import type { ReactNode } from 'react';
import {
  isValidSiteHref,
  splitBarePaths,
  type PathPart,
} from '../../lib/editorial-engine/blog/linkify-paths.js';

export type RichLinkRec = {
  anchor: string;
  target: string;
};

const LINK_CLASS =
  'font-semibold text-teal-700 underline decoration-teal-400/70 underline-offset-2 transition hover:text-teal-900 hover:decoration-teal-600 dark:text-teal-300 dark:hover:text-teal-200';

function InlineLink({
  href,
  children,
  onNavigate,
}: {
  href: string;
  children: ReactNode;
  onNavigate?: (path: string) => void;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (href.startsWith('http') || href.startsWith('mailto:') || !onNavigate) return;
        e.preventDefault();
        onNavigate(href);
      }}
      className={LINK_CLASS}
    >
      {children}
    </a>
  );
}

function partsToNodes(
  parts: PathPart[],
  onNavigate: ((path: string) => void) | undefined,
  keyBase: string
): ReactNode[] {
  return parts.map((p, i) =>
    p.type === 'link' && p.href ? (
      <span key={`${keyBase}-l-${i}`}>
        <InlineLink href={p.href} onNavigate={onNavigate}>
          {p.value}
        </InlineLink>
      </span>
    ) : (
      <span key={`${keyBase}-t-${i}`}>{p.value}</span>
    )
  );
}

/**
 * Site-wide rich text: markdown/HTML links + bare /city|/methodology paths.
 * Use in blog body, FAQ answers, tips, and any public prose that may contain paths.
 */
export function RichText({
  text,
  onNavigate,
  links = [],
  used,
}: {
  text: string;
  onNavigate?: (path: string) => void;
  links?: RichLinkRec[];
  /** Optional shared set so internal-link anchors are only injected once per article. */
  used?: Set<string>;
}): ReactNode {
  if (!text) return null;
  const usedSet = used ?? new Set<string>();
  const nodes: ReactNode[] = [];
  const mdRe = /\[([^\]]+)\]\(([^)]+)\)|<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  const pushChunk = (chunk: string) => {
    if (!chunk) return;
    nodes.push(...linkifyChunk(chunk, links, usedSet, onNavigate, `c${key}`));
    key += 1;
  };

  while ((m = mdRe.exec(text)) !== null) {
    if (m.index > last) pushChunk(text.slice(last, m.index));
    const label = (m[1] || m[4] || '').replace(/<[^>]+>/g, '').trim();
    const href = (m[2] || m[3] || '').trim();
    if (label && isValidSiteHref(href)) {
      nodes.push(
        <span key={`md-${key++}`}>
          <InlineLink href={href} onNavigate={onNavigate}>
            {label}
          </InlineLink>
        </span>
      );
      usedSet.add(href);
    } else if (label) {
      nodes.push(<span key={`plain-${key++}`}>{label}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) pushChunk(text.slice(last));
  return nodes.length ? <>{nodes}</> : text;
}

function linkifyChunk(
  text: string,
  links: RichLinkRec[],
  used: Set<string>,
  onNavigate: ((path: string) => void) | undefined,
  keyBase: string
): ReactNode[] {
  const ordered = [...links]
    .filter((l) => isValidSiteHref(l.target) && l.anchor.trim().length >= 3)
    .sort((a, b) => b.anchor.length - a.anchor.length);

  let parts: PathPart[] = [{ type: 'text', value: text }];

  for (const link of ordered) {
    if (used.has(link.target)) continue;
    const next: PathPart[] = [];
    let placed = false;
    for (const part of parts) {
      if (part.type !== 'text' || placed) {
        next.push(part);
        continue;
      }
      const idx = part.value.toLowerCase().indexOf(link.anchor.toLowerCase());
      if (idx === -1) {
        next.push(part);
        continue;
      }
      const actual = part.value.slice(idx, idx + link.anchor.length);
      if (idx > 0) next.push({ type: 'text', value: part.value.slice(0, idx) });
      next.push({ type: 'link', value: actual, href: link.target });
      if (idx + link.anchor.length < part.value.length) {
        next.push({ type: 'text', value: part.value.slice(idx + link.anchor.length) });
      }
      used.add(link.target);
      placed = true;
    }
    parts = next;
  }

  parts = parts.flatMap((part) => (part.type !== 'text' ? [part] : splitBarePaths(part.value)));
  return partsToNodes(parts, onNavigate, keyBase);
}
