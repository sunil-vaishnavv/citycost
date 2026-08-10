/**
 * Smoke: draft job progress helpers + structural FAQ reattach still work.
 * Run: npx tsx scripts/draft-job-async-smoke.ts
 */
import assert from 'node:assert/strict';
import {
  applyStage,
  createInitialProgress,
  DRAFT_GENERATE_JOB_TYPE,
  STAGE_PROGRESS_PCT,
} from '../lib/editorial-engine/jobs/draft-job-types.js';
import { reattachStructuralBlocks } from '../lib/editorial-engine/writer/draft-validate.js';
import { runQualityAudit } from '../lib/editorial-engine/writer/v2/quality-audit.js';
import type { EditorialPlan, WriterDraftPayload } from '../lib/editorial-engine/writer/v2/types.js';

assert.equal(DRAFT_GENERATE_JOB_TYPE, 'draft_generate');

let progress = createInitialProgress({ topic_id: 1, topic_title: 'Test India guide' });
assert.equal(progress.stage, 'queued');
assert.equal(progress.stages[0]?.status, 'active');

progress = applyStage(progress, 'writing_sections', {
  log: 'Writing Housing',
  section_detail: 'Housing',
});
assert.equal(progress.stage, 'writing_sections');
assert.equal(progress.progress_pct, STAGE_PROGRESS_PCT.writing_sections);
assert.ok(progress.logs.some((l) => l.message.includes('Writing Housing')));

const faqBlock = {
  id: 'faq',
  type: 'faq' as const,
  heading: 'FAQ',
  content: [{ q: 'Q1?', a: 'A1 with enough words for sanitize.' }],
};
const summaryBlock = {
  id: 'summary',
  type: 'summary' as const,
  heading: 'Summary',
  content:
    'Summary paragraph with enough words to pass the sanitize floor for summary blocks in draft validation helpers used by quality audit.',
};

const before: WriterDraftPayload = {
  seo_title: 'Test',
  meta_title: 'Test',
  meta_description: 'Test description for smoke',
  excerpt: 'Excerpt for smoke test article',
  blocks: [
    { id: 'p1', type: 'paragraph', content: 'Body paragraph one with enough words here for counting.' },
    { id: 'p2', type: 'paragraph', content: 'Body paragraph two with enough words here for counting.' },
    faqBlock,
    summaryBlock,
  ],
};

const wiped = {
  ...before,
  blocks: before.blocks.filter((b) => b.type !== 'faq' && b.type !== 'summary'),
};
const restored = {
  ...wiped,
  blocks: reattachStructuralBlocks(wiped.blocks, before.blocks),
};
assert.ok(restored.blocks.some((b) => b.type === 'faq'), 'FAQ reattached');
assert.ok(restored.blocks.some((b) => b.type === 'summary'), 'Summary reattached');

const plan = {
  guide_id: 'country',
  purpose: 'test',
  persona: { id: 'general', label: 'General', faq_framing: '', summary_stance: '', advice_angle: '' },
  style: { id: 'practical', label: 'Practical' },
  outline: [],
  link_max: 4,
} as unknown as EditorialPlan;

const audit = runQualityAudit({
  draft: restored,
  plan,
  similarity: [],
  knowledge_gaps: [],
  section_writer_ids: ['country.housing'],
  min_words: 50,
});
assert.ok(!audit.critical.includes('missing_faq'), `unexpected critical: ${audit.critical.join(',')}`);

console.log('OK — draft job progress + FAQ preserve smoke passed');
