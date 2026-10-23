/**
 * Browser-facing job payload shaping.
 *
 * editorial_jobs.result_json keeps planning artifacts for retry/resume
 * (cache.research_pack, half-draft blocks) and the full Writer debug log.
 * None of that is rendered by the admin UI, but it used to be shipped on
 * every jobs-list poll, every /jobs/:id fetch and every SSE progress event.
 * These helpers strip it down to what the drawer / AI Jobs menu display.
 * The DB row is never modified — `?view=full` still returns the raw shape.
 */

/** Logs kept per job in the AI Jobs list (drawer fetches detail separately). */
export const JOB_LIST_LOG_LIMIT = 20;
/** Logs kept per job for the drawer (detail fetch + SSE). */
export const JOB_DETAIL_LOG_LIMIT = 80;
/** Max characters for a single log message / failure string sent to the UI. */
export const JOB_TEXT_LIMIT = 600;

/** Small, display-only debug fields the drawer reads. Everything else is dropped. */
const DEBUG_KEEP_SCALARS = [
  'before_score',
  'after_score',
  'failed_stage',
  'error_category',
  'tokens_in',
  'tokens_out',
  'final_word_count',
  'generation_time_ms',
  'groq_model',
  'research_pack_size_chars',
] as const;

export type JobPayloadView = 'list' | 'detail' | 'full';

export function parseJobView(raw: unknown, fallback: JobPayloadView): JobPayloadView {
  const v = String(raw || '').toLowerCase();
  if (v === 'full' || v === 'detail' || v === 'list') return v;
  if (v === 'summary') return 'list';
  return fallback;
}

function clip(value: unknown, max = JOB_TEXT_LIMIT): unknown {
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function compactDebug(debug: unknown): Record<string, unknown> | undefined {
  if (!debug || typeof debug !== 'object') return undefined;
  const src = debug as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of DEBUG_KEEP_SCALARS) {
    const v = src[key];
    if (v == null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string') out[key] = clip(v, 200);
  }
  if (Array.isArray(src.validation_failures)) {
    out.validation_failures = src.validation_failures
      .slice(0, 5)
      .map((f) => clip(typeof f === 'string' ? f : JSON.stringify(f)));
  }
  if (Array.isArray(src.active_fix_stages)) {
    out.active_fix_stages = src.active_fix_stages.slice(0, 20);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Return a display-safe copy of a job progress object. Never mutates input.
 * `full` returns the input untouched (explicit diagnostics only).
 */
export function compactJobProgress(
  progress: Record<string, unknown> | null | undefined,
  view: JobPayloadView
): Record<string, unknown> {
  const src = (progress && typeof progress === 'object' ? progress : {}) as Record<string, unknown>;
  if (view === 'full') return src;

  const { cache: _cache, debug, logs, actions_taken, issue_summary, ...rest } = src;
  const out: Record<string, unknown> = { ...rest };

  const logLimit = view === 'list' ? JOB_LIST_LOG_LIMIT : JOB_DETAIL_LOG_LIMIT;
  if (Array.isArray(logs)) {
    out.logs = logs.slice(-logLimit).map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const e = entry as Record<string, unknown>;
      return { t: e.t, level: e.level, message: clip(e.message) };
    });
  } else {
    out.logs = [];
  }

  if (Array.isArray(actions_taken)) out.actions_taken = actions_taken.slice(-24).map((a) => clip(a, 240));
  if (Array.isArray(issue_summary)) out.issue_summary = issue_summary.slice(0, 40);
  if (typeof out.failure_reason === 'string') out.failure_reason = clip(out.failure_reason);
  if (typeof out.result_message === 'string') out.result_message = clip(out.result_message);
  if (Array.isArray(out.stages)) {
    out.stages = (out.stages as Array<Record<string, unknown>>).map((s) =>
      s && typeof s === 'object' && typeof s.detail === 'string' ? { ...s, detail: clip(s.detail, 240) } : s
    );
  }

  const dbg = compactDebug(debug);
  if (dbg) out.debug = dbg;
  return out;
}
