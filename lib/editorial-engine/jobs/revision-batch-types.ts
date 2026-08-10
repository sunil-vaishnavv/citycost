/**
 * revision_batch background job — progress schema in editorial_jobs.result_json.
 * Mirrors draft_generate shape so SSE / JobsProvider / GenerationDrawer reuse cleanly.
 */

import type { IssueSummaryItem, WordBudget } from '../revision/revision-plan.js';

export const REVISION_BATCH_JOB_TYPE = 'revision_batch';

export const REVISION_BATCH_STAGES = [
  'queued',
  'planning_revision',
  'analyzing_failed_rules',
  'expanding_words',
  'improving_readability',
  'humanization',
  'fixing_links',
  'seo_repair',
  'updating_faq',
  'updating_summary',
  'applying_batch',
  'quality_audit',
  'final_review',
  'completed',
  'failed',
  // Legacy aliases kept for resume / older job payloads
  'reading_quality_report',
  'found_issues',
  'adding_table',
  'validation',
] as const;

export type RevisionBatchStage = (typeof REVISION_BATCH_STAGES)[number];

export type RevisionBatchStageStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface RevisionBatchStageState {
  id: RevisionBatchStage;
  label: string;
  status: RevisionBatchStageStatus;
  detail?: string;
}

export interface RevisionBatchLogEntry {
  t: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface RevisionBatchMetrics {
  total_ms?: number;
  ai_ms?: number;
  review_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  provider?: string;
  model?: string;
  retry_count?: number;
  duration_ms?: number;
  before_score?: number | null;
  after_score?: number | null;
  issue_count?: number;
  fixed_count?: number;
  remaining_count?: number;
  passed?: boolean;
}

export interface RevisionBatchProgress {
  topic_id: number;
  topic_title?: string;
  article_id: number;
  stage: RevisionBatchStage;
  stage_label: string;
  progress_pct: number;
  eta_seconds: number | null;
  stages: RevisionBatchStageState[];
  logs: RevisionBatchLogEntry[];
  metrics: RevisionBatchMetrics;
  checkpoint?: RevisionBatchStage;
  cancel_requested?: boolean;
  section_detail?: string;
  /** Issue summary panel payload */
  issue_summary?: IssueSummaryItem[];
  word_budget?: WordBudget;
  /** Concrete actions taken (Expanded Housing +210, inserted table, …) */
  actions_taken?: string[];
  /** Resume from this stage on retry (do not restart from beginning) */
  resume_stage?: RevisionBatchStage;
  failed_stage?: RevisionBatchStage;
  failure_reason?: string;
  result_message?: string;
  /** Quality review gate passed. */
  passed?: boolean;
  /** All publish-gate checks clear. */
  publish_ready?: boolean;
  fixed_count?: number;
  remaining_count?: number;
  debug?: Record<string, unknown>;
}

export interface RevisionBatchPayload {
  article_id: number;
  topic_id?: number;
  topic_title?: string;
  reuse_report?: boolean;
  retry_of_job_id?: number;
  resume_stage?: RevisionBatchStage;
  source?: 'manual' | 'retry' | 'pipeline';
}

/** Canonical display labels for the shared GenerationDrawer timeline. */
export const REVISION_STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  planning_revision: 'Planning Revision',
  analyzing_failed_rules: 'Analyzing Failed Rules',
  expanding_words: 'Word Count Expand',
  improving_readability: 'Readability Repair',
  humanization: 'Humanization',
  fixing_links: 'Internal Link Repair',
  seo_repair: 'SEO Repair',
  updating_faq: 'FAQ Repair',
  updating_summary: 'Summary Repair',
  applying_batch: 'Applying Fixes',
  quality_audit: 'Quality Audit',
  final_review: 'Final Review',
  completed: 'Completed',
  failed: 'Failed',
  // Legacy → same labels
  reading_quality_report: 'Analyzing Failed Rules',
  found_issues: 'Analyzing Failed Rules',
  adding_table: 'SEO Repair',
  validation: 'Quality Audit',
};

/** Map legacy / alternate stage ids onto the canonical timeline id. */
export function canonicalizeRevisionStage(stage: string): RevisionBatchStage {
  switch (stage) {
    case 'reading_quality_report':
    case 'found_issues':
      return 'analyzing_failed_rules';
    case 'adding_table':
      return 'seo_repair';
    case 'validation':
      return 'quality_audit';
    default:
      return stage as RevisionBatchStage;
  }
}

export const REVISION_STAGE_ETA_SEED: Partial<Record<string, number>> = {
  queued: 1,
  planning_revision: 2,
  analyzing_failed_rules: 8,
  expanding_words: 3,
  improving_readability: 4,
  humanization: 4,
  fixing_links: 2,
  seo_repair: 3,
  updating_faq: 2,
  updating_summary: 2,
  applying_batch: 30,
  quality_audit: 3,
  final_review: 25,
  reading_quality_report: 8,
  found_issues: 1,
  adding_table: 2,
  validation: 3,
};

export const REVISION_STAGE_PROGRESS_PCT: Record<string, number> = {
  queued: 0,
  planning_revision: 8,
  analyzing_failed_rules: 16,
  expanding_words: 24,
  improving_readability: 32,
  humanization: 40,
  fixing_links: 48,
  seo_repair: 56,
  updating_faq: 64,
  updating_summary: 70,
  applying_batch: 78,
  quality_audit: 86,
  final_review: 92,
  completed: 100,
  failed: 100,
  reading_quality_report: 16,
  found_issues: 16,
  adding_table: 56,
  validation: 86,
};

/** Always-visible bookend stages; fix stages are inserted dynamically from the plan. */
const CORE_STAGES: RevisionBatchStage[] = [
  'queued',
  'planning_revision',
  'analyzing_failed_rules',
  'quality_audit',
  'final_review',
];

/** Optional repairs — order matches the shared drawer timeline. */
const OPTIONAL_FIX_STAGES: RevisionBatchStage[] = [
  'expanding_words',
  'improving_readability',
  'humanization',
  'fixing_links',
  'seo_repair',
  'updating_faq',
  'updating_summary',
];

/** Hidden from timeline (still valid progress.stage while running). */
const HIDDEN_TIMELINE_STAGES = new Set<string>(['applying_batch']);

export function buildRevisionStages(activeFixStages: string[] = []): RevisionBatchStageState[] {
  const normalizedActive = activeFixStages
    .map((s) => canonicalizeRevisionStage(s))
    .filter((s) => !HIDDEN_TIMELINE_STAGES.has(s));
  const active = new Set(normalizedActive);
  const ordered: RevisionBatchStage[] = [];

  for (const s of CORE_STAGES) {
    if (s === 'quality_audit') {
      for (const opt of OPTIONAL_FIX_STAGES) {
        if (active.size === 0 || active.has(opt)) ordered.push(opt);
      }
      ordered.push(s);
    } else {
      ordered.push(s);
    }
  }

  const seen = new Set<string>();
  const unique = ordered.filter((id) => {
    if (seen.has(id) || HIDDEN_TIMELINE_STAGES.has(id)) return false;
    seen.add(id);
    return true;
  });

  return unique.map((id) => ({
    id,
    label: REVISION_STAGE_LABELS[id] || id,
    status: id === 'queued' ? ('active' as const) : ('pending' as const),
  }));
}

export function createInitialRevisionProgress(
  payload: RevisionBatchPayload
): RevisionBatchProgress {
  return {
    topic_id: payload.topic_id || 0,
    topic_title: payload.topic_title,
    article_id: payload.article_id,
    stage: 'queued',
    stage_label: REVISION_STAGE_LABELS.queued,
    progress_pct: 0,
    eta_seconds: sumRevisionEta('queued'),
    stages: buildRevisionStages([]),
    logs: [
      {
        t: new Date().toISOString(),
        level: 'info',
        message: `Revision batch queued for article #${payload.article_id}`,
      },
    ],
    metrics: { retry_count: payload.retry_of_job_id ? 1 : 0 },
    checkpoint: 'queued',
    cancel_requested: false,
    actions_taken: [],
    resume_stage: payload.resume_stage,
  };
}

export function sumRevisionEta(fromStage: RevisionBatchStage): number {
  const canonical = canonicalizeRevisionStage(fromStage);
  const visible = [
    'queued',
    'planning_revision',
    'analyzing_failed_rules',
    'expanding_words',
    'improving_readability',
    'humanization',
    'fixing_links',
    'seo_repair',
    'updating_faq',
    'updating_summary',
    'quality_audit',
    'final_review',
  ];
  const idx = visible.indexOf(canonical);
  let total = 0;
  for (let i = Math.max(0, idx); i < visible.length; i++) {
    total += REVISION_STAGE_ETA_SEED[visible[i]] ?? 0;
  }
  return total;
}

export function applyRevisionStage(
  progress: RevisionBatchProgress,
  stage: RevisionBatchStage,
  opts?: { detail?: string; log?: string; skipIds?: string[] }
): RevisionBatchProgress {
  const canonical = canonicalizeRevisionStage(stage);
  const logs = [...progress.logs];
  if (opts?.log) {
    logs.push({ t: new Date().toISOString(), level: 'info', message: opts.log });
  }
  if (logs.length > 250) logs.splice(0, logs.length - 250);

  const stageLabel =
    canonical === 'analyzing_failed_rules' && opts?.detail
      ? opts.detail
      : REVISION_STAGE_LABELS[canonical] || REVISION_STAGE_LABELS[stage] || stage;

  // Hidden runtime stages (e.g. applying_batch): advance prior actives to done, no timeline node.
  if (HIDDEN_TIMELINE_STAGES.has(canonical) || HIDDEN_TIMELINE_STAGES.has(stage)) {
    return {
      ...progress,
      stage: canonical,
      stage_label: stageLabel,
      progress_pct: REVISION_STAGE_PROGRESS_PCT[canonical] ?? REVISION_STAGE_PROGRESS_PCT[stage] ?? 50,
      eta_seconds: sumRevisionEta('quality_audit'),
      stages: progress.stages.map((s) =>
        s.status === 'active' ? { ...s, status: 'done' as const } : s
      ),
      logs,
      checkpoint: canonical,
      resume_stage: canonical,
    };
  }

  const stages = progress.stages.map((s) => {
    if (opts?.skipIds?.includes(s.id) || opts?.skipIds?.includes(canonicalizeRevisionStage(s.id))) {
      return { ...s, status: 'skipped' as const };
    }
    if (canonicalizeRevisionStage(s.id) === canonical) {
      return { ...s, status: 'active' as const, detail: opts?.detail };
    }
    const order = progress.stages.findIndex(
      (x) => canonicalizeRevisionStage(x.id) === canonicalizeRevisionStage(s.id)
    );
    const cur = progress.stages.findIndex((x) => canonicalizeRevisionStage(x.id) === canonical);
    if (cur >= 0 && order < cur && s.status !== 'skipped') {
      return { ...s, status: 'done' as const };
    }
    return s;
  });

  return {
    ...progress,
    stage: canonical,
    stage_label: stageLabel,
    progress_pct: REVISION_STAGE_PROGRESS_PCT[canonical] ?? REVISION_STAGE_PROGRESS_PCT[stage] ?? 50,
    eta_seconds: sumRevisionEta(canonical),
    stages:
      canonical === 'analyzing_failed_rules' && opts?.detail
        ? stages.map((s) =>
            canonicalizeRevisionStage(s.id) === 'analyzing_failed_rules'
              ? { ...s, label: opts.detail!, detail: opts.detail }
              : s
          )
        : stages,
    logs,
    checkpoint: canonical,
    resume_stage: canonical,
  };
}

export function appendRevisionLog(
  progress: RevisionBatchProgress,
  message: string,
  level: RevisionBatchLogEntry['level'] = 'info'
): RevisionBatchProgress {
  const logs = [
    ...progress.logs,
    { t: new Date().toISOString(), level, message },
  ];
  if (logs.length > 250) logs.splice(0, logs.length - 250);
  return { ...progress, logs };
}

export function markRevisionStagesFromPlan(
  progress: RevisionBatchProgress,
  activeFixStages: string[],
  issueCount: number
): RevisionBatchProgress {
  const rebuilt = buildRevisionStages(activeFixStages);
  const prevMap = new Map(
    progress.stages.map((s) => [canonicalizeRevisionStage(s.id), s])
  );
  const active = new Set(activeFixStages.map((s) => canonicalizeRevisionStage(s)));

  const stages: RevisionBatchStageState[] = rebuilt.map((s) => {
    const prev = prevMap.get(canonicalizeRevisionStage(s.id));
    let status: RevisionBatchStageStatus = s.status;
    if (prev?.status === 'done' || prev?.status === 'failed' || prev?.status === 'skipped') {
      status = prev.status;
    } else if (prev?.status === 'active') {
      status = 'active';
    }
    if (OPTIONAL_FIX_STAGES.includes(s.id) && active.size > 0 && !active.has(s.id)) {
      status = 'skipped';
    }
    const base: RevisionBatchStageState = {
      id: s.id,
      label:
        canonicalizeRevisionStage(s.id) === 'analyzing_failed_rules' && issueCount > 0
          ? `Analyzing Failed Rules · ${issueCount} issues`
          : s.label,
      status,
      detail:
        canonicalizeRevisionStage(s.id) === 'analyzing_failed_rules'
          ? `${issueCount} fixable issues`
          : prev?.detail ?? s.detail,
    };
    return base;
  });

  return { ...progress, stages };
}
