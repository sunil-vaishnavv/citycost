import { useMemo, useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, Clock } from 'lucide-react';
import ContentPageShell, {
  ContentBreadcrumb,
  ContentCtaBand,
  ContentLinkGroup,
} from './ContentPageShell';
import { RichText } from './RichText';

type Block = {
  id: string;
  type: string;
  heading?: string;
  content: unknown;
};

type LinkRec = {
  anchor: string;
  target: string;
  reason: string;
  confidence: number;
  location: string;
  link_kind: string;
};

export type BlogArticleView = {
  slug: string;
  seo_title: string;
  excerpt: string | null;
  content_type: string;
  reading_time_minutes: number | null;
  published_at: string;
  last_public_update_at: string | null;
  blocks: Block[];
  internal_links?: { recommendations?: LinkRec[]; count?: number } | null;
};

type Related = {
  slug: string;
  title: string;
  excerpt?: string | null;
  reading_time_minutes?: number | null;
};

interface Props {
  article: BlogArticleView;
  related: Related[];
  onNavigate: (path: string) => void;
}

function cleanDisplayTitle(title: string): string {
  return title
    .replace(/\s*[\(\[]\s*cert\d*[-_]?\d{0,8}[a-z]?\s*[\)\]]\s*:?\s*/gi, ': ')
    .replace(/\bcert\d{1,3}[-_\s]\d{6,8}[a-z]?\b/gi, ' ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/:\s*:/g, ':')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[:\-–—]+\s*|\s*[:\-–—]+$/g, '')
    .trim();
}

function slugifyHeading(h: string, index: number): string {
  const slug = h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return `section-${index}-${slug || 'section'}`;
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
    return String(d).slice(0, 10);
  }
}

function blockPlainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const o = item as {
            q?: string;
            a?: string;
            question?: string;
            answer?: string;
            text?: string;
            body?: string;
            content?: string;
          };
          if (o.q || o.question) return `${o.q || o.question}\n${o.a || o.answer || ''}`;
          if (typeof o.text === 'string') return o.text;
          if (typeof o.body === 'string') return o.body;
          if (typeof o.content === 'string') return o.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const o = content as { text?: string; body?: string; content?: string };
    if (typeof o.text === 'string') return o.text;
    if (typeof o.body === 'string') return o.body;
    if (typeof o.content === 'string') return o.content;
  }
  return '';
}

function parseTable(content: unknown): { headers: string[] | null; rows: string[][] } | null {
  if (!content) return null;
  if (Array.isArray(content)) {
    const rows = content.map((r) =>
      Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r)]
    );
    return rows.length ? { headers: null, rows } : null;
  }
  if (typeof content !== 'object') return null;
  const obj = content as { headers?: string[]; columns?: string[]; rows?: unknown[] };
  if (!Array.isArray(obj.rows) || !obj.rows.length) return null;
  const rows = obj.rows.map((r) =>
    Array.isArray(r)
      ? r.map((c) => String(c ?? ''))
      : r && typeof r === 'object'
        ? Object.values(r as Record<string, unknown>).map((c) => String(c ?? ''))
        : [String(r)]
  );
  const headers =
    Array.isArray(obj.headers) && obj.headers.length
      ? obj.headers.map(String)
      : Array.isArray(obj.columns) && obj.columns.length
        ? obj.columns.map(String)
        : null;
  return { headers, rows };
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-28 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-[1.75rem]"
    >
      <span className="relative inline-block pb-2.5">
        {children}
        <span
          className="absolute bottom-0 left-0 h-[3px] w-14 rounded-full bg-teal-500 sm:w-16"
          aria-hidden
        />
      </span>
    </h2>
  );
}

function FaqAccordion({
  items,
  links,
  used,
  onNavigate,
}: {
  items: Array<{ q: string; a: string }>;
  links: LinkRec[];
  used: Set<string>;
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className="bg-white dark:bg-slate-900/80">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.03] sm:px-5"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span className="text-sm font-semibold text-slate-900 dark:text-white sm:text-base">
                {item.q}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-teal-600 transition-transform dark:text-teal-400 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-1 text-[15px] leading-relaxed text-slate-600 dark:border-white/10 dark:text-slate-300 sm:px-5 sm:text-base">
                <RichText text={item.a} links={links} used={used} onNavigate={onNavigate} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function BlogArticlePage({ article, related, onNavigate }: Props) {
  const links = article.internal_links?.recommendations || [];
  const used = useMemo(() => new Set<string>(), [article.slug]);
  const title = cleanDisplayTitle(article.seo_title || article.slug);
  const showUpdated =
    article.last_public_update_at &&
    fmt(article.last_public_update_at) !== fmt(article.published_at);

  const headingMeta = useMemo(() => {
    const map = new Map<string, string>();
    let idx = 0;
    for (const b of article.blocks || []) {
      const heading = (b.heading || '').trim();
      const isToc = /^table of contents|^contents$/i.test(heading);
      if (isToc) continue;
      if (b.type === 'heading') {
        const label = heading || blockPlainText(b.content).trim();
        if (!label) continue;
        idx += 1;
        map.set(b.id, slugifyHeading(label, idx));
        continue;
      }
      if (heading && b.type !== 'intro') {
        idx += 1;
        map.set(b.id, slugifyHeading(heading, idx));
      }
    }
    return map;
  }, [article.blocks]);

  const toc = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    for (const b of article.blocks || []) {
      const id = headingMeta.get(b.id);
      if (!id) continue;
      const label =
        (b.heading || '').trim() ||
        (b.type === 'heading' ? blockPlainText(b.content).trim() : '');
      if (!label || /^table of contents|^contents$/i.test(label)) continue;
      if (/^faq$/i.test(label) && b.type === 'faq') {
        items.push({ id, label: 'FAQ' });
        continue;
      }
      items.push({ id, label });
    }
    return items;
  }, [article.blocks, headingMeta]);

  const grouped = useMemo(() => {
    const g: Record<string, LinkRec[]> = {};
    for (const l of links) (g[l.link_kind] ||= []).push(l);
    return g;
  }, [links]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <ContentPageShell>
      <ContentBreadcrumb
        onNavigate={onNavigate}
        items={[
          { label: 'Home', href: '/' },
          { label: 'Blog', href: '/blog' },
          { label: title },
        ]}
      />

      <article className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        {/* Hero */}
        <header className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-teal-50/40 px-6 py-8 sm:px-10 sm:py-10 dark:border-white/10 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950/20">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200/70 bg-white/80 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300">
            <BookOpen className="h-3.5 w-3.5" />
            CityCost Guide
          </div>
          <h1 className="max-w-4xl font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl sm:leading-tight">
            {title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
            <span>Published {fmt(article.published_at)}</span>
            {showUpdated && <span>Updated {fmt(article.last_public_update_at)}</span>}
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {article.reading_time_minutes ?? '—'} min read
            </span>
          </div>
          {article.excerpt && (
            <p className="mt-5 max-w-3xl text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
              {article.excerpt}
            </p>
          )}
        </header>

        <div className="space-y-8 px-6 py-8 sm:px-10 sm:py-10">
          {toc.length > 0 && (
            <nav
              className="rounded-2xl border border-teal-100 bg-teal-50/40 p-5 dark:border-teal-500/20 dark:bg-teal-500/5"
              aria-label="Table of contents"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-800 dark:text-teal-300">
                Table of contents
              </p>
              <ol className="mt-3 columns-1 gap-x-8 space-y-1.5 sm:columns-2">
                {toc.map((item, i) => (
                  <li key={item.id} className="break-inside-avoid">
                    <button
                      type="button"
                      onClick={() => scrollTo(item.id)}
                      className="group inline-flex max-w-full items-baseline gap-2 text-left text-sm font-medium text-slate-700 transition hover:text-teal-700 dark:text-slate-200 dark:hover:text-teal-300"
                    >
                      <span className="tabular-nums text-teal-600/80 dark:text-teal-400/80">
                        {i + 1}.
                      </span>
                      <span className="underline-offset-2 group-hover:underline">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div className="space-y-8">
            {(article.blocks || []).map((b) => {
              const heading = (b.heading || '').trim();
              const isToc = /^table of contents|^contents$/i.test(heading);
              if (isToc) return null;
              const sectionId = headingMeta.get(b.id);

              if (b.type === 'faq') {
                const items = (Array.isArray(b.content) ? b.content : [])
                  .map((item) => {
                    const o = item as {
                      q?: string;
                      a?: string;
                      question?: string;
                      answer?: string;
                    };
                    return {
                      q: (o.q || o.question || '').trim(),
                      a: (o.a || o.answer || '').trim(),
                    };
                  })
                  .filter((x) => x.q && x.a);
                return (
                  <section key={b.id} className="space-y-4">
                    <SectionHeading id={sectionId || 'faq'}>{heading || 'FAQ'}</SectionHeading>
                    <FaqAccordion
                      items={items}
                      links={links}
                      used={used}
                      onNavigate={onNavigate}
                    />
                  </section>
                );
              }

              if (b.type === 'table' || b.type === 'comparison') {
                const table = parseTable(b.content);
                return (
                  <section key={b.id} className="space-y-4">
                    {heading && sectionId && (
                      <SectionHeading id={sectionId}>{heading}</SectionHeading>
                    )}
                    {table ? (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm dark:border-white/10">
                        <table className="min-w-full border-collapse text-left text-sm">
                          {table.headers && (
                            <thead>
                              <tr className="bg-slate-900 text-white dark:bg-teal-900">
                                {table.headers.map((h) => (
                                  <th
                                    key={h}
                                    className="px-4 py-3 text-xs font-bold uppercase tracking-wide"
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                          )}
                          <tbody>
                            {table.rows.map((row, ri) => (
                              <tr
                                key={ri}
                                className={
                                  ri % 2 === 0
                                    ? 'bg-white dark:bg-slate-900'
                                    : 'bg-slate-50/80 dark:bg-white/[0.03]'
                                }
                              >
                                {row.map((cell, ci) => (
                                  <td
                                    key={ci}
                                    className={`px-4 py-3 align-top leading-relaxed text-slate-700 dark:text-slate-200 ${
                                      ci === 0 ? 'font-semibold text-slate-900 dark:text-white' : ''
                                    }`}
                                  >
                                    <RichText
                                      text={cell}
                                      links={links}
                                      used={used}
                                      onNavigate={onNavigate}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">Table unavailable.</p>
                    )}
                  </section>
                );
              }

              if (b.type === 'list') {
                const items = Array.isArray(b.content) ? b.content : [b.content];
                return (
                  <section key={b.id} className="space-y-3">
                    {heading && sectionId && (
                      <SectionHeading id={sectionId}>{heading}</SectionHeading>
                    )}
                    <ul className="space-y-2.5 pl-1">
                      {items.map((item, i) => (
                        <li
                          key={i}
                          className="flex gap-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300"
                        >
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                          <span>
                            {typeof item === 'string'
                              ? (
                                  <RichText
                                    text={item}
                                    links={links}
                                    used={used}
                                    onNavigate={onNavigate}
                                  />
                                )
                              : JSON.stringify(item)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              }

              if (b.type === 'tip' || b.type === 'warning') {
                return (
                  <aside
                    key={b.id}
                    className={`rounded-2xl border px-5 py-4 text-[15px] leading-relaxed ${
                      b.type === 'tip'
                        ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
                        : 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
                    }`}
                  >
                    <strong className="font-bold">
                      {b.type === 'tip' ? 'Tip · ' : 'Note · '}
                    </strong>
                    <RichText
                      text={blockPlainText(b.content)}
                      links={links}
                      used={used}
                      onNavigate={onNavigate}
                    />
                  </aside>
                );
              }

              if (b.type === 'heading') {
                const label = heading || blockPlainText(b.content).trim();
                if (!label || !sectionId) return null;
                return (
                  <div key={b.id}>
                    <SectionHeading id={sectionId}>{label}</SectionHeading>
                  </div>
                );
              }

              const body = blockPlainText(b.content);
              return (
                <section key={b.id} className="space-y-3">
                  {heading && b.type !== 'intro' && sectionId && (
                    <SectionHeading id={sectionId}>{heading}</SectionHeading>
                  )}
                  {body ? (
                    <p className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300 sm:text-base whitespace-pre-wrap">
                      <RichText
                        text={body}
                        links={links}
                        used={used}
                        onNavigate={onNavigate}
                      />
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      </article>

      <ContentCtaBand title="Next step">
        Verify cost signals with the{' '}
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="font-bold underline decoration-white/50 underline-offset-2 hover:decoration-white"
        >
          CityCost calculator
        </button>
        .
      </ContentCtaBand>

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900 sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700 dark:text-teal-400">
          Explore CityCost
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Keep exploring
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300 sm:text-base">
          Related comparisons, cities, and guides — real links you can open or share.
        </p>
        <div className="mt-6 space-y-7">
          {(['comparison', 'city', 'country', 'calculator'] as const).map((kind) => {
            const items = (grouped[kind] || []).filter(
              (l) => typeof l.target === 'string' && l.target.startsWith('/') && l.anchor.trim()
            );
            if (!items.length) return null;
            const label =
              kind === 'comparison'
                ? 'Related comparisons'
                : kind === 'city'
                  ? 'Related cities'
                  : kind === 'country'
                    ? 'Related countries'
                    : 'Tools';
            return (
              <div key={kind}>
                <ContentLinkGroup
                  title={label}
                  links={items.slice(0, 8).map((l) => ({
                    label: l.anchor.trim(),
                    href: l.target.trim(),
                  }))}
                  onNavigate={onNavigate}
                />
              </div>
            );
          })}
          {related.length > 0 && (
            <ContentLinkGroup
              title="More guides"
              links={related.map((r) => ({
                label: cleanDisplayTitle(r.title),
                href: `/blog/${r.slug}`,
              }))}
              onNavigate={onNavigate}
            />
          )}
        </div>
      </section>
    </ContentPageShell>
  );
}
