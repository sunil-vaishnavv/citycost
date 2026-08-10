/**
 * Live fix: remediate publish blockers for article 47 (Delhi vs Mumbai).
 * Run: npx tsx scripts/verify-review-pass-live.ts
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { initEditorialEngine } from '../lib/editorial-engine/init.js';
import { autoFixArticle } from '../lib/editorial-engine/revision/revision-service.js';
import { getArticleById } from '../lib/editorial-engine/db/articles-repo.js';
import { getLatestQualityReport } from '../lib/editorial-engine/db/quality-reports-repo.js';
import { getPublishReadiness } from '../lib/editorial-engine/publish/publish-gate.js';
import { deriveArticleWorkflow } from '../src/components/editorial/article-workflow.js';
import type { ArticlePreview, PublishReadiness, QualityReport } from '../src/components/editorial/api.js';

const ARTICLE_ID = 47;

async function main(): Promise<void> {
  console.log(`═══ Live review-pass fix · article ${ARTICLE_ID} ═══\n`);
  await initEditorialEngine();

  const result = await autoFixArticle(ARTICLE_ID);
  const article = await getArticleById(ARTICLE_ID);
  const latest = await getLatestQualityReport(ARTICLE_ID);
  const readiness = await getPublishReadiness(ARTICLE_ID);
  const findings = (latest?.findings_json || {}) as QualityReport;

  console.log({
    result_passed: result.passed,
    result_publish_ready: result.publish_ready,
    article_status: article?.status,
    word_count: article?.word_count,
    quality_score: article?.quality_score,
    report_decision: findings.decision,
    report_passed: findings.passed,
    readiness_ready: readiness.ready,
    blocking: readiness.blocking_errors,
  });

  assert.ok(result.passed, 'review must pass');
  assert.equal(article?.status, 'review');
  assert.ok(findings.passed || findings.decision === 'approved', 'quality report approved');

  const preview = {
    blocks: article!.blocks_json,
    word_count: article!.word_count,
    seo_package: article!.seo_package_json,
    internal_links: article!.internal_links_json,
    status: article!.status,
    slug: article!.slug,
    excerpt: article!.excerpt,
  } as unknown as ArticlePreview;

  const wf = deriveArticleWorkflow({
    status: article!.status,
    preview,
    qualityReport: findings,
    readiness: readiness as unknown as PublishReadiness,
    hasResearch: true,
    topicId: article!.topic_id,
  });

  console.log('workflow:', {
    stage: wf.stage,
    primaryAction: wf.primaryAction,
    reviewPassed: wf.reviewPassed,
    publishReady: wf.publishReady,
    showAutoFixBanner: wf.showAutoFixBanner,
  });

  assert.equal(wf.stage, 'ready', 'must advance to Ready after review pass');
  assert.ok(wf.reviewPassed);
  if (readiness.ready) {
    assert.equal(wf.primaryAction, 'publish');
    assert.equal(wf.showAutoFixBanner, false);
    console.log('\nPASS  fully ready to publish');
  } else {
    assert.equal(wf.primaryAction, 'auto_fix');
    console.log('\nPASS  review passed → Ready stage (publish blockers may remain)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
