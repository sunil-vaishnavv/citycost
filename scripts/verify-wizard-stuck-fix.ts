/**
 * Quick regression checks for wizard soft-locks (no DB).
 * Run: npx tsx scripts/verify-wizard-stuck-fix.ts
 */
import {
  deriveArticleWorkflow,
  isLinksComplete,
  isSeoComplete,
  isSeoStepComplete,
} from '../src/components/editorial/article-workflow';
import type { ArticlePreview, PublishReadiness, QualityReport } from '../src/components/editorial/api';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const basePreview = {
  article_id: 1,
  slug: 'test-article',
  status: 'draft',
  preview_version: 1,
  reading_time_minutes: 8,
  word_count: 2000,
  quality_score: null,
  review_score: null,
  blocks: [{ id: '1', type: 'paragraph', content: 'Hello world without links.' }],
  excerpt: 'Hello',
  seo_package: {
    seo_title: 'Title',
    meta_title: 'Meta',
    meta_description: 'Desc long enough',
    canonical: 'https://example.com/blog/test-article',
    primary_keyword: 'cost of living',
  },
  entity_map: {},
  json_ld: { '@graph': [] },
  internal_links: {
    count: 5,
    recommendations: [
      {
        anchor: 'Compare cities',
        target: '/compare',
        reason: 'tool',
        confidence: 0.9,
        location: 'body',
        link_kind: 'tool',
      },
    ],
  },
  seo_validation: { seo_score: 80, errors: [], warnings: [] },
  quality_panel: {
    overall_seo_score: 80,
    eeat_score: 70,
    helpful_content_score: 70,
    search_intent_score: 70,
    readability_score: 60,
    internal_link_count: 5,
    schema_status: {},
    missing_items: [],
    quality_score: null,
  },
} as unknown as ArticlePreview;

// 1) SEO generate result with package links but ZERO body links must unlock Review
assert(isSeoComplete(basePreview, null), 'seo complete');
assert(isLinksComplete(basePreview, null), 'package links complete');
assert(isSeoStepComplete(basePreview, null), 'seo step complete');
assert(
  !basePreview.blocks.some((b) => String(b.content).includes('](/')),
  'fixture has no body links'
);

// Soft validation errors (meta length band) must NOT block leaving SEO
const withSeoErrors = {
  ...basePreview,
  seo_validation: {
    seo_score: 88,
    errors: [{ message: 'Meta description short (142); target 150–160' }],
    warnings: [],
  },
} as unknown as ArticlePreview;
assert(isSeoComplete(withSeoErrors, null), 'seo complete despite soft validation errors');
assert(isSeoStepComplete(withSeoErrors, null), 'seo step complete despite soft validation errors');

const afterSeo = deriveArticleWorkflow({
  status: 'draft',
  preview: withSeoErrors,
  qualityReport: null,
  readiness: null,
  hasResearch: true,
  topicId: 1,
});
assert(afterSeo.stage === 'review', `expected review after SEO, got ${afterSeo.stage}`);
assert(afterSeo.primaryAction === 'run_review', `expected run_review, got ${afterSeo.primaryAction}`);

// 2) Soft-fail review → Auto Fix, not dead-end
const failedQr = {
  passed: false,
  overall_score: 60,
  threshold: 85,
  decision: 'revision',
  failure_reasons: ['missing_internal_links'],
  scores: {},
  issues: ['missing_internal_links'],
} as unknown as QualityReport;

const afterFail = deriveArticleWorkflow({
  status: 'draft',
  preview: basePreview,
  qualityReport: failedQr,
  readiness: null,
  hasResearch: true,
  topicId: 1,
});
assert(afterFail.stage === 'review', 'soft fail stays on review');
assert(afterFail.primaryAction === 'auto_fix', 'soft fail offers auto_fix');
assert(afterFail.showAutoFixBanner, 'auto fix banner');

// 3) Ready with publishReady → Publish CTA (never none)
const readyPreview = { ...basePreview, status: 'review' } as ArticlePreview;
const readiness: PublishReadiness = {
  ready: true,
  article_id: 1,
  status: 'review',
  slug: 'test-article',
  title: 'Title',
  quality_score: 90,
  seo_score: 80,
  word_count: 2000,
  internal_link_count: 3,
  package_link_count: 5,
  canonical_url: 'https://example.com/blog/test-article',
  checks: [
    { key: 'status_review', label: 'Status', passed: true },
    { key: 'quality_review', label: 'Quality', passed: true },
    { key: 'seo_package', label: 'SEO', passed: true },
    { key: 'seo_validation', label: 'SEO Validation', passed: true },
    { key: 'schema', label: 'Schema', passed: true },
    { key: 'internal_links', label: 'Links', passed: true },
    { key: 'content_validation', label: 'Content', passed: true },
    { key: 'slug', label: 'Slug', passed: true },
    { key: 'confidence', label: 'Confidence', passed: true },
  ],
  blocking_errors: [],
};

const ready = deriveArticleWorkflow({
  status: 'review',
  preview: readyPreview,
  qualityReport: { ...failedQr, passed: true, decision: 'approved', overall_score: 90 },
  readiness,
  hasResearch: true,
  topicId: 1,
});
assert(ready.stage === 'ready', `expected ready, got ${ready.stage}`);
assert(ready.primaryAction === 'publish', `expected publish, got ${ready.primaryAction}`);

// 4) Review passed but body links missing → Ready stage with Fix Issues (not stuck on Review)
const blockedReadiness: PublishReadiness = {
  ...readiness,
  ready: false,
  internal_link_count: 0,
  checks: readiness.checks.map((c) =>
    c.key === 'internal_links' ? { ...c, passed: false, detail: 'Need ≥1 in-body link' } : c
  ),
  blocking_errors: [{ code: 'internal_links', message: 'Internal Links: Need ≥1 in-body link' }],
};

const blocked = deriveArticleWorkflow({
  status: 'review',
  preview: readyPreview,
  qualityReport: { ...failedQr, passed: true, decision: 'approved', overall_score: 90 },
  readiness: blockedReadiness,
  hasResearch: true,
  topicId: 1,
});
assert(blocked.stage === 'ready', `expected ready for body-link blocker after review pass, got ${blocked.stage}`);
assert(blocked.primaryAction === 'auto_fix', `expected auto_fix, got ${blocked.primaryAction}`);
assert(blocked.reviewPassed, 'review must be marked passed');
assert(blocked.primaryAction !== 'none', 'never primary none when recoverable');

// 5) Review passed + publish ready → Publish CTA on Ready stage
const reviewPassReady = deriveArticleWorkflow({
  status: 'review',
  preview: readyPreview,
  qualityReport: { ...failedQr, passed: true, decision: 'approved', overall_score: 90, ready: true },
  readiness,
  hasResearch: true,
  topicId: 1,
});
assert(reviewPassReady.stage === 'ready', 'review pass + publish ready → ready stage');
assert(reviewPassReady.primaryAction === 'publish', 'publish CTA when fully ready');

// 6) Review failed → stays on Review with Fix Issues
const reviewFail = deriveArticleWorkflow({
  status: 'draft',
  preview: basePreview,
  qualityReport: failedQr,
  readiness: null,
  hasResearch: true,
  topicId: 1,
});
assert(reviewFail.stage === 'review', 'failed review stays on review');
assert(reviewFail.primaryAction === 'auto_fix', 'failed review offers auto_fix');
assert(!reviewFail.reviewPassed, 'reviewPassed false when quality failed');

// 7) Review passed but word-count publish blocker → Ready (not Needs Revision label path)
const wordBlockedReadiness: PublishReadiness = {
  ...readiness,
  ready: false,
  checks: readiness.checks.map((c) =>
    c.key === 'content_validation'
      ? { ...c, passed: false, detail: 'Word count 2199 below minimum 2200' }
      : c
  ),
  blocking_errors: [
    { code: 'content_validation', message: 'Content Validation: Word count 2199 below minimum 2200' },
  ],
};
const wordBlocked = deriveArticleWorkflow({
  status: 'review',
  preview: { ...readyPreview, word_count: 2199 },
  qualityReport: { ...failedQr, passed: true, decision: 'approved', overall_score: 91, ready: true },
  readiness: wordBlockedReadiness,
  hasResearch: true,
  topicId: 1,
});
assert(wordBlocked.stage === 'ready', `word blocker after review pass → ready, got ${wordBlocked.stage}`);
assert(wordBlocked.reviewPassed, 'reviewPassed true when status review + approved report');
assert(!wordBlocked.publishReady, 'publishReady false when content_validation blocks');

// 8) Busy revise must not override review-passed ready routing after job completes
const afterRevise = deriveArticleWorkflow({
  status: 'review',
  preview: readyPreview,
  qualityReport: { ...failedQr, passed: true, decision: 'approved', overall_score: 90 },
  readiness,
  hasResearch: true,
  topicId: 1,
  busy: null,
});
assert(afterRevise.stage === 'ready', 'after revise completes, ready stage when publish ready');

console.log('verify-wizard-stuck-fix: OK');
