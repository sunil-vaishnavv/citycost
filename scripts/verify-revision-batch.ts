/**
 * Regression: failed review is repairable in ONE revision cycle across guide types.
 *
 * Asserts:
 * - Issue planner builds a multi-issue plan (word budget + categories)
 * - Batch applies ALL categories without intermediate review loops
 * - Orchestration path is planning → one reviseDraftOnce → one final review
 * - Word budget never fails solely because of low words (expand path present)
 *
 * Uses fixtures/mocks for AI; exercises real planner / validator / stage wiring.
 *
 * Run: npx tsx scripts/verify-revision-batch.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRevisionBatchPlan } from '../lib/editorial-engine/revision/revision-plan.ts';
import { buildIssuePlan } from '../lib/editorial-engine/validation/issue-plan.ts';
import {
  applyDeterministicRepairs,
  expandDraftToMinWords,
} from '../lib/editorial-engine/revision/revision-validator.ts';
import { countDraftWords, type WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.ts';
import type { QualityReport } from '../lib/editorial-engine/reviewer/quality-report.ts';
import {
  REVISION_BATCH_JOB_TYPE,
  REVISION_BATCH_STAGES,
  buildRevisionStages,
  markRevisionStagesFromPlan,
  createInitialRevisionProgress,
  applyRevisionStage,
} from '../lib/editorial-engine/jobs/revision-batch-types.ts';
import {
  isLengthPrimaryFailure,
  shouldRollbackOnScoreRegression,
} from '../lib/editorial-engine/validation/decision-engine.ts';
import { deriveArticleWorkflow } from '../src/components/editorial/article-workflow.ts';
import type { ArticlePreview, PublishReadiness, QualityReport as UiQualityReport } from '../src/components/editorial/api.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GUIDE_TYPES = [
  'Country',
  'City',
  'Comparison',
  'Salary',
  'Rent',
  'Student',
  'Visa',
  'Healthcare',
  'Moving',
  'Food',
] as const;

function thinDraft(guide: string): WriterDraftPayload {
  return {
    seo_title: `${guide} cost of living`,
    meta_title: `${guide} COL`,
    meta_description: 'Short meta.',
    excerpt: 'Short.',
    blocks: [
      { id: 'intro-1', type: 'intro', heading: 'Intro', content: { text: 'Welcome briefly.' } },
      {
        id: 'housing-1',
        type: 'paragraph',
        heading: 'Housing',
        content: { text: 'Rents vary by neighbourhood and commute.' },
      },
      {
        id: 'housing-2',
        type: 'paragraph',
        heading: 'Housing',
        content: { text: 'Rents vary by neighbourhood and commute again.' },
      },
      {
        id: 'food-1',
        type: 'paragraph',
        heading: 'Food',
        content: {
          text: 'Additionally, furthermore, in conclusion groceries can be managed carefully with planning.',
        },
      },
    ],
  };
}

function failingReport(draft: WriterDraftPayload): QualityReport {
  const words = countDraftWords(draft);
  return {
    overall_score: 52,
    threshold: 70,
    passed: false,
    decision: 'revision',
    critical_fail: false,
    failure_reasons: [
      `Word count ${words} / 1800`,
      'Duplicate heading Housing',
      'Missing FAQ block',
      'Missing summary block',
      'Readability score 48',
      'Missing internal links in body',
      'Human writing score 44',
    ],
    remaining_rules: ['word_count_low', 'duplicate_heading', 'missing_faq'],
    scores: {
      overall: 52,
      rule_validator: 40,
      readability: 48,
      human_writing: 44,
      eeat: 60,
      helpful_content: 55,
      ai_review: 50,
    },
    rule_validator: {
      passed: false,
      score: 40,
      seo_pass: false,
      findings: [
        {
          code: 'word_count_low',
          severity: 'major',
          message: `Word count ${words} / 1800`,
          category: 'CONTENT',
          auto_fixable: true,
        },
        {
          code: 'duplicate_heading',
          severity: 'major',
          message: 'Duplicate heading: Housing',
          category: 'CONTENT',
          auto_fixable: true,
        },
        {
          code: 'missing_faq',
          severity: 'major',
          message: 'Missing FAQ block',
          category: 'CONTENT',
          auto_fixable: true,
        },
        {
          code: 'missing_summary',
          severity: 'major',
          message: 'Missing summary block',
          category: 'CONTENT',
          auto_fixable: true,
        },
        {
          code: 'missing_internal_links',
          severity: 'major',
          message: 'Missing internal links in body',
          category: 'SEO',
          auto_fixable: true,
        },
        {
          code: 'meta_description_short',
          severity: 'minor',
          message: 'Meta description too short',
          category: 'SEO',
          auto_fixable: true,
        },
      ],
      failed_rules: [],
      auto_fixable: [],
      warnings: [],
    },
    readability: {
      score: 48,
      passed: false,
      findings: ['Long dense sentences', 'Weak transitions'],
    },
    human_writing: {
      score: 44,
      passed: false,
      findings: ['AI filler phrases', 'Template repetition'],
    },
    eeat: { score: 60, passed: true, findings: [] },
    helpful_content: { score: 55, passed: true, findings: [] },
    search_intent: { score: 70, passed: true, findings: [] },
    duplicate: {
      is_duplicate: false,
      is_warning: false,
      max_similarity: 0.12,
      decision: 'ok',
    },
    ai_review: {
      passed: false,
      rewrite_required: true,
      score: 50,
      issues: ['Needs clearer housing cost table', 'Prompt leakage / meta bleed in openings'],
    },
  } as unknown as QualityReport;
}

function assertPlannerForGuide(guide: string): {
  issue_count: number;
  categories: string[];
  word_missing: number;
  stages: string[];
} {
  const draft = thinDraft(guide);
  const report = failingReport(draft);
  const plan = buildRevisionBatchPlan(report, draft, {
    article_length_min: 1800,
    article_length_target_min: 2000,
  });

  assert.ok(plan.issue_count >= 5, `${guide}: expected multi-issue plan, got ${plan.issue_count}`);
  assert.ok(plan.categories.length >= 2, `${guide}: expected multiple categories`);
  assert.ok(plan.word_budget.needs_expand, `${guide}: word budget should need expand`);
  assert.ok(plan.word_budget.missing > 0, `${guide}: missing words should be > 0`);
  assert.ok(plan.needs_faq, `${guide}: needs FAQ`);
  assert.ok(plan.needs_links, `${guide}: needs links`);
  assert.ok(plan.needs_readability || plan.needs_humanization, `${guide}: needs style/readability`);
  assert.ok(plan.active_fix_stages.includes('expanding_words'), `${guide}: expand stage`);
  assert.ok(plan.active_fix_stages.includes('applying_batch'), `${guide}: batch stage`);

  // Deterministic batch apply (no AI) — ONE pass, all categories
  let next = draft;
  const actions: string[] = [];
  for (const cat of plan.issue_plan.categories) {
    const det = applyDeterministicRepairs(next, cat.category, {
      onlyBlockIds: cat.affected_block_ids,
      skipHeadingUniquify: true,
      expandToMinWords: cat.category === 'STRUCTURE' ? plan.word_budget.min : undefined,
      linkCandidates: ['/cost-of-living/portugal', '/compare/lisbon-vs-porto'],
    });
    next = det.draft;
    actions.push(...det.fixes);
  }
  if (countDraftWords(next) < plan.word_budget.min) {
    const expanded = expandDraftToMinWords(next, plan.word_budget.min);
    next = expanded.draft;
    actions.push(...expanded.fixes);
  }

  assert.ok(
    countDraftWords(next) >= plan.word_budget.min,
    `${guide}: after batch expand words ${countDraftWords(next)} < min ${plan.word_budget.min}`
  );
  assert.ok(actions.length > 0, `${guide}: expected concrete actions`);

  // Issue plan from shared builder agrees with batch plan
  const issuePlan = buildIssuePlan(report, draft);
  assert.equal(issuePlan.all_issues.length, plan.issue_plan.all_issues.length);

  return {
    issue_count: plan.issue_count,
    categories: plan.categories,
    word_missing: plan.word_budget.missing,
    stages: plan.active_fix_stages,
  };
}

function assertOrchestrationSource(): void {
  const svc = readFileSync(
    join(ROOT, 'lib/editorial-engine/revision/revision-service.ts'),
    'utf8'
  );
  const engine = readFileSync(
    join(ROOT, 'lib/editorial-engine/revision/revision-engine.ts'),
    'utf8'
  );
  const worker = readFileSync(
    join(ROOT, 'lib/editorial-engine/jobs/revision-batch-worker.ts'),
    'utf8'
  );
  const routes = readFileSync(join(ROOT, 'lib/editorial-engine/routes.ts'), 'utf8');

  assert.ok(svc.includes('buildRevisionBatchPlan'), 'service uses batch planner');
  assert.ok(svc.includes('reviseDraftOnce'), 'service calls reviseDraftOnce');
  const reviseCalls = (svc.match(/reviseDraftOnce\(/g) || []).length;
  assert.equal(reviseCalls, 1, `exactly one reviseDraftOnce call site, got ${reviseCalls}`);

  // No Review↔Revision loop: final review uses revisions_exhausted once per path
  assert.ok(svc.includes('revisions_exhausted: true'), 'final review marks cycle complete');
  assert.ok(!/for\s*\(.*maxAttempts/.test(svc), 'no maxAttempts for-loop');
  assert.ok(svc.includes('lengthPrimary') || svc.includes('length_primary'), 'length-primary path present');
  assert.ok(svc.includes('shouldRollbackOnScoreRegression'), 'score rollback gated by length-floor policy');
  assert.ok(svc.includes('reuseAi: workingReport.ai_review'), 'length/soft paths reuse AI judgment');
  assert.ok(
    svc.includes('Quality already approved') || svc.includes('remediating publish blockers only'),
    'approved articles skip demoting re-review'
  );

  assert.ok(engine.includes('applyPlanDeterministic'), 'engine batches deterministic categories');
  assert.ok(worker.includes(REVISION_BATCH_JOB_TYPE) || worker.includes('revision_batch'));
  assert.ok(worker.includes('autoFixArticle'), 'worker runs autoFixArticle once');
  assert.ok(routes.includes('enqueueRevisionBatch'), 'revise endpoint enqueues batch job');
  assert.ok(routes.includes("status: 202") || routes.includes('status(202)'), 'async 202 response');

  const panel = readFileSync(
    join(ROOT, 'src/components/editorial/jobs/RevisionBatchPanel.tsx'),
    'utf8'
  );
  assert.ok(panel.includes('openDrawer') || panel.includes('GenerationDrawer'), 'RevisionBatchPanel is thin drawer shim');
  const drawer = readFileSync(
    join(ROOT, 'src/components/editorial/jobs/GenerationDrawer.tsx'),
    'utf8'
  );
  assert.ok(drawer.includes('Completed with Issues') || drawer.includes('isRevisionJob'), 'shared drawer handles Fix Issues');
  const jobsProvider = readFileSync(
    join(ROOT, 'src/components/editorial/jobs/JobsProvider.tsx'),
    'utf8'
  );
  assert.ok(jobsProvider.includes('enqueueRevision'), 'JobsProvider enqueues revision into shared drawer');
  const detail = readFileSync(
    join(ROOT, 'src/components/editorial/ArticleDetailPanel.tsx'),
    'utf8'
  );
  assert.ok(detail.includes('enqueueRevision'), 'ArticleDetailPanel uses shared enqueueRevision');
  assert.ok(
    detail.includes('subscribeJobTerminal') || detail.includes('passed'),
    'ArticleDetailPanel refreshes after Fix Issues completion'
  );
  assert.ok(!detail.includes('RevisionBatchPanel'), 'ArticleDetailPanel no longer mounts inline RevisionBatchPanel');
}

function assertTimelineStages(): void {
  const progress = createInitialRevisionProgress({ article_id: 1, topic_title: 'Test' });
  let next = markRevisionStagesFromPlan(
    progress,
    ['expanding_words', 'updating_faq', 'fixing_links', 'humanization', 'seo_repair', 'applying_batch'],
    7
  );
  next = applyRevisionStage(next, 'planning_revision', { log: 'plan' });
  next = applyRevisionStage(next, 'analyzing_failed_rules', {
    detail: 'Analyzing Failed Rules · 7 issues',
  });
  assert.ok(next.stages.some((s) => s.label.includes('7') || s.detail?.includes('7')));
  assert.ok(next.stages.some((s) => s.id === 'planning_revision' && s.label === 'Planning Revision'));
  assert.equal(
    next.stages.find((s) => s.id === 'fixing_links')?.label,
    'Internal Link Repair'
  );
  assert.equal(next.stages.find((s) => s.id === 'updating_faq')?.label, 'FAQ Repair');
  assert.equal(next.stages.find((s) => s.id === 'quality_audit')?.label, 'Quality Audit');
  assert.equal(next.stages.find((s) => s.id === 'final_review')?.label, 'Final Review');
  // Legacy aliases canonicalize into the shared timeline
  next = applyRevisionStage(next, 'validation' as never, { log: 'audit' });
  assert.equal(next.stage, 'quality_audit');
  next = applyRevisionStage(next, 'adding_table' as never, { log: 'seo' });
  assert.equal(next.stage, 'seo_repair');
  assert.ok(REVISION_BATCH_STAGES.includes('final_review'));
  assert.ok(REVISION_BATCH_STAGES.includes('expanding_words'));
  const built = buildRevisionStages(['expanding_words', 'updating_faq', 'seo_repair']);
  assert.ok(built.some((s) => s.id === 'expanding_words'));
  assert.ok(built.some((s) => s.id === 'seo_repair'));
  assert.ok(built.some((s) => s.id === 'final_review'));
  assert.ok(!built.some((s) => s.id === 'applying_batch'), 'applying_batch hidden from drawer timeline');
  const labels = built.map((s) => s.label);
  assert.ok(labels.includes('Queued'));
  assert.ok(labels.includes('Planning Revision'));
  assert.ok(labels.includes('Analyzing Failed Rules'));
  assert.ok(labels.includes('Quality Audit'));
}


/** RCA regression: expand must not be undone by a mild final-review score dip. */
function assertNoRollbackOnLengthFloorWin(): void {
  // Exact production bug shape: 1656 → 2210 expand, score 82.7 → 70.5
  assert.equal(
    shouldRollbackOnScoreRegression({
      scoreBefore: 82.7,
      scoreAfter: 70.5,
      wordsBefore: 1656,
      wordsAfter: 2210,
      minWords: 2200,
    }),
    false,
    'must NOT rollback when hard length floor was won'
  );
  assert.equal(
    shouldRollbackOnScoreRegression({
      scoreBefore: 82.7,
      scoreAfter: 70.5,
      wordsBefore: 1656,
      wordsAfter: 1656,
      minWords: 2200,
    }),
    true,
    'severe score drop without length win may still rollback'
  );
  assert.equal(
    shouldRollbackOnScoreRegression({
      scoreBefore: 82.7,
      scoreAfter: 80.0,
      wordsBefore: 1656,
      wordsAfter: 1800,
      minWords: 2200,
    }),
    false,
    'meaningful word gain toward floor blocks rollback'
  );
  assert.equal(
    shouldRollbackOnScoreRegression({
      scoreBefore: 80,
      scoreAfter: 81,
      wordsBefore: 1000,
      wordsAfter: 900,
      minWords: 2200,
    }),
    false,
    'score improved → never rollback'
  );
}

function assertLengthPrimaryDetection(): void {
  assert.ok(
    isLengthPrimaryFailure({
      overall_score: 82.7,
      threshold: 75,
      critical_fail: false,
      auto_fixable: [
        { code: 'missing_table', severity: 'minor' },
        { code: 'word_count_low', severity: 'major' },
      ],
      failed_rules: [],
      findings: [{ code: 'word_count_low', severity: 'major' }],
    }),
    'score≥threshold + only major word_count_low → length-primary'
  );
  assert.equal(
    isLengthPrimaryFailure({
      overall_score: 82.7,
      threshold: 75,
      auto_fixable: [
        { code: 'word_count_low', severity: 'major' },
        { code: 'missing_internal_links', severity: 'major' },
      ],
    }),
    false,
    'other major findings disable length-primary'
  );
  assert.equal(
    isLengthPrimaryFailure({
      overall_score: 60,
      threshold: 75,
      auto_fixable: [{ code: 'word_count_low', severity: 'major' }],
    }),
    false,
    'score below threshold disables length-primary'
  );
}

/**
 * fail review → fix → final review READY → workflow Ready, no Fix Issues.
 * Uses the same fields the ArticleDetailPanel derives from GET article/quality.
 */
function assertWorkflowReadyHidesFixButton(): void {
  const preview = {
    blocks: [{ id: '1', type: 'paragraph', content: 'x '.repeat(2300) }],
    word_count: 2300,
    seo_package: { canonical: '/blog/x', meta_title: 'Title long enough here' },
    internal_links: { count: 3, recommendations: [{ target: '/cost-of-living/india' }] },
    status: 'review',
    slug: 'x',
    excerpt: 'ok',
  } as unknown as ArticlePreview;

  const failedReport = {
    overall_score: 82.7,
    threshold: 75,
    passed: false,
    decision: 'revision',
    ready: false,
    failure_reasons: ['Word count 1656 below minimum 2200'],
  } as unknown as UiQualityReport;

  const readyReport = {
    overall_score: 84,
    threshold: 75,
    passed: true,
    decision: 'approved',
    ready: true,
    failure_reasons: [],
  } as unknown as UiQualityReport;

  const readinessReady = {
    ready: true,
    checks: [
      { key: 'quality_review', passed: true },
      { key: 'seo_package', passed: true },
      { key: 'internal_links', passed: true },
    ],
    blocking_errors: [],
  } as unknown as PublishReadiness;

  const before = deriveArticleWorkflow({
    status: 'draft',
    preview: { ...preview, word_count: 1656, status: 'draft' } as ArticlePreview,
    qualityReport: failedReport,
    readiness: {
      ready: false,
      checks: [
        { key: 'quality_review', passed: false },
        { key: 'seo_package', passed: true },
        { key: 'internal_links', passed: true },
      ],
      blocking_errors: [{ message: 'Word count 1656 below minimum 2200' }],
    } as unknown as PublishReadiness,
    hasResearch: true,
    topicId: 1,
  });
  assert.equal(before.stage, 'review');
  assert.equal(before.primaryAction, 'auto_fix');
  assert.equal(before.showAutoFixBanner, true);

  const after = deriveArticleWorkflow({
    status: 'review',
    preview,
    qualityReport: readyReport,
    readiness: readinessReady,
    hasResearch: true,
    topicId: 1,
  });
  assert.equal(after.stage, 'ready');
  assert.equal(after.primaryAction, 'publish');
  assert.equal(after.showAutoFixBanner, false);
  assert.ok(after.reviewPassed);
}

/** Review PASS + 1-word publish blocker must route to Ready (not Needs Revision on Review). */
function assertReviewPassRoutesReadyWithPublishBlocker(): void {
  const preview = {
    blocks: [{ id: '1', type: 'paragraph', content: 'x '.repeat(2200) }],
    word_count: 2199,
    seo_package: { canonical: '/blog/x', meta_title: 'Title long enough here' },
    internal_links: { count: 3, recommendations: [{ target: '/cost-of-living/india' }] },
    status: 'review',
    slug: 'x',
    excerpt: 'ok',
  } as unknown as ArticlePreview;

  const approvedReport = {
    overall_score: 91,
    threshold: 75,
    passed: true,
    decision: 'approved',
    ready: true,
    failure_reasons: [],
  } as unknown as UiQualityReport;

  const readinessBlocked = {
    ready: false,
    checks: [
      { key: 'quality_review', passed: true },
      { key: 'content_validation', passed: false, detail: 'Word count 2199 below minimum 2200' },
      { key: 'seo_package', passed: true },
      { key: 'internal_links', passed: true },
    ],
    blocking_errors: [
      { code: 'content_validation', message: 'Content Validation: Word count 2199 below minimum 2200' },
    ],
  } as unknown as PublishReadiness;

  const wf = deriveArticleWorkflow({
    status: 'review',
    preview,
    qualityReport: approvedReport,
    readiness: readinessBlocked,
    hasResearch: true,
    topicId: 1,
  });
  assert.equal(wf.stage, 'ready');
  assert.equal(wf.primaryAction, 'auto_fix');
  assert.ok(wf.reviewPassed);
  assert.equal(wf.publishReady, false);
}

function assertExpandPersistsPastMin(): void {
  const draft = thinDraft('Country');
  const before = countDraftWords(draft);
  assert.ok(before < 2200, 'fixture starts below min');
  const expanded = expandDraftToMinWords(draft, 2200);
  assert.ok(
    countDraftWords(expanded.draft) >= 2200,
    `expand must reach min (got ${countDraftWords(expanded.draft)})`
  );
  assert.ok(expanded.fixes.length > 0, 'expand reports actions');
}

function main(): void {
  console.log('═══ Revision Batch regression ═══\n');
  assertOrchestrationSource();
  console.log('PASS  orchestration = planner → one batch → one final review (no loops)');

  assertTimelineStages();
  console.log('PASS  timeline stages + issue-count label wiring');

  assertNoRollbackOnLengthFloorWin();
  console.log('PASS  score-regression policy never undoes length-floor wins');

  assertLengthPrimaryDetection();
  console.log('PASS  length-primary failure detection');

  assertExpandPersistsPastMin();
  console.log('PASS  deterministic expand reaches hard minimum');

  assertWorkflowReadyHidesFixButton();
  console.log('PASS  workflow: Review failed → Fix; after READY → Publish, no Fix button');

  assertReviewPassRoutesReadyWithPublishBlocker();
  console.log('PASS  workflow: Review pass + publish blocker → Ready (not Needs Revision)');

  const rows: Array<{ guide: string; issues: number; cats: string; missing: number }> = [];
  for (const guide of GUIDE_TYPES) {
    const r = assertPlannerForGuide(guide);
    rows.push({
      guide,
      issues: r.issue_count,
      cats: r.categories.join('+'),
      missing: r.word_missing,
    });
    console.log(
      `PASS  ${guide.padEnd(12)} issues=${r.issue_count} cats=${r.categories.join('+')} missing_words=${r.word_missing}`
    );
  }

  console.log('\n── Summary ──');
  console.table(rows);
  console.log(
    `\nALL ${GUIDE_TYPES.length} guide types: failed review is repairable in ONE revision cycle.`
  );
  console.log('State-machine RCA regressions: PASS');
}

main();
