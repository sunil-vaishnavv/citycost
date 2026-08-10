/**
 * Shared text metrics for Content Quality Engine (fingerprints, Jaccard, cosine, n-grams).
 */

import type { DraftBlock, WriterDraftPayload } from '../../draft-validate.js';
import { isProtectedBlock } from '../block-integrity.js';

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`~>]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint(s: string): string {
  return normalizeText(s).slice(0, 240);
}

export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(' ')
    .filter((t) => t.length > 2);
}

export function ngrams(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

export function jaccard(a: Set<string> | string[], b: Set<string> | string[]): number {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export function cosineBag(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const fa = new Map<string, number>();
  const fb = new Map<string, number>();
  for (const t of a) fa.set(t, (fa.get(t) || 0) + 1);
  for (const t of b) fb.set(t, (fb.get(t) || 0) + 1);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of fa) na += v * v;
  for (const [k, v] of fb) {
    nb += v * v;
    const av = fa.get(k);
    if (av) dot += av * v;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function similarityScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return fingerprint(a) === fingerprint(b) ? 1 : 0;
  const jac = jaccard(ta, tb);
  const cos = cosineBag(ta, tb);
  const ng = jaccard(ngrams(ta, 3), ngrams(tb, 3));
  return Math.max(jac, cos, ng * 0.95);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function blockPlain(b: DraftBlock): string {
  if (typeof b.content === 'string') return b.content;
  if (Array.isArray(b.content)) {
    return b.content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          return [o.q, o.a, o.question, o.answer].filter((x) => typeof x === 'string').join(' ');
        }
        return '';
      })
      .join(' ');
  }
  if (b.content && typeof b.content === 'object') {
    try {
      return JSON.stringify(b.content);
    } catch {
      return '';
    }
  }
  return '';
}

export function bodyBlocks(draft: WriterDraftPayload): DraftBlock[] {
  return (draft.blocks || []).filter((b) => !isProtectedBlock(b));
}

export function paragraphsFromDraft(draft: WriterDraftPayload): Array<{
  index: number;
  blockId: string;
  text: string;
  protected: boolean;
}> {
  const out: Array<{ index: number; blockId: string; text: string; protected: boolean }> = [];
  (draft.blocks || []).forEach((b, index) => {
    if (b.type === 'heading') return;
    const text = blockPlain(b).trim();
    if (text.length < 40) return;
    out.push({
      index,
      blockId: b.id,
      text,
      protected: isProtectedBlock(b),
    });
  });
  return out;
}

export function hashString(s: string): string {
  let h = 2166136261;
  const n = normalizeText(s);
  for (let i = 0; i < n.length; i++) {
    h ^= n.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export const SENTENCE_SIM_THRESHOLD = 0.8;
export const PARAGRAPH_SIM_THRESHOLD = 0.7;
export const SECTION_SIM_THRESHOLD = 0.6;
