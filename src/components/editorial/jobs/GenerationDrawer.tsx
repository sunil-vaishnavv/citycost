import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Button } from '../ui';
import { JobLogs } from './JobLogs';
import { JobTimeline } from './JobTimeline';
import { useJobSubscription } from './useJobSubscription';
import { isRevisionJob, type DraftJobProgress } from './types';

function formatEta(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `~${Math.round(sec)}s remaining`;
  return `~${Math.round(sec / 60)}m remaining`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.round(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function metricNum(metrics: Record<string, unknown> | undefined, key: string): number | null {
  const v = metrics?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function metricStr(metrics: Record<string, unknown> | undefined, key: string): string | null {
  const v = metrics?.[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

function formatFailureStage(
  progress: DraftJobProgress | undefined,
  stageLabels?: Record<string, string>
): string {
  const id = progress?.failed_stage || progress?.stage;
  if (!id || id === 'failed') return progress?.stage_label || '—';
  const label = stageLabels?.[id];
  return label || id.replace(/_/g, ' ');
}

function humanizeFailureReason(reason: string): string {
  const m = reason.match(/word_count_below_minimum:(\d+)<(\d+)/);
  if (m) {
    return `Word count ${m[1]} is below the minimum ${m[2]} after quality gates.`;
  }
  if (/^Writer v2 quality gate failed:/i.test(reason)) {
    return reason.replace(/^Writer v2 quality gate failed:\s*/i, 'Quality gate: ');
  }
  return reason;
}

export function GenerationDrawer({
  jobId,
  open,
  onClose,
  onOpenArticle,
  onCancel,
  onRetry,
  onJobTerminal,
  debugMode,
}: {
  jobId: number | null;
  open: boolean;
  onClose: () => void;
  onOpenArticle?: (articleId: number) => void;
  onCancel?: (jobId: number) => void;
  onRetry?: (jobId: number) => void;
  /** Fires once when a watched job reaches completed/failed (for article refresh). */
  onJobTerminal?: (job: NonNullable<ReturnType<typeof useJobSubscription>['job']>) => void;
  debugMode?: boolean;
}) {
  const { job, transport, error } = useJobSubscription(jobId, open && jobId != null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [notifiedTerminal, setNotifiedTerminal] = useState<number | null>(null);
  const progress = job?.progress;
  const pct = progress?.progress_pct ?? 0;
  const terminal = job?.status === 'completed' || job?.status === 'failed';
  const revision = isRevisionJob(job);
  const passed = progress?.passed === true;
  const metrics = progress?.metrics as Record<string, unknown> | undefined;
  const beforeScore =
    metricNum(metrics, 'before_score') ??
    (typeof progress?.debug?.before_score === 'number' ? progress.debug.before_score : null);
  const afterScore = metricNum(metrics, 'after_score');
  const durationMs = metricNum(metrics, 'duration_ms') ?? metricNum(metrics, 'total_ms');
  const tokensIn = metricNum(metrics, 'tokens_in');
  const tokensOut = metricNum(metrics, 'tokens_out');
  const provider = metricStr(metrics, 'provider') || metricStr(metrics, 'model');
  const fixedCount = progress?.fixed_count ?? metricNum(metrics, 'fixed_count');
  const remainingCount = progress?.remaining_count ?? metricNum(metrics, 'remaining_count');
  const articleId = job?.article_id || progress?.article_id;
  const failureReason =
    progress?.failure_reason ||
    job?.error_message ||
    (Array.isArray(progress?.debug?.validation_failures)
      ? String((progress?.debug?.validation_failures as string[])[0] || '')
      : '') ||
    'Unknown error';
  const failedStageLabel = formatFailureStage(progress);
  const errorCategory = progress?.error_category;

  useEffect(() => {
    if (!open) setLogsOpen(false);
  }, [open]);

  useEffect(() => {
    if (!job || !terminal) return;
    if (notifiedTerminal === job.id) return;
    setNotifiedTerminal(job.id);
    onJobTerminal?.(job);
  }, [job, terminal, notifiedTerminal, onJobTerminal]);

  if (!open || !jobId) return null;

  const eyebrow = revision ? 'Fix Issues' : 'Draft generation';
  const title =
    job?.topic_title ||
    progress?.topic_title ||
    (revision && articleId ? `Article #${articleId}` : `Job #${jobId}`);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        aria-label="Close AI job drawer"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-slate-200/80 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
              {eyebrow}
            </p>
            <h2 className="mt-1 truncate font-display text-lg font-bold text-slate-900 dark:text-white">
              {title}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Job #{jobId}
              {transport ? ` · ${transport}` : ''}
              {job?.status ? ` · ${job.status}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div>
            <div className="mb-2 flex items-end justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {progress?.stage_label || 'Queued'}
                </p>
                <p className="text-xs text-slate-500">{formatEta(progress?.eta_seconds)}</p>
              </div>
              <p className="text-sm font-bold tabular-nums text-teal-700 dark:text-teal-400">
                {Math.round(pct)}%
              </p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </p>
          )}

          {job?.status === 'failed' && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-3 text-sm dark:border-rose-900/50 dark:bg-rose-950/30">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <div>
                  <p className="font-semibold text-rose-800 dark:text-rose-300">
                    {revision ? 'Fix Issues failed' : 'Generation failed'}
                  </p>
                  <p className="mt-1 text-rose-700 dark:text-rose-400">
                    {humanizeFailureReason(failureReason)}
                  </p>
                  <p className="mt-1 text-xs text-rose-600/80">
                    Stage: {failedStageLabel}
                    {errorCategory ? ` · ${errorCategory.replace(/_/g, ' ')}` : ''}
                  </p>
                  {revision && (
                    <p className="mt-2 text-xs text-rose-600/90">
                      Retry resumes from the failed stage — quality report, draft, and research are
                      reused (article is not regenerated).
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {job?.status === 'completed' && revision && !passed && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    Completed with Issues
                  </p>
                  <p className="mt-1 text-amber-800 dark:text-amber-300">
                    {progress?.result_message ||
                      'Revision finished but final review still needs work.'}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-amber-900/90 dark:text-amber-200/90">
                    <div>
                      <dt className="font-medium opacity-70">Score</dt>
                      <dd className="tabular-nums">
                        {beforeScore ?? '—'} → {afterScore ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium opacity-70">Fixed / remaining</dt>
                      <dd className="tabular-nums">
                        {fixedCount ?? '—'} / {remainingCount ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium opacity-70">Time</dt>
                      <dd>{formatDuration(durationMs)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium opacity-70">Tokens</dt>
                      <dd className="tabular-nums">
                        {tokensIn != null || tokensOut != null
                          ? `${tokensIn ?? 0} in / ${tokensOut ?? 0} out`
                          : '—'}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="font-medium opacity-70">Provider</dt>
                      <dd>{provider || '—'}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          )}

          {job?.status === 'completed' && (!revision || passed) && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/30">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                    {revision ? 'Ready after Fix Issues' : 'Draft ready'}
                  </p>
                  {revision && progress?.result_message ? (
                    <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                      {progress.result_message}
                    </p>
                  ) : null}
                  {revision && (beforeScore != null || afterScore != null) ? (
                    <p className="mt-1 text-xs text-emerald-700/90 dark:text-emerald-400/90">
                      Score {beforeScore ?? '—'} → {afterScore ?? '—'}
                      {durationMs != null ? ` · ${formatDuration(durationMs)}` : ''}
                      {provider ? ` · ${provider}` : ''}
                    </p>
                  ) : null}
                  {!revision && articleId ? (
                    <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                      Article #{articleId}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Timeline</p>
            <JobTimeline stages={progress?.stages || []} sectionDetail={progress?.section_detail} />
          </div>

          {revision && (progress?.actions_taken?.length || 0) > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Actions taken
              </p>
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs text-slate-700 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-300">
                {(progress?.actions_taken || []).slice(-24).map((a, i) => (
                  <li key={`${i}-${a.slice(0, 40)}`}>· {a}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <button
              type="button"
              className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              onClick={() => setLogsOpen((v) => !v)}
            >
              {logsOpen ? 'Hide logs' : 'Show logs'}
            </button>
            {logsOpen && <JobLogs logs={progress?.logs || []} />}
          </div>

          {debugMode && progress?.metrics && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-white/10 dark:bg-slate-900/50">
              <p className="mb-1 font-bold uppercase tracking-wider text-slate-500">Debug</p>
              <pre className="overflow-x-auto whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                {JSON.stringify(progress.metrics, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-4 dark:border-white/10">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!terminal && onCancel && (
            <Button variant="outline" onClick={() => onCancel(jobId)}>
              Cancel job
            </Button>
          )}
          {(job?.status === 'failed' || (job?.status === 'completed' && revision && !passed)) &&
            onRetry && (
              <Button variant="primary" onClick={() => onRetry(jobId)}>
                Retry
              </Button>
            )}
          {job?.status === 'completed' && articleId && onOpenArticle && !revision && (
            <Button variant="primary" onClick={() => onOpenArticle(Number(articleId))}>
              Open article
            </Button>
          )}
        </footer>
      </aside>
    </div>
  );
}
