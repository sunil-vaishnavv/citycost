/**
 * Smoke: normalize + rule validator + decision engine (no live AI).
 */
import { normalizeDraft, headingFingerprint } from '../lib/editorial-engine/validation/normalize-draft.ts';
import { decidePipeline } from '../lib/editorial-engine/validation/decision-engine.ts';
import { runRuleValidator } from '../lib/editorial-engine/reviewer/rule-validator.ts';
import { getSettings } from '../lib/editorial-engine/db/settings-repo.ts';
import { initEditorialEngine } from '../lib/editorial-engine/init.ts';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.ts';

const draft: WriterDraftPayload = {
  seo_title: 'Berlin vs Dublin cost of living',
  meta_title: 'Berlin vs Dublin cost of living 2026',
  meta_description: 'Compare rent, food, and transport costs between Berlin and Dublin for remote workers.',
  excerpt: 'A practical cost comparison for movers.',
  blocks: [
    { id: '1', type: 'intro', content: 'This guide compares Berlin and Dublin for everyday costs. '.repeat(8) },
    { id: '2', type: 'heading', heading: 'Who should read this', content: 'Who should read this' },
    { id: '3', type: 'heading', heading: 'Who should read this', content: 'Who should read this' },
    { id: '4', type: 'paragraph', content: 'Housing is the largest expense for most movers. '.repeat(10) },
    { id: '5', type: 'heading', heading: 'Housing costs', content: 'Housing costs' },
    { id: '6', type: 'paragraph', content: 'Expect different deposit norms and lease lengths. '.repeat(10) },
    { id: '7', type: 'heading', heading: 'Food and groceries', content: 'Food and groceries' },
    { id: '8', type: 'paragraph', content: 'Grocery baskets vary by diet and neighborhood. '.repeat(10) },
    { id: '9', type: 'list', heading: 'Table of Contents', content: ['Housing costs', 'Housing costs', 'Food and groceries'] },
    { id: '10', type: 'list', heading: 'Table of Contents', content: ['Dup TOC'] },
    {
      id: '11',
      type: 'faq',
      content: [{ q: 'Is Berlin cheaper?', a: 'Often for rent, but it depends on neighborhood.' }],
    },
    { id: '12', type: 'summary', content: 'Compare rent first, then transport and taxes. '.repeat(6) },
  ],
};

async function main() {
  await initEditorialEngine();
  const settings = await getSettings();

  const fp = headingFingerprint('Who should read this');
  const norm = normalizeDraft(draft);
  const afterHeadings = norm.draft.blocks
    .filter((b) => b.type === 'heading')
    .map((b) => b.heading);
  const tocCount = norm.draft.blocks.filter(
    (b) => /table of contents/i.test(b.heading || '')
  ).length;

  const rules = runRuleValidator({ draft: norm.draft, settings, research: null });
  const decision = decidePipeline({
    overall_score: 78,
    threshold: settings.quality_score_threshold,
    rules,
    ai: {
      passed: true,
      score: 80,
      scores: {
        readability: 75,
        eeat: 70,
        search_intent: 72,
        human_writing: 74,
        helpful_content: 76,
      },
      issues: ['Duplicate Heading should be ignored if validator clean'],
      rewrite_required: false,
      summary: 'ok',
      raw: {},
    },
    seo_pass: rules.seo_pass,
    readability_pass: true,
  });

  console.log(
    JSON.stringify(
      {
        fingerprint_example: fp,
        normalize_fixes: norm.fixes,
        headings_after: afterHeadings,
        toc_count_after: tocCount,
        duplicate_heading_findings: rules.findings.filter((f) => f.code === 'duplicate_heading'),
        auto_fixable_codes: rules.auto_fixable.map((f) => f.code),
        failed_rules: rules.failed_rules.map((f) => f.code),
        critical_fail: rules.critical_fail,
        decision: decision.decision,
        status: decision.status,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
