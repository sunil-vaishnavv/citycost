import type { ReactNode } from 'react';
import { RichText } from '../../RichText';
import { ProseHtml } from '../../ProseHtml';
import { containsHtml, listItemsFromContent, blockHeadingLevel, blockHeadingText } from '../manual-html-blocks';

export function normHeading(h: string): string {
  return h.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function sectionAnchor(heading: string, index: number): string {
  const slug = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return `admin-section-${index}-${slug || 'section'}`;
}

export function isTocBlock(block: {
  type: string;
  heading?: string | null;
  content?: unknown;
}): boolean {
  return (
    /table of contents|^contents$/i.test(block.heading || '') ||
    (block.type === 'list' &&
      Array.isArray(block.content) &&
      /table of contents|^contents$/i.test(block.heading || 'Table of contents'))
  );
}

export function shouldShowHeading(
  block: { type: string; heading?: string | null; content?: unknown },
  index: number,
  blocks: Array<{ type: string; heading?: string | null; content?: unknown }>
): boolean {
  if (block.type === 'heading') {
    const label =
      (typeof block.heading === 'string' && block.heading) ||
      (typeof block.content === 'string' ? block.content : '');
    return Boolean(label?.trim());
  }
  if (!block.heading?.trim()) return false;
  if (isTocBlock(block)) return true;
  const prev = blocks[index - 1];
  if (prev?.type === 'heading') {
    const prevLabel =
      (typeof prev.heading === 'string' && prev.heading) ||
      (typeof prev.content === 'string' ? prev.content : '');
    if (normHeading(prevLabel || '') === normHeading(block.heading)) return false;
  }
  return true;
}

export function headingLabel(block: {
  type: string;
  heading?: string | null;
  content?: unknown;
}): string {
  if (typeof block.heading === 'string' && block.heading.trim()) return block.heading.trim();
  if (block.type === 'heading') {
    const fromObj = blockHeadingText(block as { type: string; heading?: string; content?: unknown });
    if (fromObj) return fromObj;
    if (typeof block.content === 'string') return block.content.trim();
  }
  return '';
}

export function previewHeadingLevel(block: {
  type: string;
  heading?: string | null;
  content?: unknown;
}): number {
  if (block.type === 'heading') {
    return blockHeadingLevel(block as { type: string; heading?: string; content?: unknown });
  }
  return 2;
}

export function PreviewHeading({
  block,
  className,
}: {
  block: { type: string; heading?: string | null; content?: unknown };
  className?: string;
}) {
  const label = headingLabel(block);
  if (!label) return null;
  const level = previewHeadingLevel(block);
  const cls =
    className ||
    (level === 3
      ? 'mb-2 text-lg font-semibold text-slate-900 dark:text-white'
      : level === 4
        ? 'mb-2 text-base font-semibold text-slate-900 dark:text-white'
        : 'mb-2 font-display text-xl font-semibold text-slate-900 dark:text-white');
  if (level === 3) return <h3 className={cls}>{label}</h3>;
  if (level === 4) return <h4 className={cls}>{label}</h4>;
  return <h2 className={cls}>{label}</h2>;
}

function RenderFaq({ content }: { content: unknown }) {
  const items: Array<{ q: string; a: string }> = [];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const o = item as { q?: string; a?: string; question?: string; answer?: string };
      const q = (o.q || o.question || '').trim();
      const a = (o.a || o.answer || '').trim();
      if (q) items.push({ q, a });
    }
  } else if (content && typeof content === 'object') {
    const o = content as { items?: unknown; faqs?: unknown };
    const list = Array.isArray(o.items) ? o.items : Array.isArray(o.faqs) ? o.faqs : null;
    if (list) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const f = item as { q?: string; a?: string; question?: string; answer?: string };
        const q = (f.q || f.question || '').trim();
        const a = (f.a || f.answer || '').trim();
        if (q) items.push({ q, a });
      }
    }
  }
  if (!items.length) {
    return <p className="text-slate-500 dark:text-slate-400">No FAQ items.</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.q}
          className="rounded-xl border border-slate-100 px-3 py-2.5 dark:border-white/10"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Question</p>
          <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">{item.q}</p>
          <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Answer</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
            {item.a ? <RichText text={item.a} /> : '—'}
          </p>
        </div>
      ))}
    </div>
  );
}

function RenderTable({ content }: { content: unknown }) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return <p className="text-slate-500 dark:text-slate-400">Table data unavailable.</p>;
  }
  const t = content as { headers?: unknown; rows?: unknown; columns?: unknown };
  const headers = Array.isArray(t.headers)
    ? t.headers.map(String)
    : Array.isArray(t.columns)
      ? t.columns.map(String)
      : [];
  const rows = Array.isArray(t.rows)
    ? t.rows.map((r) =>
        Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : [String(r)]
      )
    : [];
  if (!headers.length && !rows.length) {
    return <p className="text-slate-500 dark:text-slate-400">Empty table.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
      <table className="min-w-full border-collapse text-left text-[13px]">
        {headers.length > 0 && (
          <thead className="bg-slate-50 dark:bg-white/[0.04]">
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-800 dark:border-white/10 dark:text-slate-100"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`r-${i}`}
              className="odd:bg-white even:bg-slate-50/70 dark:odd:bg-transparent dark:even:bg-white/[0.02]"
            >
              {row.map((cell, j) => (
                <td
                  key={`c-${i}-${j}`}
                  className="border-b border-slate-100 px-3 py-2 text-slate-700 dark:border-white/5 dark:text-slate-300"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenderComparison({ content }: { content: unknown }) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return <p className="text-slate-500 dark:text-slate-400">Comparison unavailable.</p>;
  }
  const c = content as { left?: string; right?: string; points?: unknown; note?: string };
  const points = Array.isArray(c.points) ? c.points.map(String) : [];
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Left</p>
          <p className="font-semibold text-slate-900 dark:text-white">{c.left || '—'}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Right</p>
          <p className="font-semibold text-slate-900 dark:text-white">{c.right || '—'}</p>
        </div>
      </div>
      {points.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-700 dark:text-slate-300">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {c.note && <p className="text-[12px] text-slate-500 dark:text-slate-400">{c.note}</p>}
    </div>
  );
}

function RenderTocList({
  content,
  headingToAnchor,
}: {
  content: unknown;
  headingToAnchor: Map<string, string>;
}) {
  const items = Array.isArray(content) ? content.map(String) : [];
  if (!items.length) return null;
  return (
    <nav aria-label="Table of contents">
      <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-teal-800 dark:text-teal-300">
        {items.map((item) => {
          const anchor = headingToAnchor.get(normHeading(item));
          if (anchor) {
            return (
              <li key={item}>
                <a href={`#${anchor}`} className="underline-offset-2 hover:underline">
                  {item}
                </a>
              </li>
            );
          }
          return <li key={item}>{item}</li>;
        })}
      </ol>
    </nav>
  );
}

export function RenderBlockBody({
  block,
  headingToAnchor,
}: {
  block: { type: string; heading?: string | null; content?: unknown };
  headingToAnchor: Map<string, string>;
}): ReactNode {
  if (block.type === 'heading') return null;
  if (isTocBlock(block)) {
    return <RenderTocList content={block.content} headingToAnchor={headingToAnchor} />;
  }
  if (block.type === 'faq') return <RenderFaq content={block.content} />;
  if (block.type === 'table') return <RenderTable content={block.content} />;
  if (block.type === 'comparison') return <RenderComparison content={block.content} />;
  if (block.type === 'list') {
    const { items, ordered } = listItemsFromContent(block.content);
    if (!items.length) return null;
    const Tag = ordered ? 'ol' : 'ul';
    const listClass = ordered
      ? 'list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300'
      : 'list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300';
    return (
      <Tag className={listClass}>
        {items.map((item, i) => (
          <li key={i}>
            {containsHtml(item) ? <ProseHtml html={item} /> : item}
          </li>
        ))}
      </Tag>
    );
  }
  if (typeof block.content === 'string') {
    if (containsHtml(block.content)) {
      return (
        <div className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
          <ProseHtml html={block.content} />
        </div>
      );
    }
    return (
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
        {block.content}
      </div>
    );
  }
  if (Array.isArray(block.content)) {
    return (
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-700 dark:text-slate-300">
        {block.content.map((item, i) => (
          <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
        ))}
      </ul>
    );
  }
  return <p className="text-slate-500 dark:text-slate-400">Unsupported block content.</p>;
}

export function formatUsd(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(3)}`;
}

export function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-slate-800 dark:text-slate-100">{value || '—'}</p>
    </div>
  );
}
