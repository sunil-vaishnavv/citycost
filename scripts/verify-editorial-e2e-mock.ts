/**
 * End-to-end topic → draft workflow through the REAL Writer Engine v2
 * orchestrator (all stages and gates), with a deterministic MOCKED LLM.
 *
 * Proves the pipeline wiring: public-title boundary, research pack (policy-
 * blocked grounding + CityCost ledger), section writing, humanization fallback,
 * link engine relevance, quality gates and the final public-integrity gate.
 * It does NOT prove live AI or live Google grounding.
 *
 * Optional DB leg (throwaway Postgres only): set E2E_DATABASE_URL to also
 * insert the draft, read it back, and confirm publish readiness is blocked.
 *
 * Usage: npx tsx scripts/verify-editorial-e2e-mock.ts
 */
import assert from 'node:assert/strict';
import type { EditorialTopic } from '../lib/editorial-engine/types.js';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import { buildStructuredContext } from '../lib/editorial-engine/writer/context-pack.js';
import { buildGroundedResearchPackAsync } from '../lib/editorial-engine/research/build.js';
import { runWriterV2 } from '../lib/editorial-engine/writer/v2/orchestrator.js';
import { internalTitleLabels, toPublicTitle } from '../lib/editorial-engine/utils/clean-title.js';
import { collectRenderedHeadings } from '../lib/editorial-engine/writer/v2/heading-integrity.js';
import { judgeLink, type LinkGeoScope } from '../lib/editorial-engine/writer/v2/link-relevance.js';
import { inspectPublicIntegrity } from '../lib/editorial-engine/writer/v2/public-integrity-gate.js';
import type { CalculationLedger } from '../lib/editorial-engine/research/comparison-ledger.js';

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ── Deterministic mocked LLM ──────────────────────────────────────────── */

const ANGLES = [
  'what a lease actually costs once bond and moving fees are counted',
  'how commute time changes the real price of a cheaper suburb',
  'which recurring bills tend to surprise new arrivals in the first quarter',
  'where a single renter can trade space for location without regret',
  'how a couple sharing one income should test the monthly margin',
  'why the first three months need a separate cash buffer',
  'how utility plans differ between older and newer apartment blocks',
  'when it pays to sign a longer lease instead of a periodic one',
  'what grocery habits move the weekly total more than store choice',
  'how public transport caps limit the cost of a long commute',
  'which neighbourhood trade-offs matter most for families with school-age kids',
  'how to read a rental listing for costs it does not mention',
  'why insurance and internet are easy places to overspend',
  'how to compare offers when salaries and rents both differ',
  'what to check before paying any holding deposit',
  'how seasonal demand shifts asking rents around university terms',
];
const VERBS = ['Start by', 'Begin with', 'Focus on', 'Look first at', 'Settle', 'Work out', 'Check', 'Confirm'];
const TAILS = [
  'and write the number down before viewing anything.',
  'so the comparison rests on the same household.',
  'because that line moves the budget more than any other.',
  'then revisit it after the first full month of bills.',
  'and keep the receipts to adjust next quarter.',
  'since agents rarely volunteer it unprompted.',
];

class MockLlm {
  calls: Record<string, number> = {};
  private n = 0;
  constructor(
    private readonly cities: string[],
    private readonly injectDefects: boolean
  ) {}

  private next<T>(arr: T[]): T {
    return arr[this.n++ % arr.length]!;
  }

  private sentence(topic: string, i: number): string {
    const city = this.cities[i % this.cities.length] || 'the city';
    const angle = ANGLES[(this.n + i * 5) % ANGLES.length]!;
    const verb = VERBS[(this.n * 3 + i) % VERBS.length]!;
    const tail = TAILS[(this.n + i * 7) % TAILS.length]!;
    this.n += 1;
    return `${verb} ${angle} in ${city} for ${topic.toLowerCase()}, ${tail}`;
  }

  private paragraphs(topic: string, words: number): string[] {
    const out: string[] = [];
    let count = 0;
    while (count < words) {
      const s = [0, 1, 2].map((i) => this.sentence(topic, i)).join(' ');
      out.push(s);
      count += s.split(/\s+/).length;
    }
    return out;
  }

  complete = async (system: string, user: string) => {
    const kind = /Write ONLY an intro/.test(system)
      ? 'intro'
      : /Write one article section as JSON/.test(system)
        ? 'section'
        : /unique FAQ items/.test(system)
          ? 'faq'
          : /"type":"summary"/.test(system)
            ? 'summary'
            : /^Expand this|Add one useful/m.test(system)
              ? 'expand'
              : /humanization editor/.test(system)
                ? 'humanize'
                : 'other';
    this.calls[kind] = (this.calls[kind] || 0) + 1;
    const diff = /Core monthly basket difference: (A\$[\d,]+) lower in (\w+)/.exec(user);
    let text = '{"blocks":[]}';
    if (kind === 'intro') {
      const title = /TITLE=(.+)/.exec(user)?.[1] || 'this guide';
      text = JSON.stringify({ blocks: [{ type: 'intro', content: `${title} compares everyday costs for renters. ${this.paragraphs('the move', 90).join(' ')}` }] });
    } else if (kind === 'section') {
      const heading = /Return heading exactly: (.+)/.exec(user)?.[1]?.trim() || 'Section';
      const target = Number(/Aim for (\d+)-/.exec(system)?.[1] || 120);
      const paras = this.paragraphs(heading, target);
      if (this.injectDefects && this.calls.section === 1) {
        paras[0] = `Choosing a suburb requires. looking at the commute first. ${paras[0]} See [Afghanistan living costs](/country/afghanistan).`;
      }
      text = JSON.stringify({
        blocks: [{ type: 'heading', heading, content: '' }, ...paras.map((p) => ({ type: 'paragraph', content: p }))],
      });
    } else if (kind === 'faq') {
      const items = [
        ['Which city is cheaper for a single renter?', diff ? `${diff[2]} is cheaper on the core monthly basket, by about ${diff[1]} per month.` : 'It depends on rent first.'],
        ['How much bond should I budget?', 'Plan for four weeks of rent as bond, plus the first rent payment in advance.'],
        ['Is public transport enough without a car?', 'For most inner and middle suburbs, yes, provided the commute stays on one train line.'],
        ['What bills are easy to forget?', 'Contents insurance, internet set-up and the first electricity bill after moving in.'],
        ['How long should my cash buffer last?', 'Three months of fixed costs covers lease set-up and a slow first pay cycle.'],
        ['Should I sign a 12-month lease?', 'A fixed term usually gives a steadier rent; a periodic lease keeps flexibility if work may change.'],
        ['Does the modeled remainder equal my savings?', 'No. It only subtracts rent, utilities and internet from net pay; food and transport still come out of it.'],
      ];
      text = JSON.stringify({ blocks: [{ type: 'faq', heading: 'FAQ', content: items.map(([q, a]) => ({ q, a })) }] });
    } else if (kind === 'summary') {
      text = JSON.stringify({ blocks: [{ type: 'summary', heading: 'Summary', content: `${diff ? `${diff[2]} keeps the core monthly basket about ${diff[1]} lower.` : ''} ${this.paragraphs('the decision', 50).join(' ')}` }] });
    } else if (kind === 'expand') {
      const need = Number(/NEED(?:_WORDS)?[=≈](\d+)/.exec(user)?.[1] || 80);
      text = JSON.stringify({ blocks: this.paragraphs('the budget', need).map((p) => ({ type: 'paragraph', content: p })) });
    } else if (kind === 'humanize') {
      text = 'no rewrite'; // orchestrator keeps the deterministic humanizer output
    }
    return { text, tokensIn: Math.round((system.length + user.length) / 4), tokensOut: Math.round(text.length / 4), latencyMs: 1 };
  };
}

function makeTopic(id: number, title: string, contentType: string, refs: Record<string, unknown>): EditorialTopic {
  const now = new Date();
  return {
    id,
    title,
    cluster_id: null,
    content_type: contentType,
    source_refs_json: refs,
    priority_score: 85,
    status: 'approved',
    topic_hash: `e2e-${id}`,
    rationale_json: [],
    locked: false,
    locked_at: null,
    locked_reason: null,
    created_at: now,
    updated_at: now,
  } as unknown as EditorialTopic;
}

async function runCase(
  t: EditorialTopic,
  cities: string[],
  injectDefects: boolean,
  lengths: { min: number; max: number } = { min: 900, max: 3200 }
) {
  const ctx = buildStructuredContext(t);
  const research = await buildGroundedResearchPackAsync(t, ctx);
  const llm = new MockLlm(cities, injectDefects);
  const started = Date.now();
  const result = await runWriterV2({
    topic: {
      id: t.id,
      title: toPublicTitle(t.title),
      content_type: t.content_type,
      primary_keyword: String((t.source_refs_json as Record<string, unknown>).primary_keyword || ''),
      city_a: cities[0] || null,
      city_b: cities[1] || null,
      country: 'Australia',
    },
    internalLabels: internalTitleLabels(t.title),
    research,
    settings: {
      writer_model: 'mock-llm',
      temperature: 0.4,
      top_p: 0.9,
      article_length_min: lengths.min,
      article_length_max: lengths.max,
    },
    complete: llm.complete,
  });
  return { result, research, llm, ms: Date.now() - started };
}

function assertCleanDraft(draft: WriterDraftPayload, scope: LinkGeoScope, publicTitle: string, labels: string[], ledger: CalculationLedger | null) {
  const json = JSON.stringify(draft);
  for (const l of labels) assert.ok(!json.includes(l), `label "${l}" leaked`);
  assert.ok(!/0865|Post-Fix/i.test(json), 'QA marker leaked');
  const toc = draft.blocks.find((b) => b.id === 'toc');
  assert.ok(toc, 'toc present');
  const headings = collectRenderedHeadings(draft.blocks);
  for (const entry of toc!.content as string[]) assert.ok(headings.includes(entry), `TOC entry without heading: ${entry}`);
  const links = [...json.matchAll(/\]\((\/[^)\s"]*)\)/g)].map((m) => m[1]!);
  assert.ok(links.length >= 1, 'has internal links');
  for (const h of links) assert.equal(judgeLink(h, scope), 'relevant', `irrelevant link ${h}`);
  const report = inspectPublicIntegrity(draft, { articleTitle: publicTitle, internalLabels: labels, scope, ledger });
  assert.ok(report.ok, JSON.stringify(report.errors.slice(0, 5)));
}

async function main() {
  console.log('verify-editorial-e2e-mock (REAL orchestrator, MOCKED LLM, grounding policy-blocked)');
  if (process.env.E2E_DATABASE_URL) {
    // Throwaway DB only: create editorial tables before the writer's similarity lookups run.
    const { initEditorialEngine } = await import('../lib/editorial-engine/init.js');
    const rt = await initEditorialEngine();
    console.log(`  (throwaway DB initialised: editorial ready=${rt.ready})`);
  }

  await test('fresh two-city comparison (no topic refs, QA-labelled title, injected defects)', async () => {
    const raw = 'Sydney vs Melbourne Cost of Living 2026: Post-Fix Verification (0865)';
    const t = makeTopic(9001, raw, 'comparison_guide', { primary_keyword: 'sydney vs melbourne cost of living' });
    const { result, research, llm, ms } = await runCase(t, ['Sydney', 'Melbourne'], true);
    const pub = toPublicTitle(raw);
    const words = result.debug?.final_words;
    console.log(`      ok=${result.ok} words=${words} ms=${ms} calls=${JSON.stringify(llm.calls)} research_status=${research.research_status}`);
    console.log(`      public_integrity=${JSON.stringify({ ok: result.debug?.public_integrity_report?.ok, fixes: result.debug?.public_integrity_report?.fixes })}`);
    assert.ok(result.ok, `writer failed: ${result.message}`);
    assert.equal(research.research_status, 'grounding_blocked');
    assert.ok(research.calculation_ledger, 'ledger built from CityCost data');
    assert.equal(result.draft!.seo_title.startsWith(pub), true);
    assertCleanDraft(result.draft!, research.geo_scope!, pub, internalTitleLabels(raw), research.calculation_ledger as CalculationLedger);
    const json = JSON.stringify(result.draft);
    assert.ok(!json.includes('requires. looking'), 'injected sentence break repaired');
    assert.ok(!json.includes('/country/afghanistan'), 'injected irrelevant link removed');
  });

  await test('fresh single-city article (city refs, clean title)', async () => {
    const t = makeTopic(9002, 'Cost of Living in Melbourne 2026: A Renter’s Budget', 'city_guide', {
      city_slug: 'melbourne-victoria-australia',
      primary_keyword: 'cost of living melbourne',
    });
    const { result, research, llm, ms } = await runCase(t, ['Melbourne'], false);
    console.log(`      ok=${result.ok} words=${result.debug?.final_words} ms=${ms} calls=${JSON.stringify(llm.calls)} ledger=${(research.calculation_ledger as CalculationLedger | undefined)?.kind}`);
    assert.ok(result.ok, `writer failed: ${result.message}`);
    assertCleanDraft(result.draft!, research.geo_scope!, toPublicTitle(t.title), [], research.calculation_ledger as CalculationLedger);
  });

  await test('large research context stays bounded in the writer digest', async () => {
    const t = makeTopic(9003, 'Sydney vs Melbourne Cost of Living 2026', 'comparison_guide', {});
    const ctx = buildStructuredContext(t);
    ctx.known_facts.push(...Array.from({ length: 400 }, (_, i) => `Extra fact ${i}: ${'detail '.repeat(40)}`));
    const research = await buildGroundedResearchPackAsync(t, ctx);
    const { buildFactsDigest } = await import('../lib/editorial-engine/writer/v2/prompt-sanitizer.js');
    const digest = buildFactsDigest(research);
    assert.ok(ctx.known_facts.length >= 400, 'large context supplied');
    console.log(`      context facts=${ctx.known_facts.length} pack facts=${research.supporting_facts.length} digest=${digest.length} chars`);
    assert.ok(digest.length < 12000, `digest ${digest.length} chars`);
    assert.ok(digest.includes('Core monthly basket difference'), 'ledger kept at the top of a large digest');
  });

  if (process.env.E2E_DATABASE_URL) {
    await test('DB (throwaway): draft persists as draft; publish readiness is blocked', async () => {
      const { insertDraftArticle, getArticleById } = await import('../lib/editorial-engine/db/articles-repo.js');
      const { getPublishReadiness } = await import('../lib/editorial-engine/publish/publish-gate.js');
      const raw = 'Sydney vs Melbourne Cost of Living 2026: Post-Fix Verification (0865)';
      const t = makeTopic(9101, raw, 'comparison_guide', {});
      const { getSettings } = await import('../lib/editorial-engine/db/settings-repo.js');
      const settings = await getSettings();
      const { result, research } = await runCase(t, ['Sydney', 'Melbourne'], true, {
        min: settings.article_length_min,
        max: settings.article_length_max,
      });
      assert.ok(result.ok, result.message);
      const id = await insertDraftArticle({
        slug: `e2e-sydney-vs-melbourne-${Date.now()}`,
        content_type: t.content_type,
        cluster_id: null,
        topic_id: null as unknown as number,
        draft: result.draft!,
        research,
        raw_ai_response: '{}',
        prompt_version: null as unknown as number,
        prompt_hash: 'e2e',
        ai_model: 'mock-llm',
        temperature: 0.4,
        top_p: 0.9,
        generation_time_ms: 1,
        word_count: result.debug?.final_words || 0,
        reading_time_minutes: 5,
      });
      const stored = await getArticleById(id);
      assert.equal(stored?.status, 'draft', 'saved as draft, never published');
      const readiness = await getPublishReadiness(id);
      assert.equal(readiness.ready, false);
      assert.ok(readiness.blocking_errors.some((e) => e.code === 'draft_not_allowed'));
      const pi = readiness.checks.find((c) => c.key === 'public_integrity');
      assert.ok(pi?.passed, `public integrity on stored draft: ${pi?.detail}`);
      console.log(`      article #${id} status=${stored?.status} ready=${readiness.ready} public_integrity=${pi?.passed}`);
    });
  } else {
    console.log('  - DB leg skipped (set E2E_DATABASE_URL to a throwaway Postgres to run it)');
  }

  console.log(`\n${passed} passed (mocked LLM)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
