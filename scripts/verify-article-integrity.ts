/**
 * Article integrity regression — fixtures from the Sydney–Melbourne defects.
 * Deterministic (no AI, no DB, no network). Uses the real CityCost catalog for
 * route existence, geography and the calculation ledger.
 *
 * Usage: npx tsx scripts/verify-article-integrity.ts
 */
import assert from 'node:assert/strict';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import { findQaMarkers, internalTitleLabels, toPublicTitle } from '../lib/editorial-engine/utils/clean-title.js';
import {
  detectCorruptSentenceBreaks,
  repairCorruptSentenceBreaks,
  safeSplitLongSentence,
} from '../lib/editorial-engine/writer/v2/prose-integrity.js';
import { inspectHeadingsAndToc, repairHeadingsAndToc } from '../lib/editorial-engine/writer/v2/heading-integrity.js';
import { buildTocHtml, renderArticleBlocksHtml } from '../lib/editorial-engine/blog/blog-render.js';
import { judgeLink, inferGeoFromText, relevantLinkPool } from '../lib/editorial-engine/writer/v2/link-relevance.js';
import { runInternalLinkEngine, unlinkIrrelevantLinks } from '../lib/editorial-engine/writer/v2/link-engine.js';
import { buildStructuredContext } from '../lib/editorial-engine/writer/context-pack.js';
import { assembleResearchPack } from '../lib/editorial-engine/research/build.js';
import { buildCalculationLedger, ledgerFactLines } from '../lib/editorial-engine/research/comparison-ledger.js';
import { validateLedgerConsistency } from '../lib/editorial-engine/writer/v2/ledger-consistency.js';
import {
  inspectPublicIntegrity,
  runPublicIntegrityGate,
} from '../lib/editorial-engine/writer/v2/public-integrity-gate.js';
import { applyDeterministicRepairs } from '../lib/editorial-engine/revision/revision-validator.js';
import { buildFactsDigest } from '../lib/editorial-engine/writer/v2/prompt-sanitizer.js';
import type { EditorialTopic } from '../lib/editorial-engine/types.js';

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const RAW_TITLE = 'Sydney vs Melbourne Cost of Living 2026: Post-Fix Verification (0865)';
const PUBLIC_TITLE = 'Sydney vs Melbourne Cost of Living 2026';
const SYD = 'sydney-new-south-wales-australia';
const MEL = 'melbourne-victoria-australia';
const SCOPE = { country_codes: ['AU'], city_page_slugs: [SYD, MEL] };

function topic(title: string, refs: Record<string, unknown> = {}): EditorialTopic {
  const now = new Date();
  return {
    id: 0,
    title,
    cluster_id: null,
    content_type: 'comparison_guide',
    source_refs_json: refs,
    priority_score: 80,
    status: 'approved',
    topic_hash: 't',
    rationale_json: [],
    locked: false,
    locked_at: null,
    locked_reason: null,
    created_at: now,
    updated_at: now,
  } as unknown as EditorialTopic;
}

/** A draft carrying every observed defect class. */
function defectiveDraft(): WriterDraftPayload {
  return {
    seo_title: RAW_TITLE,
    meta_title: `${RAW_TITLE} | CityCost`,
    meta_description: 'Compare rent in Sydney vs Melbourne (Post-Fix Verification 0865) for 2026.',
    excerpt: 'Rent and transport compared for 2026.',
    blocks: [
      { id: 'intro', type: 'intro', content: 'Choosing between Sydney and Melbourne requires. looking at rent first.' },
      {
        id: 'toc',
        type: 'list',
        heading: 'Table of contents',
        content: ['Housing costs', `Transport options — ${PUBLIC_TITLE}`, 'A section that was never written'],
      },
      { id: 'h1', type: 'heading', heading: `Housing costs — ${PUBLIC_TITLE}`, content: '' },
      {
        id: 'p1',
        type: 'paragraph',
        content:
          'Melbourne rents are steeper. upfront costs include a bond. See [Afghanistan living costs](/country/afghanistan) and [Sydney prices](/city/sydney-new-south-wales-australia). ' +
          'A one-bedroom flat near the Sydney CBD lists for about A$3,277 a month, against roughly A$2,537 for a comparable Melbourne unit. ' +
          'Inner-ring suburbs with a direct train line usually cost a few hundred dollars less than city-centre stock, so renters often trade twenty minutes of commuting for a lower lease. ' +
          'Budget four weeks of rent as bond plus the first month in advance before you sign.',
      },
      { id: 'h2', type: 'heading', heading: 'Transport options', content: '' },
      {
        id: 'p2',
        type: 'paragraph',
        content:
          'Good transport. routes help, providing a. solid base. Do a test run of your commute before signing. ' +
          'Sydney trains and Melbourne trams both cap weekly fares, which makes daily commuting predictable once you know your zone. ' +
          'Cyclists in flatter Melbourne neighbourhoods often skip a pass entirely, while hilly Sydney suburbs push most residents onto buses or ferries. ' +
          'Check whether your employer subsidises a travel card before choosing a suburb far from the office.',
      },
      {
        id: 'tbl',
        type: 'table',
        heading: 'Rent snapshot',
        content: { headers: ['City', 'Rent'], rows: [['Sydney', 'A$3,277'], ['Melbourne', 'A$2,537']] },
      },
      {
        id: 'faq',
        type: 'faq',
        heading: 'FAQ',
        content: [
          { q: 'Is Melbourne cheaper than Sydney (QA run 12)?', a: 'Yes. Melbourne is cheaper than Sydney, with a core basket about A$786 lower per month.' },
        ],
      },
      { id: 'summary', type: 'summary', heading: 'Summary', content: 'Melbourne usually costs less to live in for a renter.' },
    ],
  };
}

async function main() {
  console.log('verify-article-integrity');

  // ── D1 title / metadata boundary ──────────────────────────────────────
  await test('public title drops QA markers but keeps years, prices and real words', () => {
    assert.equal(toPublicTitle(RAW_TITLE), PUBLIC_TITLE);
    assert.deepEqual(internalTitleLabels(RAW_TITLE), ['Post-Fix Verification (0865)']);
    const keep = [
      'Sydney vs Melbourne Cost of Living (2026)',
      'Rent in Lisbon (1-Bedroom, €1,250): What Changed in 2026',
      'Visa Verification Costs in Dubai',
      'NYC Rent: A Regression Analysis of 2025 Prices',
    ];
    for (const t of keep) assert.equal(toPublicTitle(t), t);
    assert.equal(toPublicTitle('[QA] Berlin Rent Guide 2026 — smoke test run #12'), 'Berlin Rent Guide 2026');
    assert.equal(toPublicTitle('Austin Living Costs 2026 (Job #4412)'), 'Austin Living Costs 2026');
  });

  await test('body mode does not flag ordinary English ("test run", "dry run")', () => {
    assert.deepEqual(findQaMarkers('Do a test run of your commute and a dry run of the budget.', 'body'), []);
    assert.ok(findQaMarkers('Post-fix verification of rents', 'body').length > 0);
  });

  // ── D3 punctuation / prose ────────────────────────────────────────────
  await test('corrupt sentence breaks detected + repaired; no false positives', () => {
    const bad = 'It requires. looking at rents. They are steeper. upfront costs differ. Good transport. routes help, providing a. solid base.';
    assert.deepEqual(detectCorruptSentenceBreaks(bad).map((b) => b.snippet), [
      'requires. looking',
      'steeper. upfront',
      'transport. routes',
      'a. solid',
    ]);
    const fixed = repairCorruptSentenceBreaks(bad);
    assert.equal(fixed.fixes, 4);
    assert.equal(detectCorruptSentenceBreaks(fixed.text).length, 0);
    const ok = 'Rent is A$2,100 (approx. one-third of pay), e.g. inner suburbs. U.S. rents differ. See [costs](/city/x). a. First item\nSt. kilda is busy. The iPhone costs more.';
    assert.deepEqual(detectCorruptSentenceBreaks(ok), []);
  });

  await test('safe sentence split never cuts mid-clause or inside numbers', () => {
    const [a, b] = safeSplitLongSentence(
      'Sydney rents for a one-bedroom unit near the centre average A$2,600 a month, while Melbourne equivalents sit closer to A$2,100 for similar access.'
    );
    assert.ok(a!.endsWith('month.') && /^Meanwhile, Melbourne/.test(b!));
    const one = 'The basket in Sydney costs about A$3,450 including rent utilities internet groceries transport and a small entertainment allowance for one person.';
    assert.deepEqual(safeSplitLongSentence(one), [one]);
  });

  await test('Fix Issues readability repair no longer corrupts prose, numbers, lists or tables', () => {
    const draft: WriterDraftPayload = {
      seo_title: PUBLIC_TITLE,
      meta_title: PUBLIC_TITLE,
      meta_description: 'd',
      excerpt: 'e',
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          content:
            'Living in Sydney as a single renter who commutes by train every weekday requires looking closely at bond, letting fees and the A$1,520 upfront cost before you sign anything at all.\n\n- Bond: four weeks\n- Letting fee: none\n\nSee [Sydney prices](/city/sydney-new-south-wales-australia).',
        },
        { id: 'tbl', type: 'table', content: { headers: ['City', 'Rent'], rows: [['Sydney', 'A$3,277']] } },
      ],
    };
    const out = applyDeterministicRepairs(draft, 'READABILITY').draft;
    const p = String(out.blocks.find((b) => b.id === 'p')!.content);
    assert.equal(detectCorruptSentenceBreaks(p).length, 0, p);
    assert.ok(p.includes('A$1,520'), 'number intact');
    assert.ok(p.includes('\n- Bond: four weeks\n- Letting fee: none'), 'markdown list intact');
    assert.ok(p.includes('[Sydney prices](/city/sydney-new-south-wales-australia)'), 'link intact');
    assert.deepEqual(out.blocks.find((b) => b.id === 'tbl')!.content, draft.blocks[1]!.content, 'table untouched');
  });

  // ── D2 TOC / headings ─────────────────────────────────────────────────
  await test('TOC rebuilt from final headings; title suffix removed; dangling entry dropped', () => {
    const { draft } = repairHeadingsAndToc(defectiveDraft(), PUBLIC_TITLE);
    const toc = draft.blocks.find((b) => b.id === 'toc')!.content as string[];
    assert.deepEqual(toc, ['Housing costs', 'Transport options', 'Rent snapshot', 'FAQ', 'Summary']);
    assert.equal(inspectHeadingsAndToc(draft, PUBLIC_TITLE).length, 0);
  });

  await test('duplicate sections under the same name are reported', () => {
    const d = defectiveDraft();
    d.blocks.push({ id: 'h9', type: 'heading', heading: 'Transport options', content: '' });
    const codes = inspectHeadingsAndToc(repairHeadingsAndToc(d, PUBLIC_TITLE).draft, PUBLIC_TITLE).map((f) => f.code);
    assert.ok(codes.includes('duplicate_heading'));
  });

  await test('rendered HTML: every TOC anchor has a matching heading id; "contents" lists still render', () => {
    const d = repairHeadingsAndToc(defectiveDraft(), PUBLIC_TITLE).draft;
    d.blocks.splice(5, 0, {
      id: 'ins',
      type: 'list',
      heading: 'Insurance',
      content: ['Contents insurance is about A$30 a month.'],
    });
    const html = renderArticleBlocksHtml(d);
    const anchors = [...buildTocHtml(d.blocks).matchAll(/href="#(section-\d+)"/g)].map((m) => m[1]);
    const ids = new Set([...html.matchAll(/ id="(section-\d+)"/g)].map((m) => m[1]));
    assert.ok(anchors.length >= 5);
    for (const a of anchors) assert.ok(ids.has(a), `anchor ${a} has a heading`);
    assert.ok(html.includes('Contents insurance is about A$30'), 'list mentioning "contents" is rendered');
  });

  // ── D4 internal links ─────────────────────────────────────────────────
  await test('link relevance: Afghanistan irrelevant, Australian pages relevant, fake routes unknown', () => {
    assert.equal(judgeLink('/country/afghanistan', SCOPE), 'irrelevant');
    assert.equal(judgeLink('/country/australia', SCOPE), 'relevant');
    assert.equal(judgeLink(`/city/${SYD}`, SCOPE), 'relevant');
    assert.equal(judgeLink('/compare/melbourne-vs-canberra', SCOPE), 'relevant');
    assert.equal(judgeLink('/compare/melbourne-vs-addis-ababa', SCOPE), 'irrelevant');
    assert.equal(judgeLink('/city/atlantis-nowhere', SCOPE), 'unknown_route');
    assert.equal(judgeLink('/about', SCOPE), 'irrelevant');
  });

  await test('irrelevant links are unlinked (text kept); link engine only injects relevant links', () => {
    const un = unlinkIrrelevantLinks(defectiveDraft(), SCOPE);
    const p1 = String(un.draft.blocks.find((b) => b.id === 'p1')!.content);
    assert.ok(p1.includes('Afghanistan living costs') && !p1.includes('/country/afghanistan'));
    assert.ok(p1.includes(`](/city/${SYD})`));
    const res = runInternalLinkEngine({
      draft: { ...defectiveDraft(), blocks: defectiveDraft().blocks.map((b) => (b.id === 'p1' ? { ...b, content: 'Rents differ by suburb.' } : b)) },
      candidates: ['/country/afghanistan', '/about', `/city/${MEL}`, '/methodology', '/data-sources'],
      scope: SCOPE,
    });
    assert.ok(res.report.ok, JSON.stringify(res.report));
    assert.ok(res.report.paths_injected.every((h) => judgeLink(h, SCOPE) === 'relevant'), res.report.paths_injected.join(','));
    assert.ok(!res.report.paths_injected.includes('/about'));
    const text = JSON.stringify(res.draft.blocks);
    assert.ok(!text.includes('For related planning context'), 'no generic repeated CTA');
  });

  await test('context pack for a topic without refs infers Sydney/Melbourne and lists only Australian pages', () => {
    const t = topic(RAW_TITLE);
    const ctx = buildStructuredContext(t);
    assert.deepEqual(ctx.geo.country_codes, ['AU']);
    assert.deepEqual(ctx.geo.city_page_slugs, [SYD, MEL]);
    const hrefs = [...ctx.related_cities, ...ctx.related_countries, ...ctx.related_comparisons].map((l) => l.href);
    assert.ok(hrefs.length >= 3, hrefs.join(','));
    for (const h of hrefs) assert.equal(judgeLink(h, ctx.geo), 'relevant', h);
    assert.ok(!hrefs.some((h) => /afghanistan|albania|algeria/.test(h)));
    const pack = assembleResearchPack(t, ctx, null);
    assert.ok(relevantLinkPool(pack).length >= 3);
  });

  // ── D5 numbers ────────────────────────────────────────────────────────
  await test('ledger: same currency (no FX), cross currency (FX disclosed), missing side (gap)', () => {
    const au = buildCalculationLedger([SYD, MEL])!;
    assert.equal(au.status, 'complete');
    assert.equal(au.same_currency, true);
    assert.equal(au.difference?.basis, 'same_currency');
    assert.equal(au.difference?.currency, 'AUD');
    assert.equal(au.fx.basis, 'none');
    assert.equal(au.difference!.cheaper, 'Melbourne');
    const x = buildCalculationLedger(['berlin-berlin-germany', 'new-york-new-york-united-states'])!;
    assert.equal(x.difference?.basis, 'usd_converted');
    assert.equal(x.fx.basis, 'static_reference_table');
    assert.equal(x.fx.as_of, null, 'no invented FX date');
    assert.ok(ledgerFactLines(x).some((l) => /no recorded reference date/.test(l)));
    assert.ok(x.difference!.cheaper_lower_pct < 100, 'lower-% is relative to the dearer side');
    const partial = buildCalculationLedger(['atlantis-nowhere', MEL])!;
    assert.equal(partial.status, 'partial');
    assert.equal(partial.difference, null);
    assert.ok(ledgerFactLines(partial).some((l) => /^Data gap:/.test(l)));
  });

  await test('ledger reaches the writer facts digest (single source of figures)', () => {
    const t = topic(RAW_TITLE);
    const pack = assembleResearchPack(t, buildStructuredContext(t), null);
    const digest = buildFactsDigest(pack);
    assert.ok(/Core monthly basket difference: A\$\d/.test(digest), digest.slice(0, 400));
    assert.ok(/not total cost of living/i.test(digest));
    assert.ok(!/LEDGER/.test(digest), 'no internal label leaks into prompts');
  });

  await test('numbers: body/FAQ/summary checked against the ledger and each other', () => {
    const ledger = buildCalculationLedger([SYD, MEL])!;
    const diff = ledger.difference!.amount;
    const ok: WriterDraftPayload = { ...defectiveDraft(), blocks: [
      { id: 'p', type: 'paragraph', content: `Melbourne is cheaper than Sydney. The core monthly basket is about A$${diff.toLocaleString('en-US')} lower per month in Melbourne.` },
      { id: 'faq', type: 'faq', content: [{ q: 'Is Sydney more expensive than Melbourne?', a: `Yes, Sydney is more expensive than Melbourne, with a monthly gap of about A$${diff}.` }] },
    ] };
    assert.deepEqual(validateLedgerConsistency(ok, ledger).filter((f) => f.severity === 'error'), []);
    const bad: WriterDraftPayload = { ...ok, blocks: [
      { id: 'p', type: 'paragraph', content: 'Sydney is cheaper than Melbourne overall.' },
      { id: 'faq', type: 'faq', content: [{ q: 'How big is the gap?', a: `The monthly difference between Sydney and Melbourne is A$${diff * 2}.` }] },
    ] };
    const codes = validateLedgerConsistency(bad, ledger).map((f) => f.code);
    assert.ok(codes.includes('direction_contradicts_ledger'));
    assert.ok(codes.includes('difference_mismatch'));
    const noLedger: WriterDraftPayload = { ...ok, blocks: [
      { id: 'p', type: 'paragraph', content: 'Perth costs about A$500 less per month than Brisbane, a difference most renters notice.' },
      { id: 's', type: 'summary', content: 'Overall the monthly gap between Perth and Brisbane is roughly A$900.' },
    ] };
    assert.ok(validateLedgerConsistency(noLedger, null).some((f) => f.code === 'inconsistent_difference'));
  });

  // ── D10 final gate ────────────────────────────────────────────────────
  const ledger = buildCalculationLedger([SYD, MEL]);
  const ctx = {
    articleTitle: PUBLIC_TITLE,
    internalLabels: internalTitleLabels(RAW_TITLE),
    scope: SCOPE,
    ledger,
    researchStatus: 'grounding_blocked',
  };

  await test('public gate repairs mechanical defects and passes a clean result', () => {
    const { draft, report } = runPublicIntegrityGate(defectiveDraft(), ctx);
    assert.ok(report.ok, JSON.stringify(report.errors, null, 1));
    assert.equal(draft.seo_title, PUBLIC_TITLE);
    assert.ok(!JSON.stringify(draft).includes('0865'));
    assert.ok(JSON.stringify(draft).includes('A$3,277'), 'table figures preserved');
    assert.ok(JSON.stringify(draft).includes('test run of your commute'), 'ordinary prose preserved');
    assert.ok(report.fixes.some((f) => f.startsWith('qa_markers_scrubbed')));
    assert.ok(report.fixes.includes('toc_rebuilt_from_headings'));
  });

  await test('public gate blocks what it must not rewrite (figure contradictions, required grounding)', () => {
    const d = defectiveDraft();
    d.blocks.push({ id: 'p9', type: 'paragraph', content: 'Sydney is cheaper than Melbourne overall.' });
    const r1 = runPublicIntegrityGate(d, ctx).report;
    assert.equal(r1.ok, false);
    assert.ok(r1.errors.some((e) => e.code === 'direction_contradicts_ledger'));
    const r2 = runPublicIntegrityGate(defectiveDraft(), { ...ctx, groundingRequired: true }).report;
    assert.ok(r2.errors.some((e) => e.code === 'grounding_required'));
  });

  await test('a revision (Fix Issues) pass is re-validated: output passes the gate inspection', () => {
    const revised = applyDeterministicRepairs(defectiveDraft(), 'STYLE', { linkScope: SCOPE }).draft;
    const report = inspectPublicIntegrity(revised, { ...ctx, internalLabels: [] });
    const blocking = report.errors.filter((e) => e.code !== 'direction_contradicts_ledger');
    assert.deepEqual(blocking, [], JSON.stringify(blocking, null, 1));
  });

  console.log(`\n${passed} passed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
