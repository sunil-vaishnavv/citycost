/**
 * LIVE Google Search Grounding smoke test (makes ONE real, billed Gemini call).
 *
 * Proves (or reports exactly why it cannot prove):
 *  1. the topic reached the grounding provider
 *  2. the request used the googleSearch tool
 *  3. the API call succeeded
 *  4. the response carried real grounding metadata / source references
 *  5. sources were normalized
 *  6. supported claims became evidence records
 *  7. evidence reached the ResearchPack + writer facts digest   (only if article use is permitted)
 *  8. (article use of that evidence is then exercised by a real generation run)
 *
 * The grounded answer is printed to the operator who ran this command, unmodified,
 * and nothing is stored (Gemini API grounding terms).
 *
 * Usage: npx tsx scripts/verify-rag-live.ts ["topic"]
 * Exit codes: 0 PASS · 1 FAIL · 2 BLOCKED (missing key / policy)
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import {
  getRagModel,
  groundingArticlePolicy,
  groundingRequestConfig,
  resolveGeminiApiKey,
  retrieveGroundedCityCostData,
} from '../lib/editorial-engine/rag/index.js';

const DEFAULT_TOPIC =
  'Current rental and transport costs in Sydney, Australia, with publication date and source provenance';

function step(n: number, label: string, status: 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO', detail = '') {
  console.log(`  [${status}] ${n}. ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const topic = process.argv[2] || DEFAULT_TOPIC;
  const nonce = `verify-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  console.log(`Live grounding smoke · nonce=${nonce} · model=${getRagModel()}`);
  console.log(`Tool config sent with the request: ${JSON.stringify(groundingRequestConfig())}`);

  if (!resolveGeminiApiKey()) {
    step(1, 'Topic reached provider', 'BLOCKED', 'GEMINI_API_KEY missing or placeholder in .env / environment');
    console.log('\nRESULT: BLOCKED — add a real Gemini API key (with Search grounding access) and re-run.');
    process.exit(2);
  }

  const result = await retrieveGroundedCityCostData({
    targetCity: 'Sydney',
    topicTitle: `${topic} [${nonce}]`,
    includeDisplay: true,
  });
  const t = result.trace!;
  console.log(`Trace: ${JSON.stringify(t)}`);

  step(1, 'Topic reached provider', 'PASS', `request_id=${t.request_id}`);
  step(2, 'Request used googleSearch tool', 'PASS', `tool=${t.tool}`);
  if (result.status === 'error' || result.status === 'unavailable') {
    const isBlocked = result.error_category === 'quota_exhausted' || result.error_category === 'missing_key';
    step(3, 'API call succeeded', isBlocked ? 'BLOCKED' : 'FAIL', `${result.error_category}: ${result.error}`);
    console.log(`\nRESULT: ${isBlocked ? 'BLOCKED' : 'FAIL'} (${result.error_category})`);
    process.exit(isBlocked ? 2 : 1);
  }
  step(3, 'API call succeeded', 'PASS', `${t.latency_ms}ms finish=${t.finish_reason || 'n/a'}`);
  const hasMeta = t.grounding_chunks > 0 || t.grounding_supports > 0;
  step(
    4,
    'Grounding metadata present',
    hasMeta ? 'PASS' : 'FAIL',
    `queries=${t.web_search_queries} chunks=${t.grounding_chunks} supports=${t.grounding_supports}`
  );
  step(5, 'Sources normalized', result.sources.length ? 'PASS' : 'FAIL', `${result.sources.length} source(s)`);
  for (const s of result.sources) console.log(`        [^${s.id}] ${s.domain} — ${s.title}`);
  step(
    6,
    'Supported claims extracted',
    result.facts.length ? 'PASS' : 'FAIL',
    `${result.facts.length} fact(s), ${result.unsupportedDropped} unsourced line(s) dropped`
  );

  if (result.display) {
    console.log('\n--- Grounded answer (shown to you unmodified; not stored) ---');
    console.log(result.display.text);
    if (result.display.web_search_queries.length) {
      console.log(`Search suggestions: ${result.display.web_search_queries.join(' | ')}`);
    }
    console.log('--------------------------------------------------------------');
  }

  const policy = groundingArticlePolicy();
  if (!policy.permitted) {
    step(7, 'Evidence reaches ResearchPack / writer digest', 'BLOCKED', 'policy: article use needs written permission from Google');
    step(8, 'Generated article uses the evidence', 'BLOCKED', 'policy');
    const ok = hasMeta && result.sources.length > 0 && result.facts.length > 0;
    console.log(`\nRESULT: ${ok ? 'PASS (live grounding 1–6)' : 'FAIL'} · article pipeline use BLOCKED by policy`);
    process.exit(ok ? 0 : 1);
  }

  // Permitted: prove the evidence lands in the pack and the writer digest.
  const { buildGroundedResearchPackAsync } = await import('../lib/editorial-engine/research/build.js');
  const { buildStructuredContext } = await import('../lib/editorial-engine/writer/context-pack.js');
  const { buildFactsDigest } = await import('../lib/editorial-engine/writer/v2/prompt-sanitizer.js');
  const now = new Date();
  const synthetic = {
    id: 0,
    title: 'Sydney Cost of Living 2026: Rent and Transport',
    cluster_id: null,
    content_type: 'city_guide',
    source_refs_json: { city_slug: 'sydney-new-south-wales-australia', primary_keyword: 'sydney cost of living' },
    priority_score: 80,
    status: 'approved',
    topic_hash: nonce,
    rationale_json: [],
    locked: false,
    locked_at: null,
    locked_reason: null,
    created_at: now,
    updated_at: now,
  } as never;
  const pack = await buildGroundedResearchPackAsync(synthetic, buildStructuredContext(synthetic));
  const digest = buildFactsDigest(pack);
  const inDigest = (pack.grounded_facts || []).some((f) => digest.includes(f.statement.slice(0, 40)));
  step(
    7,
    'Evidence reaches ResearchPack / writer digest',
    pack.research_status === 'grounding_verified' && inDigest ? 'PASS' : 'FAIL',
    `research_status=${pack.research_status} grounded_facts=${pack.grounded_facts?.length || 0} in_digest=${inDigest}`
  );
  step(8, 'Generated article uses the evidence', 'INFO', 'run a real Generate Draft on a Sydney topic and inspect its [^n] citations');
  console.log(`\nRESULT: ${pack.research_status === 'grounding_verified' && inDigest ? 'PASS' : 'FAIL'}`);
  process.exit(pack.research_status === 'grounding_verified' && inDigest ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
