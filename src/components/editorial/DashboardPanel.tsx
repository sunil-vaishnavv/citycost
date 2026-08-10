import { useCallback, useEffect, useState } from 'react';
import {
  ActivitySquare,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  FileText,
  Gauge,
  ListTodo,
  Play,
  RefreshCw,
  Rocket,
  Shield,
  Sparkles,
  Timer,
  Wrench,
  XCircle,
} from 'lucide-react';
import { api, ApiError, type DashboardData } from './api';
import {
  Badge,
  Button,
  Callout,
  GlassPanel,
  MetricCard,
  PageLoader,
  ScoreBar,
  SectionHeader,
  Skeleton,
} from './ui';
import type { AdminPage } from './EditorialAdminApp';

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function DashboardPanel({ onNavigate }: { onNavigate: (page: AdminPage) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [obsLoading, setObsLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Core first (no heavy obs compute) so count cards paint quickly.
      const result = await api.get<DashboardData>('/api/editorial/dashboard');
      setData(result);
      setLoading(false);

      if (result.observability) return;

      setObsLoading(true);
      try {
        const obs = await api.get<{ observability: NonNullable<DashboardData['observability']> }>(
          '/api/editorial/dashboard/observability'
        );
        setData((prev) => (prev ? { ...prev, observability: obs.observability } : prev));
      } catch {
        // Charts are optional; core dashboard already painted.
      } finally {
        setObsLoading(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load dashboard');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <PageLoader label="Loading editorial dashboard…" />
      </div>
    );
  }

  if (!data) {
    return (
      <Callout tone="rose" className="flex items-center justify-between gap-3">
        <span>{error || 'Unable to load dashboard.'}</span>
        <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load()}>
          Retry
        </Button>
      </Callout>
    );
  }

  const { health, counts, settings_summary, automation, observability } = data;
  const healthTone = health.ok ? 'emerald' : health.state === 'misconfigured' ? 'amber' : 'rose';
  const obs = observability;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Overview"
        title="Editorial Dashboard"
        description="A live snapshot of content strategy, drafting, and daily automation health."
        actions={
          <>
            <Badge tone={healthTone} dot>
              {health.ok ? 'System healthy' : health.state}
            </Badge>
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load()}>
              Refresh
            </Button>
          </>
        }
      />

      {!health.ok && (
        <Callout tone={health.state === 'misconfigured' ? 'amber' : 'rose'} className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{health.message}</span>
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button type="button" onClick={() => onNavigate('articles')} className="text-left">
          <MetricCard icon={FileText} label="Draft Articles" value={counts.articles_draft} tone="amber" hint="Awaiting review" />
        </button>
        <button type="button" onClick={() => onNavigate('articles')} className="text-left">
          <MetricCard icon={CheckCircle2} label="Published" value={counts.articles_published} tone="emerald" hint="Live on the blog" />
        </button>
        <button type="button" onClick={() => onNavigate('articles')} className="text-left">
          <MetricCard icon={XCircle} label="Failed" value={counts.articles_failed} tone="rose" hint="Needs attention" />
        </button>
        <button type="button" onClick={() => onNavigate('topics')} className="text-left">
          <MetricCard icon={ListTodo} label="Topics" value={counts.topics} tone="sky" hint="In the strategy pipeline" />
        </button>
        <button type="button" onClick={() => onNavigate('topics')} className="text-left">
          <MetricCard icon={CalendarClock} label="Calendar Upcoming" value={counts.calendar_upcoming} tone="indigo" hint="Scheduled publishes" />
        </button>
        <button type="button" onClick={() => onNavigate('automation')} className="text-left">
          <MetricCard icon={ActivitySquare} label="Jobs Queued" value={counts.jobs_queued} tone="neutral" hint="Automation queue" />
        </button>
        <button type="button" onClick={() => onNavigate('topics')} className="text-left">
          <MetricCard icon={Gauge} label="Open Content Gaps" value={counts.content_gaps_open} tone="teal" hint="Opportunities detected" />
        </button>
        <button type="button" onClick={() => onNavigate('automation')} className="text-left">
          <MetricCard
            icon={Rocket}
            label="Avg. Generation"
            value={formatDuration(automation?.avg_generation_ms)}
            tone="neutral"
            hint="Per article, recent runs"
          />
        </button>
      </div>

      {obsLoading && !obs && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}

      {obs && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard icon={Shield} label="Avg Confidence" value={obs.avg_confidence || '—'} tone="teal" hint="Last 30 days" />
          <MetricCard
            icon={DollarSign}
            label="Avg AI Cost"
            value={obs.avg_ai_cost_usd != null ? `$${obs.avg_ai_cost_usd.toFixed(4)}` : '—'}
            tone="amber"
            hint="Per request avg"
          />
          <MetricCard
            icon={Wrench}
            label="Revision Success"
            value={`${obs.revision_success_rate}%`}
            tone="emerald"
            hint="Sessions that improved"
          />
          <MetricCard
            icon={AlertTriangle}
            label="Manual Review Rate"
            value={`${obs.manual_review_rate}%`}
            tone="rose"
            hint="Of revised articles"
          />
          <MetricCard icon={Gauge} label="Avg Quality" value={obs.avg_quality_score || '—'} tone="sky" hint="Quality report scores" />
          <MetricCard
            icon={Timer}
            label="Avg Publish Time"
            value={obs.avg_publish_time_hours != null ? `${obs.avg_publish_time_hours}h` : '—'}
            tone="indigo"
            hint="Created → published"
          />
        </div>
      )}

      {obs && (
        <div className="grid gap-5 lg:grid-cols-2">
          <GlassPanel>
            <h3 className="mb-3 font-display text-sm font-bold text-slate-900 dark:text-white">
              Daily Quality / Confidence
            </h3>
            <div className="space-y-2">
              {(obs.daily_quality.slice(-7).length ? obs.daily_quality.slice(-7) : []).map((d) => {
                const conf = obs.daily_confidence.find((c) => c.day === d.day);
                return (
                  <div key={d.day} className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>{d.day}</span>
                      <span>
                        Q {d.avg_score}
                        {conf ? ` · C ${conf.avg_confidence}` : ''}
                      </span>
                    </div>
                    <ScoreBar label="Quality" value={d.avg_score} />
                    {conf && <ScoreBar label="Confidence" value={conf.avg_confidence} />}
                  </div>
                );
              })}
              {!obs.daily_quality.length && (
                <p className="text-sm text-slate-500">No quality reports in the last 30 days.</p>
              )}
            </div>
          </GlassPanel>
          <GlassPanel>
            <h3 className="mb-3 font-display text-sm font-bold text-slate-900 dark:text-white">
              Daily Cost & Provider Usage
            </h3>
            <div className="mb-4 space-y-1.5">
              {obs.daily_cost.slice(-7).map((d) => (
                <div key={d.day} className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                  <span>{d.day}</span>
                  <span>
                    ${d.cost_usd.toFixed(4)} · {d.requests} req
                  </span>
                </div>
              ))}
              {!obs.daily_cost.length && (
                <p className="text-sm text-slate-500">No AI usage logged yet.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {obs.provider_usage.slice(0, 6).map((p) => (
                <div key={p.provider}>
                  <MiniStat
                    label={p.provider}
                    value={`${p.requests} · ${p.success_rate}% · $${p.cost_usd.toFixed(3)}`}
                  />
                </div>
              ))}
            </div>
          </GlassPanel>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <GlassPanel>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Today's Automation</h3>
            <Button size="sm" variant="secondary" onClick={() => onNavigate('automation')}>
              Open Automation
            </Button>
          </div>
          {!automation ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Automation status unavailable.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="Published Today" value={automation.published_today} />
                <MiniStat label="Failed Today" value={automation.failed_today} />
                <MiniStat
                  label="Next Publish"
                  value={automation.next_publish ? formatWhen(automation.next_publish) : '—'}
                />
                <MiniStat label="Job Status" value={automation.today_job?.status || 'none'} />
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.03]">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Next up
                </p>
                <p className="mt-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {automation.next_topic_title || 'No topic scheduled yet'}
                </p>
              </div>
              {!automation.next_topic_title && (
                <Button size="sm" variant="accent" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => onNavigate('topics')}>
                  Auto-schedule topics
                </Button>
              )}
              {automation.today_job?.status !== 'completed' && (
                <Button size="sm" variant="outline" icon={<Play className="h-3.5 w-3.5" />} onClick={() => onNavigate('automation')}>
                  Run today's pipeline
                </Button>
              )}
            </div>
          )}
        </GlassPanel>

        <GlassPanel>
          <h3 className="mb-4 font-display text-sm font-bold text-slate-900 dark:text-white">Configuration Snapshot</h3>
          <div className="space-y-3">
            <ScoreBar label="Automation retry budget" value={Math.min(100, settings_summary.automation_retry_count * 20)} />
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">Scheduler</span>
              <span className="text-right font-medium text-slate-800 dark:text-slate-100">
                {settings_summary.scheduler_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className="text-slate-500 dark:text-slate-400">Auto-publish</span>
              <span className="text-right font-medium text-slate-800 dark:text-slate-100">
                {settings_summary.auto_publish ? 'On' : 'Off'}
              </span>
              <span className="text-slate-500 dark:text-slate-400">Paused</span>
              <span className="text-right font-medium text-slate-800 dark:text-slate-100">
                {settings_summary.automation_paused ? 'Yes' : 'No'}
              </span>
              <span className="text-slate-500 dark:text-slate-400">Timezone</span>
              <span className="text-right font-medium text-slate-800 dark:text-slate-100">
                {settings_summary.timezone}
              </span>
              <span className="text-slate-500 dark:text-slate-400">Publish Time (UTC)</span>
              <span className="text-right font-medium text-slate-800 dark:text-slate-100">
                {settings_summary.publishing_time_utc}
              </span>
              <span className="text-slate-500 dark:text-slate-400">Writer Model</span>
              <span className="truncate text-right font-medium text-slate-800 dark:text-slate-100">
                {settings_summary.writer_model}
              </span>
              <span className="text-slate-500 dark:text-slate-400">Reviewer Model</span>
              <span className="truncate text-right font-medium text-slate-800 dark:text-slate-100">
                {settings_summary.reviewer_model}
              </span>
              <span className="text-slate-500 dark:text-slate-400">Articles / Day</span>
              <span className="text-right font-medium text-slate-800 dark:text-slate-100">
                {settings_summary.articles_per_day}
              </span>
            </div>
            <Button size="sm" variant="secondary" className="w-full" onClick={() => onNavigate('settings')}>
              Edit Settings
            </Button>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.03]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}
