/** Client-side draft / revision job types (mirrors server job progress). */

export type DraftJobStageStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface DraftJobStageState {
  id: string;
  label: string;
  status: DraftJobStageStatus;
  detail?: string;
}

export interface DraftJobLogEntry {
  t: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface DraftJobProgress {
  topic_id: number;
  topic_title?: string;
  article_id?: number;
  stage: string;
  stage_label: string;
  progress_pct: number;
  eta_seconds: number | null;
  stages: DraftJobStageState[];
  logs: DraftJobLogEntry[];
  metrics?: Record<string, unknown>;
  checkpoint?: string;
  cancel_requested?: boolean;
  section_detail?: string;
  debug?: Record<string, unknown>;
  /** revision_batch extras */
  publish_ready?: boolean;
  passed?: boolean;
  result_message?: string;
  issue_summary?: unknown[];
  word_budget?: Record<string, unknown>;
  actions_taken?: string[];
  failed_stage?: string;
  failure_reason?: string;
  error_category?: string;
  fixed_count?: number;
  remaining_count?: number;
  resume_stage?: string;
}

export interface DraftJobView {
  id: number;
  job_type: string;
  status: string;
  progress: DraftJobProgress;
  error_message?: string | null;
  article_id?: number | null;
  topic_id?: number | null;
  topic_title?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface EnqueueGenerateResult {
  ok: boolean;
  jobId?: number;
  status?: string;
  message: string;
  error?: string;
}

export type EnqueueRevisionResult = EnqueueGenerateResult;

const TRACKED_KEY = 'editorial_draft_job_ids';

export function loadTrackedJobIds(): number[] {
  try {
    const raw = sessionStorage.getItem(TRACKED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map(Number).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

export function saveTrackedJobIds(ids: number[]): void {
  try {
    sessionStorage.setItem(TRACKED_KEY, JSON.stringify(ids.slice(0, 20)));
  } catch {
    /* ignore */
  }
}

/** Max log lines kept in client state per job (server already trims). */
export const CLIENT_JOB_LOG_LIMIT = 100;

/** Display-only debug fields; anything else (Writer debug, caches) is dropped. */
function pickDebug(debug: unknown): Record<string, unknown> | undefined {
  if (!debug || typeof debug !== 'object') return undefined;
  const d = debug as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof d.before_score === 'number') out.before_score = d.before_score;
  if (Array.isArray(d.validation_failures)) out.validation_failures = d.validation_failures.slice(0, 5);
  return Object.keys(out).length ? out : undefined;
}

/**
 * Cheap change signature for a job view. Used to skip state updates when a
 * poll / SSE frame carries nothing new, so React does not re-render (and the
 * provider does not loop) on identical data.
 */
export function jobViewSignature(j: DraftJobView): string {
  const p = j.progress;
  const lastLog = p.logs.length ? p.logs[p.logs.length - 1] : null;
  return [
    j.id,
    j.job_type,
    j.status,
    p.stage,
    p.stage_label,
    p.progress_pct,
    p.eta_seconds ?? '',
    p.section_detail ?? '',
    p.logs.length,
    lastLog ? `${lastLog.t}|${lastLog.message.length}` : '',
    p.stages.map((s) => `${s.id}:${s.status}:${s.detail?.length ?? 0}`).join(','),
    j.article_id ?? '',
    j.error_message ?? '',
    p.failure_reason ?? '',
    p.result_message ?? '',
    p.passed === undefined ? '' : String(p.passed),
    p.actions_taken?.length ?? 0,
    String(j.updated_at ?? ''),
  ].join('~');
}

export function sameJobView(a: DraftJobView | null | undefined, b: DraftJobView | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return jobViewSignature(a) === jobViewSignature(b);
}

export function sameJobList(a: DraftJobView[], b: DraftJobView[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameJobView(a[i], b[i])) return false;
  }
  return true;
}

export function isTerminalJobStatus(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'failed';
}

export function normalizeJobPayload(raw: Record<string, unknown>): DraftJobView {
  const progress = (raw.progress || {}) as DraftJobProgress;
  const metrics = (progress.metrics || {}) as Record<string, unknown>;
  return {
    id: Number(raw.id),
    job_type: String(raw.job_type || 'draft_generate'),
    status: String(raw.status || 'queued'),
    progress: {
      topic_id: Number(progress.topic_id || raw.topic_id || 0),
      topic_title: progress.topic_title || (raw.topic_title as string) || undefined,
      article_id: progress.article_id ?? (raw.article_id as number) ?? undefined,
      stage: progress.stage || 'queued',
      stage_label: progress.stage_label || 'Queued',
      progress_pct: Number(progress.progress_pct || 0),
      eta_seconds: progress.eta_seconds ?? null,
      stages: Array.isArray(progress.stages) ? progress.stages : [],
      logs: Array.isArray(progress.logs) ? progress.logs.slice(-CLIENT_JOB_LOG_LIMIT) : [],
      metrics: progress.metrics,
      checkpoint: progress.checkpoint,
      cancel_requested: progress.cancel_requested,
      section_detail: progress.section_detail,
      debug: pickDebug(progress.debug),
      passed:
        typeof progress.passed === 'boolean'
          ? progress.passed
          : typeof metrics.passed === 'boolean'
            ? (metrics.passed as boolean)
            : undefined,
      result_message: progress.result_message,
      issue_summary: Array.isArray(progress.issue_summary) ? progress.issue_summary : undefined,
      word_budget: progress.word_budget,
      actions_taken: Array.isArray(progress.actions_taken) ? progress.actions_taken : undefined,
      failed_stage: progress.failed_stage,
      failure_reason: progress.failure_reason,
      error_category: progress.error_category,
      fixed_count:
        typeof progress.fixed_count === 'number'
          ? progress.fixed_count
          : typeof metrics.fixed_count === 'number'
            ? (metrics.fixed_count as number)
            : undefined,
      remaining_count:
        typeof progress.remaining_count === 'number'
          ? progress.remaining_count
          : typeof metrics.remaining_count === 'number'
            ? (metrics.remaining_count as number)
            : undefined,
      resume_stage: progress.resume_stage,
    },
    error_message: (raw.error_message as string) || null,
    article_id: (raw.article_id as number) ?? progress.article_id ?? null,
    topic_id: (raw.topic_id as number) ?? progress.topic_id ?? null,
    topic_title: (raw.topic_title as string) || progress.topic_title || null,
    created_at: raw.created_at as string | undefined,
    updated_at: raw.updated_at as string | undefined,
  };
}

export function isRevisionJob(job: DraftJobView | null | undefined): boolean {
  return job?.job_type === 'revision_batch';
}
