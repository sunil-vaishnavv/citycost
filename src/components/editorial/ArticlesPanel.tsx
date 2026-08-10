import { useCallback, useEffect, useState, type Key } from 'react';
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError, qs, type Article, type ResearchPreview, type Topic } from './api';
import { useEditorialJobsOptional } from './jobs/JobsProvider';
import { formatRelativeTime, topicCanGenerateDraft } from './topics/topicMeta';
import {
  articleStatusCardClass,
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  GlassPanel,
  Input,
  PageLoader,
  SectionHeader,
  Select,
  StatusPill,
} from './ui';
import ArticleDetailPanel from './ArticleDetailPanel';

const STATUS_OPTIONS = [
  'draft',
  'review',
  'needs_manual_review',
  'published',
  'failed',
  'archived',
];
const WORDS_PER_MINUTE = 220;

function readingMinutesFor(article: Article): number | null {
  const words = Number(article.word_count || 0);
  if (words > 0) return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return article.reading_time_minutes != null ? Number(article.reading_time_minutes) : null;
}

function formatContentType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function qualityTone(score: number): 'emerald' | 'amber' | 'rose' {
  if (score >= 75) return 'emerald';
  if (score >= 50) return 'amber';
  return 'rose';
}

export default function ArticlesPanel() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 24;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = qs({ q: q.trim() || undefined, status: status || undefined, limit, offset });
      const result = await api.get<{ articles: Article[]; total: number }>(
        `/api/editorial/articles${query}`
      );
      setArticles(result.articles || []);
      setTotal(result.total || 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load articles');
    } finally {
      setLoading(false);
    }
  }, [q, status, offset]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, offset]);

  useEffect(() => {
    const openStored = () => {
      try {
        const raw = sessionStorage.getItem('editorial_open_article_id');
        if (raw) {
          const id = Number(raw);
          if (Number.isFinite(id)) {
            setSelectedId(id);
            sessionStorage.removeItem('editorial_open_article_id');
          }
        }
      } catch {
        /* ignore */
      }
    };
    openStored();
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ articleId: number }>).detail;
      if (detail?.articleId) setSelectedId(detail.articleId);
    };
    window.addEventListener('editorial:open-article', onOpen);
    return () => window.removeEventListener('editorial:open-article', onOpen);
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await api.post('/api/editorial/articles/' + deleteTarget.id + '/delete', {
        confirm_slug: deleteTarget.status === 'published' ? deleteTarget.slug : undefined,
      });
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      void load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  };

  if (selectedId != null) {
    return (
      <div className="space-y-4">
        <Button size="sm" variant="ghost" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => setSelectedId(null)}>
          Back to articles
        </Button>
        <ArticleDetailPanel
          articleId={selectedId}
          onChanged={() => void load()}
          onNavigateArticle={(id) => setSelectedId(id)}
        />
      </div>
    );
  }

  const hasFilters = Boolean(q || status);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Content"
        title="Articles"
        description="Drafts flowing through research, writing, review, SEO, and publishing."
        actions={
          <Button size="sm" variant="accent" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowGenerate(true)}>
            New Draft
          </Button>
        }
      />

      <GlassPanel padding="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => {
                setOffset(0);
                setQ(e.target.value);
              }}
              placeholder="Search by title, slug, or excerpt…"
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setOffset(0);
              setStatus(e.target.value);
            }}
            className="sm:w-48"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>
      </GlassPanel>

      {error && <Callout tone="rose">{error}</Callout>}

      {loading && !articles.length ? (
        <PageLoader label="Loading articles…" />
      ) : !articles.length ? (
        <EmptyState
          icon={FileText}
          title={hasFilters ? 'No articles match your filters' : 'No articles yet'}
          description={
            hasFilters
              ? 'Try clearing search or filters to see more results.'
              : 'Generate your first draft from an approved topic to get started.'
          }
          action={
            !hasFilters && (
              <Button size="sm" variant="accent" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => setShowGenerate(true)}>
                New Draft
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {articles.map((a) => (
              <ArticleCard
                key={a.id}
                article={a}
                readMins={readingMinutesFor(a)}
                onOpen={() => setSelectedId(a.id)}
                onDelete={() => {
                  setDeleteError('');
                  setDeleteTarget(a);
                }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing {articles.length ? offset + 1 : 0}–{offset + articles.length} of {total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {showGenerate && (
        <GenerateDraftModal
          onClose={() => setShowGenerate(false)}
          onGenerated={(articleId) => {
            setShowGenerate(false);
            void load();
            setSelectedId(articleId);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.status === 'published' ? 'Delete published article?' : 'Delete article?'}
          body={
            <div className="space-y-2">
              <p>
                {deleteTarget.status === 'published' ? (
                  <>
                    This will permanently remove <strong className="font-semibold text-slate-800 dark:text-slate-100">{deleteTarget.seo_title || deleteTarget.slug}</strong> from
                    the site. The public URL <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-white/10">/blog/{deleteTarget.slug}</code> will stop working.
                  </>
                ) : (
                  <>
                    Permanently delete <strong className="font-semibold text-slate-800 dark:text-slate-100">{deleteTarget.seo_title || deleteTarget.slug}</strong>? This cannot be undone.
                  </>
                )}
              </p>
              {deleteError && <p className="text-sm text-rose-600 dark:text-rose-400">{deleteError}</p>}
            </div>
          }
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          typedConfirm={deleteTarget.status === 'published' ? deleteTarget.slug : undefined}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

function ArticleCard({
  article: a,
  readMins,
  onOpen,
  onDelete,
}: {
  key?: Key;
  article: Article;
  readMins: number | null;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const isPublished = a.status === 'published';
  const statusAccent = articleStatusCardClass(a.status);

  return (
    <Card
      padding="p-0"
      className={`group overflow-hidden transition-all duration-200 hover:border-teal-500/35 hover:shadow-md hover:shadow-slate-200/60 dark:hover:border-teal-400/25 dark:hover:shadow-black/20 ${statusAccent}`}
    >
      <div className="flex flex-col px-4 py-4 sm:px-5 sm:py-[1.125rem]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <StatusPill status={a.status} emphasis={isPublished || a.status === 'needs_manual_review' || a.status === 'failed'} />
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 opacity-100 transition hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            aria-label={`Delete ${a.seo_title || a.slug}`}
            title="Delete article"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <button type="button" onClick={onOpen} className="mt-3 block w-full text-left">
          <p className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-slate-900 dark:text-white">
            {a.seo_title || a.slug}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral" className="!rounded-md !px-2 !py-0.5 !text-[10px]">
              {formatContentType(a.content_type)}
            </Badge>
            {a.quality_score != null && (
              <Badge tone={qualityTone(a.quality_score)} className="!rounded-md !px-2 !py-0.5 !text-[10px] tabular-nums">
                Quality {a.quality_score}
              </Badge>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="tabular-nums">{a.word_count.toLocaleString()} words</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>{readMins != null ? `${readMins} min read` : '— min read'}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="inline-flex items-center gap-1" title={new Date(a.updated_at).toLocaleString()}>
              <Clock className="h-3 w-3 opacity-60" />
              {formatRelativeTime(a.updated_at)}
            </span>
          </div>

          {isPublished && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">/blog/{a.slug}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
            </p>
          )}
        </button>
      </div>
    </Card>
  );
}

function GenerateDraftModal({
  onClose,
  onGenerated,
}: {
  onClose: () => void;
  onGenerated: (articleId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState<Topic | null>(null);
  const [research, setResearch] = useState<ResearchPreview | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genElapsedSec, setGenElapsedSec] = useState(0);
  const [error, setError] = useState('');
  const jobsCtx = useEditorialJobsOptional();

  const searchTopics = useCallback(async (q: string) => {
    try {
      const result = await api.get<{ topics: Topic[] }>(
        `/api/editorial/topics${qs({ q: q || undefined, limit: 15, status: undefined })}`
      );
      setTopics((result.topics || []).filter((t) => topicCanGenerateDraft(t.status)));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void searchTopics('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void searchTopics(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query, searchTopics]);

  useEffect(() => {
    if (!generating) {
      setGenElapsedSec(0);
      return;
    }
    const started = Date.now();
    setGenElapsedSec(0);
    const timer = window.setInterval(() => {
      setGenElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  const pick = async (topic: Topic) => {
    setSelected(topic);
    setResearch(null);
    setError('');
    setResearchLoading(true);
    try {
      const result = await api.get<{ research: ResearchPreview }>(
        `/api/editorial/articles/research-preview${qs({ topic_id: topic.id })}`
      );
      setResearch(result.research);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to preview research');
    } finally {
      setResearchLoading(false);
    }
  };

  const generate = async () => {
    if (!selected || !topicCanGenerateDraft(selected.status) || generating) return;
    setGenerating(true);
    setError('');
    try {
      if (jobsCtx) {
        const result = await jobsCtx.enqueueGenerate(selected.id);
        if (!result.ok || !result.jobId) {
          setError(result.message || result.error || 'Failed to queue draft');
          return;
        }
        onClose();
        return;
      }
      const result = await api.post<{
        ok: boolean;
        message: string;
        jobId?: number;
      }>('/api/editorial/articles/generate', { topic_id: selected.id });
      if (!result.ok || !result.jobId) {
        setError(result.message || 'Failed to queue draft');
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to queue draft');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="editorial-fade-in flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">Generate New Draft</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden sm:grid-cols-2">
          <div className="flex flex-col border-b border-slate-100 sm:border-b-0 sm:border-r dark:border-white/10">
            <div className="p-4 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search approved topics…" className="pl-9" />
              </div>
            </div>
            <ul className="max-h-72 flex-1 space-y-1 overflow-auto p-3 pt-1 sm:max-h-none">
              {topics.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void pick(t)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                      selected?.id === t.id
                        ? 'bg-teal-50 text-teal-900 dark:bg-teal-500/10 dark:text-teal-200'
                        : 'hover:bg-slate-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <p className="line-clamp-2 font-medium text-slate-800 dark:text-slate-100">{t.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {t.content_type} · score {t.priority_score} · {t.status}
                    </p>
                  </button>
                </li>
              ))}
              {!topics.length && <li className="py-6 text-center text-sm text-slate-400">No topics found.</li>}
            </ul>
          </div>
          <div className="flex flex-col overflow-auto p-4">
            {!selected && <p className="text-sm text-slate-400">Select a topic to preview its research brief.</p>}
            {researchLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Building research pack…
              </div>
            )}
            {research && !researchLoading && (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Intent</p>
                  <p className="mt-0.5 text-slate-700 dark:text-slate-200">{research.intent}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Target keyword</p>
                  <p className="mt-0.5 text-slate-700 dark:text-slate-200">{research.target_keyword}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Angle</p>
                  <p className="mt-0.5 text-slate-700 dark:text-slate-200">{research.article_angle}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Persona</p>
                  <p className="mt-0.5 text-slate-700 dark:text-slate-200">{research.reader_persona}</p>
                </div>
              </div>
            )}
            {generating && (
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                Queuing background draft job…
              </p>
            )}
            {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-white/10">
          <Button variant="outline" onClick={onClose} disabled={generating}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            loading={generating}
            disabled={!selected || !topicCanGenerateDraft(selected?.status || '') || generating}
            onClick={() => void generate()}
          >
            {generating ? 'Queuing…' : 'Generate Draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
