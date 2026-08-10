/**
 * Normalize draft BEFORE any validator / reviewer runs.
 * Single source of truth: Reviewer never sees raw writer output.
 *
 * Heading uniquify uses headingFingerprint and runs ONCE after AI revision
 * (see uniquifyHeadingsByFingerprint) — not during early normalize.
 */

import type { DraftBlock, WriterDraftPayload } from '../writer/draft-validate.js';

export interface NormalizeResult {
  draft: WriterDraftPayload;
  fixes: string[];
  /** Heading fingerprints after normalize */
  heading_fingerprints: string[];
}

/** Fingerprint: "Who should read this" → "who-should-read-this" */
export function headingFingerprint(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120);
}

function trimStr(s: string): string {
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strip formatting noise ONLY — preserve markdown links, HTML <a href>, anchors.
 * Never convert [text](/path) → text or strip <a> tags.
 */
function stripMdNoise(text: string): string {
  // Protect link spans so bold/italic/fence stripping cannot touch them
  const vault: string[] = [];
  const protect = (s: string, re: RegExp): string =>
    s.replace(re, (m) => {
      const i = vault.length;
      vault.push(m);
      return `\u0000LINK${i}\u0000`;
    });

  let t = text;
  // Markdown images first (so ![alt](url) is not treated as a link)
  t = protect(t, /!\[[^\]]*\]\([^)]*\)/g);
  // Markdown links [text](url) including internal /path and anchors
  t = protect(t, /\[[^\]]*\]\([^)]*\)/g);
  // HTML anchors (opening + closing kept intact as a unit when possible)
  t = protect(t, /<a\b[^>]*>[\s\S]*?<\/a>/gi);
  // Lone opening/closing <a> if malformed
  t = protect(t, /<\/?a\b[^>]*>/gi);

  t = t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Strip non-anchor HTML tags only
    .replace(/<\/?(?!a\b)[a-z][^>]*>/gi, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  t = t.replace(/\u0000LINK(\d+)\u0000/g, (_, n) => vault[Number(n)] ?? '');
  return t;
}

function normalizeBlockContent(content: unknown): unknown {
  if (typeof content === 'string') return stripMdNoise(trimStr(content));
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return stripMdNoise(trimStr(item));
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const out: Record<string, unknown> = { ...o };
        for (const k of ['q', 'a', 'question', 'answer', 'text', 'content', 'label', 'value']) {
          if (typeof o[k] === 'string') out[k] = stripMdNoise(trimStr(String(o[k])));
        }
        return out;
      }
      return item;
    });
  }
  return content;
}

function blockHeadingText(b: DraftBlock): string {
  if (typeof b.heading === 'string' && b.heading.trim()) return b.heading.trim();
  if (b.type === 'heading' && typeof b.content === 'string') return b.content.trim();
  return '';
}

const RENAME_SUFFIXES = ['overview', 'details', 'costs', 'guide', 'notes', 'context'];

/**
 * Single heading uniquify algorithm (headingFingerprint).
 * Call ONCE after AI revision — not during early normalizeDraft.
 */
export function uniquifyHeadingsByFingerprint(blocks: DraftBlock[]): {
  blocks: DraftBlock[];
  fixes: string[];
  unresolved: string[];
} {
  const fixes: string[] = [];
  const unresolved: string[] = [];
  const seen = new Map<string, number>(); // fingerprint → first index
  const out: DraftBlock[] = [];

  for (const raw of blocks) {
    const b = { ...raw };
    const heading = blockHeadingText(b);
    if (b.type === 'heading' || heading) {
      const fp = headingFingerprint(heading);
      if (!fp) {
        if (b.type === 'heading') {
          fixes.push('Removed empty heading');
          continue;
        }
        b.heading = undefined;
        out.push(b);
        continue;
      }

      if (seen.has(fp)) {
        const firstIdx = seen.get(fp)!;
        const first = out[firstIdx];
        if (b.type === 'heading') {
          const firstText = blockHeadingText(first);
          let renamed = '';
          for (const suf of RENAME_SUFFIXES) {
            const candidate = `${heading} (${suf})`;
            const cfp = headingFingerprint(candidate);
            if (
              ![...seen.keys()].includes(cfp) &&
              !out.some((x) => headingFingerprint(blockHeadingText(x)) === cfp)
            ) {
              renamed = candidate;
              seen.set(cfp, out.length);
              break;
            }
          }
          if (renamed) {
            out.push({
              ...b,
              heading: renamed,
              content: renamed,
            });
            fixes.push(`Renamed duplicate heading "${heading}" → "${renamed}"`);
          } else if (first && first.type === 'heading' && firstText) {
            fixes.push(`Merged duplicate heading "${heading}"`);
          } else {
            unresolved.push(heading);
            out.push(b);
          }
          continue;
        }

        b.heading = undefined;
        fixes.push(`Cleared duplicate section label "${heading}"`);
        out.push(b);
        continue;
      }

      seen.set(fp, out.length);
      if (b.type === 'heading') {
        out.push({ ...b, heading, content: heading });
      } else {
        out.push({ ...b, heading });
      }
      continue;
    }
    out.push(b);
  }

  return { blocks: out, fixes, unresolved };
}

/** @deprecated Use uniquifyHeadingsByFingerprint — kept as alias for callers. */
export const resolveDuplicateHeadings = uniquifyHeadingsByFingerprint;

function dedupeToc(blocks: DraftBlock[]): { blocks: DraftBlock[]; fixes: string[] } {
  const fixes: string[] = [];
  let tocSeen = false;
  const out: DraftBlock[] = [];
  for (const b of blocks) {
    const isToc =
      (b.type === 'heading' && /table of contents|^contents$/i.test(b.heading || '')) ||
      (b.type === 'list' &&
        /table of contents|^contents$/i.test(`${b.heading || ''} ${typeof b.content === 'string' ? b.content : ''}`));
    if (isToc) {
      if (tocSeen) {
        fixes.push('Removed duplicated TOC entry');
        continue;
      }
      tocSeen = true;
      if (b.type === 'list' && Array.isArray(b.content)) {
        const items = b.content.map((x) => (typeof x === 'string' ? trimStr(x) : x));
        const uniq: unknown[] = [];
        const fps = new Set<string>();
        for (const item of items) {
          const fp = headingFingerprint(typeof item === 'string' ? item : JSON.stringify(item));
          if (fp && fps.has(fp)) continue;
          if (fp) fps.add(fp);
          uniq.push(item);
        }
        if (uniq.length !== items.length) fixes.push('Deduped TOC list items');
        out.push({ ...b, content: uniq });
        continue;
      }
    }
    out.push(b);
  }
  return { blocks: out, fixes };
}

function normalizeFaq(blocks: DraftBlock[]): { blocks: DraftBlock[]; fixes: string[] } {
  const fixes: string[] = [];
  const out = blocks.map((b) => {
    if (b.type !== 'faq') return b;
    const content = b.content;
    if (!Array.isArray(content)) return b;
    const items = content
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const o = item as Record<string, unknown>;
        const q = trimStr(String(o.q || o.question || ''));
        const a = trimStr(String(o.a || o.answer || ''));
        if (!q || !a) return null;
        return { q, a };
      })
      .filter(Boolean);
    if (items.length !== content.length) fixes.push('Normalized FAQ entries');
    return { ...b, content: items };
  });
  return { blocks: out, fixes };
}

function normalizeTables(blocks: DraftBlock[]): { blocks: DraftBlock[]; fixes: string[] } {
  const fixes: string[] = [];
  const out = blocks.map((b) => {
    if (b.type !== 'table') return b;
    const c = b.content;
    if (!c || typeof c !== 'object') return b;
    const obj = c as Record<string, unknown>;
    if (Array.isArray(obj.headers) || Array.isArray(obj.rows)) {
      const headers = Array.isArray(obj.headers)
        ? obj.headers.map((h) => trimStr(String(h)))
        : [];
      const rows = Array.isArray(obj.rows)
        ? obj.rows.map((row) =>
            Array.isArray(row) ? row.map((cell) => trimStr(String(cell))) : row
          )
        : [];
      fixes.push('Normalized table structure');
      return { ...b, content: { headers, rows } };
    }
    return b;
  });
  return { blocks: out, fixes: [...new Set(fixes)] };
}

function normalizeInternalLinks(blocks: DraftBlock[]): { blocks: DraftBlock[]; fixes: string[] } {
  const fixes: string[] = [];
  let changed = 0;
  const out = blocks.map((b) => {
    if (typeof b.content !== 'string') return b;
    const next = b.content.replace(/\]\(\s*\/+/g, '](/').replace(/\]\(\s+/g, '](');
    if (next !== b.content) changed += 1;
    return next === b.content ? b : { ...b, content: next };
  });
  if (changed) fixes.push(`Normalized internal links in ${changed} block(s)`);
  return { blocks: out, fixes };
}

function ensureBlockIds(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((b, i) => ({
    ...b,
    id: typeof b.id === 'string' && b.id.trim() ? b.id : `n-${i}`,
    type: b.type,
  }));
}

/**
 * Count in-body internal links (markdown + HTML <a href="/…">).
 * Used by Quality UI — SEO package recommendations are separate.
 */
export function countBodyInternalLinks(draft: WriterDraftPayload): number {
  let n = 0;
  const walk = (s: string) => {
    const md = s.match(/\[[^\]]*\]\(\/[a-z0-9/._\-?#%]+\)/gi);
    if (md) n += md.length;
    const html = s.match(/<a\b[^>]*href=["']\/[^"']+["'][^>]*>/gi);
    if (html) n += html.length;
  };
  for (const b of draft.blocks || []) {
    if (typeof b.content === 'string') walk(b.content);
    else if (Array.isArray(b.content)) {
      for (const item of b.content) {
        if (typeof item === 'string') walk(item);
        else if (item && typeof item === 'object') {
          for (const v of Object.values(item as Record<string, unknown>)) {
            if (typeof v === 'string') walk(v);
          }
        }
      }
    } else if (b.content && typeof b.content === 'object') {
      for (const v of Object.values(b.content as Record<string, unknown>)) {
        if (typeof v === 'string') walk(v);
      }
    }
  }
  return n;
}

/**
 * Full normalize pipeline — run before Rule Validator and AI Reviewer.
 * Does NOT uniquify headings (that runs once after AI revision via
 * uniquifyHeadingsByFingerprint to avoid dual-scheme fights).
 */
export function normalizeDraft(draft: WriterDraftPayload): NormalizeResult {
  const fixes: string[] = [];
  let blocks = ensureBlockIds(draft.blocks || []);

  // Trim + markdown noise strip (links preserved)
  blocks = blocks.map((b) => {
    const heading = typeof b.heading === 'string' ? trimStr(stripMdNoise(b.heading)) : b.heading;
    return {
      ...b,
      heading: heading || undefined,
      content: normalizeBlockContent(b.content),
    };
  });

  // Soft trim empty headings only — no rename/merge here
  blocks = blocks.map((b) => {
    if (b.type !== 'heading') return b;
    const h = blockHeadingText(b);
    if (!h) return b;
    return { ...b, heading: h, content: h };
  });

  const toc = dedupeToc(blocks);
  blocks = toc.blocks;
  fixes.push(...toc.fixes);

  const faq = normalizeFaq(blocks);
  blocks = faq.blocks;
  fixes.push(...faq.fixes);

  const tables = normalizeTables(blocks);
  blocks = tables.blocks;
  fixes.push(...tables.fixes);

  const links = normalizeInternalLinks(blocks);
  blocks = links.blocks;
  fixes.push(...links.fixes);

  // Drop empty non-heading blocks
  const beforeLen = blocks.length;
  blocks = blocks.filter((b) => {
    if (b.type === 'heading') return Boolean(blockHeadingText(b));
    const raw = JSON.stringify(b.content ?? '');
    return raw.replace(/[\s"\[\]{}null]/g, '').length > 0;
  });
  if (blocks.length < beforeLen) fixes.push(`Removed ${beforeLen - blocks.length} empty block(s)`);

  const meta_title = trimStr(draft.meta_title || '');
  const meta_description = trimStr(draft.meta_description || '');
  const excerpt = trimStr(draft.excerpt || '');
  const seo_title = trimStr(draft.seo_title || '');

  const fingerprints = blocks
    .filter((b) => b.type === 'heading')
    .map((b) => headingFingerprint(blockHeadingText(b)))
    .filter(Boolean);

  return {
    draft: {
      ...draft,
      seo_title,
      meta_title,
      meta_description,
      excerpt,
      blocks,
    },
    fixes: [...new Set(fixes)],
    heading_fingerprints: fingerprints,
  };
}
