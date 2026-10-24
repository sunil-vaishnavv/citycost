/**
 * Regression for the defects found in saved Article #117 (Sydney vs Melbourne).
 * Each fixture reproduces the exact defective text; checks run on blocks AND on
 * the final rendered HTML. Deterministic (no AI / DB / network); real catalog.
 *
 * Usage: npx tsx scripts/verify-article-117-defects.ts
 */
import assert from 'node:assert/strict';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import { runPublicIntegrityGate, inspectPublicIntegrity, finalizeDraftForSave } from '../lib/editorial-engine/writer/v2/public-integrity-gate.js';
import { inspectRenderedArticleHtml, renderArticleHtml } from '../lib/editorial-engine/blog/rendered-html-check.js';
import { buildCalculationLedger, ledgerFactLines } from '../lib/editorial-engine/research/comparison-ledger.js';
import { findDirectiveLeaks, findThinSections } from '../lib/editorial-engine/writer/v2/public-content-quality.js';
import { normalizeSiteLinks } from '../lib/editorial-engine/writer/v2/link-normalize.js';
import { slugToNaturalLabel } from '../lib/editorial-engine/writer/v2/link-engine.js';
import { validateFaq } from '../lib/editorial-engine/writer/v2/content-quality/faq-validator.js';
import { fillThinSectionsWithAi } from '../lib/editorial-engine/writer/v2/word-expand.js';
import { buildFactsDigest } from '../lib/editorial-engine/writer/v2/prompt-sanitizer.js';
import { EVIDENCE_RULES } from '../lib/editorial-engine/writer/v2/prompt-sanitizer.js';
import { validateLedgerConsistency } from '../lib/editorial-engine/writer/v2/ledger-consistency.js';
import { detectAndRepairRepetition } from '../lib/editorial-engine/writer/v2/content-quality/repetition-detector.js';

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const TITLE = 'Sydney vs Melbourne Cost of Living 2026';
const SYD = 'sydney-new-south-wales-australia';
const MEL = 'melbourne-victoria-australia';
const SCOPE = { country_codes: ['AU'], city_page_slugs: [SYD, MEL] };
const LEAK = 'CityCost figures below are final: quote them as given and do not compute other differences.';
const NEXT_STEP = 'Next step: write down one decision (neighbourhood, lease length, or budget cap) before you rely on the average alone.';
const words = (n: number, topic: string) =>
  Array.from({ length: n }, (_, i) => `${topic} detail ${i} matters for renters comparing ${i % 2 ? 'Sydney' : 'Melbourne'} costs.`).join(' ');

/** Article #117 as saved: every reported defect present. */
function article117(): WriterDraftPayload {
  return {
    seo_title: TITLE,
    meta_title: TITLE,
    meta_description: 'Compare Sydney and Melbourne rent, salaries and everyday costs in 2026.',
    excerpt: 'Sydney vs Melbourne costs compared.',
    blocks: [
      { id: 'intro', type: 'intro', content: `Moving between Australia's two largest cities is mostly a housing decision. ${LEAK}` },
      {
        id: 'toc',
        type: 'list',
        heading: 'Table of contents',
        content: ['Cons of Melbourne', 'Housing comparison (Sydney vs Melbourne Cost of Living 2026)', 'Comparison frame', 'A planned section that was never written'],
      },
      { id: 'h-frame', type: 'heading', heading: 'Comparison frame', content: '' },
      { id: 'p-frame', type: 'paragraph', content: 'Both cities are compared below.' },
      { id: 'h-housing', type: 'heading', heading: 'Housing comparison (', content: '' },
      {
        id: 'p-housing',
        type: 'paragraph',
        content: `${words(9, 'Housing')} Rent for a city-centre one-bedroom flat is A$3,277 in Sydney and A$2,537 in Melbourne in 2026. See [Sydney New](https://example.com/city/${SYD}) for item prices, or visit https://example.com/compare for more.`,
      },
      { id: 'h-salary', type: 'heading', heading: 'Salary and purchasing power comparison (', content: '' },
      { id: 'p-salary', type: 'paragraph', content: `${words(8, 'Salary')} Average net salary is A$10,298 in Sydney and A$10,111 in Melbourne.` },
      { id: 'h-food', type: 'heading', heading: 'Food and groceries', content: '' },
      {
        id: 'p-food',
        type: 'paragraph',
        content: `${words(8, 'Grocery')} Indexed grocery data is missing for both cities. Even so, Melbourne is cheaper than Sydney for groceries.`,
      },
      { id: 'h-cons', type: 'heading', heading: 'Cons of Melbourne', content: '' },
      { id: 'p-cons', type: 'paragraph', content: 'Weather can change quickly.' },
      { id: 'h-verdict', type: 'heading', heading: 'Verdict', content: '' },
      {
        id: 'p-verdict',
        type: 'paragraph',
        content: `${words(8, 'Verdict')} Melbourne is the clear winner. Melbourne is the better choice for renters on cost, because its core basket is lower.`,
      },
      {
        id: 'faq',
        type: 'faq',
        heading: 'FAQ',
        content: [
          { q: 'Is rent cheaper in Melbourne than Sydney?', a: `Yes, city-centre rent is lower in Melbourne by about A$740 a month. ${NEXT_STEP}` },
          { q: 'How much bond do landlords ask for?', a: `Usually four weeks of rent is held as bond in both cities. ${NEXT_STEP}` },
          { q: 'Are salaries higher in Sydney?', a: `Slightly — average net pay is about A$190 higher in Sydney. Next step: note one decision such as neighbourhood, lease length or budget cap before you rely on averages alone.` },
        ],
      },
      { id: 'summary', type: 'summary', heading: 'Summary', content: 'Melbourne keeps core housing costs lower for most renters.' },
    ],
  };
}

async function main() {
  console.log('verify-article-117-defects');
  const ledger = buildCalculationLedger([SYD, MEL])!;
  // Reproduce the #117 condition: no comparable grocery evidence.
  const ledgerNoGroceries = { ...ledger, evidence: { ...ledger.evidence, groceries: false } };
  const ctx = { articleTitle: TITLE, scope: SCOPE, ledger: ledgerNoGroceries, internalLabels: [] };

  await test('defects are detected on the saved draft (blocks + rendered HTML)', () => {
    const codes = new Set(inspectPublicIntegrity(article117(), ctx).errors.map((e) => e.code));
    for (const c of ['incomplete_heading', 'placeholder_url', 'directive_leak', 'repeated_boilerplate', 'thin_section', 'unsupported_category_winner', 'unsupported_broad_claim', 'toc_entry_missing_heading']) {
      assert.ok(codes.has(c), `expected ${c}; got ${[...codes].join(',')}`);
    }
    const html = new Set(inspectRenderedArticleHtml(article117()).map((f) => f.code));
    for (const c of ['incomplete_heading', 'placeholder_url', 'directive_leak']) assert.ok(html.has(c), `rendered: expected ${c}`);
  });

  const { draft, report } = runPublicIntegrityGate(article117(), ctx);
  const json = JSON.stringify(draft);
  const { toc, body } = renderArticleHtml(draft);

  await test('1. incomplete headings repaired ("Housing comparison (" → "Housing comparison")', () => {
    const heads = draft.blocks.filter((b) => b.type === 'heading').map((b) => b.heading);
    assert.ok(heads.includes('Housing comparison'));
    assert.ok(heads.includes('Salary and purchasing power comparison'));
    assert.ok(!/<h\d[^>]*>[^<]*\(\s*<\/h\d>/.test(body), 'no "(" ending in rendered headings');
  });

  await test('2. TOC = final H2 headings in order; every anchor resolves in rendered HTML', () => {
    const tocBlock = draft.blocks.find((b) => b.id === 'toc')!.content as string[];
    assert.deepEqual(tocBlock, ['Comparison frame', 'Housing comparison', 'Salary and purchasing power comparison', 'Food and groceries', 'Cons of Melbourne', 'Verdict', 'FAQ', 'Summary']);
    const ids = new Set([...body.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const anchors = [...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
    assert.equal(anchors.length, tocBlock.length);
    for (const a of anchors) assert.ok(ids.has(a), `anchor ${a}`);
    assert.deepEqual(inspectRenderedArticleHtml(draft).filter((f) => f.code.startsWith('toc')), []);
  });

  await test('3. placeholder URL → verified relative route; "Sydney New" → "Sydney"; bare example URL removed', () => {
    assert.ok(!json.includes('example.com'));
    assert.ok(json.includes(`[Sydney](/city/${SYD})`), 'catalog label + relative route');
    assert.ok(!json.includes('Sydney New'));
    assert.equal(slugToNaturalLabel(`/city/${SYD}`), 'Sydney');
    const unknown = normalizeSiteLinks('See [costs](https://example.com/not/a/route) here.', SCOPE);
    assert.equal(unknown.text, 'See costs here.');
    const external = normalizeSiteLinks('Source: [ABS](https://www.abs.gov.au/statistics).', SCOPE);
    assert.equal(external.fixes.length, 0, 'real external links untouched');
  });

  await test('4. instruction leak removed; figures and years preserved', () => {
    assert.ok(!json.includes('quote them as given') && !json.includes('figures below are final'));
    assert.ok(json.includes('A$3,277') && json.includes('A$10,298') && json.includes('2026'));
    assert.deepEqual(findDirectiveLeaks(ledgerFactLines(ledger).join(' ')), [], 'ledger facts carry no directives');
    assert.ok(/quote CityCost figures exactly/.test(EVIDENCE_RULES), 'rules live in the system prompt instead');
  });

  await test('5. repeated FAQ "Next step" boilerplate removed (exact and re-worded)', () => {
    const faq = draft.blocks.find((b) => b.type === 'faq')!.content as Array<{ a: string }>;
    const withNext = faq.filter((f) => /next step/i.test(f.a)).length;
    assert.ok(withNext <= 1, `next-step lines left: ${withNext}`);
    assert.ok(faq[0]!.a.startsWith('Yes, city-centre rent is lower in Melbourne'), 'direct answer kept');
    const v = validateFaq({ ...article117(), blocks: [{ id: 'faq', type: 'faq', content: [{ q: 'Bond?', a: 'Four weeks.' }] }] });
    assert.ok(!JSON.stringify(v.draft).includes('Next step'), 'validator no longer appends boilerplate');
  });

  await test('6. thin sections are blocking until filled with topic-specific content', async () => {
    const thin = findThinSections(draft).map((t) => t.heading);
    assert.ok(thin.includes('Comparison frame') && thin.includes('Cons of Melbourne'), thin.join(','));
    assert.ok(!report.ok && report.errors.some((e) => e.code === 'thin_section'), 'gate blocks thin sections');
    const fill = await fillThinSectionsWithAi({
      draft,
      thinHeadings: thin,
      minSectionWords: 50,
      factsDigest: 'Sydney rent A$3,277; Melbourne rent A$2,537.',
      guideId: 'comparison',
      readerLabel: 'renter',
      complete: async (system) => {
        const heading = /"([^"]+)" section/.exec(system)?.[1] || '';
        return JSON.stringify({
          blocks: [
            { type: 'paragraph', content: `${heading}: ${'Specific comparison point about leases, commutes and the A$740 rent gap between the two cities. '.repeat(4)}` },
          ],
        });
      },
    });
    assert.deepEqual(findThinSections(fill.draft), []);
  });

  await test('7. grocery winner without comparable evidence removed; disclosure kept', () => {
    assert.ok(!json.includes('Melbourne is cheaper than Sydney for groceries'));
    assert.ok(json.includes('Indexed grocery data is missing for both cities'));
    // With evidence the same claim is allowed.
    const withEvidence = runPublicIntegrityGate(article117(), { ...ctx, ledger: { ...ledger, evidence: { ...ledger.evidence, groceries: true } } });
    assert.ok(JSON.stringify(withEvidence.draft).includes('Melbourne is cheaper than Sydney for groceries'));
  });

  await test('8. broad "clear winner" claim removed; cost-qualified conclusion kept', () => {
    assert.ok(!json.includes('Melbourne is the clear winner'));
    assert.ok(json.includes('Melbourne is the better choice for renters on cost'));
  });

  await test('after repairs the only residual blocker is the thin content that needs writing', () => {
    const codes = [...new Set(report.errors.map((e) => e.code))];
    assert.deepEqual(codes, ['thin_section'], JSON.stringify(report.errors, null, 1));
    const html = inspectRenderedArticleHtml(draft);
    assert.deepEqual(html, [], JSON.stringify(html));
  });

  await test('revisions re-run integrity: finalizeDraftForSave repairs generated drafts, never manual ones', () => {
    const gen = finalizeDraftForSave({ research_pack_json: { geo_scope: SCOPE, calculation_ledger: ledgerNoGroceries } }, article117());
    assert.ok(!JSON.stringify(gen.draft).includes('example.com'));
    assert.ok(gen.fixes.includes('toc_rebuilt_from_headings'));
    const manual = finalizeDraftForSave({ prompt_hash: 'manual' }, article117());
    assert.equal(JSON.stringify(manual.draft), JSON.stringify(article117()));
  });

  await test('writer facts digest: data gaps are facts, not directives', () => {
    const digest = buildFactsDigest({ calculation_ledger: ledgerNoGroceries } as never);
    assert.ok(!/do not state|quote them as given|figures below are final/i.test(digest), digest);
  });

  await test('remainder-as-savings: conflation flagged, correct disclaimer not flagged', () => {
    const para = (content: string) =>
      ({ seo_title: TITLE, blocks: [{ id: 'p', type: 'paragraph', content }] }) as unknown as WriterDraftPayload;
    const bad = validateLedgerConsistency(para('The modeled remainder is what you can put into savings each month.'), ledger);
    assert.ok(bad.some((f) => f.code === 'conflates_remainder'), JSON.stringify(bad));
    const ok = validateLedgerConsistency(
      para('This modeled remainder is net salary minus the core monthly basket, and it is not disposable income or savings.'),
      ledger
    );
    assert.ok(!ok.some((f) => f.code === 'conflates_remainder'), JSON.stringify(ok));
  });

  await test('far-apart duplicate paragraphs are removed, so the final repetition check passes', () => {
    const dup =
      'Renters in both cities should compare bond rules, lease length and commuting costs before signing, because those three items move the monthly budget more than small price differences.';
    const TOPICS = ['tram passes', 'gas bills', 'gym fees', 'childcare', 'parking', 'pet insurance', 'phone plans', 'cinema tickets', 'coffee', 'ferries', 'bike hire', 'council rates', 'water bills', 'laundry'];
    const filler = (i: number) => ({
      id: `f${i}`,
      type: 'paragraph',
      content: `${TOPICS[i]} vary by suburb ${i}, so check ${TOPICS[(i + 5) % TOPICS.length]} quotes alongside ${TOPICS[(i + 9) % TOPICS.length]} before budgeting.`,
    });
    const draft = {
      seo_title: TITLE,
      blocks: [
        { id: 'h1', type: 'heading', heading: 'Housing comparison', level: 2 },
        { id: 'd1', type: 'paragraph', content: dup },
        ...Array.from({ length: 14 }, (_, i) => filler(i)),
        { id: 'h2', type: 'heading', heading: 'Practical tips', level: 2 },
        // near-duplicate (different hash) far outside the 12-block fuzzy window
        { id: 'd2', type: 'paragraph', content: dup.replace('Renters in both cities', 'Renters in either city') },
      ],
    } as unknown as WriterDraftPayload;
    const r = detectAndRepairRepetition(draft);
    assert.notEqual(r.result.status, 'FAIL', JSON.stringify(r.result.findings));
    const ids = r.draft.blocks.map((b) => b.id);
    assert.ok(ids.includes('d1') && !ids.includes('d2'), ids.join(','));
  });

  console.log(`\n${passed} passed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
