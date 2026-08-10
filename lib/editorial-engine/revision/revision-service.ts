/**
 * Single-cycle revision pipeline (no Review→Revision→Review loops):
 *
 *   Draft → Normalize → Rule Validator → Issue Planner
 *   → ONE Revision batch (all planned categories)
 *   → Normalize → Validator → ONE Final AI Review → Decision
 *
 * `max_revision_attempts` is kept for API/settings backward compat but is treated
 * as a soft cap on patch categories in one cycle — NOT as loop iterations.
 */

import {
  getArticleById,
  updateArticleDraft,
  updateArticleReviewState,
  updateArticleStatus,
} from '../db/articles-repo.js';
import { getSettings } from '../db/settings-repo.js';
import { insertGenerationLog } from '../db/generation-logs-repo.js';
import {
  getLatestQualityReport,
  listQualityReports,
  markQualityReportRolledBack,
} from '../db/quality-reports-repo.js';
import { reviewArticle } from '../reviewer/review.js';
import type { QualityReport } from '../reviewer/quality-report.js';
import { detectDraftCorruption } from '../validation/corruption.js';
import {
  isLengthPrimaryFailure,
  isSoftAiOnlyFailure,
  shouldRollbackOnScoreRegression,
} from '../validation/decision-engine.js';
import { ISSUE_CATEGORY_ORDER } from '../validation/issue-plan.js';
import { normalizeDraft } from '../validation/normalize-draft.js';
import type { ResearchPack } from '../writer/research-engine.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { countDraftWords } from '../writer/draft-validate.js';
import { insertRevisionHistory, nextRevisionAttempt } from './revision-history.js';
import { reviseDraftOnce } from './revision-engine.js';
import { buildRevisionBatchPlan } from './revision-plan.js';
import type {
  RevisionLoopResult,
  RevisionProgressEvent,
  RevisionResult,
} from './revision-types.js';
import { REVISION_PROMPT_VERSION } from './revision-types.js';
import {
  applyDeterministicRepairs,
  expandDraftToMinWords,
  injectBodyLinks,
  repairMetaLengths,
} from './revision-validator.js';
import { buildRevisionCategoryMeta } from '../observability/revision-categories.js';
import { buildQualityTimelinePoint } from '../observability/quality-timeline.js';
import { buildRevisionPromptMeta } from '../observability/prompt-versions.js';
import { confidenceFromQualityReport } from '../observability/confidence-engine.js';
import { getPublishReadiness } from '../publish/publish-gate.js';
import { generateArticleSeo } from '../seo/generate-seo.js';
import type { InternalLinkPackage } from '../seo/internal-links.js';
import { countBodyInternalLinks } from '../validation/normalize-draft.js';
import { cleanArticlePublicIdentity } from '../utils/clean-article-identity.js';

async function emitProgress(
  cb: ((e: RevisionProgressEvent) => void | Promise<void>) | undefined,
  event: RevisionProgressEvent
): Promise<void> {
  if (!cb) return;
  await cb(event);
}

function reportIsSoftAiOnly(report: QualityReport): boolean {
  return isSoftAiOnlyFailure({
    overall_score: report.overall_score ?? 0,
    threshold: report.threshold ?? 70,
    rules: report.rule_validator || {
      passed: false,
      seo_pass: false,
      auto_fixable: [],
      failed_rules: [],
    },
    ai: report.ai_review || { passed: false, rewrite_required: true, score: 0 },
    readability_score: report.scores?.readability ?? 0,
    critical_fail: report.critical_fail,
  });
}

function reportIsLengthPrimary(report: QualityReport): boolean {
  const rv = report.rule_validator;
  return isLengthPrimaryFailure({
    overall_score: report.overall_score ?? 0,
    threshold: report.threshold ?? 70,
    critical_fail: report.critical_fail,
    findings: rv?.findings || [],
    auto_fixable: rv?.auto_fixable || [],
    failed_rules: rv?.failed_rules || [],
  });
}

function enrichRevisionMeta(input: {
  base: Record<string, unknown>;
  attempt: number;
  before_score: number | null;
  after_score: number | null;
  fixed_issues: string[];
  remaining_issues: string[];
  before_report?: QualityReport | null;
  after_report?: QualityReport | null;
}): Record<string, unknown> {
  const cat = buildRevisionCategoryMeta({
    before_score: input.before_score,
    after_score: input.after_score,
    fixed_issues: input.fixed_issues,
    remaining_issues: input.remaining_issues,
    before_report: input.before_report,
    after_report: input.after_report,
  });
  const confBefore = input.before_report
    ? confidenceFromQualityReport(input.before_report)
    : null;
  const confAfter = input.after_report
    ? confidenceFromQualityReport(input.after_report)
    : null;
  const timeline = buildQualityTimelinePoint({
    attempt: input.attempt,
    before: input.before_report,
    after: input.after_report,
    confidence_before: confBefore,
    confidence_after: confAfter,
  });
  return {
    ...input.base,
    category: cat.category,
    categories: cat.categories,
    rules_fixed: cat.rules_fixed,
    rules_remaining: cat.rules_remaining,
    score_delta: cat.score_delta,
    quality_timeline: timeline,
    confidence_before: confBefore?.overall_confidence ?? null,
    confidence_after: confAfter?.overall_confidence ?? null,
    prompt_versions: buildRevisionPromptMeta(),
    single_cycle: true,
  };
}

/**
 * Legacy setting name. Not used as Review↔Revision loop count.
 * Single-cycle architecture: at most one planning report + one revision batch + one final review.
 */
const MAX_REVISION_ATTEMPTS = 3;

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

function asResearch(
  article: NonNullable<Awaited<ReturnType<typeof getArticleById>>>
): ResearchPack | null {
  if (!article.research_pack_json || typeof article.research_pack_json !== 'object') return null;
  return article.research_pack_json as ResearchPack;
}

function reportFromLatest(
  latest: Awaited<ReturnType<typeof getLatestQualityReport>>
): QualityReport | null {
  if (!latest?.findings_json || typeof latest.findings_json !== 'object') return null;
  const f = latest.findings_json as QualityReport & { rolled_back?: boolean; inactive?: boolean };
  if (f.rolled_back || f.inactive) return null;
  return f;
}

async function persistDraft(articleId: number, draft: WriterDraftPayload): Promise<void> {
  const normalized = normalizeDraft(draft);
  await updateArticleDraft({
    id: articleId,
    draft: normalized.draft,
    word_count: countDraftWords(normalized.draft),
    reading_time_minutes: Math.max(1, Math.round(countDraftWords(normalized.draft) / 220)),
  });
}

/**
 * Fix publish-gate blockers that Quality Review alone may ignore:
 * - short/long meta (SEO validation)
 * - missing in-body internal links (package recommendations → body)
 * - stale seo_package / seo_validation (regenerate after draft fixes)
 */
async function remediatePublishBlockers(articleId: number): Promise<string[]> {
  const fixes: string[] = [];
  try {
    const identity = await cleanArticlePublicIdentity(articleId);
    fixes.push(...identity.fixes);
  } catch (err) {
    fixes.push(`Title/slug cleanup failed: ${(err as Error).message?.slice(0, 80) || 'error'}`);
  }
  const article = await getArticleById(articleId);
  if (!article) return fixes;

  let draft = asDraft(article);
  const pkg = (article.internal_links_json as InternalLinkPackage | null) || null;
  const research = asResearch(article);
  const fromPkg = (pkg?.recommendations || [])
    .map((r) => r.target)
    .filter((h): h is string => typeof h === 'string' && h.startsWith('/'));
  const fromResearch = (
    (research as { internal_link_candidates?: Array<string | { href?: string }> } | null)
      ?.internal_link_candidates || []
  )
    .map((l) => (typeof l === 'string' ? l : l?.href))
    .filter((h): h is string => typeof h === 'string' && h.startsWith('/'));
  const fallback = [
    '/cost-of-living/india',
    '/compare/delhi-vs-mumbai',
    '/methodology',
    '/data-sources',
    '/about',
  ];
  const candidates = [...new Set([...fromPkg, ...fromResearch, ...fallback])].slice(0, 12);

  const bodyLinks = countBodyInternalLinks(draft);
  // Prefer allowlisted CityCost paths (content_validation), not just any `/…` markdown.
  const corpus = JSON.stringify(draft.blocks || []);
  const allowlisted = (
    corpus.match(
      /\/(?:cost-of-living|compare|cities|countries|blog|city|country|methodology|data-sources|about)(?:\/[a-z0-9\-._/?#%]*)?/gi
    ) || []
  ).length;
  // Content validation + publish gate need multiple in-body CityCost paths (≥3).
  if (allowlisted < 3 || bodyLinks < 3) {
    const linkPass = injectBodyLinks(draft.blocks || [], null, candidates);
    draft = { ...draft, blocks: linkPass.blocks };
    fixes.push(...linkPass.fixes);
    if (!linkPass.fixes.length && allowlisted < 3) {
      fixes.push('Unable to inject enough body internal links');
    }
  }

  const metaPass = repairMetaLengths(draft);
  draft = metaPass.draft;
  fixes.push(...metaPass.fixes);

  const draftChanged = fixes.some((f) =>
    /Inserted|Expanded|Trimmed/i.test(f)
  );
  if (draftChanged) {
    await persistDraft(articleId, draft);
  }

  const readiness = await getPublishReadiness(articleId);
  const seoBlocked = readiness.checks.some(
    (c) =>
      !c.passed &&
      (c.key === 'seo_package' ||
        c.key === 'seo_validation' ||
        c.key === 'schema' ||
        c.key === 'internal_links')
  );

  if (seoBlocked || draftChanged) {
    try {
      // Skip optional AI meta polish during Fix Issues remediation — deterministic SEO is enough
      const seo = await generateArticleSeo(articleId, { skipAiPolish: true });
      if (seo.ok) {
        fixes.push('Regenerated SEO package, validation, and link recommendations');
      } else {
        fixes.push(`SEO regenerate skipped: ${seo.message || 'not ok'}`);
      }
    } catch (err) {
      fixes.push(`SEO regenerate failed: ${(err as Error).message?.slice(0, 120) || 'error'}`);
    }
  }

  // Re-check body links after SEO regen (regen does not inject body links)
  const after = await getArticleById(articleId);
  if (after) {
    let d2 = asDraft(after);
    const allowlistedAfter = (
      JSON.stringify(d2.blocks || []).match(
        /\/(?:cost-of-living|compare|cities|countries|blog|city|country|methodology|data-sources|about)(?:\/[a-z0-9\-._/?#%]*)?/gi
      ) || []
    ).length;
    if (countBodyInternalLinks(d2) < 3 || allowlistedAfter < 3) {
      const pkg2 = (after.internal_links_json as InternalLinkPackage | null) || null;
      const cand2 = [
        ...new Set([
          ...(pkg2?.recommendations || [])
            .map((r) => r.target)
            .filter((h): h is string => typeof h === 'string' && h.startsWith('/')),
          ...candidates,
        ]),
      ].slice(0, 12);
      if (cand2.length) {
        const again = injectBodyLinks(d2.blocks || [], null, cand2);
        if (again.fixes.length) {
          d2 = { ...d2, blocks: again.blocks };
          await persistDraft(articleId, d2);
          fixes.push(...again.fixes);
        }
      }
    }
  }

  // Publish gate uses validateWriterDraft word count — expand to hard floor when 1–N words short.
  const settings = await getSettings();
  const artWords = await getArticleById(articleId);
  if (artWords) {
    let d3 = asDraft(artWords);
    const minWords = settings.article_length_min;
    if (countDraftWords(d3) < minWords) {
      const expanded = expandDraftToMinWords(d3, minWords);
      if (expanded.fixes.length) {
        await persistDraft(articleId, expanded.draft);
        fixes.push(...expanded.fixes);
      }
    }
  }

  return fixes.filter(Boolean);
}

/**
 * Single-cycle Auto Fix / revision.
 * maxAttempts is accepted for backward compat but does NOT create Review↔Revision loops.
 * Optional onProgress drives revision_batch timeline UI (no per-issue Review loops).
 */
export async function runRevisionLoop(
  articleId: number,
  opts?: {
    maxAttempts?: number;
    force?: boolean;
    reuseLatestReport?: boolean;
    /** Skip planning review when resuming after a failed final_review / validation stage */
    resumeFromStage?: string;
    onProgress?: (event: RevisionProgressEvent) => void | Promise<void>;
  }
): Promise<RevisionLoopResult> {
  const startedAt = Date.now();
  const onProgress = opts?.onProgress;
  const settings = await getSettings();
  if (!settings.auto_revision_enabled && !opts?.force) {
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: 'draft',
      attempts: 0,
      before_score: null,
      after_score: null,
      revisions: [],
      message: 'Auto revision is disabled in settings',
      needs_manual_review: false,
    };
  }

  // Kept for API/settings backward compat — NOT used as loop iterations.
  // Prefer single cycle; value may inform "max categories to patch" soft guidance only.
  void Math.min(
    Math.max(opts?.maxAttempts ?? settings.max_revision_attempts ?? MAX_REVISION_ATTEMPTS, 1),
    MAX_REVISION_ATTEMPTS
  );

  const article = await getArticleById(articleId);
  if (!article) {
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: 'draft',
      attempts: 0,
      before_score: null,
      after_score: null,
      revisions: [],
      message: 'Article not found',
      needs_manual_review: false,
    };
  }

  // ── 1. Normalize snapshot ──────────────────────────────────────────
  await persistDraft(articleId, asDraft(article));

  await emitProgress(onProgress, {
    stage: 'planning_revision',
    label: 'Planning Revision',
    log: 'Loading latest quality report / planning Fix Issues cycle',
  });

  const latest = await getLatestQualityReport(articleId);
  const cached = reportFromLatest(latest);
  const articleWords = countDraftWords(asDraft(article));
  const reportWordHint = Number(
    (cached?.rule_validator?.auto_fixable || [])
      .concat(cached?.rule_validator?.findings || [])
      .map((f) => f.message.match(/Word count (\d+)/i)?.[1])
      .find(Boolean) || 0
  );
  // Do not reuse a report that disagrees with the live draft length (stale after restore/edit).
  const reportMatchesDraft =
    !reportWordHint ||
    Math.abs(reportWordHint - articleWords) <= Math.max(80, Math.floor(articleWords * 0.08));
  const reportAgeMs =
    latest != null ? Date.now() - new Date(latest.created_at).getTime() : Number.POSITIVE_INFINITY;
  const softCached = Boolean(cached) && reportIsSoftAiOnly(cached!);
  // Soft AI-only failures keep a longer reuse window — re-planning with a full AI
  // review is pure latency when deterministic gates already cleared.
  const cacheFresh =
    Boolean(cached) &&
    !cached!.passed &&
    reportMatchesDraft &&
    latest != null &&
    reportAgeMs < (softCached ? 3 * 60 * 60 * 1000 : 45 * 60 * 1000);

  // Already quality-approved: NEVER re-run Reviewer (that demoted READY → draft in prod).
  // Prefer the newest active approved report even if a later accidental re-review failed.
  const recentReports = await listQualityReports(articleId);
  const newestFirst = [...recentReports].reverse();
  const approvedRow = newestFirst.find((r) => {
    const f = r.findings_json as QualityReport & {
      rolled_back?: boolean;
      inactive?: boolean;
      decision?: string;
      ready?: boolean;
    };
    if (!f || f.rolled_back || f.inactive) return false;
    return Boolean(r.passed || f.passed || f.decision === 'approved' || f.ready);
  });
  const approvedCached = approvedRow
    ? (approvedRow.findings_json as QualityReport)
    : null;
  if (
    approvedCached &&
    articleWords >= settings.article_length_min &&
    !approvedCached.critical_fail
  ) {
    // Mark accidental demoting re-reviews inactive so UI loads the approved report.
    for (const r of newestFirst) {
      if (r.id === approvedRow!.id) break;
      const f = r.findings_json as QualityReport & { rolled_back?: boolean; inactive?: boolean };
      if (f?.rolled_back || f?.inactive) continue;
      if (r.passed) continue;
      await markQualityReportRolledBack(
        r.id,
        'Superseded: prior approved quality report restored (avoid demotion loop)'
      );
    }
    if (article.status === 'draft') {
      await updateArticleStatus(articleId, 'review');
    }
    await emitProgress(onProgress, {
      stage: 'quality_audit',
      label: 'Quality Audit',
      log: 'Quality already approved — remediating publish blockers only',
    });
    const pubFixes = await remediatePublishBlockers(articleId);
    const readiness = await getPublishReadiness(articleId);
    const stillBlocked = (readiness.blocking_errors || []).map((e) => e.message).slice(0, 4);
    const art = await getArticleById(articleId);
    await emitProgress(onProgress, {
      stage: 'completed',
      label: 'Completed',
      log: readiness.ready
        ? 'READY — publish blockers cleared'
        : `Quality approved; publish blockers remain: ${stillBlocked.join(' · ') || 'check readiness'}`,
      actions: pubFixes,
    });
    return {
      ok: true,
      passed: true,
      publish_ready: readiness.ready,
      article_id: articleId,
      status: art?.status === 'published' ? 'published' : 'review',
      attempts: 0,
      before_score: approvedCached.overall_score ?? null,
      after_score: approvedCached.overall_score ?? null,
      revisions: [],
      final_report: approvedCached,
      failure_reasons: readiness.ready ? [] : stillBlocked,
      message: readiness.ready
        ? pubFixes.length
          ? `READY — publish blockers fixed · ${pubFixes.slice(0, 4).join(' · ')}`
          : 'Already READY — no revision needed'
        : `Review passed; publish fixes applied (${pubFixes.slice(0, 4).join(' · ') || 'none'}). Remaining: ${stillBlocked.join(' · ') || 'check readiness'}`,
      needs_manual_review: false,
    };
  }

  let planningReview: Awaited<ReturnType<typeof reviewArticle>>;
  let workingReport: QualityReport | null = null;
  let planningReportId: number | undefined;

  // ── 2. ONE planning review (or reuse failed report) ────────────────
  if (opts?.reuseLatestReport && cacheFresh && cached && !cached.critical_fail) {
    workingReport = cached;
    planningReportId = latest?.id;
    planningReview = {
      ok: true,
      passed: false,
      article_id: articleId,
      overall_score: cached.overall_score,
      threshold: cached.threshold,
      status: article.status,
      report: cached,
      failure_reasons: cached.failure_reasons,
      message: 'Reusing latest failed quality report (planning)',
      decision: cached.decision,
      report_id: latest?.id,
    };
  } else {
    planningReview = await reviewArticle(articleId);
    workingReport = planningReview.report || null;
    planningReportId = planningReview.report_id;
  }

  if (planningReview.passed || planningReview.decision === 'approved') {
    // Quality Review can pass while publish-gate SEO/links still fail — always remediate.
    const pubFixes = await remediatePublishBlockers(articleId);
    const readiness = await getPublishReadiness(articleId);
    const stillBlocked = (readiness.blocking_errors || [])
      .map((e) => e.message)
      .slice(0, 4);
    return {
      ok: true,
      passed: true,
      publish_ready: readiness.ready,
      article_id: articleId,
      status: article.status === 'published' ? 'published' : 'review',
      attempts: 0,
      before_score: planningReview.overall_score ?? null,
      after_score: planningReview.overall_score ?? null,
      revisions: [],
      final_report: planningReview.report,
      failure_reasons: readiness.ready ? [] : stillBlocked,
      message: readiness.ready
        ? pubFixes.length
          ? `READY — publish blockers fixed · ${pubFixes.slice(0, 4).join(' · ')}`
          : 'Already READY — no revision needed'
        : `Review passed; publish fixes applied (${pubFixes.slice(0, 4).join(' · ') || 'none'}). Remaining: ${stillBlocked.join(' · ') || 'check readiness'}`,
      needs_manual_review: false,
    };
  }

  if (workingReport?.critical_fail || planningReview.decision === 'manual_review') {
    await updateArticleStatus(articleId, 'needs_manual_review');
    return {
      ok: true,
      passed: false,
      article_id: articleId,
      status: 'needs_manual_review',
      attempts: 0,
      before_score: workingReport?.overall_score ?? null,
      after_score: workingReport?.overall_score ?? null,
      revisions: [],
      final_report: workingReport || undefined,
      failure_reasons: workingReport?.critical_reasons || workingReport?.failure_reasons,
      message: `Critical failures require manual review: ${(
        workingReport?.critical_reasons ||
        workingReport?.failure_reasons ||
        []
      )
        .slice(0, 4)
        .join(' · ')}`,
      needs_manual_review: true,
    };
  }

  if (!workingReport) {
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: article.status,
      attempts: 0,
      before_score: null,
      after_score: null,
      revisions: [],
      message: 'No quality report available to revise against',
      needs_manual_review: false,
    };
  }

  const before_score = workingReport.overall_score ?? planningReview.overall_score ?? null;
  const revisions: RevisionResult[] = [];
  let after_score = before_score;
  let final_report: QualityReport | undefined = workingReport;
  let passed = false;
  let needs_manual_review = false;
  let status: string = 'draft';
  let unsuccessful_attempts = 0;

  // Issue plan from planning report (drives section-scoped patches)
  const current = await getArticleById(articleId);
  if (!current) {
    return {
      ok: false,
      passed: false,
      article_id: articleId,
      status: 'draft',
      attempts: 0,
      before_score,
      after_score,
      revisions: [],
      message: 'Article disappeared during revision',
      needs_manual_review: false,
    };
  }

  const beforeDraft = asDraft(current);
  const batchPlan = buildRevisionBatchPlan(workingReport, beforeDraft, {
    article_length_min: settings.article_length_min,
    article_length_target_min: settings.article_length_target_min,
    article_length_target_max: settings.article_length_target_max,
  });
  const plan = batchPlan.issue_plan;

  await emitProgress(onProgress, {
    stage: 'analyzing_failed_rules',
    label: `Analyzing Failed Rules · ${batchPlan.issue_count} issues`,
    detail: `Analyzing Failed Rules · ${batchPlan.issue_count} issues`,
    log: `Collected ${batchPlan.issue_count} fixable issues across ${batchPlan.categories.join(', ') || 'none'}`,
    issue_count: batchPlan.issue_count,
    issue_summary: batchPlan.issue_summary,
    word_budget: batchPlan.word_budget,
    active_fix_stages: batchPlan.active_fix_stages,
    plan: batchPlan,
  });

  await emitProgress(onProgress, {
    stage: 'planning_revision',
    label: 'Planning Revision',
    log: `Word budget ${batchPlan.word_budget.current}/${batchPlan.word_budget.target} (missing ${batchPlan.word_budget.missing}) · sections ${batchPlan.affected_block_ids.length}`,
    issue_summary: batchPlan.issue_summary,
    word_budget: batchPlan.word_budget,
    active_fix_stages: batchPlan.active_fix_stages,
    plan: batchPlan,
  });

  const softAiOnly = reportIsSoftAiOnly(workingReport);
  const lengthPrimary = !softAiOnly && reportIsLengthPrimary(workingReport);
  const lightCategoriesOnly =
    plan.categories.length > 0 &&
    plan.categories.every(
      (c) => c.category === 'STYLE' || c.category === 'READABILITY' || c.category === 'SEO'
    );

  const attempt = await nextRevisionAttempt(articleId);
  const scoreBefore = workingReport.overall_score ?? before_score ?? 0;

  // ── 3a. Soft AI-only fast path (template repetition / style nit) ───
  // Deterministic gates already READY; expensive STYLE rewrite + full AI review
  // are unnecessary. Apply cheap repetition repairs, then finalize with
  // revisions_exhausted + reused AI judgment (0 new AI round-trips).
  if (softAiOnly) {
    if (batchPlan.needs_humanization) {
      await emitProgress(onProgress, {
        stage: 'humanization',
        label: 'Humanization',
        log: 'Soft style path — deterministic humanization / repetition repair',
      });
    }
    const stylePass = applyDeterministicRepairs(beforeDraft, 'STYLE');
    const readPass =
      (workingReport.scores?.readability ?? 100) < 70
        ? applyDeterministicRepairs(stylePass.draft, 'READABILITY')
        : { draft: stylePass.draft, fixes: [] as string[] };
    const fastDraft = readPass.draft;
    const fastFixes = [...stylePass.fixes, ...readPass.fixes];
    await persistDraft(articleId, fastDraft);

    await emitProgress(onProgress, {
      stage: 'quality_audit',
      label: 'Quality Audit',
      log: `Soft path applied ${fastFixes.length} deterministic fix(es)`,
      actions: fastFixes,
    });

    await emitProgress(onProgress, {
      stage: 'final_review',
      label: 'Final Review',
      log: 'Running final review (reused AI judgment)',
      actions: fastFixes,
    });

    const finalReview = await reviewArticle(articleId, {
      revisions_exhausted: true,
      reuseAi: workingReport.ai_review,
      persist_normalize: true,
    });
    const scoreAfter = finalReview.overall_score ?? scoreBefore;
    const delta = Math.round((scoreAfter - scoreBefore) * 10) / 10;
    passed = Boolean(finalReview.passed || finalReview.decision === 'approved');
    after_score = scoreAfter;
    final_report = finalReview.report || workingReport;
    status = passed ? 'review' : 'draft';
    needs_manual_review = finalReview.decision === 'manual_review';

    const softRevision: RevisionResult = {
      ok: true,
      article_id: articleId,
      attempt,
      draft: fastDraft,
      fixed_issues: [
        ...fastFixes,
        'Soft AI-only path: skipped AI rewrite + reused AI judgment for final gate',
      ],
      remaining_issues: passed
        ? []
        : (finalReview.failure_reasons || []).slice(0, 8),
      deterministic_fixes: fastFixes,
      duration_ms: Date.now() - startedAt,
      prompt_version: REVISION_PROMPT_VERSION,
      used_ai: false,
      successful: true,
      estimated_score: scoreAfter,
      progress_reason: 'soft_ai_only_fast_path',
      category: 'STYLE',
      message: `Soft Fix Issues fast path · ${fastFixes.length} deterministic fix(es)`,
    };
    revisions.push(softRevision);

    await insertRevisionHistory({
      article_id: articleId,
      attempt,
      before_score: scoreBefore,
      after_score: scoreAfter,
      fixed_issues: softRevision.fixed_issues,
      remaining_issues: softRevision.remaining_issues,
      prompt_version: REVISION_PROMPT_VERSION,
      provider: undefined,
      model: undefined,
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: softRevision.duration_ms,
      before_draft: beforeDraft,
      after_draft: fastDraft,
      meta_json: enrichRevisionMeta({
        attempt,
        before_score: scoreBefore,
        after_score: scoreAfter,
        fixed_issues: softRevision.fixed_issues,
        remaining_issues: softRevision.remaining_issues,
        before_report: workingReport,
        after_report: finalReview.report,
        base: {
          saved: true,
          rollback: false,
          soft_ai_only_fast_path: true,
          delta,
          last_score: scoreAfter,
          decision: finalReview.decision,
        },
      }),
    });

    const pubFixes = await remediatePublishBlockers(articleId);
    const readiness = await getPublishReadiness(articleId);
    const elapsed = Date.now() - startedAt;
    if (passed && !readiness.ready) {
      const remain = (readiness.blocking_errors || []).map((e) => e.message).slice(0, 4);
      await emitProgress(onProgress, {
        stage: 'completed',
        label: 'Completed',
        log: `Soft fix applied; publish blockers remain`,
        actions: [...fastFixes, ...pubFixes],
      });
      return {
        ok: true,
        passed: true,
        publish_ready: readiness.ready,
        article_id: articleId,
        status,
        attempts: 1,
        before_score,
        after_score,
        revisions,
        final_report,
        failure_reasons: remain,
        message: readiness.ready
          ? `READY after soft Fix Issues · score ${before_score ?? '—'} → ${after_score ?? '—'}`
          : `Review passed; publish blockers remain (${pubFixes.slice(0, 3).join(' · ') || 'applied'}): ${remain.join(' · ')}`,
        needs_manual_review,
        avg_score_delta: delta,
        unsuccessful_attempts: 0,
      };
    }
    await emitProgress(onProgress, {
      stage: 'completed',
      label: 'Completed',
      log: passed
        ? `READY after soft Fix Issues · score ${before_score ?? '—'} → ${after_score ?? '—'}`
        : `Soft Fix Issues complete · score ${before_score ?? '—'} → ${after_score ?? '—'}`,
      actions: [...fastFixes, ...pubFixes],
    });
    return {
      ok: true,
      passed,
      publish_ready: readiness.ready,
      article_id: articleId,
      status: passed ? 'review' : status,
      attempts: 1,
      before_score,
      after_score,
      revisions,
      final_report,
      failure_reasons: passed && readiness.ready
        ? []
        : final_report?.failure_reasons || finalReview.failure_reasons,
      message: passed
        ? readiness.ready
          ? `READY after soft Fix Issues in ${Math.round(elapsed / 1000)}s · score ${before_score ?? '—'} → ${after_score ?? '—'} (skipped AI rewrite)`
          : `Review passed after soft Fix Issues · score ${before_score ?? '—'} → ${after_score ?? '—'} (publish blockers remain)`
        : `Soft Fix Issues complete · score ${before_score ?? '—'} → ${after_score ?? '—'}`,
      needs_manual_review,
      avg_score_delta: delta,
      unsuccessful_attempts: 0,
    };
  }

  // ── 3b. Length-primary fast path (score already ≥ threshold; only word_count_low) ──
  // Deterministic expand + reuse prior AI judgment. A full AI re-review of filler
  // expansion often drops overall score and previously triggered a rollback to the
  // short draft (UI stuck on Needs Revision / 1656 words).
  if (lengthPrimary) {
    const minWords = settings.article_length_min;
    const targetWords = Math.max(
      minWords,
      settings.article_length_target_min || minWords
    );
    await emitProgress(onProgress, {
      stage: 'expanding_words',
      label: 'Word Count Expand',
      log: `Length-primary path — expand toward ${targetWords} (hard min ${minWords})`,
      word_budget: batchPlan.word_budget,
    });

    let lengthDraft = beforeDraft;
    const lengthFixes: string[] = [];
    const linkCandidates = [
      ...new Set(
        (
          ((current.internal_links_json as { recommendations?: Array<{ target?: string }> } | null)
            ?.recommendations || [])
            .map((r) => r.target)
            .filter((h): h is string => typeof h === 'string' && h.startsWith('/'))
        ).concat(
          (
            (asResearch(current) as {
              internal_link_candidates?: Array<string | { href?: string }>;
            } | null)?.internal_link_candidates || []
          )
            .map((l) => (typeof l === 'string' ? l : l?.href))
            .filter((h): h is string => typeof h === 'string' && h.startsWith('/'))
        )
      ),
    ].slice(0, 12);

    for (const cat of ISSUE_CATEGORY_ORDER) {
      const bucket = plan.categories.find((c) => c.category === cat);
      if (!bucket?.issues.length) continue;
      const det = applyDeterministicRepairs(lengthDraft, cat, {
        onlyBlockIds: bucket.affected_block_ids,
        skipHeadingUniquify: cat !== 'STRUCTURE',
        linkCandidates: cat === 'SEO' ? linkCandidates : undefined,
        expandToMinWords: cat === 'STRUCTURE' ? minWords : undefined,
      });
      lengthDraft = det.draft;
      lengthFixes.push(...det.fixes);
    }

    if (countDraftWords(lengthDraft) < targetWords) {
      const expanded = expandDraftToMinWords(lengthDraft, targetWords);
      lengthDraft = expanded.draft;
      lengthFixes.push(...expanded.fixes);
    }
    if (countDraftWords(lengthDraft) < minWords) {
      const floor = expandDraftToMinWords(lengthDraft, minWords);
      lengthDraft = floor.draft;
      lengthFixes.push(...floor.fixes);
    }

    await persistDraft(articleId, lengthDraft);
    await emitProgress(onProgress, {
      stage: 'quality_audit',
      label: 'Quality Audit',
      log: `Length path applied ${lengthFixes.length} deterministic fix(es) · ${countDraftWords(lengthDraft)} words`,
      actions: lengthFixes,
    });
    await emitProgress(onProgress, {
      stage: 'final_review',
      label: 'Final Review',
      log: 'Running final review (reused AI judgment — length-primary)',
      actions: lengthFixes,
    });

    const finalReview = await reviewArticle(articleId, {
      revisions_exhausted: true,
      reuseAi: workingReport.ai_review,
      persist_normalize: true,
    });
    const scoreAfter = finalReview.overall_score ?? scoreBefore;
    const delta = Math.round((scoreAfter - scoreBefore) * 10) / 10;
    passed = Boolean(finalReview.passed || finalReview.decision === 'approved');
    after_score = scoreAfter;
    final_report = finalReview.report || workingReport;
    status = passed ? 'review' : 'draft';
    needs_manual_review = finalReview.decision === 'manual_review';

    const lengthRevision: RevisionResult = {
      ok: true,
      article_id: articleId,
      attempt,
      draft: lengthDraft,
      fixed_issues: [
        ...lengthFixes,
        'Length-primary path: deterministic expand + reused AI judgment for final gate',
      ],
      remaining_issues: passed ? [] : (finalReview.failure_reasons || []).slice(0, 8),
      deterministic_fixes: lengthFixes,
      duration_ms: Date.now() - startedAt,
      prompt_version: REVISION_PROMPT_VERSION,
      used_ai: false,
      successful: true,
      estimated_score: scoreAfter,
      progress_reason: 'length_primary_fast_path',
      category: 'STRUCTURE',
      message: `Length Fix Issues path · ${countDraftWords(lengthDraft)} words`,
    };
    revisions.push(lengthRevision);

    await insertRevisionHistory({
      article_id: articleId,
      attempt,
      before_score: scoreBefore,
      after_score: scoreAfter,
      fixed_issues: lengthRevision.fixed_issues,
      remaining_issues: lengthRevision.remaining_issues,
      prompt_version: REVISION_PROMPT_VERSION,
      provider: undefined,
      model: undefined,
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: lengthRevision.duration_ms,
      before_draft: beforeDraft,
      after_draft: lengthDraft,
      meta_json: enrichRevisionMeta({
        attempt,
        before_score: scoreBefore,
        after_score: scoreAfter,
        fixed_issues: lengthRevision.fixed_issues,
        remaining_issues: lengthRevision.remaining_issues,
        before_report: workingReport,
        after_report: finalReview.report,
        base: {
          saved: true,
          rollback: false,
          length_primary_fast_path: true,
          words_before: countDraftWords(beforeDraft),
          words_after: countDraftWords(lengthDraft),
          delta,
          last_score: scoreAfter,
          decision: finalReview.decision,
        },
      }),
    });

    const pubFixes = await remediatePublishBlockers(articleId);
    const readiness = await getPublishReadiness(articleId);
    const elapsed = Date.now() - startedAt;
    if (passed && !readiness.ready) {
      const remain = (readiness.blocking_errors || []).map((e) => e.message).slice(0, 4);
      await emitProgress(onProgress, {
        stage: 'completed',
        label: 'Completed',
        log: `Length fix applied; publish blockers remain`,
        actions: [...lengthFixes, ...pubFixes],
      });
      return {
        ok: true,
        passed: true,
        publish_ready: readiness.ready,
        article_id: articleId,
        status,
        attempts: 1,
        before_score,
        after_score,
        revisions,
        final_report,
        failure_reasons: remain,
        message: readiness.ready
          ? `READY after length Fix Issues · score ${before_score ?? '—'} → ${after_score ?? '—'}`
          : `Review passed; publish blockers remain (${pubFixes.slice(0, 3).join(' · ') || 'applied'}): ${remain.join(' · ')}`,
        needs_manual_review,
        avg_score_delta: delta,
        unsuccessful_attempts: 0,
      };
    }
    await emitProgress(onProgress, {
      stage: 'completed',
      label: 'Completed',
      log: passed
        ? `READY after length Fix Issues · score ${before_score ?? '—'} → ${after_score ?? '—'} · ${countDraftWords(lengthDraft)} words`
        : `Length Fix Issues complete · score ${before_score ?? '—'} → ${after_score ?? '—'} · ${countDraftWords(lengthDraft)} words`,
      actions: [...lengthFixes, ...pubFixes],
    });
    return {
      ok: true,
      passed,
      publish_ready: readiness.ready,
      article_id: articleId,
      status: passed ? 'review' : status,
      attempts: 1,
      before_score,
      after_score,
      revisions,
      final_report,
      failure_reasons: passed && readiness.ready
        ? []
        : final_report?.failure_reasons || finalReview.failure_reasons,
      message: passed
        ? readiness.ready
          ? `READY after length Fix Issues in ${Math.round(elapsed / 1000)}s · score ${before_score ?? '—'} → ${after_score ?? '—'} (expanded + reused AI)`
          : `Review passed after length Fix Issues · score ${before_score ?? '—'} → ${after_score ?? '—'} (publish blockers remain)`
        : `Length Fix Issues complete · score ${before_score ?? '—'} → ${after_score ?? '—'}`,
      needs_manual_review,
      avg_score_delta: delta,
      unsuccessful_attempts: 0,
    };
  }

  // ── 3. ONE revision batch (all planned categories) ─────────────────
  // Emit planned fix stages for timeline (still ONE AI pass — no intermediate review)
  for (const stageId of batchPlan.active_fix_stages) {
    if (stageId === 'applying_batch') continue;
    const labels: Record<string, string> = {
      expanding_words: 'Word Count Expand',
      improving_readability: 'Readability Repair',
      seo_repair: 'SEO Repair',
      adding_table: 'SEO Repair',
      updating_faq: 'FAQ Repair',
      updating_summary: 'Summary Repair',
      fixing_links: 'Internal Link Repair',
      humanization: 'Humanization',
    };
    await emitProgress(onProgress, {
      stage: stageId as RevisionProgressEvent['stage'],
      label: labels[stageId] || stageId,
      log: `Queued in batch: ${labels[stageId] || stageId}`,
      word_budget: batchPlan.word_budget,
      issue_summary: batchPlan.issue_summary,
    });
  }

  await emitProgress(onProgress, {
    stage: 'applying_batch',
    label: 'Applying Revision Batch',
    log: `ONE AI revision pass for categories: ${batchPlan.categories.join(', ') || 'deterministic'}`,
    word_budget: batchPlan.word_budget,
    active_fix_stages: batchPlan.active_fix_stages,
  });

  const revision = await reviseDraftOnce({
    article_id: articleId,
    draft: beforeDraft,
    research: asResearch(current),
    report: workingReport,
    attempt,
    max_attempts: 1, // single cycle — not a loop budget
  });
  revisions.push(revision);

  await emitProgress(onProgress, {
    stage: 'quality_audit',
    label: 'Quality Audit',
    log: revision.successful
      ? `Batch applied · ${revision.fixed_issues.length} actions`
      : `Batch incomplete: ${revision.progress_reason || revision.message}`,
    actions: revision.fixed_issues,
  });

  if (revision.corrupted) {
    await persistDraft(articleId, beforeDraft);
    unsuccessful_attempts += 1;
    await insertRevisionHistory({
      article_id: articleId,
      attempt,
      before_score: scoreBefore,
      after_score: scoreBefore,
      fixed_issues: revision.fixed_issues,
      remaining_issues: revision.remaining_issues,
      prompt_version: REVISION_PROMPT_VERSION,
      provider: revision.provider,
      model: revision.model,
      tokens_in: revision.tokens_in,
      tokens_out: revision.tokens_out,
      duration_ms: revision.duration_ms,
      before_draft: beforeDraft,
      after_draft: beforeDraft,
      meta_json: enrichRevisionMeta({
        attempt,
        before_score: scoreBefore,
        after_score: scoreBefore,
        fixed_issues: revision.fixed_issues,
        remaining_issues: revision.remaining_issues,
        before_report: workingReport,
        after_report: workingReport,
        base: {
          saved: false,
          rollback: true,
          rolled_back: true,
          inactive: true,
          rollback_reason: 'corruption',
          delta: 0,
          failed_rules: (workingReport.rule_validator?.findings || []).map((f) => f.code),
        },
      }),
    });
  } else if (!revision.successful) {
    unsuccessful_attempts += 1;
    await insertRevisionHistory({
      article_id: articleId,
      attempt,
      before_score: scoreBefore,
      after_score: scoreBefore,
      fixed_issues: revision.fixed_issues,
      remaining_issues: revision.remaining_issues,
      prompt_version: REVISION_PROMPT_VERSION,
      provider: revision.provider,
      model: revision.model,
      tokens_in: revision.tokens_in,
      tokens_out: revision.tokens_out,
      duration_ms: revision.duration_ms,
      before_draft: beforeDraft,
      after_draft: beforeDraft,
      meta_json: enrichRevisionMeta({
        attempt,
        before_score: scoreBefore,
        after_score: scoreBefore,
        fixed_issues: revision.fixed_issues,
        remaining_issues: revision.remaining_issues,
        before_report: workingReport,
        after_report: workingReport,
        base: {
          saved: false,
          rollback: false,
          delta: 0,
          progress_reason: revision.progress_reason,
          estimated_score: revision.estimated_score,
          failed_rules: (workingReport.rule_validator?.findings || []).map((f) => f.code),
        },
      }),
    });
  } else {
    await persistDraft(articleId, revision.draft);

    const postCorrupt = detectDraftCorruption(beforeDraft, revision.draft, {
      minWords: settings.article_length_min,
    });
    if (postCorrupt.corrupted) {
      await persistDraft(articleId, beforeDraft);
      unsuccessful_attempts += 1;
      revision.fixed_issues.push(`Rolled back corrupted draft: ${postCorrupt.reasons.join('; ')}`);
      await insertRevisionHistory({
        article_id: articleId,
        attempt,
        before_score: scoreBefore,
        after_score: scoreBefore,
        fixed_issues: revision.fixed_issues,
        remaining_issues: revision.remaining_issues,
        prompt_version: REVISION_PROMPT_VERSION,
        provider: revision.provider,
        model: revision.model,
        tokens_in: revision.tokens_in,
        tokens_out: revision.tokens_out,
        duration_ms: revision.duration_ms,
        before_draft: beforeDraft,
        after_draft: beforeDraft,
        meta_json: enrichRevisionMeta({
          attempt,
          before_score: scoreBefore,
          after_score: scoreBefore,
          fixed_issues: revision.fixed_issues,
          remaining_issues: revision.remaining_issues,
          before_report: workingReport,
          after_report: workingReport,
          base: {
            saved: false,
            rollback: true,
            rolled_back: true,
            inactive: true,
            rollback_reason: 'post_corruption',
            delta: 0,
          },
        }),
      });
    } else {
      // ── 4. Normalize (via persist) + ONE final review ───────────────
      // revisions_exhausted = final review of this single cycle (not multi-loop budget).
      // Light category patches use the fast reviewer model + compact prompt.
      await emitProgress(onProgress, {
        stage: 'final_review',
        label: 'Final Review',
        log: 'Running ONE final quality review (no intermediate reviews)',
        actions: revision.fixed_issues,
      });
      const finalReview = await reviewArticle(articleId, {
        revisions_exhausted: true,
        fast: lightCategoriesOnly || !revision.used_ai,
      });
      const scoreAfter = finalReview.overall_score ?? 0;
      const delta = Math.round((scoreAfter - scoreBefore) * 10) / 10;
      passed = Boolean(finalReview.passed || finalReview.decision === 'approved');

      const rulesFixed = revision.fixed_issues.filter((x) =>
        /Targeted:|Rewrote|Inserted|Renamed|Normalized|Cleared|Merged|Readability|Style|link/i.test(x)
      );
      const rulesRemaining =
        finalReview.report?.remaining_rules ||
        finalReview.failure_reasons ||
        revision.remaining_issues;

      if (passed) {
        after_score = scoreAfter;
        final_report = finalReview.report;
        status = 'review';
        await insertRevisionHistory({
          article_id: articleId,
          attempt,
          before_score: scoreBefore,
          after_score: scoreAfter,
          fixed_issues: revision.fixed_issues,
          remaining_issues: [],
          prompt_version: REVISION_PROMPT_VERSION,
          provider: revision.provider,
          model: revision.model,
          tokens_in: revision.tokens_in,
          tokens_out: revision.tokens_out,
          duration_ms: revision.duration_ms,
          before_draft: beforeDraft,
          after_draft: revision.draft,
          meta_json: enrichRevisionMeta({
            attempt,
            before_score: scoreBefore,
            after_score: scoreAfter,
            fixed_issues: revision.fixed_issues,
            remaining_issues: [],
            before_report: workingReport,
            after_report: finalReview.report,
            base: {
              saved: true,
              rollback: false,
              rolled_back: false,
              inactive: false,
              delta,
              last_score: scoreAfter,
              failure_reason: null,
              failed_rules: [],
              rules_fixed: rulesFixed,
              rules_remaining: [],
              decision: finalReview.decision,
            },
          }),
        });
      } else if (finalReview.decision === 'manual_review' || finalReview.report?.critical_fail) {
        after_score = scoreAfter;
        final_report = finalReview.report;
        needs_manual_review = true;
        status = 'needs_manual_review';
        await insertRevisionHistory({
          article_id: articleId,
          attempt,
          before_score: scoreBefore,
          after_score: scoreAfter,
          fixed_issues: revision.fixed_issues,
          remaining_issues: Array.isArray(rulesRemaining) ? rulesRemaining.map(String) : [],
          prompt_version: REVISION_PROMPT_VERSION,
          provider: revision.provider,
          model: revision.model,
          tokens_in: revision.tokens_in,
          tokens_out: revision.tokens_out,
          duration_ms: revision.duration_ms,
          before_draft: beforeDraft,
          after_draft: revision.draft,
          meta_json: enrichRevisionMeta({
            attempt,
            before_score: scoreBefore,
            after_score: scoreAfter,
            fixed_issues: revision.fixed_issues,
            remaining_issues: Array.isArray(rulesRemaining) ? rulesRemaining.map(String) : [],
            before_report: workingReport,
            after_report: finalReview.report,
            base: {
              saved: true,
              rollback: false,
              rolled_back: false,
              inactive: false,
              delta,
              last_score: scoreAfter,
              failure_reason: (finalReview.report?.critical_reasons || []).join('; '),
              failed_rules: (finalReview.report?.rule_validator?.failed_rules || []).map((f) => f.code),
              rules_fixed: rulesFixed,
              rules_remaining: rulesRemaining,
              decision: 'manual_review',
            },
          }),
        });
      } else if (
        shouldRollbackOnScoreRegression({
          scoreBefore,
          scoreAfter,
          wordsBefore: countDraftWords(beforeDraft),
          wordsAfter: countDraftWords(revision.draft),
          minWords: settings.article_length_min,
        })
      ) {
        // Severe score regression WITHOUT a hard length-floor win → restore draft.
        // Length-floor wins must never be undone (expand→re-review score dip bug).
        await persistDraft(articleId, beforeDraft);
        await updateArticleReviewState({
          id: articleId,
          status: 'draft',
          quality_score: scoreBefore,
          review_score: workingReport.scores?.ai_review ?? scoreBefore,
        });
        unsuccessful_attempts += 1;
        after_score = scoreBefore;
        final_report = workingReport;
        status = 'draft';

        if (finalReview.report_id) {
          await markQualityReportRolledBack(
            finalReview.report_id,
            `Score ${scoreAfter} < ${scoreBefore} — revision rejected`
          );
        }
        // Planning report stays as the active failed report for UI
        void planningReportId;

        await insertRevisionHistory({
          article_id: articleId,
          attempt,
          before_score: scoreBefore,
          after_score: scoreBefore,
          fixed_issues: revision.fixed_issues,
          remaining_issues: Array.isArray(rulesRemaining) ? rulesRemaining.map(String) : [],
          prompt_version: REVISION_PROMPT_VERSION,
          provider: revision.provider,
          model: revision.model,
          tokens_in: revision.tokens_in,
          tokens_out: revision.tokens_out,
          duration_ms: revision.duration_ms,
          before_draft: beforeDraft,
          after_draft: beforeDraft,
          meta_json: enrichRevisionMeta({
            attempt,
            before_score: scoreBefore,
            after_score: scoreBefore,
            fixed_issues: revision.fixed_issues,
            remaining_issues: Array.isArray(rulesRemaining) ? rulesRemaining.map(String) : [],
            before_report: workingReport,
            after_report: finalReview.report,
            base: {
              saved: false,
              rollback: true,
              rolled_back: true,
              inactive: true,
              score_rejected: true,
              report_status: 'ROLLED_BACK',
              delta: 0,
              measured_after: scoreAfter,
              last_score: scoreBefore,
              failure_reason: `Score ${scoreAfter} < ${scoreBefore}`,
              failed_rules: (workingReport.rule_validator?.findings || []).map((f) => f.code),
              rules_fixed: [],
              rules_remaining: rulesRemaining,
              rolled_back_report_id: finalReview.report_id ?? null,
            },
          }),
        });
      } else {
        // Improved / soft score dip with hard-gate wins — keep draft + final report (active).
        // Includes: scoreAfter >= scoreBefore, OR length-floor win with mild score noise.
        after_score = scoreAfter;
        final_report = finalReview.report;
        status = 'draft';
        await updateArticleStatus(articleId, 'draft');
        await insertRevisionHistory({
          article_id: articleId,
          attempt,
          before_score: scoreBefore,
          after_score: scoreAfter,
          fixed_issues: revision.fixed_issues,
          remaining_issues: Array.isArray(rulesRemaining) ? rulesRemaining.map(String) : [],
          prompt_version: REVISION_PROMPT_VERSION,
          provider: revision.provider,
          model: revision.model,
          tokens_in: revision.tokens_in,
          tokens_out: revision.tokens_out,
          duration_ms: revision.duration_ms,
          before_draft: beforeDraft,
          after_draft: revision.draft,
          meta_json: enrichRevisionMeta({
            attempt,
            before_score: scoreBefore,
            after_score: scoreAfter,
            fixed_issues: revision.fixed_issues,
            remaining_issues: Array.isArray(rulesRemaining) ? rulesRemaining.map(String) : [],
            before_report: workingReport,
            after_report: finalReview.report,
            base: {
              saved: true,
              rollback: false,
              rolled_back: false,
              inactive: false,
              delta,
              last_score: scoreAfter,
              failure_reason: (finalReview.failure_reasons || []).slice(0, 3).join(' · '),
              failed_rules: (finalReview.report?.rule_validator?.findings || []).map((f) => f.code),
              rules_fixed: rulesFixed,
              rules_remaining: rulesRemaining,
              decision: finalReview.decision,
              kept_despite_score_dip: scoreAfter < scoreBefore,
              words_before: countDraftWords(beforeDraft),
              words_after: countDraftWords(revision.draft),
            },
          }),
        });

        await insertGenerationLog({
          article_id: articleId,
          topic_id: current.topic_id,
          stage: 'revision',
          model_used: revision.model,
          tokens_in: revision.tokens_in,
          tokens_out: revision.tokens_out,
          latency_ms: revision.duration_ms,
          success: true,
          meta_json: {
            attempt,
            before_score: scoreBefore,
            after_score: scoreAfter,
            delta,
            passed: false,
            single_cycle: true,
            kept_despite_score_dip: scoreAfter < scoreBefore,
            ...buildRevisionPromptMeta(),
          },
        });
      }
    }
  }

  if (passed) {
    status = 'review';
    needs_manual_review = false;
  } else if (!needs_manual_review) {
    const criticalLeft = Boolean(final_report?.critical_fail);
    if (criticalLeft) {
      needs_manual_review = true;
      status = 'needs_manual_review';
      await updateArticleStatus(articleId, 'needs_manual_review');
    } else {
      status = 'draft';
      await updateArticleStatus(articleId, 'draft');
    }
  }

  const elapsed = Date.now() - startedAt;
  const avg_score_delta =
    after_score != null && before_score != null
      ? Math.round((after_score - before_score) * 10) / 10
      : null;

  // Always close publish-gate gaps (short meta, body links, stale SEO validation)
  const pubFixes = await remediatePublishBlockers(articleId);
  const readiness = await getPublishReadiness(articleId);
  if (passed && !readiness.ready) {
    // Review approved but publish still blocked after remediation
    const remain = (readiness.blocking_errors || []).map((e) => e.message).slice(0, 4);
    await emitProgress(onProgress, {
      stage: 'completed',
      label: 'Completed',
      log: `Review passed; publish blockers remain: ${remain.join(' · ')}`,
      actions: [
        ...(revisions[0]?.fixed_issues || []),
        ...pubFixes,
      ],
    });
    return {
      ok: true,
      passed: true,
      publish_ready: false,
      article_id: articleId,
      status,
      attempts: revisions.length,
      before_score,
      after_score,
      revisions,
      final_report,
      failure_reasons: remain,
      message: `Review passed; publish blockers remain after fixes (${pubFixes.slice(0, 3).join(' · ') || 'applied'}): ${remain.join(' · ')}`,
      needs_manual_review,
      avg_score_delta,
      unsuccessful_attempts,
    };
  }

  await emitProgress(onProgress, {
    stage: 'completed',
    label: 'Completed',
    log: passed
      ? `READY after single-cycle revision · score ${before_score ?? '—'} → ${after_score ?? '—'}`
      : `Single-cycle revision complete · score ${before_score ?? '—'} → ${after_score ?? '—'}`,
    actions: [
      ...(revisions[0]?.fixed_issues || []),
      ...pubFixes,
    ],
  });

  return {
    ok: true,
    passed,
    publish_ready: readiness.ready,
    article_id: articleId,
    status,
    attempts: revisions.length,
    before_score,
    after_score,
    revisions,
    final_report,
    failure_reasons: passed && readiness.ready
      ? []
      : final_report?.critical_reasons ||
        final_report?.failure_reasons ||
        final_report?.remaining_rules ||
        planningReview.failure_reasons,
    message: passed
      ? readiness.ready
        ? `READY after single-cycle revision in ${Math.round(elapsed / 1000)}s · score ${before_score ?? '—'} → ${after_score ?? '—'}${
            pubFixes.length ? ` · ${pubFixes.slice(0, 2).join(' · ')}` : ''
          }`
        : `Review passed after revision · score ${before_score ?? '—'} → ${after_score ?? '—'} (publish blockers remain)`
      : needs_manual_review
        ? `Needs manual review — critical remaining · score ${before_score ?? '—'} → ${after_score ?? '—'}`
        : `Single-cycle revision complete · score ${before_score ?? '—'} → ${after_score ?? '—'} · status draft (non-critical)`,
    needs_manual_review,
    avg_score_delta,
    unsuccessful_attempts,
  };
}

export async function autoFixArticle(
  articleId: number,
  opts?: {
    onProgress?: (event: RevisionProgressEvent) => void | Promise<void>;
    resumeFromStage?: string;
  }
): Promise<RevisionLoopResult> {
  return runRevisionLoop(articleId, {
    force: true,
    // maxAttempts ignored for looping — single cycle always
    maxAttempts: 1,
    reuseLatestReport: true,
    onProgress: opts?.onProgress,
    resumeFromStage: opts?.resumeFromStage,
  });
}
