/**
 * Offline self-test: multi-pass merge + validation reach ≥2200 words.
 * Does not call Groq.
 */
import {
  countDraftWords,
  mergeDraftBlocks,
  validateWriterDraft,
  type DraftBlock,
  type WriterDraftPayload,
} from '../lib/editorial-engine/writer/draft-validate.js';
import type { ResearchPack } from '../lib/editorial-engine/research/schema.js';

function para(n: number, seed: string): string {
  const sentence =
    `${seed} Readers should compare housing, food, transport, and healthcare using CityCost index signals on /city/demo-city and /compare/demo-vs-other before relocating. Check /country/demo and /methodology plus /data-sources. `;
  return sentence.repeat(n);
}

const requiredH2 = [
  'Introduction',
  'Who should read this',
  'Cost of living overview',
  'Housing',
  'Food',
  'Transport',
  'Healthcare',
  'Education',
  'Salary and purchasing power',
  'Taxes and take-home pay',
  'Lifestyle',
  'Pros',
  'Cons',
  'Summary',
  'FAQ',
];

function baseDraft(): WriterDraftPayload {
  return {
    seo_title: 'Demo City Cost of Living Guide',
    meta_title: 'Demo City Cost of Living Guide',
    meta_description: 'A practical cost of living guide for relocators.',
    excerpt: 'Plan a realistic monthly budget before you move.',
    blocks: [
      { id: 'intro', type: 'intro', content: para(6, 'Introduction.') },
      {
        id: 'toc',
        type: 'list',
        heading: 'Table of contents',
        content: requiredH2,
      },
    ],
  };
}

const research = {
  required_h2: requiredH2,
  required_tables: ['Monthly cost buckets'],
  required_comparison_blocks: [],
  required_faq: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'],
} as unknown as ResearchPack;

let draft = baseDraft();
const before = countDraftWords(draft);

// Pass 1–N: append each H2 with long paragraphs (simulates Writer multi-pass)
const expandBlocks: DraftBlock[] = [];
for (let i = 0; i < requiredH2.length; i++) {
  const h = requiredH2[i];
  expandBlocks.push(
    { id: `h-${i}`, type: 'heading', heading: h, content: h },
    { id: `p-${i}`, type: 'paragraph', content: para(5, `${h} body.`) }
  );
}
draft = mergeDraftBlocks(draft, expandBlocks);

// Pass final: required FAQ/table/summary
draft = mergeDraftBlocks(draft, [
  {
    id: 'table-1',
    type: 'table',
    heading: 'Monthly cost buckets',
    content: { headers: ['Item', 'Notes'], rows: [['Rent', 'Largest line item']] },
  },
  {
    id: 'faq-1',
    type: 'faq',
    heading: 'FAQ',
    content: [
      { q: 'Q1', a: para(2, 'Answer 1.') },
      { q: 'Q2', a: para(2, 'Answer 2.') },
      { q: 'Q3', a: para(2, 'Answer 3.') },
      { q: 'Q4', a: para(2, 'Answer 4.') },
      { q: 'Q5', a: para(2, 'Answer 5.') },
      { q: 'Q6', a: para(2, 'Answer 6.') },
    ],
  },
  {
    id: 'summary-1',
    type: 'summary',
    heading: 'Summary',
    content: para(3, 'Conclusion and key takeaways.'),
  },
]);

const words = countDraftWords(draft);
const validation = validateWriterDraft(draft, { min: 2200, max: 3300 }, research);
console.log(
  JSON.stringify(
    {
      initial_words: before,
      final_words: words,
      validation_ok: validation.ok,
      errors: validation.errors,
      missing_h2_count: validation.missing_h2.length,
      multipass_merge_works: words > before && words >= 2200 && validation.ok,
    },
    null,
    2
  )
);

if (!validation.ok || words < 2200) process.exit(1);
