/**
 * Reviewer orchestrator — immutable snapshot pipeline:
 * load → normalize → persist snapshot → Rule Validator → AI Reviewer → Decision
 */

import { finalizeDraftForSave } from '../writer/v2/public-integrity-gate.js';
import { REVIEWER_ENGINE_VERSION } from '../constants.js';
import { insertGenerationLog } from '../db/generation-logs-repo.js';
import { getActivePrompt } from '../db/prompts-repo.js';
import { getSettings } from '../db/settings-repo.js';
import { listContentTypes } from '../db/content-types-repo.js';
import {
  getArticleById,
  listArticlesForDuplicateScan,
  updateArticleDraft,
  updateArticleReviewState,
} from '../db/articles-repo.js';
import {
  insertQualityReport,
  listQualityReports,
  nextReviewAttempt,
} from '../db/quality-reports-repo.js';
import { getTopicById, setTopicStatus } from '../db/topics-repo.js';
import { getEditorialRuntime } from '../init.js';
import { normalizeDraft } from '../validation/normalize-draft.js';
import { decidePipeline } from '../validation/decision-engine.js';
import { runSharedDeterministicChecks } from '../validation/shared-checks.js';
import { countDraftWords, type WriterDraftPayload } from '../writer/draft-validate.js';
import type { ResearchPack } from '../writer/research-engine.js';
import {
  buildReviewerUserPayload,
  parseAiReviewerJson,
  reviewerSystemPrompt,
  type AiReviewerResult,
} from './ai-reviewer.js';
import { detectDuplicates } from './duplicate-detector.js';
import { assembleQualityReport, type QualityReport } from './quality-report.js';
import { buildReviewerPromptMeta, buildWriterPromptMeta, buildResearchPromptMeta } from '../observability/prompt-versions.js';
import { computeArticleHealth } from '../observability/article-health.js';

export interface ReviewArticleResult {
  ok: boolean;
  passed: boolean;
  article_id: number;
  report_id?: number;
  attempt?: number;
  overall_score?: number;
  threshold?: number;
  status: string;
  topic_status?: string | null;
  report?: QualityReport;
  message: string;
  failure_reasons?: string[];
  errors?: string[];
  decision?: string;
  normalize_fixes?: string[];
}

function asDraft(article: NonNullable<Awaited<ReturnType<typeof getArticleById>>>): WriterDraftPayload {
  if (article.draft_json && typeof article.draft_json === 'object') {
    return article.draft_json as WriterDraftPayload;
  }
  return {
    seo_title: article.seo_title || '',
    meta_title: article.meta_title || '',
    meta_description: article.meta_description || '',
    excerpt: article.excerpt || '',
    blocks: Array.isArray(article.blocks_json)
      ? (article.blocks_json as WriterDraftPayload['blocks'])
      : [],
  };
}

function asResearch(article: Awaited<ReturnType<typeof getArticleById>>): ResearchPack | null {
  if (!article?.research_pack_json || typeof article.research_pack_json !== 'object') {
    return null;
  }
  return article.research_pack_json as ResearchPack;
}

/**
 * Full deterministic review on a normalized snapshot.
 * Never reviews a stale/raw writer draft.
 */
export async function reviewArticle(
  articleId: number,
  opts?: {
    fast?: boolean;
    revisions_exhausted?: boolean;
    persist_normalize?: boolean;
    /** Reuse prior AI judgment (skip AI round-trip) — used by soft Fix Issues finalize */
    reuseAi?: AiReviewerResult | null;
  }
): Promise<ReviewArticleResult> {
  const fast = Boolean(opts?.fast);
  const reuseAi = opts?.reuseAi || null;
  const runtime = getEditorialRuntime();
  if (!runtime?.ready) {
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: 'draft',
      message: 'Editorial Engine not ready',
      errors: ['engine_not_ready'],
    };
  }
  if (!runtime.ai.isConfigured() && !reuseAi) {
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: 'draft',
      message: 'No AI providers configured. Add a key in Settings → AI Providers.',
      errors: ['ai_unconfigured'],
    };
  }

  const article = await getArticleById(articleId);
  if (!article) {
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: 'draft',
      message: 'Article not found',
      errors: ['article_not_found'],
    };
  }

  if (
    article.status !== 'draft' &&
    article.status !== 'review' &&
    article.status !== 'needs_manual_review'
  ) {
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: article.status,
      message: `Article status '${article.status}' cannot be reviewed (allowed: draft, review, needs_manual_review)`,
      errors: ['invalid_article_status'],
    };
  }

  const priorStatus = article.status;
  const started = Date.now();
  let promptVersion: number | null = null;

  try {
    const settings = await getSettings();
    await listQualityReports(articleId); // soft history touch

    const reviewerPrompt = await getActivePrompt('reviewer_system');
    if (!reviewerPrompt) throw new Error('reviewer_system prompt missing');
    promptVersion = reviewerPrompt.version;

    // PART 1–2: normalize → persist snapshot (single source of truth)
    const raw = asDraft(article);
    const normalized = normalizeDraft(raw);
    // Reviews always see (and persist) the integrity-repaired draft.
    const snapshot = finalizeDraftForSave(article, normalized.draft).draft;
    if (opts?.persist_normalize !== false) {
      await updateArticleDraft({
        id: articleId,
        draft: snapshot,
        word_count: countDraftWords(snapshot),
        reading_time_minutes: Math.max(1, Math.round(countDraftWords(snapshot) / 220)),
      });
    }

    const research = asResearch(article);
    const types = await listContentTypes();
    const typeRow = types.find((t) => t.type_key === article.content_type);
    const qualityRules = typeRow?.quality_rules_json || null;

    const shared = runSharedDeterministicChecks({
      draft: snapshot,
      settings,
      research,
      qualityRules,
    });
    const rules = shared.rules;
    const readability = shared.readability;
    const eeat = shared.eeat;
    const search_intent = shared.search_intent;
    const human_writing = shared.human_writing;
    const helpful_content = shared.helpful_content;

    const candidates = await listArticlesForDuplicateScan(articleId, 80);
    const duplicate = detectDuplicates({
      draft: snapshot,
      articleId,
      threshold: settings.duplicate_threshold,
      contentType: article.content_type,
      candidates,
    });

    let reviewModel = settings.reviewer_model;
    let ai: AiReviewerResult;
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let aiProvider: string | undefined;
    let aiModelUsed: string | undefined;
    let aiRetries = 0;

    if (reuseAi) {
      // Soft Fix Issues finalize: re-run deterministic gates only; keep prior AI scores.
      ai = reuseAi;
      reviewModel = 'reused-ai-judgment';
    } else {
      const user = buildReviewerUserPayload({
        draft: snapshot,
        research,
        article: {
          id: article.id,
          slug: article.slug,
          content_type: article.content_type,
          word_count: countDraftWords(snapshot),
        },
        deterministic_hints: {
          rule_score: rules.score,
          readability_score: readability.score,
          uniqueness_score: duplicate.uniqueness_score,
          eeat_score: eeat.score,
          search_intent_score: search_intent.score,
          human_writing_score: human_writing.score,
          helpful_content_score: helpful_content.score,
        },
        validator_result: {
          passed: rules.passed,
          critical_fail: rules.critical_fail,
          failed_rules: (rules.failed_rules || []).map((f) => ({
            code: f.code,
            message: f.message,
          })),
          auto_fixable: (rules.auto_fixable || []).map((f) => ({
            code: f.code,
            message: f.message,
          })),
          warnings: (rules.warnings || []).map((f) => ({
            code: f.code,
            message: f.message,
          })),
          seo_pass: rules.seo_pass,
        },
        compact: fast,
      });

      const { getAiRouter } = await import('../ai/ai-router.js');
      reviewModel = fast
        ? /8b-instant|flash|mini|haiku/i.test(settings.reviewer_model)
          ? settings.reviewer_model
          : 'openai/gpt-oss-20b'
        : settings.reviewer_model;
      const aiResult = await getAiRouter().complete({
        model: reviewModel,
        system: reviewerSystemPrompt(reviewerPrompt),
        user,
        temperature: Math.min(settings.temperature, 0.35),
        topP: settings.top_p,
        maxTokens: Math.min(settings.max_tokens, fast ? 1536 : 4096),
        jsonMode: true,
        stage: fast ? 'reviewer_fast' : 'reviewer',
        preferredProvider: fast ? 'gemini' : undefined,
        maxFailover: fast ? 2 : undefined,
        timeoutMs: fast ? 30_000 : undefined,
        articleId,
      });
      tokensIn = aiResult.tokensIn;
      tokensOut = aiResult.tokensOut;
      aiProvider = aiResult.provider;
      aiModelUsed = aiResult.model;
      aiRetries = aiResult.retries ?? 0;
      ai = parseAiReviewerJson(aiResult.text);
    }

    const promptVersions = {
      ...buildWriterPromptMeta({
        version: article.prompt_version,
        hash: article.prompt_hash,
      }),
      ...buildResearchPromptMeta({ version: 'research-pack-v1' }),
      ...buildReviewerPromptMeta({
        version: promptVersion,
        systemPrompt: reviewerSystemPrompt(reviewerPrompt),
      }),
    };
    const report = assembleQualityReport({
      ai,
      rules,
      duplicate,
      readability,
      eeat,
      search_intent,
      human_writing,
      helpful_content,
      quality_threshold: settings.quality_score_threshold,
      engine_version: REVIEWER_ENGINE_VERSION,
      resolved_rules: normalized.fixes,
      revisions_exhausted: opts?.revisions_exhausted,
      research,
      draft: snapshot,
      article_status: priorStatus,
      prompt_versions: promptVersions,
    });

    // Align status with decision engine (not score alone). Duplicate policy lives in decidePipeline.
    const decision = decidePipeline({
      overall_score: report.overall_score,
      threshold: settings.quality_score_threshold,
      rules,
      ai: report.ai_review,
      seo_pass: rules.seo_pass,
      readability_pass: (report.scores.readability ?? 0) >= 55,
      revisions_exhausted: opts?.revisions_exhausted,
      duplicate,
    });

    const nextArticleStatus = decision.status;
    report.passed = decision.decision === 'approved';
    report.decision = decision.decision;
    report.ready = decision.ready;
    report.critical_fail = decision.critical_fail;
    report.critical_reasons = decision.critical_reasons;
    report.decision_reasons = decision.reasons;
    report.failure_reasons = report.passed
      ? []
      : decision.critical_reasons.length
        ? decision.critical_reasons
        : decision.reasons.length
          ? decision.reasons
          : report.failure_reasons;

    const attempt = await nextReviewAttempt(articleId);
    const reportId = await insertQualityReport({
      article_id: articleId,
      attempt,
      passed: report.passed,
      score: report.overall_score,
      findings: report,
    });

    report.article_health = computeArticleHealth({
      status: nextArticleStatus,
      decision: decision.decision,
      overall_confidence: report.overall_confidence,
      confidence_level: report.confidence_level,
    });

    await updateArticleReviewState({
      id: articleId,
      status: nextArticleStatus,
      quality_score: report.overall_score,
      review_score: report.scores.ai_review,
      overall_confidence: report.overall_confidence ?? null,
      confidence_level: report.confidence_level ?? null,
      article_health: report.article_health ?? null,
    });

    let topic_status: string | null = null;
    if (article.topic_id) {
      const topic = await getTopicById(article.topic_id);
      if (topic && (topic.status === 'draft' || topic.status === 'review')) {
        const topicNext = nextArticleStatus === 'review' ? 'review' : 'draft';
        await setTopicStatus(article.topic_id, topicNext);
        topic_status = topicNext;
      } else {
        topic_status = topic?.status ?? null;
      }
    }

    await insertGenerationLog({
      article_id: articleId,
      topic_id: article.topic_id,
      stage: 'reviewer',
      model_used: reviewModel,
      reviewer_prompt_version: promptVersion,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: Date.now() - started,
      success: true,
      meta_json: {
        reviewer_engine: REVIEWER_ENGINE_VERSION,
        report_id: reportId,
        attempt,
        passed: report.passed,
        overall_score: report.overall_score,
        prior_status: priorStatus,
        next_status: nextArticleStatus,
        decision: decision.decision,
        normalize_fixes: normalized.fixes.slice(0, 12),
        fast,
        reused_ai: Boolean(reuseAi),
        overall_confidence: report.overall_confidence,
        confidence_level: report.confidence_level,
        confidence_breakdown: report.confidence_breakdown,
        article_health: report.article_health,
        prompt_versions: promptVersions,
        provider: aiProvider,
        model: aiModelUsed,
        retry_count: aiRetries,
      },
    });

    const failure_reasons = report.failure_reasons || [];
    return {
      ok: true,
      passed: report.passed,
      article_id: articleId,
      report_id: reportId,
      attempt,
      overall_score: report.overall_score,
      threshold: report.threshold,
      status: nextArticleStatus,
      topic_status,
      report,
      failure_reasons,
      decision: decision.decision,
      normalize_fixes: normalized.fixes,
      message: report.passed
        ? `READY — review passed (score ${report.overall_score}/${report.threshold})`
        : decision.decision === 'manual_review'
          ? `Needs manual review — ${failure_reasons.slice(0, 3).join(' · ')}`
          : `Needs revision (score ${report.overall_score}/${report.threshold}) — ${failure_reasons.slice(0, 3).join(' · ')}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await insertGenerationLog({
        article_id: articleId,
        topic_id: article.topic_id,
        stage: 'reviewer',
        model_used: (await getSettings()).reviewer_model,
        reviewer_prompt_version: promptVersion,
        success: false,
        error_message: message,
        latency_ms: Date.now() - started,
        meta_json: { reviewer_engine: REVIEWER_ENGINE_VERSION },
      });
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: priorStatus,
      message,
      errors: [message],
    };
  }
}

export async function getArticleReviewHistory(articleId: number) {
  const reports = await listQualityReports(articleId);
  return {
    article_id: articleId,
    count: reports.length,
    reports: reports.map((r) => {
      const f = r.findings_json as QualityReport & {
        rolled_back?: boolean;
        inactive?: boolean;
        report_status?: string;
        rollback_reason?: string;
      };
      const rolled_back =
        Boolean(f?.rolled_back) ||
        Boolean(f?.inactive) ||
        f?.report_status === 'ROLLED_BACK' ||
        f?.report_status === 'inactive';
      return {
        id: r.id,
        attempt: r.attempt,
        passed: r.passed,
        score: r.score,
        created_at: r.created_at,
        summary: typeof f?.summary === 'string' ? f.summary : null,
        scores: f?.scores ?? null,
        issues: f?.issues ?? [],
        decision: f?.decision ?? null,
        remaining_rules: f?.remaining_rules ?? [],
        resolved_rules: f?.resolved_rules ?? [],
        rule_groups: f?.rule_groups ?? null,
        critical_fail: f?.critical_fail ?? false,
        overall_confidence: f?.overall_confidence ?? null,
        confidence_level: f?.confidence_level ?? null,
        confidence_breakdown: f?.confidence_breakdown ?? null,
        article_health: f?.article_health ?? null,
        prompt_versions: f?.prompt_versions ?? null,
        rolled_back,
        inactive: rolled_back,
        report_status: rolled_back ? 'ROLLED_BACK' : f?.report_status || 'active',
        rollback_reason: f?.rollback_reason ?? null,
      };
    }),
  };
}
