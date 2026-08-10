/**
 * Smoke: FAQ/summary survive humanize-style full block replace via reattach.
 * Run: npx tsx scripts/writer-v2-faq-preserve-smoke.ts
 */

import {
  reattachStructuralBlocks,
  type DraftBlock,
  type WriterDraftPayload,
} from '../lib/editorial-engine/writer/draft-validate.js';
import { runQualityAudit } from '../lib/editorial-engine/writer/v2/quality-audit.js';
import type { EditorialPlan } from '../lib/editorial-engine/writer/v2/types.js';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const faqBlock: DraftBlock = {
  id: 'faq',
  type: 'faq',
  heading: 'FAQ',
  content: [
    { q: 'Is housing the biggest cost?', a: 'Usually yes for most households in major cities.' },
    { q: 'Should I trust one monthly total?', a: 'No — build a three-line budget and stress-test rent.' },
  ],
};

const summaryBlock: DraftBlock = {
  id: 'summary',
  type: 'summary',
  heading: 'Summary',
  content:
    'Housing dominates most budgets, then food and transport. Stress-test rent for your neighbourhood and keep a buffer for utilities and lifestyle.',
};

const original: WriterDraftPayload = {
  seo_title: 'Cost of living in Lisbon',
  meta_title: 'Cost of living in Lisbon',
  meta_description: 'Practical cost planning notes for Lisbon with housing and everyday costs.',
  excerpt: 'Practical cost planning notes for Lisbon with housing and everyday costs.',
  blocks: [
    {
      id: 'h1',
      type: 'heading',
      heading: 'Housing costs',
      content: 'Housing costs',
    },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Central rents in Lisbon often dominate monthly budgets for newcomers relocating from lower-cost cities across Europe.',
    },
    {
      id: 'p2',
      type: 'paragraph',
      content:
        'Food and transit add meaningful layers once housing is fixed, especially for couples sharing a one-bedroom flat near transit hubs.',
    },
    faqBlock,
    summaryBlock,
  ],
};

/** Simulate successful AI humanize that returns body-only blocks (drops FAQ/summary). */
const wipedBody: DraftBlock[] = [
  {
    id: 'h1',
    type: 'heading',
    heading: 'Housing costs',
    content: 'Housing costs',
  },
  {
    id: 'p1',
    type: 'paragraph',
    content:
      'Central rents in Lisbon often dominate monthly budgets for newcomers relocating from lower-cost cities across Europe.',
  },
  {
    id: 'p2',
    type: 'paragraph',
    content:
      'Food and transit add meaningful layers once housing is fixed, especially for couples sharing a one-bedroom flat near transit hubs.',
  },
  {
    id: 'p3',
    type: 'paragraph',
    content:
      'Build a three-line budget for housing, essentials, and lifestyle before comparing neighbourhood averages across the metro area.',
  },
];

const stubPlan = {
  guide_id: 'city',
  content_type: 'city_guide',
  persona: {
    id: 'general',
    label: 'General',
    confidence: 1,
    tone: 'clear',
    example_bias: 'practical',
    advice_angle: 'budget realism',
    section_priority: {},
    faq_framing: 'direct',
    summary_stance: 'Recommend verifying rent locally.',
  },
  style: {
    id: 'professional',
    label: 'Professional',
    constraints: [],
    sentence_guidance: 'Clear and concrete.',
  },
  search_intent: 'informational',
  purpose: 'Explain Lisbon cost of living',
  depth: 'standard',
  outline: [],
  forbidden_behaviours: [],
  link_max: 4,
  entities: { city: 'Lisbon', country: 'Portugal' },
} as EditorialPlan;

function main() {
  console.log('writer-v2-faq-preserve-smoke');

  const beforeHasFaq = original.blocks.some((b) => b.type === 'faq');
  console.log('BEFORE wipe: faq_present=', beforeHasFaq, 'blocks=', original.blocks.length);

  const wipedHasFaq = wipedBody.some((b) => b.type === 'faq');
  console.log('AFTER fake humanize wipe: faq_present=', wipedHasFaq, 'blocks=', wipedBody.length);
  assert(!wipedHasFaq, 'fixture wipe must drop FAQ');

  const restored = reattachStructuralBlocks(wipedBody, original.blocks);
  const restoredFaq = restored.filter((b) => b.type === 'faq');
  const restoredSummary = restored.filter((b) => b.type === 'summary');
  console.log(
    'AFTER reattach: faq_present=',
    restoredFaq.length > 0,
    'faq_count=',
    restoredFaq.length,
    'summary_present=',
    restoredSummary.length > 0,
    'blocks=',
    restored.length
  );

  assert(restoredFaq.length === 1, 'reattach must restore exactly one FAQ');
  assert(restoredSummary.length === 1, 'reattach must restore exactly one summary');
  assert(Array.isArray(restoredFaq[0].content), 'FAQ content schema should be qa_array');

  const draft: WriterDraftPayload = { ...original, blocks: restored };
  const audit = runQualityAudit({
    draft,
    plan: stubPlan,
    similarity: [],
    knowledge_gaps: [],
    section_writer_ids: ['city.housing', 'city.faq', 'city.summary'],
    min_words: 100,
  });

  console.log('audit.critical=', audit.critical);
  assert(!audit.critical.includes('missing_faq'), 'quality audit must not report missing_faq');
  assert(!audit.critical.includes('missing_summary'), 'quality audit must not report missing_summary');

  console.log('OK — FAQ preserved; missing_faq not raised');
}

main();
