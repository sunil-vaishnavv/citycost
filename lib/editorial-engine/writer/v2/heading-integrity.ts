/**
 * Heading / TOC integrity.
 *
 * - One definition of "which blocks render a section heading" shared by the TOC
 *   builder and the HTML renderer, so TOC anchors always match heading ids.
 * - The stored TOC is rebuilt from the final heading tree (never the planned
 *   outline), so failed or removed sections cannot leave dangling entries.
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';

/** Block types whose `heading` is rendered as a section heading (blog-render). */
export const HEADED_BLOCK_TYPES = new Set([
  'paragraph',
  'list',
  'comparison',
  'table',
  'faq',
  'summary',
  'tip',
  'warning',
]);

const TOC_LABEL = /^(?:table of contents|contents)$/i;

function plain(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const o = content as Record<string, unknown>;
    for (const k of ['text', 'heading', 'title']) if (typeof o[k] === 'string') return o[k] as string;
  }
  return '';
}

export function isTocBlockLike(b: DraftBlock): boolean {
  if (b.id === 'toc') return true;
  const h = (b.heading || '').trim();
  return TOC_LABEL.test(h);
}

/** Heading text a block renders as a section heading, or null. */
export function renderedHeadingText(b: DraftBlock): string | null {
  if (isTocBlockLike(b) || b.type === 'intro') return null;
  if (b.type === 'heading') {
    const t = (b.heading || plain(b.content)).replace(/^#+\s*/, '').trim();
    return t && !TOC_LABEL.test(t) ? t : null;
  }
  const h = (b.heading || '').trim();
  if (h && HEADED_BLOCK_TYPES.has(b.type) && !TOC_LABEL.test(h)) return h;
  return null;
}

/** Ordered section headings exactly as the renderer will emit them. */
export function collectRenderedHeadings(blocks: DraftBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks || []) {
    const t = renderedHeadingText(b);
    if (t) out.push(t);
  }
  return out;
}

export function normalizeHeading(h: string): string {
  return h
    .toLowerCase()
    .replace(/[*_`#]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Remove an appended article title: "Housing costs — Sydney vs Melbourne 2026" → "Housing costs". */
export function stripTitleSuffix(heading: string, title: string): string {
  const t = title.trim();
  if (!t || t.length < 8) return heading;
  const nh = normalizeHeading(heading);
  const nt = normalizeHeading(t);
  if (!nh.endsWith(nt) || nh === nt) return heading;
  const idx = heading.toLowerCase().lastIndexOf(t.toLowerCase().slice(0, Math.min(12, t.length)));
  if (idx <= 0) return heading;
  const head = heading.slice(0, idx).replace(/\s*(?:[:|–—-]|\bin\b|\bfor\b)\s*$/i, '').trim();
  return head.length >= 3 ? head : heading;
}

export interface HeadingFinding {
  code: 'empty_heading' | 'duplicate_heading' | 'heading_is_title' | 'toc_entry_missing_heading' | 'heading_missing_from_toc' | 'toc_has_title';
  message: string;
  blockId?: string;
}

/**
 * Repair: strip appended titles from headings, drop empty heading blocks,
 * and rebuild the TOC from the final rendered headings (deduplicated).
 */
export function repairHeadingsAndToc(
  draft: WriterDraftPayload,
  articleTitle: string
): { draft: WriterDraftPayload; fixes: string[] } {
  const fixes: string[] = [];
  let blocks = (draft.blocks || []).map((b) => {
    if (isTocBlockLike(b) || b.type === 'intro') return b;
    if (b.heading) {
      const stripped = stripTitleSuffix(b.heading, articleTitle);
      if (stripped !== b.heading) {
        fixes.push(`title_suffix_removed:${b.id}`);
        return { ...b, heading: stripped };
      }
    }
    return b;
  });
  blocks = blocks.filter((b) => {
    if (b.type === 'heading' && !renderedHeadingText(b)) {
      fixes.push(`empty_heading_removed:${b.id}`);
      return false;
    }
    return true;
  });
  // A content block repeating the heading right above it would render the same H2 twice.
  blocks = blocks.map((b, i) => {
    if (i === 0 || b.type === 'heading' || !b.heading) return b;
    const prev = renderedHeadingText(blocks[i - 1]!);
    const own = renderedHeadingText(b);
    if (prev && own && normalizeHeading(prev) === normalizeHeading(own)) {
      fixes.push(`adjacent_duplicate_heading_removed:${b.id}`);
      const { heading: _drop, ...rest } = b;
      return rest as DraftBlock;
    }
    return b;
  });

  const headings = collectRenderedHeadings(blocks);
  const seen = new Set<string>();
  const tocEntries: string[] = [];
  for (const h of headings) {
    const n = normalizeHeading(h);
    if (!n || seen.has(n) || n === normalizeHeading(articleTitle)) continue;
    seen.add(n);
    tocEntries.push(h);
  }
  blocks = blocks.map((b) => {
    if (b.id !== 'toc') return b;
    const before = Array.isArray(b.content) ? (b.content as unknown[]).map(String) : [];
    if (JSON.stringify(before) !== JSON.stringify(tocEntries)) fixes.push('toc_rebuilt_from_headings');
    return { ...b, content: tocEntries };
  });
  return { draft: { ...draft, blocks }, fixes };
}

export function inspectHeadingsAndToc(draft: WriterDraftPayload, articleTitle: string): HeadingFinding[] {
  const findings: HeadingFinding[] = [];
  const blocks = draft.blocks || [];
  const titleNorm = normalizeHeading(articleTitle);
  const seen = new Map<string, string>();
  for (const b of blocks) {
    if (b.type === 'heading' && !renderedHeadingText(b) && !isTocBlockLike(b)) {
      findings.push({ code: 'empty_heading', message: 'Heading block without text', blockId: b.id });
      continue;
    }
    const h = renderedHeadingText(b);
    if (!h) continue;
    const n = normalizeHeading(h);
    if (titleNorm && n === titleNorm) {
      findings.push({ code: 'heading_is_title', message: `Section heading repeats the title: "${h}"`, blockId: b.id });
    }
    // A section heading and its own content block may legitimately repeat; flag repeats across sections.
    if (seen.has(n) && seen.get(n) !== b.id) {
      findings.push({ code: 'duplicate_heading', message: `Duplicate section heading: "${h}"`, blockId: b.id });
    } else {
      seen.set(n, b.id);
    }
  }
  const toc = blocks.find((b) => b.id === 'toc');
  if (toc && Array.isArray(toc.content)) {
    const headingSet = new Set(collectRenderedHeadings(blocks).map(normalizeHeading));
    const tocSet = new Set<string>();
    for (const entry of toc.content as unknown[]) {
      const n = normalizeHeading(String(entry));
      tocSet.add(n);
      if (titleNorm && n.includes(titleNorm)) {
        findings.push({ code: 'toc_has_title', message: `TOC entry contains the article title: "${entry}"` });
      } else if (!headingSet.has(n)) {
        findings.push({ code: 'toc_entry_missing_heading', message: `TOC entry has no matching heading: "${entry}"` });
      }
    }
    for (const n of headingSet) {
      if (n && !tocSet.has(n) && n !== titleNorm) {
        findings.push({ code: 'heading_missing_from_toc', message: `Heading not listed in TOC: "${n}"` });
      }
    }
  }
  return findings;
}
