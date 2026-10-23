/**
 * Prose integrity — sentence-break corruption, safe sentence splitting,
 * malformed markdown detection, and a shared walker over public draft text.
 *
 * Observed defect: readability repair split long sentences at an arbitrary
 * word midpoint and appended "." without capitalising the remainder, producing
 * "requires. looking", "steeper. upfront costs", "providing a. solid".
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';

export type TextField = 'meta' | 'heading' | 'prose' | 'list_item' | 'faq_q' | 'faq_a' | 'cell' | 'alt';

export interface TextLocation {
  field: TextField;
  blockId?: string;
  blockType?: string;
  key?: string;
}

const META_KEYS = ['seo_title', 'meta_title', 'meta_description', 'excerpt'] as const;
const FAQ_Q_KEYS = new Set(['q', 'question']);
const FAQ_A_KEYS = new Set(['a', 'answer']);
const ALT_KEYS = new Set(['alt', 'image_alt', 'alt_text']);
const CELL_PARENT_KEYS = new Set(['rows', 'headers', 'columns', 'cells']);

function mapValue(
  value: unknown,
  fn: (text: string, loc: TextLocation) => string,
  loc: TextLocation,
  parentKey?: string
): unknown {
  if (typeof value === 'string') return fn(value, loc);
  if (Array.isArray(value)) {
    const inCells = parentKey ? CELL_PARENT_KEYS.has(parentKey) : false;
    return value.map((v) =>
      mapValue(
        v,
        fn,
        inCells ? { ...loc, field: 'cell' } : loc.field === 'prose' && typeof v === 'string' ? { ...loc, field: 'list_item' } : loc,
        inCells ? parentKey : undefined
      )
    );
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      let field: TextField = loc.field === 'cell' ? 'cell' : 'prose';
      if (FAQ_Q_KEYS.has(k)) field = 'faq_q';
      else if (FAQ_A_KEYS.has(k)) field = 'faq_a';
      else if (ALT_KEYS.has(k)) field = 'alt';
      else if (CELL_PARENT_KEYS.has(k)) field = 'cell';
      else if (k === 'heading' || k === 'title') field = 'heading';
      // Never touch URLs / ids / data keys.
      if (/^(href|url|src|id|slug|anchor|key|data_keys)$/i.test(k)) {
        out[k] = v;
        continue;
      }
      out[k] = mapValue(v, fn, { ...loc, field, key: k }, k);
    }
    return out;
  }
  return value;
}

/** Apply `fn` to every public string in a draft (meta, headings, body, lists, FAQ, table cells, alt). */
export function mapDraftText(
  draft: WriterDraftPayload,
  fn: (text: string, loc: TextLocation) => string
): WriterDraftPayload {
  const out: WriterDraftPayload = { ...draft };
  for (const k of META_KEYS) {
    if (typeof draft[k] === 'string') out[k] = fn(draft[k], { field: 'meta', key: k });
  }
  out.blocks = (draft.blocks || []).map((b): DraftBlock => {
    const base = { blockId: b.id, blockType: b.type };
    const heading = typeof b.heading === 'string' ? fn(b.heading, { ...base, field: 'heading' }) : b.heading;
    const contentField: TextField = b.type === 'heading' ? 'heading' : 'prose';
    const content = mapValue(b.content, fn, { ...base, field: contentField });
    return { ...b, heading, content };
  });
  return out;
}

/** Collect every public string with its location. */
export function collectDraftText(draft: WriterDraftPayload): Array<{ text: string; loc: TextLocation }> {
  const out: Array<{ text: string; loc: TextLocation }> = [];
  mapDraftText(draft, (text, loc) => {
    out.push({ text, loc });
    return text;
  });
  return out;
}

/* ── Sentence-break corruption ─────────────────────────────────────────── */

const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'approx', 'incl', 'excl', 'est', 'no', 'nos', 'st', 'mr', 'mrs', 'ms',
  'dr', 'jr', 'sr', 'min', 'max', 'avg', 'fig', 'cf', 'sq', 'ft', 'mt', 'mo', 'yr', 'yrs', 'wk', 'hr',
  'hrs', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'dept',
  'govt', 'inc', 'ltd', 'co', 'corp', 'pty', 'ave', 'rd', 'blvd', 'mt', 'ca', 'al', 'pp', 'vol', 'ed',
]);

/** Words that never end an English sentence — "a." / "the." / "to." before lowercase is always corruption. */
const NON_TERMINAL_WORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'but', 'with', 'by', 'from', 'at',
  'as', 'than', 'into', 'your', 'their', 'its', 'our', 'this', 'that', 'these', 'those', 'is', 'are',
]);

/** "word. lowercase" where the period cannot be a real sentence end or abbreviation. */
const CORRUPT_BREAK = /(^|[^\w.@/-])([A-Za-z][A-Za-z'’-]*)\.\s+([a-z][a-z]+)/g;

function isCorruptBreak(prev: string, next: string, lineStart: boolean): boolean {
  const p = prev.toLowerCase();
  if (ABBREVIATIONS.has(p)) return false;
  if (p.length === 1 && lineStart) return false; // "a. first item" list enumerations
  if (p.length === 1 && !NON_TERMINAL_WORDS.has(p)) return false; // initials "J. smith" — leave
  // Lowercase continuation after a full stop is not a valid sentence start in this content.
  return /^[a-z]/.test(next);
}

export interface CorruptBreak {
  snippet: string;
  index: number;
}

export function detectCorruptSentenceBreaks(text: string): CorruptBreak[] {
  const found: CorruptBreak[] = [];
  if (!text) return found;
  for (const m of text.matchAll(CORRUPT_BREAK)) {
    const lead = m[1] ?? '';
    const prev = m[2];
    const next = m[3];
    const idx = (m.index ?? 0) + lead.length;
    const lineStart = idx === 0 || /\n\s*$/.test(text.slice(Math.max(0, idx - 3), idx));
    if (!isCorruptBreak(prev, next, lineStart)) continue;
    found.push({ snippet: `${prev}. ${next}`, index: idx });
  }
  return found;
}

/** Merge corrupt breaks back into one sentence: "requires. looking" → "requires looking". */
export function repairCorruptSentenceBreaks(text: string): { text: string; fixes: number } {
  if (!text) return { text, fixes: 0 };
  let fixes = 0;
  const out = text.replace(CORRUPT_BREAK, (whole, lead: string, prev: string, next: string, offset: number) => {
    const idx = offset + lead.length;
    const lineStart = idx === 0 || /\n\s*$/.test(text.slice(Math.max(0, idx - 3), idx));
    if (!isCorruptBreak(prev, next, lineStart)) return whole;
    fixes += 1;
    return `${lead}${prev} ${next}`;
  });
  return { text: out, fixes };
}

/* ── Safe sentence splitting ───────────────────────────────────────────── */

function capitalizeFirst(s: string): string {
  return s.replace(/^(\W*)([a-z])/, (_m, pre: string, ch: string) => `${pre}${ch.toUpperCase()}`);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Split a long sentence only at a real clause boundary ("; ", ", and ", ", but ",
 * ", which ", ", so ", ", while "). Never splits inside numbers, links or at an
 * arbitrary midpoint; returns the sentence unchanged when no safe split exists.
 */
export function safeSplitLongSentence(sentence: string, maxWords = 20): string[] {
  const s = sentence.trim();
  if (wordCount(s) <= maxWords) return [s];
  if (/\]\(|https?:\/\//.test(s)) return [s];
  const candidates: Array<{ at: number; len: number; keepConj: boolean }> = [];
  for (const m of s.matchAll(/;\s+/g)) candidates.push({ at: m.index ?? 0, len: m[0].length, keepConj: false });
  for (const m of s.matchAll(/,\s+(?=(?:and|but|so|while|which|whereas)\s)/gi)) {
    candidates.push({ at: m.index ?? 0, len: m[0].length, keepConj: true });
  }
  const mid = s.length / 2;
  candidates.sort((x, y) => Math.abs(x.at - mid) - Math.abs(y.at - mid));
  for (const c of candidates) {
    const left = s.slice(0, c.at).trim();
    let right = s.slice(c.at + c.len).trim();
    if (/\d$/.test(left) || /^\d/.test(right)) continue; // never split "1,520"
    if (wordCount(left) < 6 || wordCount(right) < 6) continue;
    if (c.keepConj) {
      // ", which costs more" → "That costs more"; ", and rent rises" → "Rent rises"
      right = right.replace(/^which\s+/i, 'That ').replace(/^(?:and|so)\s+/i, '');
      right = right.replace(/^but\s+/i, 'But ').replace(/^(?:while|whereas)\s+/i, 'Meanwhile, ');
    }
    const leftOut = /[.!?]$/.test(left) ? left : `${left}.`;
    return [leftOut, capitalizeFirst(right)];
  }
  return [s];
}

/* ── Markdown integrity ───────────────────────────────────────────────── */

export function detectMalformedMarkdown(text: string): string[] {
  const issues: string[] = [];
  if (!text) return issues;
  if (/\[[^\]\n]*\]\(\s*\)/.test(text)) issues.push('empty link target');
  if (/\[[^\]\n]*\]\([^)\n]*$/.test(text) || /\[[^\]\n]*\]\([^)\n]*\s[^)\n]*\)/.test(text)) {
    issues.push('unclosed or spaced link target');
  }
  if (/\]\]\(|\[\[/.test(text)) issues.push('nested link brackets');
  const opens = (text.match(/\[/g) || []).length;
  const closes = (text.match(/\]/g) || []).length;
  if (opens !== closes && /\]\(/.test(text)) issues.push('unbalanced link brackets');
  if (/\(\s*\/[a-z0-9-]+\/?\s*\)(?!\])/i.test(text) && !/\]\(\s*\/[a-z0-9-]+/i.test(text)) {
    issues.push('bare path in parentheses without link text');
  }
  return [...new Set(issues)];
}

/* ── Draft-level inspection / repair ──────────────────────────────────── */

export interface ProseIntegrityFinding {
  code: 'corrupt_sentence_break' | 'malformed_markdown';
  message: string;
  location: TextLocation;
}

export function inspectProseIntegrity(draft: WriterDraftPayload): ProseIntegrityFinding[] {
  const findings: ProseIntegrityFinding[] = [];
  for (const { text, loc } of collectDraftText(draft)) {
    for (const b of detectCorruptSentenceBreaks(text)) {
      findings.push({ code: 'corrupt_sentence_break', message: `Broken sentence: "${b.snippet}"`, location: loc });
    }
    if (loc.field !== 'cell') {
      for (const issue of detectMalformedMarkdown(text)) {
        findings.push({ code: 'malformed_markdown', message: `Markdown: ${issue}`, location: loc });
      }
    }
  }
  return findings;
}

export function repairProseIntegrity(draft: WriterDraftPayload): { draft: WriterDraftPayload; fixes: number } {
  let fixes = 0;
  const repaired = mapDraftText(draft, (text, loc) => {
    if (loc.field === 'cell') return text;
    const r = repairCorruptSentenceBreaks(text);
    fixes += r.fixes;
    return r.text;
  });
  return { draft: repaired, fixes };
}
