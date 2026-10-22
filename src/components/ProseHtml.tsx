import type { ReactNode } from 'react';
import { isValidSiteHref } from '../../lib/editorial-engine/blog/linkify-paths.js';

const LINK_CLASS =
  'font-semibold text-teal-700 underline decoration-teal-400/70 underline-offset-2 transition hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-200';

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'a',
  'ul',
  'ol',
  'li',
  'h3',
  'h4',
  'blockquote',
  'span',
  'img',
]);

function sanitizeNode(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    return [...el.childNodes].map((c, i) => sanitizeNode(c, i));
  }
  if (tag === 'br') return <br key={key} />;
  if (tag === 'img') {
    const src = el.getAttribute('src') || '';
    const alt = el.getAttribute('alt') || '';
    if (!src.startsWith('/') && !src.startsWith('https://')) return null;
    return (
      <img
        key={key}
        src={src}
        alt={alt}
        className="my-4 max-w-full rounded-xl border border-slate-200 dark:border-white/10"
        loading="lazy"
      />
    );
  }
  if (tag === 'a') {
    const href = el.getAttribute('href') || '';
    if (!isValidSiteHref(href)) return el.textContent;
    const external = href.startsWith('http');
    return (
      <a
        key={key}
        href={href}
        className={LINK_CLASS}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {[...el.childNodes].map((c, i) => sanitizeNode(c, i))}
      </a>
    );
  }
  const children = [...el.childNodes].map((c, i) => sanitizeNode(c, i));
  const cls =
    tag === 'blockquote'
      ? 'my-4 border-l-4 border-teal-400 pl-4 italic text-slate-600 dark:text-slate-300'
      : tag === 'h3'
        ? 'mt-6 mb-2 text-xl font-bold text-slate-900 dark:text-white'
        : tag === 'h4'
          ? 'mt-4 mb-2 text-lg font-semibold text-slate-900 dark:text-white'
          : tag === 'ul'
            ? 'my-3 list-disc space-y-1 pl-5'
            : tag === 'ol'
              ? 'my-3 list-decimal space-y-1 pl-5'
              : tag === 'li'
                ? 'leading-relaxed'
                : undefined;
  const Tag = (tag as any) || 'div';
  return (
    <Tag key={key} className={cls}>
      {children}
    </Tag>
  );
}

/** Safely render limited HTML from manual rich-text paragraphs. */
export function ProseHtml({ html }: { html: string }): ReactNode {
  if (!html?.trim()) return null;
  if (typeof DOMParser === 'undefined') {
    return <span>{html.replace(/<[^>]+>/g, '')}</span>;
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;
  if (!root) return null;
  return [...root.childNodes].map((n, i) => sanitizeNode(n, i));
}
