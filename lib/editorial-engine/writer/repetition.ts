/**
 * Article-level repetition detector + deterministic rewrite.
 * If the same advice / sentence fingerprint appears more than once, keep the first, remove later copies.
 */

import { blockContentText } from '../reviewer/text-utils.js';
import type { DraftBlock, WriterDraftPayload } from './draft-validate.js';

const ADVICE_FINGERPRINTS = [
  'if quotes disagree',
  'seasonal spikes',
  'shared housing',
  'prefer boring',
  'defensible numbers',
  'widen the contingency',
  'widen the buffer',
  'one-week receipt',
  'receipt diary',
  'remote-work days',
  'proof-of-funds',
  'outer suburbs only win',
  'furnished flats raise',
  'when in doubt',
  'cross-check',
  'before you finalize',
  'indexed averages',
  'budget as a worksheet',
  'the practical answer',
  'keep a contingency',
  'public averages are planning',
];

function normSentence(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceFingerprint(s: string): string {
  const words = normSentence(s)
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 12);
  return words.join(' ');
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface RepetitionRepairResult {
  draft: WriterDraftPayload;
  removed: number;
  issues: string[];
}

function openerKey(text: string): string {
  const first = (text.trim().match(/^[^.!?]+/) || [text])[0] || '';
  return first
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .trim();
}

/** If multiple paragraphs share the same opening key, drop the first sentence of later ones. */
export function repairRepeatedOpenings(draft: WriterDraftPayload): RepetitionRepairResult {
  const seen = new Set<string>();
  const issues: string[] = [];
  let removed = 0;
  const blocks = (draft.blocks || []).map((b) => {
    if (!['paragraph', 'intro', 'summary'].includes(b.type)) return b;
    if (typeof b.content !== 'string') return b;
    const key = openerKey(b.content);
    if (!key || b.content.split(/\s+/).length < 20) return b;
    if (!seen.has(key)) {
      seen.add(key);
      return b;
    }
    const rest = b.content.replace(/^[^.!?]+[.!?]\s*/, '').trim();
    if (rest.split(/\s+/).length < 12) return b;
    removed += 1;
    issues.push(`Rewrote repeated opening: "${key}"`);
    return { ...b, content: rest };
  });
  return { draft: { ...draft, blocks }, removed, issues };
}

/**
 * Remove duplicate sentences / repeated advice across the article (keep first occurrence).
 */
export function repairRepeatedAdvice(draft: WriterDraftPayload): RepetitionRepairResult {
  const seenExact = new Set<string>();
  const seenAdvice = new Set<string>();
  const issues: string[] = [];
  let removed = 0;

  const blocks = (draft.blocks || []).map((b) => {
    if (!['paragraph', 'intro', 'summary', 'tip', 'warning'].includes(b.type)) return b;
    if (typeof b.content !== 'string') return b;

    const kept: string[] = [];
    for (const sentence of splitSentences(b.content)) {
      const fp = sentenceFingerprint(sentence);
      if (fp.split(/\s+/).length < 5) {
        kept.push(sentence);
        continue;
      }

      // Exact / near-exact sentence reuse
      if (seenExact.has(fp)) {
        removed += 1;
        issues.push(`Removed repeated sentence: "${fp.slice(0, 60)}"`);
        continue;
      }

      // Advice fingerprint reuse
      const adviceHit = ADVICE_FINGERPRINTS.find((a) => fp.includes(a));
      if (adviceHit) {
        if (seenAdvice.has(adviceHit)) {
          removed += 1;
          issues.push(`Removed repeated advice: "${adviceHit}"`);
          continue;
        }
        seenAdvice.add(adviceHit);
      }

      seenExact.add(fp);
      kept.push(sentence);
    }

    let text = kept.join(' ').replace(/\s+/g, ' ').trim();
    if (text.split(/\s+/).length < 10 && typeof b.content === 'string') {
      // Don't nuke a section entirely — keep original if repair emptied it
      return b;
    }
    return text === b.content ? b : { ...b, content: text };
  });

  return { draft: { ...draft, blocks }, removed, issues: [...new Set(issues)].slice(0, 30) };
}

/** Detect remaining repeated sentence fingerprints (after repair). */
export function detectSentenceRepetition(draft: WriterDraftPayload): string[] {
  const counts = new Map<string, number>();
  for (const b of draft.blocks || []) {
    if (!['paragraph', 'intro', 'summary', 'tip', 'warning'].includes(b.type)) continue;
    const text = blockContentText(b as DraftBlock);
    for (const s of splitSentences(text)) {
      const fp = sentenceFingerprint(s);
      if (fp.split(/\s+/).length < 6) continue;
      counts.set(fp, (counts.get(fp) || 0) + 1);
    }
  }
  const issues: string[] = [];
  for (const [fp, n] of counts) {
    if (n > 1) issues.push(`Repeated sentence (${n}×): "${fp.slice(0, 70)}"`);
  }
  for (const advice of ADVICE_FINGERPRINTS) {
    let n = 0;
    for (const b of draft.blocks || []) {
      const text = blockContentText(b).toLowerCase();
      if (text.includes(advice)) n += 1;
    }
    if (n > 1) issues.push(`Repeated advice across sections (${n}×): "${advice}"`);
  }
  return issues.slice(0, 20);
}
