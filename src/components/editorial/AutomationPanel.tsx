import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  HeartPulse,
  ListTree,
  Play,
  RefreshCw,
  Save,
  ScrollText,
  Settings2,
  Sparkles,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { api, ApiError, qs, type AutomationStatus, type Job } from './api';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  GlassPanel,
  Input,
  PageLoader,
  SectionHeader,
  StatusPill,
  Toggle,
} from './ui';
import { normalizeStages, STAGE_LABELS, type NormalizedStage } from './automation/constants';
import { formatDate, formatDuration, formatTime, formatWhen } from './automation/format';
import {
  extractErrorFromStageDetail,
  humanizeError,
  type HumanizedError,
} from './automation/humanizeError';
import { StageDrawer } from './automation/StageDrawer';
import { TechnicalDetails } from './automation/TechnicalDetails';

interface CalendarEntryLite {
  id: number;
  status: string;
  topic_id: number | null;
  topic?: { title: string } | null;
}

interface ProviderLite {
  provider_name: string;
  label: string;
  enabled: boolean;
  status: string;
  status_color: 'green' | 'yellow' | 'red';
}

type AutomationMode = 'on' | 'off' | 'paused' | 'running';

function automationMode(status: AutomationStatus, running: boolean): AutomationMode {
  if (running || status.today_job?.status === 'running') return 'running';
  if (status.settings.automation_paused) return 'paused';
  if (status.settings.scheduler_enabled) return 'on';
  return 'off';
}

function pipelineHealth(
  job: Job | null,
  stages: NormalizedStage[]
): { label: string; tone: 'emerald' | 'rose' | 'amber' | 'neutral'; hint: string } {
  if (!job) return { label: 'Not started', tone: 'neutral', hint: 'No pipeline run for today yet' };
  if (job.status === 'running') return { label: 'Running', tone: 'amber', hint: 'Pipeline in progress' };
  if (job.status === 'completed') return { label: 'Healthy', tone: 'emerald', hint: 'Today’s run completed' };
  if (job.status === 'failed') {
    const failed = stages.find((s) => s.status === 'failed');
    return {
      label: 'Failed',
      tone: 'rose',
      hint: failed ? `Stopped at ${failed.label}` : 'Today’s run failed',
    };
  }
  return { label: job.status, tone: 'neutral', hint: '' };
}

function jobDurationMs(job: Job | null): number | null {
  if (!job) return null;
  const fromResult = job.result_json?.duration_ms;
  if (typeof fromResult === 'number') return fromResult;
  if (job.created_at && job.updated_at && job.status !== 'queued') {
    const a = new Date(job.created_at).getTime();
    const b = new Date(job.updated_at).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) return b - a;
  }
  return null;
}

function currentStageLabel(job: Job | null, stages: NormalizedStage[]): string {
  if (!job) return '—';
  if (job.status === 'completed') return 'Publish';
  const failed = stages.find((s) => s.status === 'failed');
  if (failed) return failed.label;
  const lastOk = [...stages].reverse().find((s) => s.status === 'ok');
  if (job.status === 'running') {
    const pending = stages.find((s) => s.status === 'pending');
    return pending?.label || lastOk?.label || '—';
  }
  return lastOk?.label || '—';
}

function HumanErrorCard({
  error,
  actions,
}: {
  error: HumanizedError;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-rose-200/70 bg-rose-50/50 px-4 py-4 dark:border-rose-500/20 dark:bg-rose-500/[0.06]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-rose-900 dark:text-rose-100">{error.title}</p>
          <p className="mt-1 text-sm text-rose-800/80 dark:text-rose-200/80">{error.reason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {error.provider && (
              <Badge tone="rose">
                Provider · {error.provider}
              </Badge>
            )}
            {error.model && (
              <Badge tone="neutral">
                Model · {error.model}
              </Badge>
            )}
            {error.code && <Badge tone="neutral">{error.code}</Badge>}
          </div>
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
          <div className="mt-3">
            <TechnicalDetails raw={error.raw} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({
  open,
  onClose,
  saving,
  schedulerEnabled,
  setSchedulerEnabled,
  autoPublish,
  setAutoPublish,
  publishTime,
  setPublishTime,
  timezone,
  setTimezone,
  retryCount,
  setRetryCount,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  saving: boolean;
  schedulerEnabled: boolean;
  setSchedulerEnabled: (v: boolean) => void;
  autoPublish: boolean;
  setAutoPublish: (v: boolean) => void;
  publishTime: string;
  setPublishTime: (v: string) => void;
  timezone: string;
  setTimezone: (v: string) => void;
  retryCount: number;
  setRetryCount: (v: number) => void;
  onSave: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-white/10 dark:bg-slate-950 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
              Editorial Control
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-white">Automation settings</h3>
          </div>
          <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClose} />
        </div>
        <div className="space-y-3">
          <Toggle
            label="Enable Scheduler"
            description="Allow the daily cron tick to run automatically"
            checked={schedulerEnabled}
            onChange={setSchedulerEnabled}
          />
          <Toggle
            label="Enable Auto Publish"
            description="Publish automatically after SEO passes"
            checked={autoPublish}
            onChange={setAutoPublish}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Daily Publish Time (UTC)">
              <Input type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} />
            </Field>
            <Field label="Timezone">
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
            </Field>
            <Field label="Retry Count" className="sm:col-span-2">
              <Input
                type="number"
                min={0}
                max={10}
                value={retryCount}
                onChange={(e) => setRetryCount(Number(e.target.value))}
                className="max-w-xs"
              />
            </Field>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AutomationPanel() {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [calendarEntry, setCalendarEntry] = useState<CalendarEntryLite | null>(null);
  const [providers, setProviders] = useState<ProviderLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [autoScheduling, setAutoScheduling] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [drawerStage, setDrawerStage] = useState<NormalizedStage | null>(null);
  const logsRef = useRef<HTMLDivElement | null>(null);

  const [schedulerEnabled, setSchedulerEnabled] = useState(false);
  const [autoPublish, setAutoPublish] = useState(false);
  const [publishTime, setPublishTime] = useState('09:00');
  const [timezone, setTimezone] = useState('UTC');
  const [retryCount, setRetryCount] = useState(3);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<AutomationStatus>('/api/editorial/automation');
      setStatus(data);
      setSchedulerEnabled(data.settings.scheduler_enabled);
      setAutoPublish(data.settings.auto_publish);
      setPublishTime(data.settings.publishing_time_utc);
      setTimezone(data.settings.timezone);
      setRetryCount(data.settings.automation_retry_count);
      try {
        const cal = await api.get<{ entry: CalendarEntryLite | null }>(
          `/api/editorial/calendar/day${qs({ date: data.today })}`
        );
        setCalendarEntry(cal.entry);
      } catch {
        setCalendarEntry(null);
      }
      try {
        const p = await api.get<{ providers: ProviderLite[] }>('/api/editorial/ai/providers');
        setProviders(p.providers || []);
      } catch {
        setProviders([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load automation status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      await api.patch('/api/editorial/settings', {
        scheduler_enabled: schedulerEnabled,
        auto_publish: autoPublish,
        publishing_time_utc: publishTime,
        timezone,
        automation_retry_count: retryCount,
      });
      setMessage('Automation settings saved');
      setSettingsOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const runToday = async () => {
    setRunning(true);
    setMessage('');
    setError('');
    try {
      const result = await api.post<{ ok: boolean; message: string }>('/api/editorial/automation/run-today');
      if (result.ok) setMessage(result.message || 'Pipeline completed');
      else setError(result.message || 'Pipeline stopped');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pipeline failed');
    } finally {
      setRunning(false);
      await load();
    }
  };

  const retryFailed = async () => {
    setRetrying(true);
    setMessage('');
    setError('');
    try {
      const result = await api.post<{ ok: boolean; message: string }>('/api/editorial/automation/retry');
      if (result.ok) setMessage(result.message || 'Retry completed');
      else setError(result.message || 'Retry stopped');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
      await load();
    }
  };

  const autoSchedule = async () => {
    setAutoScheduling(true);
    setMessage('');
    setError('');
    try {
      const result = await api.post<{ scheduled: unknown[]; message: string }>(
        '/api/editorial/calendar/auto-schedule',
        { days: 14 }
      );
      setMessage(result.message || `Scheduled ${result.scheduled.length} topics.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auto-schedule failed');
    } finally {
      setAutoScheduling(false);
    }
  };

  const scrollToLogs = () => {
    setAdvancedOpen(true);
    requestAnimationFrame(() => {
      logsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (loading && !status) {
    return <PageLoader label="Loading automation…" />;
  }

  if (!status) {
    return <Callout tone="rose">{error || 'Automation status unavailable.'}</Callout>;
  }

  const job = status.today_job;
  const stages = normalizeStages(status.stages || []);
  const calendarReady =
    Boolean(calendarEntry?.topic_id) && !['skipped', 'cancelled'].includes(calendarEntry?.status || '');
  const mode = automationMode(status, running);
  const health = pipelineHealth(job, stages);
  const runDisabled = running || job?.status === 'running' || !calendarReady;
  const failedStage = stages.find((s) => s.status === 'failed');
  const primaryErrorRaw =
    (failedStage && extractErrorFromStageDetail(failedStage.detail)) ||
    job?.error_message ||
    null;
  const jobUpdated = job ? new Date(job.updated_at).getTime() : 0;
  const keyApplied = status.groq_key_applied_at ?? 0;
  const staleAfterKeyChange = Boolean(primaryErrorRaw && keyApplied > 0 && jobUpdated > 0 && jobUpdated < keyApplied);
  const humanError = !staleAfterKeyChange && primaryErrorRaw ? humanizeError(primaryErrorRaw) : null;

  const providersOnline = providers.filter((p) => p.enabled && p.status_color === 'green').length;
  const providersReady = providers.filter((p) => p.enabled && p.status_color === 'yellow').length;
  const providersDisabled = providers.filter((p) => !p.enabled).length;

  let healthPoints = 100;
  const healthIssues: string[] = [];
  if (!status.settings.scheduler_enabled) {
    healthPoints -= 25;
    healthIssues.push('Scheduler off');
  }
  if (status.settings.automation_paused) {
    healthPoints -= 20;
    healthIssues.push('Automation paused');
  }
  if (status.failed_today > 0) {
    healthPoints -= 35;
    healthIssues.push(`${status.failed_today} failure today`);
  }
  if (providers.length && providersOnline === 0) {
    healthPoints -= 25;
    healthIssues.push('No providers online');
  }
  if (!calendarReady) {
    healthPoints -= 15;
    healthIssues.push('No topic today');
  }
  const healthScore = {
    score: Math.max(0, healthPoints),
    issues: healthIssues,
    label: healthPoints >= 80 ? 'Healthy' : healthPoints >= 50 ? 'Needs attention' : 'Unhealthy',
    tone: (healthPoints >= 80 ? 'emerald' : healthPoints >= 50 ? 'amber' : 'rose') as
      | 'emerald'
      | 'amber'
      | 'rose',
  };

  const recommendations: Array<{
    id: string;
    title: string;
    detail: string;
    actionLabel: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
  }> = [];

  if (!calendarReady) {
    recommendations.push({
      id: 'schedule',
      title: 'Schedule today’s topic',
      detail: 'The pipeline needs an approved calendar entry before it can run.',
      actionLabel: 'Auto-schedule',
      onClick: () => void autoSchedule(),
      loading: autoScheduling,
    });
  }
  if (job?.status === 'failed') {
    recommendations.push({
      id: 'retry',
      title: 'Retry the failed job',
      detail: humanError?.title
        ? `${humanError.title} — retry from the last failure.`
        : 'Re-run today’s pipeline from the last failure.',
      actionLabel: 'Retry failed',
      onClick: () => void retryFailed(),
      loading: retrying,
      disabled: retrying,
    });
  }
  if (humanError?.recommendations.includes('switch_provider') || humanError?.recommendations.includes('wait')) {
    recommendations.push({
      id: 'providers',
      title: humanError.recommendations.includes('wait')
        ? 'Wait or switch AI provider'
        : 'Switch AI provider',
      detail: 'Open Settings → AI Providers to enable a fallback or raise limits.',
      actionLabel: 'Open settings',
      onClick: () => setSettingsOpen(true),
    });
  }
  if (!status.settings.scheduler_enabled) {
    recommendations.push({
      id: 'scheduler',
      title: 'Turn the scheduler on',
      detail: 'Daily runs won’t start until the scheduler is enabled.',
      actionLabel: 'Edit settings',
      onClick: () => setSettingsOpen(true),
    });
  }
  if (!recommendations.length && job?.status === 'completed') {
    recommendations.push({
      id: 'done',
      title: 'Pipeline looks good',
      detail: 'Nothing to fix — refresh later or run again if you need a new draft.',
      actionLabel: 'Refresh',
      onClick: () => void load(),
    });
  }
  const topRecommendations = recommendations.slice(0, 4);

  const timeline = stages
    .filter((s) => s.at && s.status !== 'pending')
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map((s) => ({
      id: `${s.stage}-${s.at}`,
      at: s.at,
      label: s.label,
      status: s.status,
      detail:
        s.status === 'failed'
          ? humanizeError(extractErrorFromStageDetail(s.detail) || s.detail || '')?.title || 'Failed'
          : s.detail && !s.detail.trim().startsWith('{')
            ? s.detail.slice(0, 80)
            : s.status === 'ok'
              ? 'Completed'
              : s.status,
      stage: s,
    }));

  const modeMeta = {
    on: { label: 'Automation ON', tone: 'emerald' as const, hint: 'Scheduler enabled' },
    off: { label: 'Automation OFF', tone: 'neutral' as const, hint: 'Scheduler disabled' },
    paused: { label: 'Paused', tone: 'amber' as const, hint: 'Automation paused' },
    running: { label: 'Running', tone: 'sky' as const, hint: 'Pipeline in progress' },
  }[mode];

  const topicLabel =
    calendarEntry?.topic?.title ||
    status.next_topic_title ||
    (calendarEntry?.topic_id ? `Topic #${calendarEntry.topic_id}` : null);

  return (
    <div className="space-y-8 pb-24">
      <SectionHeader
        eyebrow="Daily Automation"
        title="Automation"
        description="Is it on, is today healthy, what failed, and what to do next."
      />

      {!calendarReady && (
        <Callout tone="amber" className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            No approved topic scheduled for {status.today}. Schedule one before running the pipeline.
          </span>
          <Button
            size="sm"
            variant="primary"
            icon={<Calendar className="h-3.5 w-3.5" />}
            loading={autoScheduling}
            onClick={() => void autoSchedule()}
          >
            Auto-schedule
          </Button>
        </Callout>
      )}

      {message && <Callout tone="emerald">{message}</Callout>}
      {error && !humanError && <Callout tone="rose">{error}</Callout>}

      {/* 1. Hero Status Card */}
      <GlassPanel className="relative overflow-hidden" padding="p-0">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-50 via-transparent to-teal-50/40 dark:from-white/[0.03] dark:to-teal-500/[0.04]" />
        <div className="relative grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr] lg:gap-8 lg:p-7">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={modeMeta.tone} dot>
                {modeMeta.label}
              </Badge>
              <Badge tone={health.tone} dot>
                Today · {health.label}
              </Badge>
            </div>
            <h3 className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {health.label === 'Failed'
                ? humanError?.title || 'Today’s pipeline failed'
                : health.label === 'Healthy'
                  ? 'Today’s pipeline is healthy'
                  : health.label === 'Running'
                    ? 'Pipeline is running'
                    : 'Ready when you are'}
            </h3>
            <p className="mt-1.5 max-w-xl text-sm text-slate-500 dark:text-slate-400">
              {staleAfterKeyChange
                ? 'Last failure was before the current GROQ_API_KEY was applied. Retry to test the new key.'
                : health.hint || modeMeta.hint}
              {topicLabel ? ` · ${topicLabel}` : ''}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={<Play className="h-3.5 w-3.5" />}
                loading={running}
                disabled={runDisabled}
                title={!calendarReady ? 'Schedule a topic for today first' : undefined}
                onClick={() => void runToday()}
              >
                Run Pipeline
              </Button>
              <Button variant="outline" icon={<ScrollText className="h-3.5 w-3.5" />} onClick={scrollToLogs}>
                View Logs
              </Button>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="rounded-2xl bg-white/70 px-4 py-3 dark:bg-white/[0.04]">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Next publish</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                {status.next_publish
                  ? formatWhen(status.next_publish)
                  : schedulerEnabled
                    ? '—'
                    : 'Scheduler off'}
              </dd>
            </div>
            <div className="rounded-2xl bg-white/70 px-4 py-3 dark:bg-white/[0.04]">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last run</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                {job ? formatWhen(job.updated_at) : 'Never'}
              </dd>
            </div>
            <div className="rounded-2xl bg-white/70 px-4 py-3 dark:bg-white/[0.04]">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Published today</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{status.published_today}</dd>
            </div>
            <div className="rounded-2xl bg-white/70 px-4 py-3 dark:bg-white/[0.04]">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Avg runtime</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                {formatDuration(status.avg_generation_ms)}
              </dd>
            </div>
          </dl>
        </div>
      </GlassPanel>

      {/* 2. Today's Job + 4. Humanized error */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Today’s job</h3>
          {job && <StatusPill status={job.status} />}
        </div>

        {!job ? (
          <EmptyState
            icon={Zap}
            title="No job for today"
            description="Schedule a topic, then run the pipeline to generate today’s article."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {!calendarReady && (
                  <Button size="sm" variant="primary" loading={autoScheduling} onClick={() => void autoSchedule()}>
                    Auto-schedule
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Play className="h-3.5 w-3.5" />}
                  loading={running}
                  disabled={runDisabled}
                  onClick={() => void runToday()}
                >
                  Run Pipeline
                </Button>
              </div>
            }
          />
        ) : (
          <GlassPanel>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
                <p className="mt-1 text-sm font-semibold capitalize text-slate-900 dark:text-white">{job.status}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stage</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  {currentStageLabel(job, stages)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Started</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{formatWhen(job.created_at)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Finished</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  {job.status === 'running' || job.status === 'queued' ? '—' : formatWhen(job.updated_at)}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reason</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {staleAfterKeyChange
                  ? 'Stale failure from before the current API key — retry recommended.'
                  : humanError?.reason ||
                    (job.status === 'completed'
                      ? 'Completed successfully.'
                      : job.status === 'running'
                        ? 'Pipeline is in progress.'
                        : '—')}
              </p>
            </div>

            {humanError && (
              <div className="mt-4">
                <HumanErrorCard
                  error={humanError}
                  actions={
                    <>
                      <Button size="sm" variant="primary" loading={retrying} onClick={() => void retryFailed()}>
                        Retry
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
                        Check settings
                      </Button>
                    </>
                  }
                />
              </div>
            )}

            {staleAfterKeyChange && (
              <Callout tone="neutral" className="mt-4">
                Last failure was before the current GROQ_API_KEY was applied. Retry the job to test this key — old
                rate-limit messages are hidden.
              </Callout>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                loading={retrying}
                disabled={retrying || job.status !== 'failed'}
                onClick={() => void retryFailed()}
              >
                Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronRight className="h-3.5 w-3.5" />}
                onClick={() => setDrawerStage(failedStage || stages.find((s) => s.status !== 'pending') || stages[0])}
              >
                View Details
              </Button>
            </div>
          </GlassPanel>
        )}
      </section>

      {/* 3. Horizontal Pipeline Progress */}
      <section className="space-y-3">
        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Pipeline progress</h3>
        <GlassPanel padding="p-4 sm:p-5">
          <div className="overflow-x-auto pb-1">
            <ol className="flex min-w-[640px] items-stretch gap-0">
              {stages.map((s, idx) => {
                const tone =
                  s.status === 'ok'
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200'
                    : s.status === 'failed'
                      ? 'border-rose-200 bg-rose-50/80 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200'
                      : s.status === 'skipped'
                        ? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400'
                        : 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-transparent';
                return (
                  <li key={s.stage} className="flex flex-1 items-center">
                    <button
                      type="button"
                      onClick={() => setDrawerStage(s)}
                      className={`flex w-full flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition hover:shadow-sm ${tone}`}
                    >
                      <span className="grid h-6 w-6 place-items-center">
                        {s.status === 'ok' ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : s.status === 'failed' ? (
                          <XCircle className="h-4 w-4" />
                        ) : (
                          <Clock className="h-4 w-4 opacity-60" />
                        )}
                      </span>
                      <span className="text-[11px] font-semibold leading-tight">{s.label}</span>
                      <span className="text-[10px] opacity-70">{formatDuration(s.duration_ms)}</span>
                    </button>
                    {idx < stages.length - 1 && (
                      <ArrowRight className="mx-1 h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="mt-3 text-xs text-slate-400">Click a stage for logs, duration, and errors.</p>
        </GlassPanel>
      </section>

      {/* 10. Recommendations + 9. Health + 8. Providers */}
      <div className="grid gap-5 lg:grid-cols-3">
        <GlassPanel className="lg:col-span-1">
          <div className="mb-3 flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Health</h3>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold text-slate-900 dark:text-white">{healthScore.score}</span>
            <Badge tone={healthScore.tone}>{healthScore.label}</Badge>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li className="flex justify-between gap-3">
              <span className="text-slate-400">Scheduler</span>
              <span>{status.settings.scheduler_enabled ? 'On' : 'Off'}</span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-slate-400">Failures today</span>
              <span>{status.failed_today}</span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-slate-400">Providers online</span>
              <span>
                {providers.length ? `${providersOnline}/${providers.length}` : '—'}
              </span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-slate-400">Avg runtime</span>
              <span>{formatDuration(status.avg_generation_ms)}</span>
            </li>
          </ul>
          {healthScore.issues.length > 0 && (
            <p className="mt-3 text-xs text-slate-400">{healthScore.issues.join(' · ')}</p>
          )}
        </GlassPanel>

        <GlassPanel className="lg:col-span-1">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-slate-500" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">AI Providers</h3>
          </div>
          {providers.length === 0 ? (
            <p className="text-sm text-slate-500">Provider status unavailable.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => {
                const chip =
                  !p.enabled
                    ? { tone: 'neutral' as const, label: 'Disabled' }
                    : p.status_color === 'green'
                      ? { tone: 'emerald' as const, label: 'Online' }
                      : p.status_color === 'yellow'
                        ? { tone: 'amber' as const, label: 'Ready' }
                        : { tone: 'rose' as const, label: 'Error' };
                return (
                  <Badge key={p.provider_name} tone={chip.tone} dot>
                    {p.label || p.provider_name} · {chip.label}
                  </Badge>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">
            {providersOnline} online · {providersReady} ready · {providersDisabled} disabled
          </p>
        </GlassPanel>

        <GlassPanel className="lg:col-span-1">
          <div className="mb-3 flex items-center gap-2">
            <ListTree className="h-4 w-4 text-slate-500" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Recommendations</h3>
          </div>
          {topRecommendations.length === 0 ? (
            <p className="text-sm text-slate-500">No actions needed right now.</p>
          ) : (
            <ul className="space-y-3">
              {topRecommendations.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{r.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{r.detail}</p>
                  </div>
                  <Button size="sm" variant="outline" loading={r.loading} disabled={r.disabled} onClick={r.onClick}>
                    {r.actionLabel}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>

      {/* 7. Activity Timeline */}
      <section className="space-y-3">
        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Activity</h3>
        <GlassPanel>
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500">No stage activity yet for today.</p>
          ) : (
            <ol className="space-y-0">
              {timeline.map((ev, i) => (
                <li key={ev.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < timeline.length - 1 && (
                    <span className="absolute top-3 left-[7px] h-[calc(100%-4px)] w-px bg-slate-200 dark:bg-white/10" />
                  )}
                  <span
                    className={`relative mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      ev.status === 'ok'
                        ? 'bg-emerald-500'
                        : ev.status === 'failed'
                          ? 'bg-rose-500'
                          : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setDrawerStage(ev.stage)}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {ev.label}{' '}
                        <span className="font-normal text-slate-400">
                          {ev.status === 'ok' ? 'completed' : ev.status === 'failed' ? 'failed' : ev.status}
                        </span>
                      </p>
                      <span className="text-[11px] text-slate-400">{formatTime(ev.at)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{ev.detail}</p>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </GlassPanel>
      </section>

      {/* 6. Queue */}
      <section className="space-y-3">
        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Queue</h3>
        <GlassPanel padding="p-0">
          {status.queue.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState icon={Activity} title="Queue is empty" description="Recent daily pipeline jobs will appear here." />
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-white/10">
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Topic / date</th>
                      <th className="px-5 py-3 font-semibold">Started</th>
                      <th className="px-5 py-3 font-semibold">Duration</th>
                      <th className="px-5 py-3 font-semibold">Provider</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                    {status.queue.map((q) => {
                      const dateLabel = String(q.payload_json?.publish_date || '—');
                      const qStages = Array.isArray(q.result_json?.stages)
                        ? (q.result_json.stages as Array<{ stage: string; status: string; detail?: string }>)
                        : [];
                      const failDetail = qStages.find((s) => s.status === 'failed')?.detail;
                      const provider = humanizeError(failDetail || q.error_message || '')?.provider || '—';
                      return (
                        <tr
                          key={q.id}
                          className="cursor-pointer transition-colors hover:bg-slate-50/80 dark:hover:bg-white/[0.03]"
                          onClick={() => {
                            const mapped = normalizeStages(
                              (Array.isArray(q.result_json?.stages)
                                ? q.result_json.stages
                                : []) as AutomationStatus['stages']
                            );
                            const focus =
                              mapped.find((s) => s.status === 'failed') ||
                              mapped.find((s) => s.status === 'ok') ||
                              mapped[0];
                            setDrawerStage(focus);
                          }}
                        >
                          <td className="px-5 py-3">
                            <StatusPill status={q.status} />
                          </td>
                          <td className="px-5 py-3 font-medium text-slate-800 dark:text-slate-100">
                            {formatDate(dateLabel)}
                            <span className="ml-2 text-xs font-normal text-slate-400">{dateLabel}</span>
                          </td>
                          <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{formatWhen(q.created_at)}</td>
                          <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                            {formatDuration(jobDurationMs(q))}
                          </td>
                          <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{provider}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Mobile stacked */}
              <div className="divide-y divide-slate-100 md:hidden dark:divide-white/10">
                {status.queue.map((q) => {
                  const dateLabel = String(q.payload_json?.publish_date || '—');
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className="flex w-full flex-col gap-1.5 px-5 py-4 text-left"
                      onClick={() => {
                        const mapped = normalizeStages(
                          (Array.isArray(q.result_json?.stages)
                            ? q.result_json.stages
                            : []) as AutomationStatus['stages']
                        );
                        setDrawerStage(mapped.find((s) => s.status === 'failed') || mapped[0]);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <StatusPill status={q.status} />
                        <span className="text-[11px] text-slate-400">{formatDuration(jobDurationMs(q))}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{dateLabel}</p>
                      <p className="text-xs text-slate-500">Started {formatWhen(q.created_at)}</p>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </GlassPanel>
      </section>

      {/* 5 / 15. Settings summary */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Editorial control</h3>
          <Button size="sm" variant="outline" icon={<Settings2 className="h-3.5 w-3.5" />} onClick={() => setSettingsOpen(true)}>
            Edit
          </Button>
        </div>
        <GlassPanel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Scheduler</p>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                {schedulerEnabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Timezone</p>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                {timezone} · {publishTime} UTC
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Retry</p>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{retryCount}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Auto publish</p>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                {autoPublish ? 'On' : 'Off'}
              </p>
            </div>
          </div>
        </GlassPanel>
      </section>

      {/* 11. Advanced Logs */}
      <section ref={logsRef} className="space-y-3">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Advanced logs</h3>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {advancedOpen && (
          <GlassPanel className="space-y-4">
            <p className="text-xs text-slate-500">
              Tokens, raw JSON, and stack-style stage dumps stay here — not in the primary view.
            </p>
            {job && (
              <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                <p>
                  Job ID <span className="font-semibold text-slate-700 dark:text-slate-200">#{job.id}</span>
                </p>
                <p>
                  Attempts <span className="font-semibold text-slate-700 dark:text-slate-200">{job.attempts}</span>
                </p>
                <p>
                  Duration{' '}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {formatDuration(jobDurationMs(job))}
                  </span>
                </p>
              </div>
            )}
            {stages.map((s) => (
              <div key={s.stage}>
                <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {STAGE_LABELS[s.stage] || s.stage} · {s.status}
                </p>
                {s.detail ? (
                  <TechnicalDetails raw={s.detail} label="Stage payload" />
                ) : (
                  <p className="text-xs text-slate-400">No detail</p>
                )}
              </div>
            ))}
            {job?.error_message && <TechnicalDetails raw={job.error_message} label="Job error_message" />}
            {job?.result_json && (
              <TechnicalDetails raw={JSON.stringify(job.result_json, null, 2)} label="Job result_json" />
            )}
          </GlassPanel>
        )}
      </section>

      {/* 14. Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <p className="hidden text-xs text-slate-500 sm:block">
            {modeMeta.label} · Today {health.label.toLowerCase()}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<Play className="h-3.5 w-3.5" />}
              loading={running}
              disabled={runDisabled}
              onClick={() => void runToday()}
            >
              Run Pipeline
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              loading={retrying}
              disabled={retrying || job?.status !== 'failed'}
              onClick={() => void retryFailed()}
            >
              Retry Failed
            </Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        saving={saving}
        schedulerEnabled={schedulerEnabled}
        setSchedulerEnabled={setSchedulerEnabled}
        autoPublish={autoPublish}
        setAutoPublish={setAutoPublish}
        publishTime={publishTime}
        setPublishTime={setPublishTime}
        timezone={timezone}
        setTimezone={setTimezone}
        retryCount={retryCount}
        setRetryCount={setRetryCount}
        onSave={() => void save()}
      />

      <StageDrawer stage={drawerStage} onClose={() => setDrawerStage(null)} />
    </div>
  );
}
