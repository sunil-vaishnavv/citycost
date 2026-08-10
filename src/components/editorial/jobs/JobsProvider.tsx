import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Bot, CheckCircle2, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { GenerationDrawer } from './GenerationDrawer';
import {
  loadTrackedJobIds,
  normalizeJobPayload,
  saveTrackedJobIds,
  type DraftJobView,
  type EnqueueGenerateResult,
  type EnqueueRevisionResult,
} from './types';

type Toast = {
  id: string;
  title: string;
  body?: string;
  articleId?: number;
};

type JobsContextValue = {
  jobs: DraftJobView[];
  activeCount: number;
  drawerJobId: number | null;
  openDrawer: (jobId: number) => void;
  closeDrawer: () => void;
  enqueueGenerate: (topicId: number, opts?: { reuse_research?: boolean }) => Promise<EnqueueGenerateResult>;
  enqueueRevision: (articleId: number, opts?: { reuse_report?: boolean }) => Promise<EnqueueRevisionResult>;
  cancelJob: (jobId: number) => Promise<void>;
  retryJob: (jobId: number) => Promise<void>;
  refreshJobs: () => Promise<void>;
  onOpenArticle?: (articleId: number) => void;
  /** Subscribe to terminal job events (completed/failed) from the shared drawer. */
  subscribeJobTerminal: (handler: (job: DraftJobView) => void) => () => void;
};

const JobsContext = createContext<JobsContextValue | null>(null);

export function useEditorialJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useEditorialJobs must be used within JobsProvider');
  return ctx;
}

/** Optional hook — returns null outside provider. */
export function useEditorialJobsOptional(): JobsContextValue | null {
  return useContext(JobsContext);
}

function ToastHost({
  toasts,
  onDismiss,
  onOpen,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onOpen?: (articleId: number) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-xl border border-emerald-200/80 bg-white p-4 shadow-xl dark:border-emerald-900/40 dark:bg-slate-900"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900 dark:text-white">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-slate-500">{t.body}</p>}
              <div className="mt-3 flex gap-2">
                {t.articleId && onOpen && (
                  <button
                    type="button"
                    className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400"
                    onClick={() => {
                      onOpen(t.articleId!);
                      onDismiss(t.id);
                    }}
                  >
                    Open article
                  </button>
                )}
                <button
                  type="button"
                  className="text-sm text-slate-500 hover:text-slate-800"
                  onClick={() => onDismiss(t.id)}
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button type="button" className="text-slate-400" onClick={() => onDismiss(t.id)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function JobCenterDropdown({
  jobs,
  onSelect,
}: {
  jobs: DraftJobView[];
  onSelect: (jobId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const recent = jobs.slice(0, 8);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-white dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200"
      >
        <Bot className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
        AI Jobs
        {active.length > 0 && (
          <span className="ml-0.5 rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {active.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-950">
            <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-white/10">
              Background jobs
            </div>
            {recent.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">No recent draft jobs</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {recent.map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                      onClick={() => {
                        onSelect(j.id);
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {j.topic_title ||
                            j.progress.topic_title ||
                            (j.job_type === 'revision_batch'
                              ? `Fix Issues #${j.article_id || j.progress.article_id || j.id}`
                              : `Draft job #${j.id}`)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {j.status === 'running' || j.status === 'queued'
                            ? `${j.progress.stage_label || j.status} · ${Math.round(j.progress.progress_pct || 0)}%`
                            : j.status}
                        </p>
                      </div>
                      {(j.status === 'running' || j.status === 'queued') && (
                        <span className="text-xs font-bold tabular-nums text-teal-600">
                          {Math.round(j.progress.progress_pct || 0)}%
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function JobsProvider({
  children,
  onOpenArticle,
  debugMode,
}: {
  children: ReactNode;
  onOpenArticle?: (articleId: number) => void;
  debugMode?: boolean;
}) {
  const [jobs, setJobs] = useState<DraftJobView[]>([]);
  const [drawerJobId, setDrawerJobId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenCompleted = useMemo(() => new Set<number>(), []);
  const [hydrated, setHydrated] = useState(false);
  const terminalHandlers = useMemo(() => new Set<(job: DraftJobView) => void>(), []);
  const seenTerminal = useMemo(() => new Set<number>(), []);

  const subscribeJobTerminal = useCallback((handler: (job: DraftJobView) => void) => {
    terminalHandlers.add(handler);
    return () => {
      terminalHandlers.delete(handler);
    };
  }, [terminalHandlers]);

  const mergeJob = useCallback((view: DraftJobView) => {
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === view.id);
      const next = idx >= 0 ? [...prev] : [view, ...prev];
      if (idx >= 0) next[idx] = view;
      else next.sort((a, b) => b.id - a.id);
      return next.slice(0, 30);
    });
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await api.get<{ jobs: Record<string, unknown>[] }>(
        '/api/editorial/jobs?type=all&limit=30'
      );
      const views = (data.jobs || []).map((j) => normalizeJobPayload(j));
      if (!hydrated) {
        for (const j of views) {
          if (j.status === 'completed' || j.status === 'failed') {
            seenCompleted.add(j.id);
            seenTerminal.add(j.id);
          }
        }
        setHydrated(true);
      }
      setJobs(views);
      const tracked = loadTrackedJobIds();
      const activeIds = views
        .filter((j) => j.status === 'queued' || j.status === 'running')
        .map((j) => j.id);
      saveTrackedJobIds([...new Set([...tracked, ...activeIds])]);
    } catch {
      /* ignore */
    }
  }, [hydrated, seenCompleted, seenTerminal]);

  const emitJobTerminal = useCallback(
    (job: DraftJobView) => {
      if (job.status !== 'completed' && job.status !== 'failed') return;
      mergeJob(job);
      // Avoid toasting historical jobs before the first jobs list hydrate.
      if (!hydrated) {
        seenTerminal.add(job.id);
        seenCompleted.add(job.id);
        return;
      }
      if (seenTerminal.has(job.id)) return;
      seenTerminal.add(job.id);
      if (job.status === 'completed' && !seenCompleted.has(job.id)) {
        seenCompleted.add(job.id);
        const articleId = job.article_id || job.progress.article_id;
        const isRevision = job.job_type === 'revision_batch';
        setToasts((t) => [
          ...t,
          {
            id: `done-${job.id}`,
            title: isRevision
              ? job.progress.passed === false
                ? 'Fix Issues finished with issues'
                : 'Fix Issues Complete'
              : 'Draft Ready',
            body: job.topic_title || job.progress.topic_title || `Job #${job.id}`,
            articleId: articleId ? Number(articleId) : undefined,
          },
        ]);
      }
      for (const h of terminalHandlers) {
        try {
          h(job);
        } catch {
          /* ignore */
        }
      }
    },
    [mergeJob, hydrated, seenTerminal, seenCompleted, terminalHandlers]
  );
  useEffect(() => {
    void refreshJobs();
    const timer = setInterval(() => void refreshJobs(), 8000);
    return () => clearInterval(timer);
  }, [refreshJobs]);

  // Reconnect tracked jobs after refresh
  useEffect(() => {
    const tracked = loadTrackedJobIds();
    if (!tracked.length) return;
    void (async () => {
      for (const id of tracked) {
        try {
          const data = await api.get<{ job: Record<string, unknown> }>(`/api/editorial/jobs/${id}`);
          mergeJob(normalizeJobPayload(data.job));
        } catch {
          /* gone */
        }
      }
    })();
  }, [mergeJob]);

  // Toast + subscriber notify when jobs finish (drawer or background poll)
  useEffect(() => {
    for (const j of jobs) {
      if (j.status === 'completed' || j.status === 'failed') {
        emitJobTerminal(j);
      }
    }
  }, [jobs, emitJobTerminal]);

  const enqueueGenerate = useCallback(
    async (topicId: number, opts?: { reuse_research?: boolean }) => {
      const result = await api.post<EnqueueGenerateResult>('/api/editorial/articles/generate', {
        topic_id: topicId,
        reuse_research: opts?.reuse_research,
      });
      if (result.jobId) {
        const ids = loadTrackedJobIds();
        saveTrackedJobIds([result.jobId, ...ids.filter((x) => x !== result.jobId)]);
        setDrawerJobId(result.jobId);
        try {
          const data = await api.get<{ job: Record<string, unknown> }>(
            `/api/editorial/jobs/${result.jobId}`
          );
          mergeJob(normalizeJobPayload(data.job));
        } catch {
          mergeJob({
            id: result.jobId,
            job_type: 'draft_generate',
            status: result.status || 'queued',
            progress: {
              topic_id: topicId,
              stage: 'queued',
              stage_label: 'Queued',
              progress_pct: 0,
              eta_seconds: null,
              stages: [],
              logs: [],
            },
            topic_id: topicId,
          });
        }
        void refreshJobs();
      }
      return result;
    },
    [mergeJob, refreshJobs]
  );

  const enqueueRevision = useCallback(
    async (articleId: number, opts?: { reuse_report?: boolean }) => {
      const result = await api.post<EnqueueRevisionResult>(
        `/api/editorial/articles/${articleId}/revise`,
        { reuse_report: opts?.reuse_report !== false }
      );
      if (result.jobId) {
        const ids = loadTrackedJobIds();
        saveTrackedJobIds([result.jobId, ...ids.filter((x) => x !== result.jobId)]);
        setDrawerJobId(result.jobId);
        try {
          const data = await api.get<{ job: Record<string, unknown> }>(
            `/api/editorial/jobs/${result.jobId}`
          );
          mergeJob(normalizeJobPayload(data.job));
        } catch {
          mergeJob({
            id: result.jobId,
            job_type: 'revision_batch',
            status: result.status || 'queued',
            progress: {
              topic_id: 0,
              article_id: articleId,
              stage: 'queued',
              stage_label: 'Queued',
              progress_pct: 0,
              eta_seconds: null,
              stages: [],
              logs: [],
            },
            article_id: articleId,
          });
        }
        void refreshJobs();
      }
      return result;
    },
    [mergeJob, refreshJobs]
  );

  const cancelJob = useCallback(
    async (jobId: number) => {
      await api.post(`/api/editorial/jobs/${jobId}/cancel`);
      await refreshJobs();
    },
    [refreshJobs]
  );

  const retryJob = useCallback(
    async (jobId: number) => {
      const result = await api.post<EnqueueGenerateResult>(`/api/editorial/jobs/${jobId}/retry`);
      if (result.jobId) {
        setDrawerJobId(result.jobId);
        const ids = loadTrackedJobIds();
        saveTrackedJobIds([result.jobId, ...ids.filter((x) => x !== result.jobId)]);
        try {
          const data = await api.get<{ job: Record<string, unknown> }>(
            `/api/editorial/jobs/${result.jobId}`
          );
          mergeJob(normalizeJobPayload(data.job));
        } catch {
          /* refresh below */
        }
      }
      await refreshJobs();
    },
    [mergeJob, refreshJobs]
  );

  const activeCount = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;

  const value: JobsContextValue = {
    jobs,
    activeCount,
    drawerJobId,
    openDrawer: setDrawerJobId,
    closeDrawer: () => setDrawerJobId(null),
    enqueueGenerate,
    enqueueRevision,
    cancelJob,
    retryJob,
    refreshJobs,
    onOpenArticle,
    subscribeJobTerminal,
  };

  return (
    <JobsContext.Provider value={value}>
      {children}
      <GenerationDrawer
        jobId={drawerJobId}
        open={drawerJobId != null}
        onClose={() => setDrawerJobId(null)}
        onOpenArticle={onOpenArticle}
        onCancel={(id) => void cancelJob(id)}
        onRetry={(id) => void retryJob(id)}
        onJobTerminal={emitJobTerminal}
        debugMode={debugMode}
      />
      <ToastHost
        toasts={toasts}
        onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
        onOpen={onOpenArticle}
      />
    </JobsContext.Provider>
  );
}

export { ApiError };
