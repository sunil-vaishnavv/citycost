import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Bot, CheckCircle2, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { GenerationDrawer } from './GenerationDrawer';
import {
  isTerminalJobStatus,
  loadTrackedJobIds,
  normalizeJobPayload,
  sameJobList,
  sameJobView,
  saveTrackedJobIds,
  type DraftJobView,
  type EnqueueGenerateResult,
  type EnqueueRevisionResult,
} from './types';

/** Tracks the current admin pathname using the custom History API router. */
function usePathname(): string {
  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return pathname;
}

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

/** Jobs kept in the AI Jobs menu. */
const MAX_JOBS = 30;
/** Poll cadence while any job is queued/running, and when idle. */
const ACTIVE_POLL_MS = 8000;
const IDLE_POLL_MS = 30000;
const MAX_TOASTS = 4;

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
  // Refs (not state) so callbacks stay stable and never retrigger effects.
  const hydratedRef = useRef(false);
  const seenTerminalRef = useRef(new Set<number>());
  const terminalHandlersRef = useRef(new Set<(job: DraftJobView) => void>());
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastRefreshAtRef = useRef(0);
  const jobsRef = useRef<DraftJobView[]>([]);
  const enqueueInFlightRef = useRef(new Map<string, Promise<EnqueueGenerateResult>>());
  const location = usePathname();

  jobsRef.current = jobs;

  // Route-change cleanup: the drawer only tracks an in-memory job id. If the
  // route changes (e.g. Open Article navigates to /admin/articles/:id), make
  // sure the drawer is fully unmounted so no overlay survives navigation.
  useEffect(() => {
    setDrawerJobId((prev) => {
      if (prev != null) {
        console.log(`[jobs] route change to ${location} — closing drawer (was job #${prev})`);
      }
      return null;
    });
  }, [location]);

  const subscribeJobTerminal = useCallback((handler: (job: DraftJobView) => void) => {
    terminalHandlersRef.current.add(handler);
    return () => {
      terminalHandlersRef.current.delete(handler);
    };
  }, []);

  /** Insert or replace one job. Returns the same array when nothing changed. */
  const mergeJob = useCallback((view: DraftJobView) => {
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === view.id);
      if (idx >= 0) {
        if (sameJobView(prev[idx], view)) return prev;
        const next = [...prev];
        next[idx] = view;
        return next;
      }
      return [view, ...prev].sort((a, b) => b.id - a.id).slice(0, MAX_JOBS);
    });
  }, []);

  /** Insert a placeholder only if the job is not already known. */
  const ensureJob = useCallback((placeholder: DraftJobView) => {
    setJobs((prev) =>
      prev.some((j) => j.id === placeholder.id)
        ? prev
        : [placeholder, ...prev].sort((a, b) => b.id - a.id).slice(0, MAX_JOBS)
    );
  }, []);

  /**
   * Toast + notify subscribers once per job reaching completed/failed.
   * Never writes `jobs` — writing here from the effect over `jobs` caused a
   * perpetual render loop that exhausted the admin tab's memory.
   */
  const notifyTerminal = useCallback((job: DraftJobView) => {
    if (!isTerminalJobStatus(job.status)) return;
    const seen = seenTerminalRef.current;
    if (seen.has(job.id)) return;
    seen.add(job.id);
    // Avoid toasting historical jobs before the first jobs list hydrate.
    if (!hydratedRef.current) return;
    if (job.status === 'completed') {
      const articleId = job.article_id || job.progress.article_id;
      const isRevision = job.job_type === 'revision_batch';
      setToasts((t) =>
        [
          ...t.filter((x) => x.id !== `done-${job.id}`),
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
        ].slice(-MAX_TOASTS)
      );
    }
    for (const h of terminalHandlersRef.current) {
      try {
        h(job);
      } catch {
        /* ignore */
      }
    }
  }, []);

  /** Drawer saw a terminal frame: record it in the list, then notify once. */
  const handleDrawerTerminal = useCallback(
    (job: DraftJobView) => {
      mergeJob(job);
      notifyTerminal(job);
    },
    [mergeJob, notifyTerminal]
  );

  const refreshJobs = useCallback(async () => {
    // Single-flight: overlapping callers share one request.
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const run = (async () => {
      try {
        const data = await api.get<{ jobs: Record<string, unknown>[] }>(
          `/api/editorial/jobs?type=all&limit=${MAX_JOBS}&view=list`
        );
        const views = (data.jobs || []).map((j) => normalizeJobPayload(j));
        const firstLoad = !hydratedRef.current;
        if (firstLoad) {
          for (const j of views) {
            if (isTerminalJobStatus(j.status)) seenTerminalRef.current.add(j.id);
          }
          hydratedRef.current = true;
        }
        setJobs((prev) => (sameJobList(prev, views) ? prev : views));

        // Reconnect jobs started in this tab that fell outside the list window,
        // then forget tracked ids that have finished.
        const byId = new Map(views.map((j) => [j.id, j]));
        const tracked = loadTrackedJobIds();
        if (firstLoad) {
          for (const id of tracked.filter((x) => !byId.has(x)).slice(0, 5)) {
            try {
              const one = await api.get<{ job: Record<string, unknown> }>(`/api/editorial/jobs/${id}`);
              const view = normalizeJobPayload(one.job);
              byId.set(view.id, view);
              mergeJob(view);
            } catch {
              /* gone */
            }
          }
        }
        const activeIds = views.filter((j) => !isTerminalJobStatus(j.status)).map((j) => j.id);
        const stillTracked = tracked.filter((id) => {
          const j = byId.get(id);
          return j ? !isTerminalJobStatus(j.status) : false;
        });
        saveTrackedJobIds([...new Set([...stillTracked, ...activeIds])]);
      } catch {
        /* ignore */
      } finally {
        lastRefreshAtRef.current = Date.now();
      }
    })().finally(() => {
      refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = run;
    return run;
  }, [mergeJob]);

  useEffect(() => {
    void refreshJobs();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const anyActive = jobsRef.current.some((j) => !isTerminalJobStatus(j.status));
      const due = anyActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
      if (Date.now() - lastRefreshAtRef.current < due - 250) return;
      void refreshJobs();
    }, ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshJobs]);

  // Toast + subscriber notify when jobs finish (drawer or background poll).
  // notifyTerminal is idempotent per job and does not touch `jobs`.
  useEffect(() => {
    for (const j of jobs) {
      if (isTerminalJobStatus(j.status)) notifyTerminal(j);
    }
  }, [jobs, notifyTerminal]);

  /** Shared enqueue path: dedupes concurrent calls with the same key. */
  const runEnqueue = useCallback(
    (
      key: string,
      request: () => Promise<EnqueueGenerateResult>,
      placeholder: (jobId: number, status: string) => DraftJobView | null
    ): Promise<EnqueueGenerateResult> => {
      const inFlight = enqueueInFlightRef.current;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const run = (async () => {
        const result = await request();
        if (result.jobId) {
          const ids = loadTrackedJobIds();
          saveTrackedJobIds([result.jobId, ...ids.filter((x) => x !== result.jobId)]);
          setDrawerJobId(result.jobId);
          const ph = placeholder(result.jobId, result.status || 'queued');
          if (ph) ensureJob(ph);
          void refreshJobs();
        }
        return result;
      })().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, run);
      return run;
    },
    [ensureJob, refreshJobs]
  );

  const enqueueGenerate = useCallback(
    (topicId: number, opts?: { reuse_research?: boolean }) =>
      runEnqueue(
        `generate:${topicId}`,
        () =>
          api.post<EnqueueGenerateResult>('/api/editorial/articles/generate', {
            topic_id: topicId,
            reuse_research: opts?.reuse_research,
          }),
        (jobId, status) => ({
          id: jobId,
          job_type: 'draft_generate',
          status,
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
        })
      ),
    [runEnqueue]
  );

  const enqueueRevision = useCallback(
    (articleId: number, opts?: { reuse_report?: boolean }) =>
      runEnqueue(
        `revise:${articleId}`,
        () =>
          api.post<EnqueueRevisionResult>(`/api/editorial/articles/${articleId}/revise`, {
            reuse_report: opts?.reuse_report !== false,
          }),
        (jobId, status) => ({
          id: jobId,
          job_type: 'revision_batch',
          status,
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
        })
      ),
    [runEnqueue]
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
      await runEnqueue(
        `retry:${jobId}`,
        () => api.post<EnqueueGenerateResult>(`/api/editorial/jobs/${jobId}/retry`),
        () => null
      );
    },
    [runEnqueue]
  );

  const activeCount = useMemo(
    () => jobs.filter((j) => j.status === 'queued' || j.status === 'running').length,
    [jobs]
  );

  // Close the drawer first, then navigate so the overlay is fully unmounted
  // before the article page renders.
  const handleOpenArticle = useCallback(
    (articleId: number) => {
      console.log(`[jobs] Open Article clicked — closing drawer before navigating to #${articleId}`);
      setDrawerJobId(null);
      onOpenArticle?.(articleId);
    },
    [onOpenArticle]
  );

  const closeDrawer = useCallback(() => setDrawerJobId(null), []);
  const handleCancel = useCallback((id: number) => void cancelJob(id), [cancelJob]);
  const handleRetry = useCallback((id: number) => void retryJob(id), [retryJob]);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const value = useMemo<JobsContextValue>(
    () => ({
      jobs,
      activeCount,
      drawerJobId,
      openDrawer: setDrawerJobId,
      closeDrawer,
      enqueueGenerate,
      enqueueRevision,
      cancelJob,
      retryJob,
      refreshJobs,
      onOpenArticle: handleOpenArticle,
      subscribeJobTerminal,
    }),
    [
      jobs,
      activeCount,
      drawerJobId,
      closeDrawer,
      enqueueGenerate,
      enqueueRevision,
      cancelJob,
      retryJob,
      refreshJobs,
      handleOpenArticle,
      subscribeJobTerminal,
    ]
  );

  return (
    <JobsContext.Provider value={value}>
      {children}
      <GenerationDrawer
        jobId={drawerJobId}
        open={drawerJobId != null}
        onClose={closeDrawer}
        onOpenArticle={handleOpenArticle}
        onCancel={handleCancel}
        onRetry={handleRetry}
        onJobTerminal={handleDrawerTerminal}
        debugMode={debugMode}
      />
      <ToastHost toasts={toasts} onDismiss={dismissToast} onOpen={handleOpenArticle} />
    </JobsContext.Provider>
  );
}

export { ApiError };
