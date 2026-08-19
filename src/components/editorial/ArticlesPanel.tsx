import { useCallback, useEffect, useState, type ComponentType, type Key, type ReactNode } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  CloudOff,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Loader2,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError, qs, type Article, type ArticlePreview, type ResearchPreview, type Topic } from './api';
import ManualBlogEditor, { isManualArticle } from './ManualBlogEditor';
import { useEditorialJobsOptional } from './jobs/JobsProvider';
import { formatRelativeTime, topicCanGenerateDraft } from './topics/topicMeta';
import {
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
} from './ui';
import ArticleDetailPanel from './ArticleDetailPanel';
import {
  navigateArticles,
  parseArticlesRoute,
  type ArticlesRoute,
} from './admin-routes';

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
  const [source, setSource] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 24;

  const [articlesRoute, setArticlesRoute] = useState<ArticlesRoute>(() =>
    parseArticlesRoute(window.location.pathname)
  );
  const [showGenerate, setShowGenerate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [actionBusy, setActionBusy] = useState<{
    id: number;
    kind: 'publish' | 'unpublish' | 'duplicate';
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    article: Article;
    kind: 'publish' | 'unpublish';
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = qs({
        q: q.trim() || undefined,
        status: status || undefined,
        source: source || undefined,
        limit,
        offset,
      });
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
  }, [q, status, source, offset]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, source, offset]);

  useEffect(() => {
    const syncRoute = () => setArticlesRoute(parseArticlesRoute(window.location.pathname));
    syncRoute();
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  const goToArticlesList = useCallback(() => {
    navigateArticles({ view: 'list' });
    setArticlesRoute({ view: 'list' });
  }, []);

  const openArticle = useCallback((articleId: number) => {
    const route: ArticlesRoute = { view: 'detail', articleId };
    navigateArticles(route);
    setArticlesRoute(route);
  }, []);

  const openManualCreate = useCallback(() => {
    navigateArticles({ view: 'new' });
    setArticlesRoute({ view: 'new' });
  }, []);

  useEffect(() => {
    const openStored = () => {
      try {
        const raw = sessionStorage.getItem('editorial_open_article_id');
        if (raw) {
          const id = Number(raw);
          if (Number.isFinite(id)) {
            openArticle(id);
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
      if (detail?.articleId) openArticle(detail.articleId);
    };
    window.addEventListener('editorial:open-article', onOpen);
    return () => window.removeEventListener('editorial:open-article', onOpen);
  }, [openArticle]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await api.post('/api/editorial/articles/' + deleteTarget.id + '/delete', {
        confirm_slug: deleteTarget.status === 'published' ? deleteTarget.slug : undefined,
      });
      setDeleteTarget(null);
      if (deleteTarget && articlesRoute.view === 'detail' && articlesRoute.articleId === deleteTarget.id) {
        goToArticlesList();
      }
      void load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  };

  const runPublish = async (a: Article) => {
    setActionBusy({ id: a.id, kind: 'publish' });
    setActionError('');
    setActionMessage('');
    try {
      const result = await api.post<{
        ok: boolean;
        message: string;
        slug?: string;
        errors?: Array<{ message: string }>;
      }>(`/api/editorial/articles/${a.id}/publish`);
      if (!result.ok) {
        const errs = (result.errors || []).map((e) => e.message).filter(Boolean).join('; ');
        throw new Error(errs || result.message || 'Publish failed');
      }
      setActionMessage(`Published · /blog/${result.slug || a.slug}`);
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setActionBusy(null);
    }
  };

  const runUnpublish = async (a: Article) => {
    setActionBusy({ id: a.id, kind: 'unpublish' });
    setActionError('');
    setActionMessage('');
    try {
      const result = await api.post<{ ok: boolean; message: string }>(
        `/api/editorial/articles/${a.id}/unpublish`
      );
      if (!result.ok) throw new Error(result.message || 'Unpublish failed');
      setActionMessage(result.message || 'Unpublished');
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unpublish failed');
    } finally {
      setActionBusy(null);
    }
  };

  /** Duplicate as a new manual draft using the article's editorial blocks. */
  const runDuplicate = async (a: Article) => {
    setActionBusy({ id: a.id, kind: 'duplicate' });
    setActionError('');
    setActionMessage('');
    try {
      const { preview } = await api.get<{ preview: ArticlePreview }>(
        `/api/editorial/articles/${a.id}/preview`
      );
      const baseTitle = (a.seo_title || a.slug || 'Untitled').trim();
      const result = await api.post<{
        ok: boolean;
        article_id: number;
        slug: string;
      }>('/api/editorial/articles/manual', {
        seo_title: baseTitle.endsWith('(Copy)') ? baseTitle : `${baseTitle} (Copy)`,
        excerpt: a.excerpt || '',
        meta_description: a.meta_description || '',
        content_type: a.content_type,
        blocks: preview.blocks || [],
      });
      if (!result.ok || !result.article_id) throw new Error('Duplicate failed');
      setActionMessage(`Duplicated as draft · /blog/${result.slug}`);
      void load();
      openArticle(result.article_id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Duplicate failed');
    } finally {
      setActionBusy(null);
    }
  };

  if (articlesRoute.view === 'new') {
    return (
      <div className="space-y-4">
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowLeft className="h-3.5 w-3.5" />}
          onClick={goToArticlesList}
        >
          Back to articles
        </Button>
        <SectionHeader
          eyebrow="Manual"
          title="Create Manual Blog"
          description="Write, format, and publish a blog post without the AI drafting pipeline."
        />
        <ManualBlogEditor
          mode="create"
          onCancel={goToArticlesList}
          onSaved={(articleId) => {
            void load();
            openArticle(articleId);
          }}
        />
      </div>
    );
  }

  if (articlesRoute.view === 'detail') {
    return (
      <div className="space-y-4">
        <Button size="sm" variant="ghost" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={goToArticlesList}>
          Back to articles
        </Button>
        <ArticleDetailPanel
          articleId={articlesRoute.articleId}
          onChanged={() => void load()}
          onNavigateArticle={openArticle}
        />
      </div>
    );
  }

  const hasFilters = Boolean(q || status || source);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Content"
        title="Articles"
        description="Drafts flowing through research, writing, review, SEO, and publishing."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<PenLine className="h-3.5 w-3.5" />}
              onClick={openManualCreate}
            >
              Create Manual Blog
            </Button>
            <Button size="sm" variant="accent" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowGenerate(true)}>
              New Draft
            </Button>
          </div>
        }
      />

      <GlassPanel padding="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => {
                setOffset(0);
                setQ(e.target.value);
              }}
              placeholder="Search by title, slug, or excerpt..."
              className="pl-9"
            />
          </div>
          <Select
            value={source}
            onChange={(e) => {
              setOffset(0);
              setSource(e.target.value);
            }}
            className="sm:w-40"
          >
            <option value="">All sources</option>
            <option value="manual">Manual</option>
            <option value="automatic">Automatic</option>
          </Select>
          <Select
            value={status}
            onChange={(e) => {
              setOffset(0);
              setStatus(e.target.value);
            }}
            className="sm:w-44"
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

      {actionError && <Callout tone="rose">{actionError}</Callout>}

      {actionMessage && <Callout tone="emerald">{actionMessage}</Callout>}

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
            {articles.map((a) => {
              const busyKind = actionBusy?.id === a.id ? actionBusy.kind : null;
              return (
                <ArticleCard
                  key={a.id}
                  article={a}
                  readMins={readingMinutesFor(a)}
                  busyKind={busyKind}
                  onOpen={() => openArticle(a.id)}
                  onPreview={() => {
                    if (a.status === 'published') {
                      window.open(`/blog/${a.slug}`, '_blank', 'noreferrer');
                      return;
                    }
                    openArticle(a.id);
                  }}
                  onPublish={() => setConfirmAction({ article: a, kind: 'publish' })}
                  onUnpublish={() => setConfirmAction({ article: a, kind: 'unpublish' })}
                  onDuplicate={() => void runDuplicate(a)}
                  onDelete={() => {
                    setDeleteError('');
                    setDeleteTarget(a);
                  }}
                />
              );
            })}
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
            openArticle(articleId);
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

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.kind === 'publish' ? 'Publish article?' : 'Unpublish article?'}
          body={
            confirmAction.kind === 'publish' ? (
              <p>
                Publish{' '}
                <strong className="font-semibold text-slate-800 dark:text-slate-100">
                  {confirmAction.article.seo_title || confirmAction.article.slug}
                </strong>{' '}
                to the public blog at{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-white/10">
                  /blog/{confirmAction.article.slug}
                </code>
                ? The page becomes immediately available.
              </p>
            ) : (
              <p>
                Take{' '}
                <strong className="font-semibold text-slate-800 dark:text-slate-100">
                  {confirmAction.article.seo_title || confirmAction.article.slug}
                </strong>{' '}
                off the public blog? The URL{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-white/10">
                  /blog/{confirmAction.article.slug}
                </code>{' '}
                will stop working and the article returns to review.
              </p>
            )
          }
          confirmLabel={confirmAction.kind === 'publish' ? 'Publish' : 'Unpublish'}
          danger={confirmAction.kind === 'unpublish'}
          busy={actionBusy != null}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            const { article, kind } = confirmAction;
            setConfirmAction(null);
            if (kind === 'publish') void runPublish(article);
            else void runUnpublish(article);
          }}
        />
      )}
    </div>
  );
}

/** Per-status card identity — status must be readable in under a second. */
const STATUS_CARD_META: Record<
  string,
  {
    label: string;
    sub: string;
    band: string;
    strip: string;
    dot: string;
    ring: string;
    live?: boolean;
  }
> = {
  published: {
    label: 'Published',
    sub: 'Live on site',
    band: 'bg-emerald-600 dark:bg-emerald-500',
    strip: 'from-emerald-500 via-emerald-400 to-teal-400',
    dot: 'bg-white',
    ring: 'hover:border-emerald-500/70 hover:ring-emerald-500/20',
    live: true,
  },
  review: {
    label: 'In Review',
    sub: 'Awaiting approval',
    band: 'bg-sky-600 dark:bg-sky-500',
    strip: 'from-sky-500 via-sky-400 to-blue-400',
    dot: 'bg-white',
    ring: 'hover:border-sky-500/70 hover:ring-sky-500/20',
  },
  needs_manual_review: {
    label: 'Needs Manual Review',
    sub: 'Human check required',
    band: 'bg-orange-500',
    strip: 'from-orange-500 via-orange-400 to-amber-400',
    dot: 'bg-white',
    ring: 'hover:border-orange-500/70 hover:ring-orange-500/20',
  },
  draft: {
    label: 'Draft',
    sub: 'Unpublished — not live',
    band: 'bg-amber-500 dark:bg-amber-400',
    strip: 'from-amber-500 via-amber-400 to-yellow-400',
    dot: 'bg-white',
    ring: 'hover:border-amber-500/70 hover:ring-amber-500/20',
  },
  failed: {
    label: 'Failed',
    sub: 'Needs attention',
    band: 'bg-rose-600 dark:bg-rose-500',
    strip: 'from-rose-500 via-rose-400 to-red-400',
    dot: 'bg-white',
    ring: 'hover:border-rose-500/70 hover:ring-rose-500/20',
  },
  archived: {
    label: 'Archived',
    sub: 'Not active',
    band: 'bg-slate-500',
    strip: 'from-slate-400 via-slate-300 to-slate-300',
    dot: 'bg-white',
    ring: 'hover:border-slate-400/70 hover:ring-slate-400/20',
  },
};

const DEFAULT_STATUS_META = STATUS_CARD_META.archived;

const QUALITY_TEXT: Record<'emerald' | 'amber' | 'rose', string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-600 dark:text-rose-400',
};

const QUALITY_BAR: Record<'emerald' | 'amber' | 'rose', string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
};

function MetaChip({
  icon: Icon,
  children,
  title,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200/70 dark:bg-white/5 dark:text-slate-400 dark:ring-white/10"
    >
      <Icon className="h-3 w-3 shrink-0 opacity-70" />
      {children}
    </span>
  );
}

function CardAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  loading = false,
  tone = 'neutral',
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'neutral' | 'accent' | 'danger';
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400'
      : tone === 'accent'
        ? 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 dark:text-slate-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300'
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function ArticleCard({
  article: a,
  readMins,
  busyKind,
  onOpen,
  onPreview,
  onPublish,
  onUnpublish,
  onDuplicate,
  onDelete,
}: {
  key?: Key;
  article: Article;
  readMins: number | null;
  busyKind: string | null;
  onOpen: () => void;
  onPreview: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const isPublished = a.status === 'published';
  const meta = STATUS_CARD_META[a.status] || DEFAULT_STATUS_META;
  const q = a.quality_score;
  const qTone = q != null ? qualityTone(q) : null;
  const busy = busyKind != null;
  const title = a.seo_title || a.slug;

  return (
    <Card
      padding="p-0"
      className={`group relative flex flex-col overflow-hidden ring-1 ring-transparent transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-300/30 dark:hover:shadow-black/40 ${meta.ring}`}
    >
      {/* Top accent strip */}
      <div aria-hidden className={`h-1 w-full shrink-0 bg-gradient-to-r ${meta.strip}`} />

      {/* Status band — the single most visible element on the card */}
      <div
        className={`flex shrink-0 items-center justify-between gap-2 px-4 py-2.5 text-white ${meta.band}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            {meta.live && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
          </span>
          <span className="truncate text-[11px] font-extrabold uppercase tracking-wider">
            {meta.label}
          </span>
          <span className="hidden truncate text-[10px] font-semibold opacity-85 md:inline">
            · {meta.sub}
          </span>
        </div>
        <span className="shrink-0 rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums tracking-wider">
          #{a.id}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Title */}
        <button
          type="button"
          onClick={onOpen}
          className="block w-full cursor-pointer text-left"
          aria-label={`Edit ${title}`}
        >
          <h3 className="line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-slate-900 transition-colors group-hover:text-indigo-700 dark:text-white dark:group-hover:text-indigo-300">
            {title}
          </h3>
        </button>

        {/* Quality score — prominent number + track */}
        {qTone && q != null && (
          <div className="mt-4">
            <div className="flex items-center gap-2.5">
              <span
                className={`font-display text-2xl font-black leading-none tabular-nums ${QUALITY_TEXT[qTone]}`}
              >
                {q.toFixed(1)}
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${QUALITY_BAR[qTone]}`}
                  style={{ width: `${Math.max(4, Math.min(100, q))}%` }}
                />
              </div>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Quality
              </span>
            </div>
          </div>
        )}

        {/* Category / source tags */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral" className="!rounded-md !px-2 !py-0.5 !text-[10px]">
            {formatContentType(a.content_type)}
          </Badge>
          {a.source === 'manual' || isManualArticle(a) ? (
            <Badge tone="sky" className="!rounded-md !px-2 !py-0.5 !text-[10px]">
              Manual
            </Badge>
          ) : (
            <Badge tone="neutral" className="!rounded-md !px-2 !py-0.5 !text-[10px] opacity-70">
              Automatic
            </Badge>
          )}
        </div>

        {/* Metadata chips */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <MetaChip icon={FileText} title="Word count">
            {a.word_count.toLocaleString()} words
          </MetaChip>
          <MetaChip icon={Clock} title="Reading time">
            {readMins != null ? `${readMins} min read` : '— min read'}
          </MetaChip>
          <MetaChip icon={CalendarDays} title={new Date(a.updated_at).toLocaleString()}>
            {formatRelativeTime(a.updated_at)}
          </MetaChip>
        </div>

        {/* Published URL */}
        {isPublished && (
          <a
            href={`/blog/${a.slug}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            <Eye className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">/blog/{a.slug}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
          </a>
        )}

        {/* Quick actions */}
        <div className="mt-auto pt-4">
          <div className="flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 pt-2.5 dark:border-white/10">
            <div className="flex items-center gap-0.5">
              <CardAction label="Edit" icon={PenLine} onClick={onOpen} disabled={busy} />
              <CardAction label="Preview" icon={Eye} onClick={onPreview} disabled={busy} />
              {isPublished ? (
                <CardAction
                  label="Unpublish"
                  icon={CloudOff}
                  onClick={onUnpublish}
                  disabled={busy}
                  loading={busyKind === 'unpublish'}
                  tone="danger"
                />
              ) : (
                <CardAction
                  label="Publish"
                  icon={Globe}
                  onClick={onPublish}
                  disabled={busy}
                  loading={busyKind === 'publish'}
                  tone="accent"
                />
              )}
              <CardAction
                label="Duplicate"
                icon={Copy}
                onClick={onDuplicate}
                disabled={busy}
                loading={busyKind === 'duplicate'}
              />
            </div>
            <CardAction
              label="Delete"
              icon={Trash2}
              onClick={onDelete}
              disabled={busy}
              tone="danger"
            />
          </div>
        </div>
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
