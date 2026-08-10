/**
 * Regression: Review PASS must advance workflow to Ready (not stuck on Needs Revision).
 * Run: npx tsx scripts/verify-review-pass-transition.ts
 */
import {
  deriveArticleWorkflow,
} from '../src/components/editorial/article-workflow';
import type { ArticlePreview, PublishReadiness, QualityReport } from '../src/components/editorial/api';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const preview = {
  blocks: [{ id: '1', type: 'paragraph', content: 'x '.repeat(2200) }],
  word_count: 2199,
  seo_package: { canonical: '/blog/x', meta_title: 'Title long enough here' },
  internal_links: { count: 3, recommendations: [{ target: '/cost-of-living/india' }] },
  status: 'review',
  slug: 'choosing-between-new-delhi-and-mumbai',
  excerpt: 'ok',
} as unknown as ArticlePreview;

const approvedReport = {
  overall_score: 91,
  threshold: 75,
  passed: true,
  decision: 'approved',
  ready: true,
  failure_reasons: [],
} as unknown as QualityReport;

const failedReport = {
  overall_score: 68.7,
  threshold: 75,
  passed: false,
  decision: 'revision',
  ready: false,
  failure_reasons: ['Score below threshold'],
} as unknown as QualityReport;

const readinessBlocked: PublishReadiness = {
  ready: false,
  article_id: 47,
  status: 'review',
  slug: preview.slug,
  title: 'Test',
  quality_score: 91,
  seo_score: 80,
  word_count: 2199,
  internal_link_count: 3,
  package_link_count: 3,
  canonical_url: '/blog/x',
  checks: [
    { key: 'status_review', label: 'Status', passed: true },
    { key: 'quality_review', label: 'Quality', passed: true },
    { key: 'seo_package', label: 'SEO', passed: true },
    { key: 'seo_validation', label: 'SEO Validation', passed: true },
    { key: 'schema', label: 'Schema', passed: true },
    { key: 'internal_links', label: 'Links', passed: true },
    { key: 'content_validation', label: 'Content', passed: false, detail: 'Word count 2199 below minimum 2200' },
    { key: 'slug', label: 'Slug', passed: true },
    { key: 'confidence', label: 'Confidence', passed: true },
  ],
  blocking_errors: [
    { code: 'content_validation', message: 'Content Validation: Word count 2199 below minimum 2200' },
  ],
};

const readinessReady: PublishReadiness = {
  ...readinessBlocked,
  ready: true,
  word_count: 2205,
  checks: readinessBlocked.checks.map((c) =>
    c.key === 'content_validation' ? { ...c, passed: true, detail: '2205 words' } : c
  ),
  blocking_errors: [],
};

console.log('TEST 1: Review FAIL → Needs Revision on Review stage');
const t1 = deriveArticleWorkflow({
  status: 'draft',
  preview: { ...preview, status: 'draft', word_count: 2055 },
  qualityReport: failedReport,
  readiness: null,
  hasResearch: true,
  topicId: 1,
});
assert(t1.stage === 'review', 'TEST 1 stage');
assert(t1.primaryAction === 'auto_fix', 'TEST 1 action');
assert(t1.showAutoFixBanner, 'TEST 1 banner');
assert(!t1.reviewPassed, 'TEST 1 reviewPassed');
console.log('PASS');

console.log('TEST 2: Review PASS (status review) + publish blocked → Ready stage');
const t2 = deriveArticleWorkflow({
  status: 'review',
  preview,
  qualityReport: approvedReport,
  readiness: readinessBlocked,
  hasResearch: true,
  topicId: 1,
});
assert(t2.stage === 'ready', `TEST 2 stage=${t2.stage}`);
assert(t2.reviewPassed, 'TEST 2 reviewPassed');
assert(!t2.publishReady, 'TEST 2 publishReady');
assert(t2.primaryAction === 'auto_fix', 'TEST 2 action');
console.log('PASS');

console.log('TEST 3: Review PASS + publish ready → Publish on Ready');
const t3 = deriveArticleWorkflow({
  status: 'review',
  preview: { ...preview, word_count: 2205 },
  qualityReport: approvedReport,
  readiness: readinessReady,
  hasResearch: true,
  topicId: 1,
});
assert(t3.stage === 'ready', 'TEST 3 stage');
assert(t3.primaryAction === 'publish', 'TEST 3 action');
assert(!t3.showAutoFixBanner, 'TEST 3 no fix banner');
console.log('PASS');

console.log('TEST 4: busy=revise during job → review stage with banner');
const t4 = deriveArticleWorkflow({
  status: 'draft',
  preview: { ...preview, status: 'draft' },
  qualityReport: failedReport,
  readiness: null,
  hasResearch: true,
  topicId: 1,
  busy: 'revise',
});
assert(t4.stage === 'review', 'TEST 4 stage');
assert(t4.primaryAction === 'auto_fix', 'TEST 4 action');
console.log('PASS');

console.log('TEST 5: After revise completes (busy=null) + review pass → ready');
const t5 = deriveArticleWorkflow({
  status: 'review',
  preview,
  qualityReport: approvedReport,
  readiness: readinessReady,
  hasResearch: true,
  topicId: 1,
  busy: null,
});
assert(t5.stage === 'ready', 'TEST 5 stage');
assert(t5.primaryAction === 'publish', 'TEST 5 action');
console.log('PASS');

console.log('TEST 6: quality_review check drives reviewPassed via readiness');
const t6 = deriveArticleWorkflow({
  status: 'draft',
  preview: { ...preview, status: 'draft' },
  qualityReport: null,
  readiness: {
    ...readinessReady,
    checks: readinessReady.checks.map((c) =>
      c.key === 'quality_review' ? { ...c, passed: true } : c
    ),
  },
  hasResearch: true,
  topicId: 1,
});
assert(t6.reviewPassed, 'TEST 6 reviewPassed via readiness check');
console.log('PASS');

console.log('TEST 7: Manual review → stays on review, run_review');
const t7 = deriveArticleWorkflow({
  status: 'needs_manual_review',
  preview,
  qualityReport: { ...failedReport, decision: 'manual_review', critical_fail: true },
  readiness: readinessBlocked,
  hasResearch: true,
  topicId: 1,
});
assert(t7.stage === 'review', 'TEST 7 stage');
assert(t7.primaryAction === 'run_review', 'TEST 7 action');
assert(t7.needsManualReview, 'TEST 7 manual');
console.log('PASS');

console.log('TEST 8: Rolled-back report must not count as review passed');
const t8 = deriveArticleWorkflow({
  status: 'draft',
  preview: { ...preview, status: 'draft' },
  qualityReport: { ...failedReport, rolled_back: true, inactive: true },
  readiness: null,
  hasResearch: true,
  topicId: 1,
});
assert(!t8.reviewPassed, 'TEST 8 reviewPassed');
assert(t8.primaryAction === 'run_review' || t8.primaryAction === 'auto_fix', 'TEST 8 action');
console.log('PASS');

console.log('\nAll 8 review-pass transition tests passed.');
