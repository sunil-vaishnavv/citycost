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
  // Drop the title together with whatever introduced it — a separator, "in"/"for",
  // or an opening bracket ("Housing comparison (Sydney vs Melbourne …)").
  const head = trimDanglingHeadingTail(heading.slice(0, idx));
  return head.length >= 3 ? head : heading;
}

/** Remove trailing separators, connectives and unclosed brackets from a heading fragment. */
export function trimDanglingHeadingTail(text: string): string {
  let s = text.trim();
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/\s*[([{]\s*$/, '')
      .replace(/\s*(?:[:|–—,;-]|\b(?:in|for|of|and|vs\.?|with|to)\b)\s*$/i, '')
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/** True when a heading is visibly cut off: dangling bracket/separator or unbalanced brackets. */
export function isIncompleteHeading(heading: string): boolean {
  const h = heading.trim();
  if (!h) return true;
  if (/[([{:,;–—-]\s*$/.test(h) || /\b(?:and|or|of|the|in|for|vs\.?|with|to)\s*$/i.test(h)) return true;
  const opens = (h.match(/[([{]/g) || []).length;
  const closes = (h.match(/[)\]}]/g) || []).length;
  return opens !== closes;
}

/**
 * Repair a cut-off heading: drop an unclosed bracket group and dangling tails.
 * Returns the original when it cannot be repaired into something meaningful.
 */
export function repairIncompleteHeading(heading: string): string {
  let h = heading.trim();
  const opens = (h.match(/[([{]/g) || []).length;
  const closes = (h.match(/[)\]}]/g) || []).length;
  if (opens > closes) {
    const lastOpen = Math.max(h.lastIndexOf('('), h.lastIndexOf('['), h.lastIndexOf('{'));
    if (lastOpen > 0) h = h.slice(0, lastOpen);
  } else if (closes > opens) {
    h = h.replace(/[)\]}]/g, '');
  }
  h = trimDanglingHeadingTail(h);
  return h.length >= 3 ? h : heading.trim();
}

/** Heading level for a heading block (content.level or markdown hashes); default 2. */
export function headingLevelOf(b: DraftBlock): number {
  const c = b.content;
  if (c && typeof c === 'object' && !Array.isArray(c) && 'level' in c) {
    const level = Number((c as { level?: number }).level);
    if (level >= 2 && level <= 4) return level;
  }
  const raw = typeof c === 'string' ? c : b.heading || '';
  const hashes = /^(#{2,4})\s/.exec(raw);
  return hashes ? hashes[1]!.length : 2;
}

/**
 * Entries for the table of contents: final H2 section headings in document order,
 * deduplicated, never the article title. (H3 sub-headings are not listed — the
 * public page and the SSR renderer apply the same rule.)
 */
export function collectTocHeadings(blocks: DraftBlock[], articleTitle = ''): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const titleNorm = normalizeHeading(articleTitle);
  for (const b of blocks || []) {
    const t = renderedHeadingText(b);
    if (!t) continue;
    if (b.type === 'heading' && headingLevelOf(b) >= 3) continue;
    const n = normalizeHeading(t);
    if (!n || seen.has(n) || (titleNorm && n === titleNorm)) continue;
    seen.add(n);
    out.push(t);
  }
  return out;
}

export interface HeadingFinding {
  code:
    | 'empty_heading'
    | 'incomplete_heading'
    | 'duplicate_heading'
    | 'heading_is_title'
    | 'toc_entry_missing_heading'
    | 'heading_missing_from_toc'
    | 'toc_has_title'
    | 'toc_order_mismatch';
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
    let next = b;
    if (next.heading) {
      const stripped = stripTitleSuffix(next.heading, articleTitle);
      if (stripped !== next.heading) {
        fixes.push(`title_suffix_removed:${b.id}`);
        next = { ...next, heading: stripped };
      }
      if (isIncompleteHeading(next.heading!)) {
        const repaired = repairIncompleteHeading(next.heading!);
        if (repaired !== next.heading && !isIncompleteHeading(repaired)) {
          fixes.push(`incomplete_heading_repaired:${b.id}`);
          next = { ...next, heading: repaired };
        }
      }
    }
    if (next.type === 'heading' && typeof next.content === 'string' && !next.heading && isIncompleteHeading(next.content)) {
      const repaired = repairIncompleteHeading(next.content);
      if (repaired !== next.content && !isIncompleteHeading(repaired)) {
        fixes.push(`incomplete_heading_repaired:${b.id}`);
        next = { ...next, content: repaired };
      }
    }
    return next;
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

  // TOC is derived from the FINAL heading tree (H2, document order) — never the plan.
  const tocEntries = collectTocHeadings(blocks, articleTitle);
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
    if (isIncompleteHeading(h)) {
      findings.push({ code: 'incomplete_heading', message: `Incomplete heading: "${h}"`, blockId: b.id });
    }
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
    const expected = collectTocHeadings(blocks, articleTitle).map(normalizeHeading);
    const actual = (toc.content as unknown[]).map((e) => normalizeHeading(String(e)));
    for (const [i, n] of actual.entries()) {
      if (titleNorm && n.includes(titleNorm)) {
        findings.push({ code: 'toc_has_title', message: `TOC entry contains the article title: "${(toc.content as unknown[])[i]}"` });
      } else if (!expected.includes(n)) {
        findings.push({ code: 'toc_entry_missing_heading', message: `TOC entry has no matching heading: "${(toc.content as unknown[])[i]}"` });
      }
    }
    for (const n of expected) {
      if (!actual.includes(n)) findings.push({ code: 'heading_missing_from_toc', message: `Heading not listed in TOC: "${n}"` });
    }
    const common = actual.filter((n) => expected.includes(n));
    const expectedOrder = expected.filter((n) => actual.includes(n));
    if (JSON.stringify(common) !== JSON.stringify(expectedOrder)) {
      findings.push({ code: 'toc_order_mismatch', message: 'TOC order does not follow the article heading order' });
    }
  }
  return findings;
}
