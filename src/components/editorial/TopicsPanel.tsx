import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Archive,
  Calendar,
  Check,
  ChevronDown,
  Filter,
  ListTree,
  MoreHorizontal,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import {
  api,
  ApiError,
  qs,
  type Cluster,
  type ResearchPreview,
  type Topic,
} from './api';
import { useEditorialJobsOptional } from './jobs/JobsProvider';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  GlassPanel,
  Input,
  MetricCard,
  PageLoader,
  SectionHeader,
  StatusPill,
} from './ui';
import { SearchableSelect } from './topics/SearchableSelect';
import { TopicCard } from './topics/TopicCard';
import {
  SCORER_VERSION_LABEL,
  STATUS_META,
  formatGeneratedDate,
  formatRelativeTime,
  loadSavedViews,
  persistSavedViews,
  topicCity,
  topicClusterLabel,
  topicCountry,
  topicIntent,
  topicKeyword,
  topicLinks,
  topicOutline,
  topicPersona,
  topicCanGenerateDraft,
  type SavedTopicView,
} from './topics/topicMeta';

const CONTENT_TYPE_OPTIONS = [
  '',
  'country_guide',
  'city_guide',
  'comparison_guide',
  'salary_guide',
  'rent_guide',
  'food_guide',
  'transportation_guide',
  'healthcare_guide',
  'tax_guide',
  'student_guide',
  'remote_worker_guide',
  'retirement_guide',
  'moving_guide',
  'budget_guide',
  'visa_guide',
  'guide',
  'checklist',
  'blog',
  'faq_hub',
];

const INTENT_OPTIONS = [
  { value: '', label: 'All intents' },
  { value: 'informational', label: 'Informational' },
  { value: 'commercial_investigation', label: 'Commercial investigation' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All priorities' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const SORT_OPTIONS = [
  { value: 'score_desc', label: 'Highest score' },
  { value: 'score_asc', label: 'Lowest score' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'recent', label: 'Recently generated' },
  { value: 'country', label: 'Country' },
  { value: 'city', label: 'City' },
  { value: 'priority', label: 'Priority' },
];

const DEFAULT_LIMIT = 50;

interface TopicStats {
  total: number;
  candidates: number;
  approved: number;
  scheduled: number;
  published: number;
  rejected: number;
  archived: number;
  average_score: number;
  highest_score: number;
  generated_today: number;
}

type ConfirmKind = 'reject' | 'archive' | 'delete' | null;

function DropdownMenu({
  open,
  onClose,
  children,
  align = 'right',
  placement = 'bottom',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
  placement?: 'bottom' | 'top';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`absolute z-40 min-w-[180px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-slate-950 ${
        placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
      } ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      {children}
    </div>
  );
}

function MenuRow({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition ${
        danger
          ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.06]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default function TopicsPanel({
  onGenerated,
  onNavigate,
}: {
  onGenerated?: (topic: Topic) => void;
  onNavigate?: (page: 'settings') => void;
}) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<TopicStats | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [contentType, setContentType] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [intent, setIntent] = useState('');
  const [cluster, setCluster] = useState('');
  const [priority, setPriority] = useState('');
  const [scoreMin, setScoreMin] = useState('');
  const [scoreMax, setScoreMax] = useState('');
  const [sort, setSort] = useState('score_desc');
  const [offset, setOffset] = useState(0);
  const [limit] = useState(DEFAULT_LIMIT);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [bulkMoreOpen, setBulkMoreOpen] = useState(false);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Topic | null>(null);
  const [research, setResearch] = useState<ResearchPreview | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftGenElapsedSec, setDraftGenElapsedSec] = useState(0);
  const jobsCtx = useEditorialJobsOptional();
  const [scheduleTopic, setScheduleTopic] = useState<Topic | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; count: number; ids?: number[] } | null>(
    null
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [autoScheduling, setAutoScheduling] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [savedViews, setSavedViews] = useState<SavedTopicView[]>([]);
  const [contextMenu, setContextMenu] = useState<{ topic: Topic; x: number; y: number } | null>(
    null
  );
  const [autoApproveOpen, setAutoApproveOpen] = useState(false);

  const listParentRef = useRef<HTMLDivElement>(null);

  const clusterMap = useMemo(() => {
    const map = new Map<number, Cluster>();
    for (const c of clusters) map.set(c.id, c);
    return map;
  }, [clusters]);

  useEffect(() => {
    if (!generatingDraft) {
      setDraftGenElapsedSec(0);
      return;
    }
    const started = Date.now();
    setDraftGenElapsedSec(0);
    const timer = window.setInterval(() => {
      setDraftGenElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generatingDraft]);

  const clusterOptions = useMemo(
    () => [
      { value: '', label: 'All clusters' },
      ...clusters
        .filter((c) => c.depth <= 2)
        .slice(0, 160)
        .map((c) => ({ value: c.slug, label: c.title })),
    ],
    [clusters]
  );

  const advancedActiveCount = useMemo(() => {
    let n = 0;
    if (city.trim()) n += 1;
    if (intent) n += 1;
    if (cluster) n += 1;
    if (priority) n += 1;
    if (scoreMin.trim()) n += 1;
    if (scoreMax.trim()) n += 1;
    if (sort !== 'score_desc') n += 1;
    return n;
  }, [city, intent, cluster, priority, scoreMin, scoreMax, sort]);

  const filterQuery = useCallback(() => {
    return qs({
      q: q.trim() || undefined,
      status: status || undefined,
      content_type: contentType || undefined,
      country: country.trim() || undefined,
      city: city.trim() || undefined,
      intent: intent || undefined,
      cluster: cluster || undefined,
      priority: priority || undefined,
      score_min: scoreMin.trim() || undefined,
      score_max: scoreMax.trim() || undefined,
      sort: sort || undefined,
      limit,
      offset,
    });
  }, [
    q,
    status,
    contentType,
    country,
    city,
    intent,
    cluster,
    priority,
    scoreMin,
    scoreMax,
    sort,
    limit,
    offset,
  ]);

  const loadStats = useCallback(async () => {
    try {
      const res = await api.get<{ stats: TopicStats }>('/api/editorial/topics/stats');
      setStats(res.stats);
    } catch {
      /* non-critical */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<{ topics: Topic[]; total: number }>(
        `/api/editorial/topics${filterQuery()}`
      );
      setTopics(result.topics || []);
      setTotal(result.total || 0);
      // Keep metric cards in sync with DB after every list refresh / delete / bulk action.
      void loadStats();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load topics');
    } finally {
      setLoading(false);
    }
  }, [filterQuery, loadStats]);

  useEffect(() => {
    setSavedViews(loadSavedViews());
    void api
      .get<{ clusters: Cluster[] }>('/api/editorial/clusters')
      .then((r) => setClusters(r.clusters || []))
      .catch(() => undefined);
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 180);
    return () => clearTimeout(t);
  }, [load]);

  const openPreview = useCallback(async (topic: Topic) => {
    setPreview(topic);
    setResearch(null);
    setResearchLoading(true);
    try {
      const result = await api.get<{ research: ResearchPreview }>(
        `/api/editorial/articles/research-preview${qs({ topic_id: topic.id })}`
      );
      setResearch(result.research);
    } catch {
      setResearch(null);
    } finally {
      setResearchLoading(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        setSelected(new Set());
        setPreview(null);
        setContextMenu(null);
        setMobileFiltersOpen(false);
        setBulkMoreOpen(false);
        setAutomationOpen(false);
        return;
      }
      if (!selected.size) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        void runBulk('approve');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setConfirm({ kind: 'reject', count: selected.size });
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        void bulkSchedule();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const rowVirtualizer = useVirtualizer({
    count: topics.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 168,
    overscan: 6,
  });

  const clearFilters = () => {
    setQ('');
    setStatus('');
    setContentType('');
    setCountry('');
    setCity('');
    setIntent('');
    setCluster('');
    setPriority('');
    setScoreMin('');
    setScoreMax('');
    setSort('score_desc');
    setOffset(0);
    setSelected(new Set());
  };

  const filterByStatus = (next: string) => {
    setOffset(0);
    setSelected(new Set());
    setStatus((prev) => (prev === next ? '' : next));
  };

  const hasFilters = Boolean(
    q ||
      contentType ||
      country ||
      city ||
      intent ||
      cluster ||
      priority ||
      scoreMin ||
      scoreMax ||
      status ||
      sort !== 'score_desc'
  );

  const emptyStats: TopicStats = {
    total: 0,
    candidates: 0,
    approved: 0,
    scheduled: 0,
    published: 0,
    rejected: 0,
    archived: 0,
    average_score: 0,
    highest_score: 0,
    generated_today: 0,
  };
  const liveStats = stats ?? emptyStats;

  const toggleOne = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setLastClickedId(id);
  };

  const shiftSelect = (id: number) => {
    if (lastClickedId == null) {
      toggleOne(id, true);
      return;
    }
    const ids = topics.map((t) => t.id);
    const a = ids.indexOf(lastClickedId);
    const b = ids.indexOf(id);
    if (a < 0 || b < 0) {
      toggleOne(id, true);
      return;
    }
    const [start, end] = a < b ? [a, b] : [b, a];
    setSelected((prev) => {
      const next = new Set(prev);
      for (let i = start; i <= end; i++) next.add(ids[i]!);
      return next;
    });
    setLastClickedId(id);
  };

  const selectPage = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of topics) {
        if (checked) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });
  };

  const selectAllFiltered = async () => {
    try {
      const full = await api.get<{ ids: number[]; total: number }>(
        `/api/editorial/topics/ids${qs({
          q: q.trim() || undefined,
          status: status || undefined,
          content_type: contentType || undefined,
          country: country.trim() || undefined,
          city: city.trim() || undefined,
          intent: intent || undefined,
          cluster: cluster || undefined,
          priority: priority || undefined,
          score_min: scoreMin.trim() || undefined,
          score_max: scoreMax.trim() || undefined,
          sort,
        })}`
      );
      setSelected(new Set(full.ids));
      setMessage(`Selected ${full.ids.length} of ${full.total} filtered topics`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to select filtered topics');
    }
  };

  const pageAllSelected = topics.length > 0 && topics.every((t) => selected.has(t.id));

  const runBulk = async (
    action: 'approve' | 'reject' | 'archive' | 'delete',
    idsOverride?: number[]
  ) => {
    const ids = idsOverride ?? [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    setError('');
    try {
      const result = await api.post<{ ok: number; failed: number; errors: string[] }>(
        '/api/editorial/topics/bulk',
        { action, ids }
      );
      setMessage(
        `Bulk ${action}: ${result.ok} ok${result.failed ? `, ${result.failed} failed` : ''}`
      );
      if (result.errors?.length) setError(result.errors.slice(0, 3).join('; '));
      setSelected(new Set());
      setConfirm(null);
      setBulkMoreOpen(false);
      await load();
      await loadStats();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Bulk ${action} failed`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSchedule = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    setError('');
    let ok = 0;
    let failed = 0;
    const start = Date.now() + 86400000;
    try {
      for (let i = 0; i < ids.length; i++) {
        const publish_date = new Date(start + i * 86400000).toISOString().slice(0, 10);
        try {
          await api.post('/api/editorial/calendar/schedule', {
            publish_date,
            topic_id: ids[i],
          });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      setMessage(`Scheduled ${ok} topics${failed ? ` (${failed} failed)` : ''}`);
      setSelected(new Set());
      setBulkMoreOpen(false);
      await load();
      await loadStats();
    } finally {
      setBulkBusy(false);
    }
  };

  const approve = async (topic: Topic) => {
    setBusyId(topic.id);
    setError('');
    try {
      await api.post(`/api/editorial/topics/${topic.id}/approve`);
      setMessage(`Approved "${topic.title}"`);
      if (preview?.id === topic.id) {
        setPreview({ ...topic, status: 'approved' });
      }
      await load();
      await loadStats();
      onGenerated?.(topic);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (topic: Topic) => {
    setBusyId(topic.id);
    setError('');
    try {
      await api.post(`/api/editorial/topics/${topic.id}/reject`);
      setMessage(`Rejected "${topic.title}"`);
      if (preview?.id === topic.id) setPreview(null);
      await load();
      await loadStats();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  const deleteOne = (topic: Topic) => {
    setConfirm({ kind: 'delete', count: 1, ids: [topic.id] });
  };

  const copyKeyword = async (topic: Topic) => {
    const kw = topicKeyword(topic);
    if (!kw) return;
    try {
      await navigator.clipboard.writeText(kw);
      setMessage(`Copied keyword “${kw}”`);
    } catch {
      setError('Could not copy keyword');
    }
  };

  const generateDraft = async (topic: Topic) => {
    if (!topicCanGenerateDraft(topic.status) || generatingDraft) return;
    setGeneratingDraft(true);
    setError('');
    setMessage('Queuing background draft job…');
    try {
      if (jobsCtx) {
        const result = await jobsCtx.enqueueGenerate(topic.id);
        if (!result.ok || !result.jobId) {
          setError(result.message || result.error || 'Failed to queue draft');
          setMessage('');
          return;
        }
        setMessage(`Draft job #${result.jobId} queued — progress continues in AI Jobs (safe to close this panel).`);
        onGenerated?.(topic);
        return;
      }
      const result = await api.post<{
        ok: boolean;
        message: string;
        jobId?: number;
        status?: string;
      }>('/api/editorial/articles/generate', { topic_id: topic.id });
      if (!result.ok || !result.jobId) {
        setError(result.message || 'Failed to queue draft');
        setMessage('');
        return;
      }
      setMessage(`Draft job #${result.jobId} queued (${result.status || 'queued'}). Watch AI Jobs in the header.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to queue draft');
      setMessage('');
    } finally {
      setGeneratingDraft(false);
    }
  };

  const generateTopics = async () => {
    setGenerating(true);
    setMessage('');
    setError('');
    try {
      const result = await api.post<{
        ok: boolean;
        topics_upserted: number;
        candidates_considered: number;
        topics_rejected: number;
        topics_skipped?: number;
        topics_pruned?: number;
      }>('/api/editorial/strategy/run', { max_candidates: 2, max_countries: 40 });
      setMessage(
        `Researched ${result.topics_upserted} unique topic${result.topics_upserted === 1 ? '' : 's'} (max 2/run). Scanned ${result.candidates_considered} ideas · skipped ${result.topics_skipped ?? 0} already researched · ${result.topics_rejected} low-quality filtered${
          result.topics_pruned ? ` · ${result.topics_pruned} weak legacy comparisons pruned` : ''
        }.`
      );
      setOffset(0);
      setStatus('candidate');
      await load();
      await loadStats();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Strategy run failed');
    } finally {
      setGenerating(false);
    }
  };

  const autoSchedule = async () => {
    setAutomationOpen(false);
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
      await loadStats();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auto-schedule failed');
    } finally {
      setAutoScheduling(false);
    }
  };

  const saveCurrentView = () => {
    setAutomationOpen(false);
    const name = window.prompt('Save view as…');
    if (!name?.trim()) return;
    const view: SavedTopicView = {
      id: `${Date.now()}`,
      name: name.trim(),
      filters: {
        q,
        status,
        contentType,
        country,
        city,
        intent,
        cluster,
        priority,
        scoreMin,
        scoreMax,
        sort,
      },
    };
    const next = [view, ...savedViews].slice(0, 24);
    setSavedViews(next);
    persistSavedViews(next);
    setMessage(`Saved view “${view.name}”`);
  };

  const applyView = (view: SavedTopicView) => {
    setQ(view.filters.q);
    setStatus(view.filters.status);
    setContentType(view.filters.contentType);
    setCountry(view.filters.country);
    setCity(view.filters.city);
    setIntent(view.filters.intent);
    setCluster(view.filters.cluster);
    setPriority(view.filters.priority);
    setScoreMin(view.filters.scoreMin);
    setScoreMax(view.filters.scoreMax);
    setSort(view.filters.sort);
    setOffset(0);
    setSelected(new Set());
  };

  const runAutoApprove = async () => {
    setAutoApproveOpen(false);
    setStatus('candidate');
    if (!scoreMin) setScoreMin('82');
    setOffset(0);
    setTimeout(async () => {
      try {
        const full = await api.get<{ ids: number[]; total: number }>(
          `/api/editorial/topics/ids${qs({
            status: 'candidate',
            content_type: contentType || undefined,
            country: country.trim() || undefined,
            score_min: scoreMin.trim() || '82',
            sort: 'score_desc',
          })}`
        );
        if (!full.ids.length) {
          setMessage('No candidates matched Auto Approve filters');
          return;
        }
        setSelected(new Set(full.ids));
        const result = await api.post<{ ok: number; failed: number }>(
          '/api/editorial/topics/bulk',
          { action: 'approve', ids: full.ids }
        );
        setMessage(`Auto-approved ${result.ok} topics (score ≥ ${scoreMin || '82'})`);
        setSelected(new Set());
        await load();
        await loadStats();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Auto approve failed');
      }
    }, 50);
  };

  const primaryFilters = (
    <>
      <div className="relative min-w-0 flex-1 lg:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={q}
          onChange={(e) => {
            setOffset(0);
            setQ(e.target.value);
          }}
          placeholder="Search topics…"
          className="pl-9 dark:bg-slate-950/80"
        />
      </div>
      <SearchableSelect
        value={status}
        onChange={(v) => {
          setOffset(0);
          setStatus(v);
        }}
        options={STATUS_META.map((s) => ({
          value: s.value,
          label: s.label,
          icon: s.icon,
        }))}
        placeholder="Status"
        className="w-full lg:w-[160px]"
      />
      <Input
        value={country}
        onChange={(e) => {
          setOffset(0);
          setCountry(e.target.value);
        }}
        placeholder="Country"
        className="w-full dark:bg-slate-950/80 lg:w-[140px]"
      />
      <SearchableSelect
        value={contentType}
        onChange={(v) => {
          setOffset(0);
          setContentType(v);
        }}
        options={CONTENT_TYPE_OPTIONS.map((c) => ({
          value: c,
          label: c ? c.replace(/_/g, ' ') : 'All content types',
        }))}
        className="w-full lg:w-[180px]"
      />
    </>
  );

  const advancedFilters = (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <Input
        value={city}
        onChange={(e) => {
          setOffset(0);
          setCity(e.target.value);
        }}
        placeholder="City"
        className="dark:bg-slate-950/80"
      />
      <SearchableSelect
        value={intent}
        onChange={(v) => {
          setOffset(0);
          setIntent(v);
        }}
        options={INTENT_OPTIONS}
      />
      <SearchableSelect
        value={cluster}
        onChange={(v) => {
          setOffset(0);
          setCluster(v);
        }}
        options={clusterOptions}
      />
      <SearchableSelect
        value={priority}
        onChange={(v) => {
          setOffset(0);
          setPriority(v);
        }}
        options={PRIORITY_OPTIONS}
      />
      <Input
        type="number"
        value={scoreMin}
        onChange={(e) => {
          setOffset(0);
          setScoreMin(e.target.value);
        }}
        placeholder="Min score"
        className="dark:bg-slate-950/80"
      />
      <Input
        type="number"
        value={scoreMax}
        onChange={(e) => {
          setOffset(0);
          setScoreMax(e.target.value);
        }}
        placeholder="Max score"
        className="dark:bg-slate-950/80"
      />
      <SearchableSelect
        value={sort}
        onChange={(v) => {
          setOffset(0);
          setSort(v);
        }}
        options={SORT_OPTIONS}
        searchable={false}
      />
      <Button
        size="sm"
        variant="ghost"
        className="justify-self-start"
        onClick={() => {
          setScoreMin('80');
          setOffset(0);
        }}
      >
        Score &gt; 80
      </Button>
    </div>
  );

  const previewKeyword = preview ? topicKeyword(preview) : null;
  const previewIntent =
    research?.intent || (preview ? topicIntent(preview) : null) || '—';
  const previewOutline =
    research?.recommended_outline?.length
      ? research.recommended_outline
      : preview
        ? topicOutline(preview)
        : [];

  return (
    <div className="relative space-y-4 pb-28">
      <SectionHeader
        eyebrow="Strategy"
        title="Topics"
        description="Cluster-based SEO topics with multi-factor scores. Bulk-approve the strongest candidates for drafting."
        actions={
          <>
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                onClick={() => setAutomationOpen((v) => !v)}
              >
                Automation
                <ChevronDown className="ml-0.5 h-3.5 w-3.5 opacity-60" />
              </Button>
              <DropdownMenu open={automationOpen} onClose={() => setAutomationOpen(false)}>
                <MenuRow
                  label="Auto Approve"
                  icon={<Zap className="h-3.5 w-3.5 opacity-50" />}
                  onClick={() => {
                    setAutomationOpen(false);
                    setAutoApproveOpen(true);
                  }}
                />
                <MenuRow
                  label={autoScheduling ? 'Scheduling…' : 'Auto Schedule'}
                  icon={<Calendar className="h-3.5 w-3.5 opacity-50" />}
                  onClick={() => void autoSchedule()}
                />
                <MenuRow
                  label="Save View"
                  icon={<Check className="h-3.5 w-3.5 opacity-50" />}
                  onClick={saveCurrentView}
                />
                {onNavigate && (
                  <MenuRow
                    label="Settings"
                    icon={<Settings2 className="h-3.5 w-3.5 opacity-50" />}
                    onClick={() => {
                      setAutomationOpen(false);
                      onNavigate('settings');
                    }}
                  />
                )}
              </DropdownMenu>
            </div>
            <Button
              size="sm"
              variant="accent"
              icon={<Wand2 className="h-3.5 w-3.5" />}
              loading={generating}
              onClick={() => void generateTopics()}
            >
              Generate Topics
            </Button>
          </>
        }
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Total Topics"
          value={liveStats.total}
          tone="neutral"
          active={!status}
          hint="Live DB count · click for all"
          onClick={() => filterByStatus('')}
        />
        <MetricCard
          label="Candidates"
          value={liveStats.candidates}
          tone="amber"
          active={status === 'candidate'}
          hint="Click to filter"
          onClick={() => filterByStatus('candidate')}
        />
        <MetricCard
          label="Approved"
          value={liveStats.approved}
          tone="emerald"
          active={status === 'approved'}
          hint="Click to filter"
          onClick={() => filterByStatus('approved')}
        />
        <MetricCard
          label="Scheduled"
          value={liveStats.scheduled}
          tone="sky"
          active={status === 'scheduled'}
          hint="Click to filter"
          onClick={() => filterByStatus('scheduled')}
        />
        <MetricCard
          label="Published"
          value={liveStats.published}
          tone="teal"
          active={status === 'published'}
          hint="Click to filter"
          onClick={() => filterByStatus('published')}
        />
        <MetricCard
          label="Rejected"
          value={liveStats.rejected}
          tone="rose"
          active={status === 'rejected'}
          hint="Click to filter"
          onClick={() => filterByStatus('rejected')}
        />
        <MetricCard
          label="Archived"
          value={liveStats.archived}
          tone="neutral"
          active={status === 'archived'}
          hint="Click to filter"
          onClick={() => filterByStatus('archived')}
        />
        <MetricCard
          label="Average Score"
          value={liveStats.total ? liveStats.average_score : 0}
          tone="indigo"
          hint="Across all topics in DB"
        />
        <MetricCard
          label="Highest Score"
          value={liveStats.total ? liveStats.highest_score : 0}
          tone="emerald"
          hint="Across all topics in DB"
        />
        <MetricCard
          label="Generated Today"
          value={liveStats.generated_today}
          tone="sky"
          hint="UTC calendar day"
        />
      </div>

      {savedViews.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {savedViews.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => applyView(v)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-teal-500 hover:text-teal-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-teal-400/50 dark:hover:text-teal-200"
            >
              {v.name}
            </button>
          ))}
        </div>
      )}

      {/* Sticky filter bar — desktop primary filters */}
      <div className="sticky top-0 z-30 -mx-1 space-y-2 bg-slate-50/90 px-1 py-2 backdrop-blur-xl dark:bg-slate-950/85">
        <GlassPanel padding="p-3 sm:p-3.5">
          {/* Mobile / tablet: search + filter drawer trigger */}
          <div className="flex flex-col gap-2.5 lg:hidden">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={q}
                  onChange={(e) => {
                    setOffset(0);
                    setQ(e.target.value);
                  }}
                  placeholder="Search topics…"
                  className="pl-9 dark:bg-slate-950/80"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                icon={<Filter className="h-3.5 w-3.5" />}
                onClick={() => setMobileFiltersOpen(true)}
              >
                Filters
                {(() => {
                  const active =
                    (status ? 1 : 0) +
                    (contentType ? 1 : 0) +
                    (country.trim() ? 1 : 0) +
                    (q.trim() ? 1 : 0) +
                    advancedActiveCount;
                  return active > 0 ? (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] text-white">
                      {active}
                    </span>
                  ) : null;
                })()}
              </Button>
            </div>
          </div>

          {/* Desktop: primary filters sticky */}
          <div className="hidden items-center gap-2.5 lg:flex">{primaryFilters}</div>

          {/* Desktop advanced filters (collapsed by default) */}
          <div className="mt-2.5 hidden lg:block">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Advanced Filters
              {advancedActiveCount > 0 && (
                <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                  {advancedActiveCount}
                </span>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 transition ${advancedOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {advancedOpen && <div className="mt-2.5 border-t border-slate-100 pt-3 dark:border-white/10">{advancedFilters}</div>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={pageAllSelected}
                onChange={(e) => selectPage(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600"
              />
              Select page
            </label>
            <Button size="sm" variant="ghost" onClick={() => void selectAllFiltered()}>
              Select all filtered ({total})
            </Button>
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <span className="ml-auto text-[11px] text-slate-400">
              {total.toLocaleString()} topics · {SCORER_VERSION_LABEL}
            </span>
          </div>
        </GlassPanel>
      </div>

      {message && <Callout tone="emerald">{message}</Callout>}
      {error && <Callout tone="rose">{error}</Callout>}

      {loading && !topics.length ? (
        <PageLoader label="Loading topics…" />
      ) : !topics.length ? (
        <EmptyState
          icon={ListTree}
          title="No topics found"
          description={
            liveStats.total > 0 && status
              ? `No “${status}” topics in this view, but ${liveStats.total.toLocaleString()} topics still exist in the database (e.g. rejected/approved). Click a metric card above to switch status, or clear filters.`
              : hasFilters
                ? 'No topics match these filters. Clear filters or generate new candidates.'
                : 'Run the strategy engine to generate scored topic candidates.'
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {hasFilters && (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
              {liveStats.rejected > 0 && status !== 'rejected' && (
                <Button size="sm" variant="outline" onClick={() => filterByStatus('rejected')}>
                  View rejected ({liveStats.rejected})
                </Button>
              )}
              <Button
                size="sm"
                variant="accent"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                loading={generating}
                onClick={() => void generateTopics()}
              >
                Generate Topics
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div
            ref={listParentRef}
            className="max-h-[min(70vh,820px)] overflow-auto rounded-2xl border border-transparent"
          >
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((row) => {
                const topic = topics[row.index]!;
                return (
                  <div
                    key={topic.id}
                    data-index={row.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${row.start}px)`,
                      paddingBottom: 12,
                    }}
                  >
                    <TopicCard
                      topic={topic}
                      clusterMap={clusterMap}
                      selected={selected.has(topic.id)}
                      busy={busyId === topic.id}
                      onToggle={toggleOne}
                      onShiftClick={shiftSelect}
                      onPreview={(t) => void openPreview(t)}
                      onApprove={(t) => void approve(t)}
                      onReject={(t) => void reject(t)}
                      onSchedule={setScheduleTopic}
                      onDelete={deleteOne}
                      onCopyKeyword={(t) => void copyKeyword(t)}
                      onContext={(t, x, y) => setContextMenu({ topic: t, x, y })}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing {topics.length ? offset + 1 : 0}–{offset + topics.length} of{' '}
              {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Sticky bulk toolbar — only when selection active */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-2xl shadow-slate-900/15 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95">
            <span className="px-1 text-xs font-bold text-slate-800 dark:text-slate-100">
              {selected.size} Topics Selected
            </span>
            <span className="hidden text-slate-300 sm:inline dark:text-slate-600">·</span>
            <Button
              size="sm"
              variant="secondary"
              icon={<Check className="h-3.5 w-3.5" />}
              loading={bulkBusy}
              onClick={() => void runBulk('approve')}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<Calendar className="h-3.5 w-3.5" />}
              loading={bulkBusy}
              onClick={() => void bulkSchedule()}
            >
              Schedule
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => setConfirm({ kind: 'reject', count: selected.size })}
            >
              Reject
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant="ghost"
                icon={<MoreHorizontal className="h-3.5 w-3.5" />}
                onClick={() => setBulkMoreOpen((v) => !v)}
              >
                More
              </Button>
              <DropdownMenu
                open={bulkMoreOpen}
                onClose={() => setBulkMoreOpen(false)}
                placement="top"
              >
                <MenuRow
                  label="Archive"
                  icon={<Archive className="h-3.5 w-3.5 opacity-50" />}
                  onClick={() => {
                    setBulkMoreOpen(false);
                    setConfirm({ kind: 'archive', count: selected.size });
                  }}
                />
                <MenuRow
                  label="Delete"
                  danger
                  icon={<Trash2 className="h-3.5 w-3.5 opacity-50" />}
                  onClick={() => {
                    setBulkMoreOpen(false);
                    setConfirm({ kind: 'delete', count: selected.size });
                  }}
                />
                <MenuRow
                  label="Clear selection"
                  onClick={() => {
                    setBulkMoreOpen(false);
                    setSelected(new Set());
                  }}
                />
              </DropdownMenu>
            </div>
          </div>
        </div>
      )}

      {/* Mobile filter drawer */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm lg:hidden">
          <button
            type="button"
            className="h-full flex-1 cursor-default"
            aria-label="Close filters"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <aside className="editorial-fade-in flex h-full w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/10">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Filters</h3>
              <Button
                size="sm"
                variant="ghost"
                icon={<X className="h-4 w-4" />}
                onClick={() => setMobileFiltersOpen(false)}
              />
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Primary
                </p>
                <SearchableSelect
                  value={status}
                  onChange={(v) => {
                    setOffset(0);
                    setStatus(v);
                  }}
                  options={STATUS_META.map((s) => ({
                    value: s.value,
                    label: s.label,
                    icon: s.icon,
                  }))}
                  placeholder="Status"
                />
                <Input
                  value={country}
                  onChange={(e) => {
                    setOffset(0);
                    setCountry(e.target.value);
                  }}
                  placeholder="Country"
                  className="dark:bg-slate-950/80"
                />
                <SearchableSelect
                  value={contentType}
                  onChange={(v) => {
                    setOffset(0);
                    setContentType(v);
                  }}
                  options={CONTENT_TYPE_OPTIONS.map((c) => ({
                    value: c,
                    label: c ? c.replace(/_/g, ' ') : 'All content types',
                  }))}
                />
              </div>
              <div className="space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Advanced
                </p>
                {advancedFilters}
              </div>
            </div>
            <div className="flex gap-2 border-t border-slate-100 p-4 dark:border-white/10">
              {hasFilters && (
                <Button size="sm" variant="outline" className="flex-1" onClick={clearFilters}>
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                onClick={() => setMobileFiltersOpen(false)}
              >
                Apply
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Preview drawer */}
      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm">
          <button
            type="button"
            className="h-full flex-1 cursor-default"
            aria-label="Close preview"
            onClick={() => setPreview(null)}
          />
          <aside className="editorial-fade-in flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-700 dark:text-teal-400">
                  Topic preview
                </p>
                <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                  {preview.title}
                </h3>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<X className="h-4 w-4" />}
                onClick={() => setPreview(null)}
              />
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill status={preview.status} />
                <Badge tone="emerald" className="!rounded-md !px-1.5 !py-0.5 !text-[10px]">
                  Score {preview.priority_score}
                </Badge>
              </div>
              <FieldBlock label="Keyword" value={previewKeyword || research?.target_keyword || '—'} />
              <FieldBlock
                label="Intent"
                value={String(previewIntent).replace(/_/g, ' ')}
              />
              <FieldBlock label="Persona" value={research?.reader_persona || topicPersona(preview) || '—'} />
              <FieldBlock
                label="Cluster"
                value={topicClusterLabel(preview, clusterMap) || '—'}
              />
              <FieldBlock
                label="Location"
                value={
                  [topicCity(preview), topicCountry(preview)].filter(Boolean).join(', ') || '—'
                }
              />
              <FieldBlock
                label="Generated"
                value={`${formatGeneratedDate(preview.created_at)} (${formatRelativeTime(preview.created_at)})`}
              />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Research summary
                </p>
                {researchLoading ? (
                  <p className="mt-1.5 text-xs text-slate-400">Loading research…</p>
                ) : (
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
                    {(
                      research?.search_questions?.length
                        ? research.search_questions
                        : preview.rationale_json || ['No rationale captured yet.']
                    )
                      .slice(0, 8)
                      .map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                  </ul>
                )}
                {research?.article_angle && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-500">Angle: </span>
                    {research.article_angle}
                  </p>
                )}
              </div>
              {previewOutline.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Outline
                  </p>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
                    {previewOutline.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ol>
                </div>
              )}
              {topicLinks(preview).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Internal links
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs text-teal-700 dark:text-teal-300">
                    {topicLinks(preview).map((l) => (
                      <li key={l} className="font-mono">
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="space-y-3 border-t border-slate-100 p-4 dark:border-white/10">
              {generatingDraft && (
                <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-200">
                  Queuing draft job…
                </p>
              )}
              {!generatingDraft && message && (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  {message}
                </p>
              )}
              {!generatingDraft && error && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
              {preview.status === 'candidate' && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Check className="h-3.5 w-3.5" />}
                  loading={busyId === preview.id}
                  onClick={() => void approve(preview)}
                >
                  Approve
                </Button>
              )}
              {topicCanGenerateDraft(preview.status) && (
                <Button
                  size="sm"
                  variant="accent"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  loading={generatingDraft}
                  disabled={generatingDraft}
                  onClick={() => void generateDraft(preview)}
                >
                  Generate Draft
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
                Close
              </Button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-[60] min-w-[160px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-slate-950"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {[
            { label: 'Preview', run: () => void openPreview(contextMenu.topic) },
            { label: 'Approve', run: () => void approve(contextMenu.topic) },
            { label: 'Schedule', run: () => setScheduleTopic(contextMenu.topic) },
            { label: 'Reject', run: () => void reject(contextMenu.topic) },
            { label: 'Select', run: () => toggleOne(contextMenu.topic.id, true) },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.06]"
              onClick={() => {
                item.run();
                setContextMenu(null);
              }}
            >
              <MoreHorizontal className="h-3 w-3 opacity-40" />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Bulk ${confirm.kind}`}
          body={`You are about to ${confirm.kind} ${confirm.count} topic${confirm.count === 1 ? '' : 's'}.`}
          confirmLabel={
            confirm.kind === 'delete' ? 'Delete' : confirm.kind === 'archive' ? 'Archive' : 'Reject'
          }
          danger={confirm.kind !== 'archive'}
          busy={bulkBusy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runBulk(confirm.kind!, confirm.ids)}
        />
      )}

      {autoApproveOpen && (
        <ConfirmDialog
          title="Auto Approve"
          body={`Approve all candidate topics matching current filters (default min score ${scoreMin || '82'}). Country / content type filters are respected.`}
          confirmLabel="Approve matching"
          busy={bulkBusy}
          onCancel={() => setAutoApproveOpen(false)}
          onConfirm={() => void runAutoApprove()}
        />
      )}

      {scheduleTopic && (
        <ScheduleModal
          topic={scheduleTopic}
          onClose={() => setScheduleTopic(null)}
          onScheduled={() => {
            setMessage(`Scheduled "${scheduleTopic.title}"`);
            setScheduleTopic(null);
            void load();
            void loadStats();
          }}
        />
      )}
    </div>
  );
}

function FieldBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="editorial-fade-in w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-slate-900">
        <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">{body}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            className="flex-1"
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({
  topic,
  onClose,
  onScheduled,
}: {
  topic: Topic;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [date, setDate] = useState(tomorrow);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/api/editorial/calendar/schedule', {
        publish_date: date,
        topic_id: topic.id,
        notes: notes || undefined,
      });
      onScheduled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Scheduling failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="editorial-fade-in w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900 p-5">
        <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
          Schedule Topic
        </h3>
        <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{topic.title}</p>
        <div className="mt-4 space-y-3">
          <Field label="Publish date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Editorial notes…"
            />
          </Field>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" loading={busy} onClick={() => void submit()}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
