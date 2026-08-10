/**
 * Pure UI workflow derivation for the article admin guided wizard.
 * Stage order (product): Research → Writing → SEO+Links → Review → Ready → Published.
 * Reads article/preview/quality/readiness fields already returned by APIs.
 *
 * Important: SEO step completion uses the SEO *package* + link *recommendations*.
 * In-body links are enforced later by Review / Publish — requiring them here stuck
 * the wizard after Generate SEO (which does not inject body links).
 */

import type { ArticlePreview, PublishReadiness, QualityReport } from './api';

export type WizardStepKey =
  | 'research'
  | 'writing'
  | 'seo'
  | 'review'
  | 'ready'
  | 'published';

export type PrimaryActionId =
  | 'start_research'
  | 'generate_draft'
  | 'generate_seo_links'
  | 'continue_review'
  | 'run_review'
  | 'auto_fix'
  | 'publish'
  | 'view_live'
  | 'none';

export type ProgressStepStatus = 'done' | 'current' | 'locked';

export interface ProgressStep {
  key: WizardStepKey;
  label: string;
  emoji: string;
  status: ProgressStepStatus;
}

export interface WorkflowState {
  stage: WizardStepKey;
  stageLabel: string;
  statusLabel: string;
  primaryAction: PrimaryActionId;
  primaryLabel: string;
  estimatedTime: string | null;
  /** Soft-fail — stay on Review; only Auto Fix CTA */
  showAutoFixBanner: boolean;
  /** Hard stop — needs human attention */
  needsManualReview: boolean;
  hasResearch: boolean;
  hasDraft: boolean;
  reviewPassed: boolean;
  seoComplete: boolean;
  linksComplete: boolean;
  seoAndLinksComplete: boolean;
  publishReady: boolean;
  published: boolean;
  steps: ProgressStep[];
  failureReason: string | null;
  recommendedFix: string | null;
  failureReasons: string[];
}

const STAGE_META: Record<WizardStepKey, { label: string; emoji: string }> = {
  research: { label: 'Research', emoji: '🔍' },
  writing: { label: 'Writing', emoji: '✍️' },
  seo: { label: 'SEO', emoji: '🎯' },
  review: { label: 'Review', emoji: '✅' },
  ready: { label: 'Ready to Publish', emoji: '🚀' },
  published: { label: 'Published', emoji: '🌍' },
};

const ACTION_LABELS: Record<PrimaryActionId, string> = {
  start_research: 'Start Research',
  generate_draft: 'Generate Draft',
  generate_seo_links: 'Generate SEO & Links',
  continue_review: 'Continue to Review',
  run_review: 'Run Review',
  auto_fix: 'Fix Issues',
  publish: 'Publish Article',
  view_live: 'View Live',
  none: '—',
};

const ESTIMATES: Partial<Record<PrimaryActionId, string>> = {
  start_research: '~5s',
  generate_draft: '~60s',
  generate_seo_links: '~20s',
  run_review: '~30s',
  auto_fix: '~15–90s (background)',
  publish: '~5s',
};

const STEP_ORDER: WizardStepKey[] = [
  'research',
  'writing',
  'seo',
  'review',
  'ready',
  'published',
];

export function countBodyInternalLinks(
  blocks: Array<{ content?: unknown }> | undefined | null
): number {
  if (!blocks?.length) return 0;
  let n = 0;
  const walk = (s: string) => {
    const md = s.match(/\[[^\]]*\]\(\/[a-z0-9/._\-?#%]+\)/gi);
    if (md) n += md.length;
    const html = s.match(/<a\b[^>]*href=["']\/[^"']+["'][^>]*>/gi);
    if (html) n += html.length;
  };
  for (const b of blocks) {
    if (typeof b.content === 'string') walk(b.content);
    else if (Array.isArray(b.content)) {
      for (const item of b.content) {
        if (typeof item === 'string') walk(item);
        else if (item && typeof item === 'object') {
          for (const v of Object.values(item as Record<string, unknown>)) {
            if (typeof v === 'string') walk(v);
          }
        }
      }
    }
  }
  return n;
}

function checkPassed(readiness: PublishReadiness | null, key: string): boolean {
  return Boolean(readiness?.checks?.find((c) => c.key === key)?.passed);
}

function packageLinkCount(preview: ArticlePreview): number {
  return preview.internal_links?.count ?? preview.internal_links?.recommendations?.length ?? 0;
}

/**
 * SEO package present for wizard progression.
 * Do NOT require zero seo_validation.errors — Generate SEO often returns score 80+
 * with soft errors (e.g. meta description 150–160 band). Those are Review/Publish
 * concerns; blocking here soft-locks the wizard on "Generate SEO" forever.
 */
export function isSeoComplete(preview: ArticlePreview, readiness: PublishReadiness | null): boolean {
  if (checkPassed(readiness, 'seo_package')) return true;
  const seo = preview.seo_package;
  return Boolean(seo?.canonical && seo?.meta_title);
}

/**
 * Wizard SEO-step link gate: package recommendations are enough.
 * Body links are a Review/Publish concern (Generate SEO does not inject them).
 */
export function isLinksComplete(
  preview: ArticlePreview,
  readiness: PublishReadiness | null
): boolean {
  if (checkPassed(readiness, 'internal_links')) return true;
  return packageLinkCount(preview) > 0;
}

/** True when the SEO wizard step can advance to Review. */
export function isSeoStepComplete(
  preview: ArticlePreview,
  readiness: PublishReadiness | null
): boolean {
  if (!isSeoComplete(preview, readiness)) return false;
  // Package links preferred; SEO package alone is enough to leave the step.
  if (isLinksComplete(preview, readiness)) return true;
  return Boolean(preview.seo_package);
}

function isReviewPassed(
  status: string,
  qualityReport: QualityReport | null,
  readiness: PublishReadiness | null
): boolean {
  if (status === 'published') return true;
  if (status === 'review') return true;
  if (checkPassed(readiness, 'quality_review')) return true;
  if (!qualityReport) return false;
  if (qualityReport.rolled_back || qualityReport.inactive) return false;
  if (qualityReport.passed) return true;
  if (qualityReport.decision === 'approved') return true;
  if (qualityReport.ready) return true;
  return false;
}

function isNeedsManualReview(status: string, qualityReport: QualityReport | null): boolean {
  if (status === 'needs_manual_review') return true;
  if (!qualityReport || qualityReport.rolled_back || qualityReport.inactive) return false;
  if (qualityReport.decision === 'manual_review') return true;
  if (qualityReport.critical_fail) return true;
  return false;
}

function isSoftReviewFail(
  status: string,
  qualityReport: QualityReport | null,
  reviewPassed: boolean,
  needsManual: boolean
): boolean {
  if (needsManual || reviewPassed) return false;
  if (status === 'published' || status === 'review') return false;
  if (!qualityReport || qualityReport.rolled_back || qualityReport.inactive) return false;
  if (qualityReport.passed) return false;
  if (qualityReport.ready) return false;
  if (qualityReport.decision === 'approved') return false;
  // Fix Issues only while the active decision is still revision (or equivalent soft fail).
  return (
    qualityReport.decision === 'revision' ||
    Boolean(qualityReport.failure_reasons?.length) ||
    Boolean(qualityReport.remaining_rules?.length)
  );
}

function collectFailureReasons(qualityReport: QualityReport | null): string[] {
  if (!qualityReport) return [];
  const reasons =
    qualityReport.critical_reasons ||
    qualityReport.failure_reasons ||
    qualityReport.decision_reasons ||
    qualityReport.remaining_rules ||
    qualityReport.issues ||
    [];
  return reasons.map(String).filter(Boolean);
}

function firstFailedCheckKey(readiness: PublishReadiness | null): string | null {
  return readiness?.checks?.find((c) => !c.passed)?.key ?? null;
}

function buildSteps(current: WizardStepKey, published: boolean): ProgressStep[] {
  const currentIdx = STEP_ORDER.indexOf(current);
  return STEP_ORDER.map((key, idx) => {
    let status: ProgressStepStatus;
    if (published && key === 'published') status = 'current';
    else if (published || idx < currentIdx) status = 'done';
    else if (idx === currentIdx) status = 'current';
    else status = 'locked';
    return {
      key,
      label: STAGE_META[key].label,
      emoji: STAGE_META[key].emoji,
      status,
    };
  });
}

export function hasResearchPack(input: {
  researchPack?: unknown | null;
  researchPackSizeChars?: number | null;
  sessionResearch?: unknown | null;
}): boolean {
  if (input.sessionResearch) return true;
  if (input.researchPack && typeof input.researchPack === 'object') {
    const keys = Object.keys(input.researchPack as object);
    if (keys.length > 0) return true;
  }
  if ((input.researchPackSizeChars ?? 0) > 0) return true;
  return false;
}

export function deriveArticleWorkflow(input: {
  status: string;
  preview: ArticlePreview;
  qualityReport: QualityReport | null;
  readiness: PublishReadiness | null;
  hasResearch: boolean;
  topicId?: number | null;
  busy?: 'research' | 'draft' | 'seo' | 'review' | 'revise' | 'publish' | 'unpublish' | 'export' | null;
  /** UI override after Continue to Review when SEO package already exists */
  forceStage?: WizardStepKey | null;
}): WorkflowState {
  const {
    status,
    preview,
    qualityReport,
    readiness,
    hasResearch,
    topicId = null,
    busy = null,
    forceStage = null,
  } = input;

  const hasDraft = preview.blocks.length > 0;
  const needsManual = isNeedsManualReview(status, qualityReport);
  const reviewPassed = isReviewPassed(status, qualityReport, readiness);
  const seoComplete = isSeoComplete(preview, readiness);
  const linksComplete = isLinksComplete(preview, readiness);
  const seoAndLinksComplete = isSeoStepComplete(preview, readiness);
  const publishReady = Boolean(readiness?.ready);
  const published = status === 'published';
  const softFail = isSoftReviewFail(status, qualityReport, reviewPassed, needsManual);
  const failureReasons = collectFailureReasons(qualityReport);
  const failedCheck = firstFailedCheckKey(readiness);
  const blockingMsg = readiness?.blocking_errors?.[0]?.message;

  let stage: WizardStepKey;
  let primaryAction: PrimaryActionId;
  let showAutoFixBanner = false;
  let statusLabel = status;

  if (published) {
    stage = 'published';
    primaryAction = 'view_live';
    statusLabel = 'published';
  } else if (!hasResearch) {
    stage = 'research';
    primaryAction = topicId ? 'start_research' : 'none';
    statusLabel = 'needs_research';
  } else if (!hasDraft) {
    stage = 'writing';
    primaryAction = topicId ? 'generate_draft' : 'none';
    statusLabel = 'needs_draft';
  } else if (!seoAndLinksComplete) {
    stage = 'seo';
    // Package already on article → Continue (never trap on Generate after success)
    if (seoComplete) {
      primaryAction = 'continue_review';
      statusLabel = 'seo_ready_continue';
    } else {
      primaryAction = 'generate_seo_links';
      statusLabel = 'needs_seo';
    }
  } else if (needsManual) {
    stage = 'review';
    // Always offer a retry path after manual edits — never dead-end with no CTA
    primaryAction = 'run_review';
    statusLabel = 'needs_manual_review';
  } else if (softFail || busy === 'revise') {
    stage = 'review';
    primaryAction = 'auto_fix';
    showAutoFixBanner = true;
    statusLabel = busy === 'revise' ? 'auto_fix_running' : qualityReport?.decision || 'review_failed';
  } else if (!reviewPassed) {
    stage = 'review';
    primaryAction = 'run_review';
    statusLabel = status === 'draft' ? 'needs_review' : status;
  } else if (!publishReady) {
    // Review passed — advance to Ready; remediate remaining publish blockers from there.
    if (failedCheck === 'seo_package') {
      stage = 'seo';
      primaryAction = 'generate_seo_links';
      statusLabel = 'fix_seo_blockers';
    } else {
      stage = 'ready';
      if (
        failedCheck === 'internal_links' ||
        failedCheck === 'content_validation' ||
        failedCheck === 'seo_validation' ||
        failedCheck === 'schema' ||
        failedCheck === 'confidence'
      ) {
        primaryAction = 'auto_fix';
        showAutoFixBanner = true;
        statusLabel = 'fix_publish_blockers';
        if (blockingMsg && !failureReasons.includes(blockingMsg)) {
          failureReasons.unshift(blockingMsg);
        }
      } else if (failedCheck === 'quality_review' || failedCheck === 'status_review') {
        stage = 'review';
        primaryAction = 'run_review';
        statusLabel = 'needs_review';
      } else {
        primaryAction = 'publish';
        statusLabel = 'awaiting_readiness';
      }
    }
  } else {
    stage = 'ready';
    primaryAction = 'publish';
    statusLabel = 'ready_to_publish';
  }

  // After successful Generate SEO (or Continue): always open Review — ignore soft gates
  if (
    forceStage === 'review' &&
    !published &&
    hasDraft &&
    !reviewPassed &&
    stage === 'seo'
  ) {
    stage = 'review';
    if (needsManual) {
      primaryAction = 'run_review';
      showAutoFixBanner = false;
      statusLabel = 'needs_manual_review';
    } else if (softFail) {
      primaryAction = 'auto_fix';
      showAutoFixBanner = true;
      statusLabel = qualityReport?.decision || 'review_failed';
    } else {
      primaryAction = 'run_review';
      showAutoFixBanner = false;
      statusLabel = 'needs_review';
    }
  }

  if (busy === 'research') {
    stage = 'research';
    primaryAction = 'none';
  } else if (busy === 'draft') {
    stage = 'writing';
    primaryAction = 'none';
  } else if (busy === 'review') {
    stage = 'review';
    primaryAction = 'none';
  } else if (busy === 'revise') {
    stage = 'review';
    primaryAction = 'auto_fix';
    showAutoFixBanner = true;
  } else if (busy === 'seo') {
    stage = 'seo';
    primaryAction = 'none';
  } else if (busy === 'publish') {
    stage = 'ready';
    primaryAction = 'none';
  }

  const recommendedFix = showAutoFixBanner
    ? 'Fix Issues runs ONE revision batch in the background (planner → all fixes → one final review). You can leave the page; progress reconnects automatically.'
    : needsManual
      ? 'Edit the draft in Advanced if needed, then click Run Review to try again.'
      : null;

  const steps = buildSteps(stage, published);
  const failureReason = failureReasons[0] ?? (qualityReport?.summary || null);

  return {
    stage,
    stageLabel: STAGE_META[stage].label,
    statusLabel,
    primaryAction,
    primaryLabel: ACTION_LABELS[primaryAction],
    estimatedTime: ESTIMATES[primaryAction] ?? null,
    showAutoFixBanner,
    needsManualReview: needsManual,
    hasResearch,
    hasDraft,
    reviewPassed: reviewPassed && !softFail && !needsManual,
    seoComplete,
    linksComplete,
    seoAndLinksComplete,
    publishReady: publishReady && !needsManual,
    published,
    steps,
    failureReason,
    recommendedFix,
    failureReasons,
  };
}

export function actionLabel(action: PrimaryActionId): string {
  return ACTION_LABELS[action];
}

export { STAGE_META, STEP_ORDER };
