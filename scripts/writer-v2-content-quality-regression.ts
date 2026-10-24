/**
 * Content Quality Engine regression — fixtures + per-guide dry runs.
 * Run: npx tsx scripts/writer-v2-content-quality-regression.ts
 */
import assert from 'node:assert/strict';
import {
  hasFakeExpansionPattern,
  runContentQualityEngine,
} from '../lib/editorial-engine/writer/v2/content-quality/index.js';
import { similarityScore } from '../lib/editorial-engine/writer/v2/content-quality/text-metrics.js';
import { BLOCK_SAVE_CATEGORIES } from '../lib/editorial-engine/writer/v2/content-quality/types.js';
import type { GuideId } from '../lib/editorial-engine/writer/v2/types.js';
import type { DraftBlock, WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import { draftBodyText } from '../lib/editorial-engine/reviewer/text-utils.js';

const GUIDE_TYPES: GuideId[] = [
  'country',
  'city',
  'comparison',
  'salary',
  'rent',
  'student',
  'visa',
  'moving',
  'healthcare',
  'food',
  'travel',
  'budget',
  'remote',
  'retirement',
];

function baseDraft(overrides: Partial<WriterDraftPayload> & { body?: DraftBlock[] }): WriterDraftPayload {
  const body = overrides.body || [];
  return {
    seo_title: overrides.seo_title || 'Cost of Living Guide',
    meta_title: overrides.meta_title || 'Cost of Living Guide',
    meta_description: overrides.meta_description || 'Practical cost planning.',
    excerpt: overrides.excerpt || 'Practical cost planning.',
    blocks: [
      {
        id: 'intro',
        type: 'intro',
        content:
          'This guide helps you plan monthly costs with housing, food, and transport as the main levers.',
      },
      {
        id: 'toc',
        type: 'list',
        heading: 'Table of contents',
        content: ['Overview', 'Housing', 'Decision tips', 'FAQ'],
      },
      ...body,
      {
        id: 'faq',
        type: 'faq',
        heading: 'FAQ',
        content: [
          {
            id: 'f1',
            q: 'How should I start budgeting?',
            a: 'Yes — start with rent, then essentials. Confirm one local quote and decide your contingency before you commit.',
          },
        ],
      },
      {
        id: 'summary',
        type: 'summary',
        content:
          'Recap: housing usually dominates. Decide your rent band first, then size food and transport. Next step: collect two quotes and revise the total.',
      },
    ],
  };
}

function assertNoDupParagraphs(draft: WriterDraftPayload): void {
  const paras = (draft.blocks || []).filter(
    (b) => typeof b.content === 'string' && (b.type === 'paragraph' || b.type === 'tip')
  );
  for (let i = 0; i < paras.length; i++) {
    for (let j = 0; j < i; j++) {
      const score = similarityScore(String(paras[i].content), String(paras[j].content));
      assert.ok(
        score < 0.7,
        `duplicate paragraphs score=${score.toFixed(2)} a=${String(paras[i].content).slice(0, 60)}`
      );
    }
  }
}

function assertNoLeakage(draft: WriterDraftPayload): void {
  const body = draftBodyText(draft).toLowerCase();
  const banned = [
    'required h2',
    'research says',
    'planning note',
    'expand section',
    'research pack',
    'average cost index',
    'indexed averages',
    'return json',
    'you are a helpful writer',
  ];
  for (const b of banned) {
    assert.ok(!body.includes(b), `leakage remains: ${b}`);
  }
}

function assertNoCorruption(draft: WriterDraftPayload): void {
  for (const b of draft.blocks || []) {
    if (typeof b.content !== 'string') continue;
    assert.ok(!/\.\s*and\b/i.test(b.content), `period-and corruption in ${b.id}`);
    assert.ok(!/\s{2,}/.test(b.content), `double spaces in ${b.id}`);
    assert.ok(!/<\/?div\b/i.test(b.content), `html residue in ${b.id}`);
  }
}

function hardFailStatus(
  validators: Array<{ category: string; status: string }>
): string[] {
  return validators
    .filter(
      (v) =>
        v.status === 'FAIL' &&
        (BLOCK_SAVE_CATEGORIES as readonly string[]).includes(v.category)
    )
    .map((v) => v.category);
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

console.log('\n=== Content Quality Engine regression ===\n');

// --- Detector fixtures ---
console.log('Fixtures / detectors');

test('repetition: removes duplicated paragraphs', () => {
  const dup =
    'When planning housing costs, gather two neighbourhood quotes and stress-test the monthly total against take-home pay before you sign anything long-term.';
  const draft = baseDraft({
    body: [
      { id: 'h1', type: 'heading', heading: 'Housing', content: '' },
      { id: 'p1', type: 'paragraph', content: dup },
      {
        id: 'p2',
        type: 'paragraph',
        content: dup,
      },
      {
        id: 'p3',
        type: 'paragraph',
        content:
          'Food costs vary with grocery mix. Build a weekly basket and compare markets before you lock a lifestyle line.',
      },
    ],
  });
  const before = draft.blocks.filter((b) => b.type === 'paragraph').length;
  const result = runContentQualityEngine({ draft, guideId: 'city', city: 'Lisbon', country: 'Portugal' });
  assert.ok(result.report.repeated_paragraphs_removed >= 1, 'expected removals');
  assertNoDupParagraphs(result.draft);
  assert.equal(
    hardFailStatus(result.validators).includes('repeated_content'),
    false,
    'repeated_content should not FAIL after repair'
  );
  assert.ok(result.draft.blocks.filter((b) => b.type === 'paragraph').length >= 2);
  void before;
});

test('sentence-repair: fixes punctuation corruption', () => {
  const draft = baseDraft({
    body: [
      { id: 'h1', type: 'heading', heading: 'Overview', content: '' },
      {
        id: 'p1',
        type: 'paragraph',
        content:
          'Rent is the largest line. and deposits often add two months.  Then  utilities follow. Check quotes  before you decide.',
      },
      {
        id: 'p2',
        type: 'paragraph',
        content: 'See the <div>details</div> and [guide]() for neighbourhood trade-offs when you compare two areas.',
      },
    ],
  });
  const result = runContentQualityEngine({ draft, guideId: 'rent', country: 'Portugal' });
  assert.ok(result.report.sentences_repaired >= 1, 'expected repairs');
  assertNoCorruption(result.draft);
  assert.ok(!hardFailStatus(result.validators).includes('broken_sentences'));
});

test('content-expansion: strips fake pad loops', () => {
  const pad =
    'Confirm each line with a local quote. Re-run the three-line budget after collecting fresh rent and grocery quotes so the plan matches the place you will actually live. Re-run the three-line budget after collecting fresh rent and grocery quotes so the plan matches the place you will actually live. Re-run the three-line budget after collecting fresh rent and grocery quotes so the plan matches the place you will actually live.';
  const draft = baseDraft({
    body: [
      { id: 'h1', type: 'heading', heading: 'Budget worksheet', content: '' },
      {
        id: 'p1',
        type: 'paragraph',
        content:
          'Allocate housing, essentials, and discretionary lines so a contingency still fits after rent is fixed.',
      },
      { id: 'p2', type: 'paragraph', content: pad },
    ],
  });
  assert.equal(hasFakeExpansionPattern(draft), true);
  const result = runContentQualityEngine({ draft, guideId: 'budget', country: 'Spain' });
  assert.equal(hasFakeExpansionPattern(result.draft), false, 'fake expansion should be gone');
  assertNoDupParagraphs(result.draft);
});

test('prompt-leakage: strips instruction scaffolding', () => {
  const draft = baseDraft({
    body: [
      { id: 'h1', type: 'heading', heading: 'National overview', content: '' },
      {
        id: 'p1',
        type: 'paragraph',
        content:
          'Required H2: Housing. Research says averages help. Planning note: expand section with Research pack. Average Cost Index and indexed averages must not appear. Return JSON {"blocks":[]}. You are a helpful writer.',
      },
      {
        id: 'p2',
        type: 'paragraph',
        content:
          'Across India, rupee pricing and metro vs tier-2 housing differ. Compare state-level GST effects on services, then decide a region using UPI-friendly cashflow assumptions.',
      },
    ],
  });
  const result = runContentQualityEngine({
    draft,
    guideId: 'country',
    country: 'India',
  });
  assert.ok(result.report.leakage_removed >= 1);
  assertNoLeakage(result.draft);
  assert.ok(!hardFailStatus(result.validators).includes('prompt_leakage'));
});

test('human-writing: removes AI clichés', () => {
  const draft = baseDraft({
    body: [
      { id: 'h1', type: 'heading', heading: 'Neighbourhoods', content: '' },
      {
        id: 'p1',
        type: 'paragraph',
        content:
          'When it comes to housing, it is important to note that in today\'s fast-paced world you should leverage a robust and seamless plan. Delve into commute trade-offs and decide a deposit buffer before you sign.',
      },
    ],
  });
  const result = runContentQualityEngine({ draft, guideId: 'city', city: 'Berlin', country: 'Germany' });
  assert.ok(result.report.ai_cliches_removed >= 1);
  const body = draftBodyText(result.draft).toLowerCase();
  assert.ok(!/when it comes to/.test(body));
  assert.ok(!/delve into/.test(body));
  assert.ok(!hardFailStatus(result.validators).includes('human_writing'));
});

test('guide-mismatch: FAIL blocks save on wrong family', () => {
  const draft = baseDraft({
    body: [
      { id: 'h1', type: 'heading', heading: 'Housing comparison vs City B', content: '' },
      { id: 'h2', type: 'heading', heading: 'Salary comparison tables', content: '' },
      {
        id: 'p1',
        type: 'paragraph',
        content:
          'City A vs City B vs City C vs City D rent and salary comparison. Pros and cons for each pair without national framing.',
      },
    ],
  });
  const result = runContentQualityEngine({ draft, guideId: 'country', country: 'India' });
  assert.equal(result.block_save, true, 'should block save on guide mismatch');
  assert.ok(
    result.report.block_reasons.some((r) => r.startsWith('guide_mismatch')),
    `expected guide_mismatch in ${result.report.block_reasons.join(',')}`
  );
});

test('faq + summary validators repair thin answers / intro echo', () => {
  const intro =
    'Plan costs with housing first, then food and transport, using local quotes before you treat averages as a personal budget.';
  const draft: WriterDraftPayload = {
    seo_title: 'Student budget',
    meta_title: 'Student budget',
    meta_description: 'Student costs',
    excerpt: 'Student costs',
    blocks: [
      { id: 'intro', type: 'intro', content: intro },
      {
        id: 'toc',
        type: 'list',
        heading: 'Table of contents',
        content: ['Campus costs'],
      },
      {
        id: 'h1',
        type: 'heading',
        heading: 'Student housing and semester costs',
        content: '',
      },
      {
        id: 'p1',
        type: 'paragraph',
        content:
          'Shared housing near campus usually beats tourist districts. Check semester transport passes and tuition add-ons, then decide whether a longer commute saves more than it costs in time.',
      },
      {
        id: 'faq',
        type: 'faq',
        heading: 'FAQ',
        content: [{ id: 'f1', q: 'What is the cost index?', a: 'The cost index is an average metric.' }],
      },
      { id: 'summary', type: 'summary', content: intro },
    ],
  };
  const result = runContentQualityEngine({ draft, guideId: 'student', country: 'Germany' });
  const faq = result.draft.blocks.find((b) => b.type === 'faq');
  const answer = Array.isArray(faq?.content)
    ? String((faq!.content[0] as { a: string }).a)
    : '';
  // Thin answers are reported, not padded with the same generic sentence on every
  // FAQ (Article #117 defect: repeated "Next step: write down one decision…").
  assert.ok(!/Next step: write down one decision/i.test(answer), 'no generic FAQ boilerplate appended');
  assert.ok(
    result.validators.some((v) => v.findings.some((f) => /faq_index_only|faq_no_advice/.test(f.code))),
    'thin FAQ answer is reported'
  );
  const summary = String(result.draft.blocks.find((b) => b.type === 'summary')?.content || '');
  assert.ok(similarityScore(intro, summary) < 0.7, 'summary must not mirror intro');
  assert.ok(/next|decide|recap|check|collect/i.test(summary));
});

test('protected blocks preserved (intro/toc/faq/summary)', () => {
  const draft = baseDraft({
    body: [
      { id: 'h1', type: 'heading', heading: 'Visa pathways and permit fees', content: '' },
      {
        id: 'p1',
        type: 'paragraph',
        content:
          'Map biometric appointments and proof-of-funds onto a calendar. Confirm fees early so cash arrives before the interview, then decide whether a longer visa duration is worth the premium.',
      },
    ],
  });
  const result = runContentQualityEngine({ draft, guideId: 'visa', country: 'Japan' });
  const types = result.draft.blocks.map((b) => b.type);
  assert.ok(types.includes('intro'));
  assert.ok(types.includes('faq'));
  assert.ok(types.includes('summary'));
  assert.ok(result.draft.blocks.some((b) => b.id === 'toc' || /table of contents/i.test(String(b.heading))));
});

// --- Per-guide dry runs ---
console.log('\nGuide-type dry runs');

const GUIDE_BODY: Record<GuideId, DraftBlock[]> = {
  country: [
    { id: 'h1', type: 'heading', heading: 'National overview and major cities', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Across India, rupee (INR) pricing differs between metro and tier-2 cities. Compare regional housing, use UPI-friendly cash buffers, and decide a state before you lock a long lease.',
    },
  ],
  city: [
    { id: 'h1', type: 'heading', heading: 'Neighbourhoods and commute', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'In Lisbon, compare two neighbourhoods on rent plus commute. Confirm deposit norms, then decide whether a longer trip is worth cheaper housing.',
    },
  ],
  comparison: [
    { id: 'h1', type: 'heading', heading: 'Berlin vs Lisbon pros and cons', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Hold lifestyle constant. Recommend the city that wins on housing plus tax drag first. Who should choose which city depends on remote vs office needs.',
    },
  ],
  salary: [
    { id: 'h1', type: 'heading', heading: 'Take-home pay and wage bands', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Convert salary offers to monthly take-home income. Subtract a realistic rent band, then decide whether the residual covers healthcare and tax withholdings.',
    },
  ],
  rent: [
    { id: 'h1', type: 'heading', heading: 'Lease deposits and 1-bed rent', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Confirm landlord deposit months and agency fees. Build first-month cash need separate from ongoing rent, then decide a neighbourhood only after two quotes.',
    },
  ],
  student: [
    { id: 'h1', type: 'heading', heading: 'Student shared housing and semester costs', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Tuition plus shared housing plus a transport pass set the semester floor. Keep an emergency line for registration fees, then decide campus vs commute trade-offs.',
    },
  ],
  visa: [
    { id: 'h1', type: 'heading', heading: 'Visa permits and biometric fees', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Map immigration appointment fees and proof-of-funds. Confirm residency timelines early so cash buffers arrive before biometrics.',
    },
  ],
  moving: [
    { id: 'h1', type: 'heading', heading: 'Moving-week relocation checklist', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Book temporary housing for the first week, budget SIM setup fees, and buy two weeks of groceries before your first transfer clears.',
    },
  ],
  healthcare: [
    { id: 'h1', type: 'heading', heading: 'Clinic visits and health insurance', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Price a GP visit and one common prescription. Decide whether private hospital cover is needed for the first six months.',
    },
  ],
  food: [
    { id: 'h1', type: 'heading', heading: 'Grocery and dining budget', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Mix market groceries with two restaurant meals per week. Stress-test what happens if dining doubles in month one, then decide a sustainable meal pattern.',
    },
  ],
  travel: [
    { id: 'h1', type: 'heading', heading: 'Trip transport and hotel spend', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Separate flight cost from daily tourist spend. Cheap hotels near transit often beat resort packages once airport transfers are counted.',
    },
  ],
  budget: [
    { id: 'h1', type: 'heading', heading: 'Monthly budget worksheet', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Allocate fixed rent, flexible food and transport, then discretionary. Freeze discretionary first when quotes overrun your monthly total.',
    },
  ],
  remote: [
    { id: 'h1', type: 'heading', heading: 'Remote coworking and timezone costs', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Confirm coworking or home internet cost and whether tax residency still holds after 90 days when you work from another country.',
    },
  ],
  retirement: [
    { id: 'h1', type: 'heading', heading: 'Retirement healthcare and fixed income', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Model pension and healthcare as non-negotiable. Set lifestyle spend so a 15% currency swing still leaves later-life buffers intact.',
    },
  ],
  tax: [
    { id: 'h1', type: 'heading', heading: 'Tax withholding and filing residency', content: '' },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Map withholding rules and filing residency tests. Decide whether remote days abroad change your tax residency for the year.',
    },
  ],
};

for (const guideId of GUIDE_TYPES) {
  test(`dry-run ${guideId}`, () => {
    const draft = baseDraft({
      seo_title: `${guideId} guide`,
      body: GUIDE_BODY[guideId],
    });
    // Patch summary/intro slightly so country guides keep national framing in FAQ path
    const result = runContentQualityEngine({
      draft,
      guideId,
      country:
        guideId === 'country' || guideId === 'moving' || guideId === 'budget' || guideId === 'retirement'
          ? 'India'
          : 'Portugal',
      city: guideId === 'city' ? 'Lisbon' : undefined,
    });
    assertNoDupParagraphs(result.draft);
    assertNoLeakage(result.draft);
    assertNoCorruption(result.draft);
    assert.equal(hasFakeExpansionPattern(result.draft), false);
    const hard = hardFailStatus(result.validators);
    assert.deepEqual(hard, [], `hard FAIL categories: ${hard.join(',')}`);
    assert.equal(result.block_save, false, `block_save unexpectedly true: ${result.report.block_reasons.join('|')}`);
    assert.ok(result.score >= 50, `score too low: ${result.score}`);
    // Sample before/after for one guide
    if (guideId === 'country') {
      (globalThis as { __cq_sample?: unknown }).__cq_sample = {
        before_excerpt: draftBodyText(draft).slice(0, 220),
        after_excerpt: draftBodyText(result.draft).slice(0, 220),
        report: result.report,
      };
    }
  });
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
console.log('REGRESSION PASS');
const sample = (globalThis as { __cq_sample?: { before_excerpt: string; after_excerpt: string } }).__cq_sample;
if (sample) {
  console.log('\nSample before (country excerpt):');
  console.log(sample.before_excerpt);
  console.log('\nSample after (country excerpt):');
  console.log(sample.after_excerpt);
}
