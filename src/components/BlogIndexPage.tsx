import { useEffect, useState } from 'react';
import { BookOpen, Clock } from 'lucide-react';
import ContentPageShell, {
  ContentBreadcrumb,
  ContentCard,
  ContentCtaBand,
  ContentHero,
} from './ContentPageShell';

type BlogListItem = {
  slug: string;
  seo_title: string;
  excerpt: string | null;
  content_type: string;
  reading_time_minutes: number | null;
  published_at: string;
  last_public_update_at: string | null;
};

interface Props {
  onNavigate: (path: string) => void;
}

function fmt(d: string | null | undefined): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d.slice(0, 10);
  }
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[\(\[]\s*cert\d*[-_]?\d{0,8}[a-z]?\s*[\)\]]\s*:?\s*/gi, ': ')
    .replace(/\bcert\d{1,3}[-_\s]\d{6,8}[a-z]?\b/gi, ' ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/:\s*:/g, ':')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[:\-–—]+\s*|\s*[:\-–—]+$/g, '')
    .trim();
}

export default function BlogIndexPage({ onNavigate }: Props) {
  const [articles, setArticles] = useState<BlogListItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/blog?page=${page}&limit=12`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setArticles(d.articles || []);
        setPages(d.pages || 1);
        setError('');
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load guides.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <ContentPageShell>
      <ContentBreadcrumb
        onNavigate={onNavigate}
        items={[{ label: 'Home', href: '/' }, { label: 'Blog' }]}
      />

      <ContentHero
        eyebrow="CityCost Guides"
        icon={<BookOpen className="h-3.5 w-3.5" />}
        title="Cost of Living Guides & Insights"
        intro="Practical, data-backed guides on city costs, relocation budgeting, and comparisons — built on CityCost indexes and tools."
      />

      {loading && (
        <p className="text-sm font-medium text-slate-500">Loading guides…</p>
      )}
      {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {articles.map((a) => {
          const showUpdated =
            a.last_public_update_at &&
            fmt(a.last_public_update_at) !== fmt(a.published_at);
          const title = cleanTitle(a.seo_title);
          return (
            <article
              key={a.slug}
              className="flex flex-col rounded-[1.5rem] border border-slate-200/80 bg-white p-5 shadow-sm transition hover:border-teal-200 hover:shadow-md dark:border-white/10 dark:bg-slate-900 dark:hover:border-teal-500/30 sm:p-6"
            >
              <button
                type="button"
                onClick={() => onNavigate(`/blog/${a.slug}`)}
                className="w-full text-left"
              >
                <h2 className="font-display text-lg font-bold tracking-tight text-slate-900 transition hover:text-teal-700 dark:text-white dark:hover:text-teal-300">
                  {title}
                </h2>
              </button>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-slate-400">
                <span>Published {fmt(a.published_at)}</span>
                {showUpdated && <span>Updated {fmt(a.last_public_update_at)}</span>}
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {a.reading_time_minutes ?? '—'} min
                </span>
                <span className="capitalize">{a.content_type.replace(/_/g, ' ')}</span>
              </div>
              {a.excerpt && (
                <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {a.excerpt}
                </p>
              )}
              <button
                type="button"
                onClick={() => onNavigate(`/blog/${a.slug}`)}
                className="mt-4 self-start text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300"
              >
                Read guide →
              </button>
            </article>
          );
        })}
      </div>

      {!loading && !articles.length && !error && (
        <ContentCard>
          <p className="text-sm text-slate-500">No published guides yet.</p>
        </ContentCard>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-40 dark:border-white/10"
          >
            Previous
          </button>
          <span className="text-xs font-bold text-slate-500">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-40 dark:border-white/10"
          >
            Next
          </button>
        </div>
      )}

      <ContentCtaBand title="Ready to compare cities?">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="font-bold underline decoration-white/50 underline-offset-2 hover:decoration-white"
        >
          Open the CityCost calculator →
        </button>
      </ContentCtaBand>
    </ContentPageShell>
  );
}
