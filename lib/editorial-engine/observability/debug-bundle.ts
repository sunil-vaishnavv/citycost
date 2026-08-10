/**
 * Export Debug Bundle — auth-protected JSON snapshot for one article.
 */

import { getArticleById } from '../db/articles-repo.js';
import { listQualityReports, getLatestQualityReport } from '../db/quality-reports-repo.js';
import { listRevisionHistory } from '../revision/revision-history.js';
import { getPublishReadiness } from '../publish/publish-gate.js';
import { pool } from '../../db.js';
import type { RowDataPacket } from 'mysql2';
import { getArticleCostAnalytics, listArticleAiUsageLogs } from './cost-analytics.js';
import { computeArticleHealth } from './article-health.js';
import type { QualityReport } from '../reviewer/quality-report.js';
import { EDITORIAL_ENGINE_VERSION } from '../constants.js';

export async function buildArticleDebugBundle(articleId: number): Promise<Record<string, unknown>> {
  const article = await getArticleById(articleId);
  if (!article) {
    throw new Error('Article not found');
  }

  const latest = await getLatestQualityReport(articleId);
  const reports = await listQualityReports(articleId);
  const revisions = await listRevisionHistory(articleId);
  const readiness = await getPublishReadiness(articleId);
  const cost = await getArticleCostAnalytics(articleId);
  const aiLogs = await listArticleAiUsageLogs(articleId, 200);

  let generationLogs: RowDataPacket[] = [];
  if (pool) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, stage, model_used, writer_prompt_version, reviewer_prompt_version,
              tokens_in, tokens_out, latency_ms, success, error_message, meta_json, created_at
       FROM editorial_generation_logs
       WHERE article_id = $1
       ORDER BY id ASC`,
      [articleId]
    );
    generationLogs = rows;
  }

  const findings = (latest?.findings_json || null) as QualityReport | null;
  const health = computeArticleHealth({
    status: article.status,
    decision: findings?.decision,
    overall_confidence: findings?.overall_confidence,
    confidence_level: findings?.confidence_level,
  });

  return {
    exported_at: new Date().toISOString(),
    engine_version: EDITORIAL_ENGINE_VERSION,
    article_id: articleId,
    article_health: health,
    article: {
      id: article.id,
      slug: article.slug,
      status: article.status,
      content_type: article.content_type,
      topic_id: article.topic_id,
      prompt_version: article.prompt_version,
      prompt_hash: article.prompt_hash,
      ai_model: article.ai_model,
      quality_score: article.quality_score,
      review_score: article.review_score,
      word_count: article.word_count,
      published_at: article.published_at,
      created_at: article.created_at,
      updated_at: article.updated_at,
    },
    research_pack: article.research_pack_json ?? null,
    writer_output: {
      draft_json: article.draft_json ?? null,
      blocks_json: article.blocks_json ?? null,
      raw_ai_response: article.raw_ai_response ?? null,
      seo_title: article.seo_title,
      meta_title: article.meta_title,
      meta_description: article.meta_description,
      excerpt: article.excerpt,
    },
    normalized_draft: article.draft_json ?? null,
    validator: findings?.rule_validator ?? null,
    reviewer: findings?.ai_review ?? null,
    decision: {
      decision: findings?.decision ?? null,
      ready: findings?.ready ?? null,
      critical_fail: findings?.critical_fail ?? null,
      reasons: findings?.decision_reasons ?? [],
      critical_reasons: findings?.critical_reasons ?? [],
    },
    quality_report: findings,
    quality_reports_history: reports.map((r) => ({
      id: r.id,
      attempt: r.attempt,
      passed: r.passed,
      score: r.score,
      created_at: r.created_at,
      findings: r.findings_json,
    })),
    revision_history: revisions,
    confidence: {
      overall_confidence: findings?.overall_confidence ?? null,
      confidence_level: findings?.confidence_level ?? null,
      confidence_breakdown: findings?.confidence_breakdown ?? null,
      article_health: health,
    },
    prompt_versions: findings?.prompt_versions ?? null,
    seo_package: article.seo_package_json ?? null,
    seo_validation: article.seo_validation_json ?? null,
    json_ld: article.json_ld_json ?? null,
    internal_links: article.internal_links_json ?? null,
    publish_readiness: readiness,
    cost_analytics: cost,
    generation_logs: generationLogs,
    ai_usage_logs: aiLogs,
  };
}
