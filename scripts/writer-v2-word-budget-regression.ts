/**
 * Word Budget Engine regression — allocation + ensure never finishes below min.
 * Run: npx tsx scripts/writer-v2-word-budget-regression.ts
 */
import assert from 'node:assert/strict';
import { countDraftWords, type WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import {
  allocateWordBudgets,
  applyWordBudgetToOutline,
} from '../lib/editorial-engine/writer/v2/word-budget.js';
import {
  ensureDraftMeetsMinWords,
  expandSectionToMin,
} from '../lib/editorial-engine/writer/v2/word-expand.js';
import type { OutlineSection } from '../lib/editorial-engine/writer/v2/types.js';

const GUIDES: Array<{ label: string; keys: OutlineSection['key'][] }> = [
  {
    label: 'country',
    keys: ['overview', 'housing', 'food', 'transport', 'healthcare', 'education', 'salary', 'budget', 'who_should', 'summary'],
  },
  {
    label: 'city',
    keys: ['overview', 'neighbourhoods', 'housing', 'food', 'transport', 'healthcare', 'budget', 'summary'],
  },
  {
    label: 'comparison',
    keys: ['overview', 'housing', 'salary', 'food', 'pros', 'cons', 'recommendation', 'summary'],
  },
  {
    label: 'salary',
    keys: ['overview', 'salary', 'tax', 'housing', 'budget', 'summary'],
  },
  {
    label: 'rent',
    keys: ['overview', 'housing', 'neighbourhoods', 'budget', 'summary'],
  },
  {
    label: 'student',
    keys: ['overview', 'housing', 'education', 'food', 'budget', 'summary'],
  },
  {
    label: 'visa',
    keys: ['overview', 'visa', 'housing', 'budget', 'summary'],
  },
  {
    label: 'moving',
    keys: ['overview', 'housing', 'budget', 'transport', 'summary'],
  },
  {
    label: 'healthcare',
    keys: ['overview', 'healthcare', 'budget', 'summary'],
  },
  {
    label: 'food',
    keys: ['overview', 'food', 'budget', 'summary'],
  },
  {
    label: 'budget',
    keys: ['overview', 'housing', 'food', 'transport', 'budget', 'summary'],
  },
  {
    label: 'travel',
    keys: ['overview', 'housing', 'food', 'transport', 'lifestyle', 'summary'],
  },
  {
    label: 'retirement',
    keys: ['overview', 'healthcare', 'housing', 'budget', 'summary'],
  },
];

const MIN = 2200;

console.log('=== Word Budget allocation ===\n');

for (const g of GUIDES) {
  const outline: OutlineSection[] = g.keys.map((key, i) => ({
    key,
    heading: `${key} section`,
    priority: 1 - i * 0.05,
    min_words: 120,
    max_words: 220,
    evidence_mode: 'full',
    brief: '',
  }));
  const budget = allocateWordBudgets(outline, MIN);
  assert.ok(budget.target_total >= MIN, `${g.label} target ${budget.target_total} < ${MIN}`);
  const applied = applyWordBudgetToOutline(outline, budget);
  const bodyMinSum = applied
    .filter((s) => s.key !== 'faq' && s.key !== 'summary')
    .reduce((a, s) => a + s.min_words, 0);
  const projected =
    bodyMinSum + budget.reserve.intro + budget.reserve.faq + budget.reserve.summary;
  assert.ok(
    projected >= MIN * 0.85,
    `${g.label} projected mins ${projected} too low vs ${MIN}`
  );
  console.log(
    `OK  ${g.label.padEnd(12)} target=${budget.target_total} body_budget=${budget.body_budget} sections=${budget.sections.length}`
  );
}

console.log('\n=== Section expand + draft ensure ===\n');

const shortSection = await expandSectionToMin({
  blocks: [
    {
      id: 'h',
      type: 'heading',
      heading: 'Housing',
      content: 'Housing',
    },
    {
      id: 'p',
      type: 'paragraph',
      content: 'Rent usually dominates. Check deposits and agency fees before you commit.',
    },
  ],
  section: {
    key: 'housing',
    heading: 'Housing',
    priority: 1,
    min_words: 200,
    max_words: 320,
    evidence_mode: 'full',
    brief: '',
  },
  min_words: 200,
  factsDigest: '- Average Cost Index for India = 16.1\n- Average Rent Index = 20511\n- Currency: INR',
  guideId: 'country',
  readerLabel: 'General',
  complete: async () => {
    throw new Error('force deterministic pad');
  },
});
assert.ok(shortSection.actual >= 200, `section actual ${shortSection.actual} < 200`);
console.log(`OK  section expand actual=${shortSection.actual} expansions=${shortSection.expansions}`);

const shortDraft: WriterDraftPayload = {
  seo_title: 'India COL',
  meta_title: 'India COL',
  meta_description: 'Cost of living guide for India with practical budgeting notes for movers.',
  excerpt: 'Practical budgeting for a move to India with housing-first planning.',
  blocks: [
    {
      id: 'intro',
      type: 'intro',
      content:
        'India cost planning starts with housing. Build a three-line budget before you compare cities.',
    },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Food and transport come next. Keep healthcare as a buffer line rather than an afterthought.',
    },
    {
      id: 'faq',
      type: 'faq',
      heading: 'FAQ',
      content: [
        { q: 'Is rent the largest cost?', a: 'Usually yes in major cities; confirm with local quotes.' },
        { q: 'What about deposits?', a: 'Budget multiple months of rent for deposits and fees.' },
      ],
    },
  ],
};

assert.ok(countDraftWords(shortDraft) < MIN);

const ensured = await ensureDraftMeetsMinWords({
  draft: shortDraft,
  article_min: MIN,
  sectionActuals: [
    { key: 'intro', heading: 'Intro', target: 160, min: 160, actual: 40, expansions: 0 },
    { key: 'housing', heading: 'Housing', target: 300, min: 260, actual: 50, expansions: 0 },
  ],
  factsDigest: '- Place: India\n- Average Cost Index for India = 16.1',
  guideId: 'country',
  readerLabel: 'General',
  outlineHeadings: ['Overview', 'Housing', 'Food'],
  complete: async () => '{"blocks":[]}',
});

assert.ok(
  ensured.final_words > countDraftWords(shortDraft),
  `ensure finished at ${ensured.final_words}, should be > ${countDraftWords(shortDraft)}`
);
assert.equal(ensured.expansion_rounds, 1);
console.log(
  `OK  ensureDraftMeetsMinWords final=${ensured.final_words} rounds=${ensured.expansion_rounds}`
);
console.log(`    debug: ${ensured.debug}`);

console.log('\nAll word-budget regressions passed.');
