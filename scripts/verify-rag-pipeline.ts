/**
 * Offline verification for the CityCost RAG pipeline + claim-by-claim fact checker.
 * No network: the Gemini call is replaced with fixture responses via the `generate` seam.
 *
 * Usage: npx tsx scripts/verify-rag-pipeline.ts
 * Live check (real Gemini call): npx tsx scripts/verify-rag-live.ts
 */

import { strict as assert } from 'node:assert';
import {
  auditArticleClaimsAgainstRag,
  auditTextClaimsAgainstRag,
  parseGroundedResponse,
  retrieveGroundedCityCostData,
  type GroundedModelResponse,
} from '../lib/editorial-engine/rag/index.js';
import { assembleResearchPack } from '../lib/editorial-engine/research/build.js';
import { stripUntrustedGrounding, trustedRagEvidence } from '../lib/editorial-engine/research/rag-trust.js';
import { buildStructuredContext } from '../lib/editorial-engine/writer/context-pack.js';
import type { EditorialTopic } from '../lib/editorial-engine/types.js';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/';

/** Build a grounded response whose supports point at numbered lines by UTF-8 byte offset. */
function groundedFixture(
  lines: Array<{ text: string; chunks: number[]; byText?: boolean }>,
  chunkTitles: string[]
): GroundedModelResponse {
  const header = 'Here is the current data for Berlin and Munich:\n';
  let text = header;
  const supports: NonNullable<NonNullable<GroundedModelResponse['candidates']>[0]['groundingMetadata']>['groundingSupports'] = [];
  lines.forEach((l, i) => {
    const line = `${i + 1}. ${l.text}`;
    const start = Buffer.byteLength(text, 'utf8') + 3; // after "N. "
    const end = Buffer.byteLength(text + line, 'utf8');
    text += `${line}\n`;
    if (!l.chunks.length) return;
    supports!.push(
      l.byText
        ? { segment: { text: l.text }, groundingChunkIndices: l.chunks }
        : { segment: { startIndex: start, endIndex: end, text: l.text }, groundingChunkIndices: l.chunks }
    );
  });
  return {
    text,
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: chunkTitles.map((t, i) => ({ web: { uri: `${REDIRECT}${i}`, title: t } })),
          groundingSupports: supports,
        },
      },
    ],
  };
}

const BERLIN_MUNICH = groundedFixture(
  [
    { text: 'In Berlin, the average 1-bedroom rent in the city centre is €1,250 per month.', chunks: [2] },
    { text: 'In München (Munich), a 1-bedroom apartment rents for about €1,690 per month.', chunks: [0, 2] },
    { text: 'A Deutschlandticket monthly transit pass costs €58 in both Berlin and Munich.', chunks: [1], byText: true },
    { text: 'Munich has a very high quality of life and many parks for residents.', chunks: [0] }, // no figure → dropped
    { text: 'Berlin groceries for a single adult average €320 per month.', chunks: [] }, // unsourced → dropped
  ],
  ['immowelt.de', 'bahn.de', 'numbeo.com', 'unused-source.com']
);

async function main() {
  console.log('verify-rag-pipeline');

  await test('no API key → unavailable, empty, never another city’s data', async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const r = await retrieveGroundedCityCostData({ targetCity: 'Berlin', comparisonCity: 'Munich' });
      assert.equal(r.status, 'unavailable');
      assert.match(r.error || '', /GEMINI_API_KEY/);
      assert.equal(r.facts.length, 0);
      assert.equal(r.sources.length, 0);
      assert.ok(!JSON.stringify(r).toLowerCase().includes('austin'), 'no Austin fallback leak');
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    }
  });

  await test('provider failure (bad model / quota / timeout) → error status, no facts', async () => {
    const r = await retrieveGroundedCityCostData({
      targetCity: 'Lisbon',
      generate: async () => {
        throw new Error('404 models/gemini-x is not found');
      },
    });
    assert.equal(r.status, 'error');
    assert.match(r.error || '', /not found/);
    assert.equal(r.facts.length, 0);
    assert.equal(r.sources.length, 0);
  });

  await test('live: only source-backed, quantified statements kept; citations are real', async () => {
    const r = await retrieveGroundedCityCostData({
      targetCity: 'Berlin',
      comparisonCity: 'Munich',
      generate: async () => BERLIN_MUNICH,
    });
    assert.equal(r.status, 'live');
    assert.equal(r.facts.length, 3, 'unsourced + non-numeric lines dropped');
    assert.equal(r.unsupportedDropped, 2);

    // Sources: only the 3 referenced chunks, renumbered in first-use order, real domains.
    assert.deepEqual(r.sources.map((s) => s.domain), ['numbeo.com', 'immowelt.de', 'bahn.de']);
    assert.ok(r.sources.every((s) => s.url.startsWith(REDIRECT)), 'urls come from Gemini, not synthesized');

    const [berlinRent, munichRent, transit] = r.facts;
    assert.deepEqual(berlinRent.sourceIds, [1]);
    assert.equal(berlinRent.citationRef, '[^1]');
    assert.equal(berlinRent.city, 'Berlin');
    assert.equal(berlinRent.category, 'rent');
    assert.match(berlinRent.figure || '', /€1,250/);

    assert.deepEqual(munichRent.sourceIds, [2, 1], 'multi-source attribution kept (chunk order)');
    assert.equal(munichRent.city, 'Munich');

    assert.deepEqual(transit.sourceIds, [3], 'segment.text matching works without offsets');
    assert.equal(transit.city, undefined, 'statement naming both cities is not pinned to one');
    assert.equal(transit.category, 'transport');
    assert.deepEqual(r.factLines[0], '[^1] In Berlin, the average 1-bedroom rent in the city centre is €1,250 per month.');
  });

  await test('live call with no supports → no_evidence', async () => {
    const r = await retrieveGroundedCityCostData({
      targetCity: 'Tokyo',
      generate: async () => ({ text: '1. Tokyo rent is ¥115,000 per month on average.\n', candidates: [{}] }),
    });
    assert.equal(r.status, 'no_evidence');
    assert.equal(r.facts.length, 0);
  });

  await test('parser ignores out-of-range chunk indices', () => {
    const fx = groundedFixture([{ text: 'Paris 1-bedroom rent averages €1,400 per month.', chunks: [7] }], ['a.com']);
    const out = parseGroundedResponse(fx, { targetCity: 'Paris' });
    assert.equal(out.facts.length, 0);
    assert.equal(out.sources.length, 0);
  });

  const topic: EditorialTopic = {
    id: 0,
    title: 'Berlin vs Munich: Cost of Living Comparison Guide',
    cluster_id: null,
    content_type: 'comparison_guide',
    source_refs_json: { primary_keyword: 'berlin vs munich cost of living', country: 'Germany', cities: ['Berlin', 'Munich'] },
    priority_score: 80,
    status: 'approved',
    topic_hash: 'x',
    rationale_json: [],
    locked: false,
    locked_at: null,
    locked_reason: null,
    created_at: new Date(),
    updated_at: new Date(),
  } as unknown as EditorialTopic;
  const ctx = buildStructuredContext(topic);

  await test('research pack: unavailable grounding adds a data gap, no sources, no fake score', async () => {
    const rag = await retrieveGroundedCityCostData({
      targetCity: 'Berlin',
      generate: async () => {
        throw new Error('429 quota exceeded');
      },
    });
    const pack = assembleResearchPack(topic, ctx, rag);
    assert.equal(pack.grounding_sources, undefined);
    assert.equal(pack.grounded_facts, undefined);
    assert.equal(pack.rag_accuracy_score, undefined, 'no hardcoded 96');
    assert.equal(pack.rag_status, rag.status);
    assert.ok(pack.known_data_gaps.some((g) => g.includes('No live web-sourced figures')));
    assert.ok(!pack.supporting_facts.some((f) => /\[\^\d+\]/.test(f)), 'no footnoted facts');
  });

  await test('research pack: live grounding adds cited facts + sources', async () => {
    const rag = await retrieveGroundedCityCostData({
      targetCity: 'Berlin',
      comparisonCity: 'Munich',
      generate: async () => BERLIN_MUNICH,
    });
    const pack = assembleResearchPack(topic, ctx, rag);
    assert.equal(pack.rag_status, 'live');
    assert.equal(pack.grounding_sources?.length, 3);
    assert.ok(pack.supporting_facts.includes(rag.factLines[0]));
  });

  await test('legacy packs (pre-fix fallback data) are not trusted or reused', () => {
    const legacy = {
      ...assembleResearchPack(topic, ctx, null),
      supporting_facts: ['CityCost index: 72', '[^1] In Austin, TX, the median rent for a 1-bedroom apartment in 2026 is approximately $1,520/month.'],
      grounding_sources: [{ id: 1, title: 'Austin report', url: 'https://www.citycost.org/data/us/austin-rent-report-2026', domain: 'citycost.org', retrievedAt: '2026-10-22' }],
      grounded_facts: [{ category: 'rent', statement: 'In Austin, TX, the median rent…', sourceId: 1, citationRef: '[^1]' }],
      rag_accuracy_score: 96,
    };
    assert.deepEqual(trustedRagEvidence(legacy), { facts: [], sources: [] });
    const cleaned = stripUntrustedGrounding(legacy);
    assert.equal(cleaned.grounding_sources, undefined);
    assert.equal(cleaned.grounded_facts, undefined);
    assert.equal(cleaned.rag_accuracy_score, undefined);
    assert.deepEqual(cleaned.supporting_facts, ['CityCost index: 72'], 'injected [^n] facts removed, own facts kept');
    assert.equal(cleaned.rag_status, 'unavailable');
  });

  // ── Claim checker ──────────────────────────────────────────────────────────
  const live = await retrieveGroundedCityCostData({
    targetCity: 'Berlin',
    comparisonCity: 'Munich',
    generate: async () => BERLIN_MUNICH,
  });

  await test('fact checker: accurate claims verified with the right source', () => {
    const report = auditTextClaimsAgainstRag(
      'In Berlin, the average 1-bedroom rent in the city centre is about €1,240 per month. In Munich, a 1-bedroom apartment rents for about €1,700 per month.',
      live.facts,
      live.sources
    );
    assert.equal(report.status, 'audited');
    assert.equal(report.disputedCount, 0);
    assert.equal(report.verifiedCount, 2);
    assert.equal(report.passed, true);
    assert.equal(report.claims[0].matchedSourceId, 1);
  });

  await test('fact checker: wrong figures are disputed and fail the gate', () => {
    const report = auditTextClaimsAgainstRag(
      'In Berlin, the average 1-bedroom rent in the city centre is €2,900 per month.',
      live.facts,
      live.sources
    );
    assert.equal(report.disputedCount, 1);
    assert.equal(report.passed, false);
    assert.match(report.claims[0].discrepancyNote || '', /discrepancy/);
  });

  await test('fact checker: city-aware — Munich claim is not checked against Berlin evidence', () => {
    const report = auditTextClaimsAgainstRag(
      'In Munich, the average 1-bedroom rent in the city centre is €1,250 per month.',
      live.facts,
      live.sources
    );
    // Berlin's €1,250 must not "verify" a Munich claim; Munich evidence is €1,690.
    assert.notEqual(report.claims[0].matchedEvidence, live.facts[0].statement);
    assert.notEqual(report.claims[0].status, 'verified');
  });

  await test('fact checker: a footnote alone never verifies a claim', () => {
    const unrelated = auditTextClaimsAgainstRag(
      'Berlin dentists charge €95 for a routine cleaning appointment [^1].',
      live.facts,
      live.sources
    );
    assert.equal(unrelated.claims[0].status, 'ungrounded');
    assert.match(unrelated.claims[0].discrepancyNote || '', /\[\^1\]/);

    const unknown = auditTextClaimsAgainstRag(
      'In Berlin, the average 1-bedroom rent in the city centre is €1,250 per month [^9].',
      live.facts,
      live.sources
    );
    assert.equal(unknown.claims[0].status, 'ungrounded');
    assert.match(unknown.claims[0].discrepancyNote || '', /not a retrieved source/);
  });

  await test('fact checker: footnote to the backing source verifies', () => {
    const report = auditTextClaimsAgainstRag(
      'In Berlin, the average 1-bedroom rent in the city centre is €1,250 per month [^1].',
      live.facts,
      live.sources
    );
    assert.equal(report.claims[0].status, 'verified');
    assert.equal(report.claims[0].matchedSourceId, 1);
  });

  await test('fact checker: no evidence → not audited (no score, no fake pass)', () => {
    const report = auditArticleClaimsAgainstRag(
      [{ type: 'paragraph', content: 'Berlin rent averages €1,250 per month for a 1-bedroom flat.' }],
      [],
      []
    );
    assert.equal(report.status, 'no_evidence');
    assert.equal(report.accuracyScore, null);
    assert.equal(report.passed, false);
    assert.equal(report.claims.length, 0);
    assert.equal(report.totalClaims, 1);
  });

  console.log(`\n${passed} passed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ RAG Pipeline Test Failed:', err);
    process.exit(1);
  });
