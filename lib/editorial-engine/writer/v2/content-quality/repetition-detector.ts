/**
 * Repetition detector — rewrite ONLY duplicates via fingerprints / similarity.
 * Never regenerates the full article.
 */

import type { DraftBlock, WriterDraftPayload } from '../../draft-validate.js';
import { isProtectedBlock } from '../block-integrity.js';
import {
  PARAGRAPH_SIM_THRESHOLD,
  SENTENCE_SIM_THRESHOLD,
  blockPlain,
  fingerprint,
  hashString,
  similarityScore,
  splitSentences,
} from './text-metrics.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';

const OPENING_RE =
  /^(when planning|to start|in this (?:section|guide)|first[,]?|overall[,]?|another (?:key|important)|it is worth|as mentioned)/i;
const TRANSITION_RE =
  /^(additionally|furthermore|moreover|in addition|on the other hand|that said|moving on)/i;
const CTA_RE = /\b(click here|read (?:our|more)|explore (?:our|more)|visit our guide|check out our)\b/i;
const CHECKLIST_RE = /\b(checklist|make sure to|don'?t forget to|be sure to)\b/i;

function dedupeSentences(text: string): { text: string; removed: number } {
  const sentences = splitSentences(text);
  const kept: string[] = [];
  let removed = 0;
  for (const s of sentences) {
    const dup = kept.some((k) => similarityScore(k, s) >= SENTENCE_SIM_THRESHOLD);
    if (dup) {
      removed += 1;
      continue;
    }
    kept.push(s);
  }
  return { text: kept.join(' ').replace(/\s+/g, ' ').trim(), removed };
}

function rewriteDuplicateParagraph(original: string, siblingHint: string): string | null {
  // Exact / near clones: drop the duplicate (caller removes empty)
  if (similarityScore(original, siblingHint) >= PARAGRAPH_SIM_THRESHOLD) {
    return null;
  }
  const sentences = splitSentences(original);
  const unique = sentences.filter((s) => similarityScore(s, siblingHint) < SENTENCE_SIM_THRESHOLD);
  if (!unique.length) return null;
  const candidate = unique
    .join(' ')
    .replace(OPENING_RE, 'Next,')
    .replace(TRANSITION_RE, 'Separately,');
  if (similarityScore(candidate, siblingHint) >= PARAGRAPH_SIM_THRESHOLD) return null;
  return candidate;
}

function sectionKeyForIndex(blocks: DraftBlock[], index: number): string {
  for (let i = index; i >= 0; i--) {
    const b = blocks[i];
    if (b?.type === 'heading' && b.heading) return fingerprint(b.heading);
  }
  return 'body';
}

export function detectAndRepairRepetition(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  removed: number;
} {
  const findings: ValidatorFinding[] = [];
  let removed = 0;
  const blocks = [...(draft.blocks || [])];
  const seenHashes = new Map<string, number>();
  const sectionTexts = new Map<string, string[]>();

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || isProtectedBlock(b)) continue;
    if (b.type === 'heading') continue;
    if (typeof b.content !== 'string') continue;

    let content = b.content;
    const sent = dedupeSentences(content);
    if (sent.removed) {
      removed += sent.removed;
      content = sent.text;
      findings.push({
        code: 'duplicate_sentence',
        message: `Removed ${sent.removed} near-duplicate sentence(s)`,
        severity: 'warn',
        location: b.id,
      });
    }

    const fp = fingerprint(content);
    const h = hashString(fp);
    const priorIdx = seenHashes.get(h);
    let drop = false;
    if (priorIdx !== undefined && similarityScore(content, String(blocks[priorIdx]?.content || '')) >= PARAGRAPH_SIM_THRESHOLD) {
      const sibling = String(blocks[priorIdx]?.content || '');
      const rewritten = rewriteDuplicateParagraph(content, sibling);
      if (rewritten === null) {
        drop = true;
        removed += 1;
        findings.push({
          code: 'duplicate_paragraph',
          message: 'Removed duplicated paragraph',
          severity: 'error',
          location: b.id,
        });
      } else {
        content = rewritten;
        removed += 1;
        findings.push({
          code: 'duplicate_paragraph',
          message: 'Rewrote duplicated paragraph',
          severity: 'error',
          location: b.id,
        });
      }
    } else {
      // Fuzzy paragraph compare against recent body paragraphs
      for (let j = Math.max(0, i - 12); j < i; j++) {
        const prev = blocks[j];
        if (!prev || typeof prev.content !== 'string' || isProtectedBlock(prev)) continue;
        if (similarityScore(content, prev.content) >= PARAGRAPH_SIM_THRESHOLD) {
          const rewritten = rewriteDuplicateParagraph(content, prev.content);
          if (rewritten === null) {
            drop = true;
            removed += 1;
            findings.push({
              code: 'similar_paragraph',
              message: 'Removed near-duplicate paragraph',
              severity: 'error',
              location: b.id,
            });
          } else {
            content = rewritten;
            removed += 1;
            findings.push({
              code: 'similar_paragraph',
              message: 'Rewrote near-duplicate paragraph',
              severity: 'error',
              location: b.id,
            });
          }
          break;
        }
      }
    }

    if (drop) {
      blocks[i] = { ...b, content: '' };
      continue;
    }

    // Opening / transition / CTA / checklist echo across sections
    const opening = content.slice(0, 64);
    if (OPENING_RE.test(opening) || TRANSITION_RE.test(opening) || CTA_RE.test(content) || CHECKLIST_RE.test(content.slice(0, 120))) {
      for (let j = 0; j < i; j++) {
        const prev = blocks[j];
        if (!prev || typeof prev.content !== 'string') continue;
        const po = prev.content.slice(0, 64);
        if (fingerprint(opening) === fingerprint(po) && opening.length > 20) {
          content = content.replace(OPENING_RE, 'Next,').replace(TRANSITION_RE, 'Separately,');
          findings.push({
            code: 'repeated_opening',
            message: 'Diversified repeated opening/transition',
            severity: 'warn',
            location: b.id,
          });
          removed += 1;
          break;
        }
      }
    }

    const sk = sectionKeyForIndex(blocks, i);
    const bucket = sectionTexts.get(sk) || [];
    const sectionBlob = bucket.join(' ');
    if (sectionBlob && similarityScore(content, sectionBlob) >= 0.6 && content.length > 80) {
      const rewritten = rewriteDuplicateParagraph(content, sectionBlob);
      if (rewritten === null) {
        blocks[i] = { ...b, content: '' };
        removed += 1;
        findings.push({
          code: 'section_echo',
          message: 'Removed section-level repeated advice',
          severity: 'error',
          location: b.id,
        });
        continue;
      }
      content = rewritten;
      removed += 1;
      findings.push({
        code: 'section_echo',
        message: 'Rewrote section-level repeated advice',
        severity: 'error',
        location: b.id,
      });
    }
    bucket.push(content);
    sectionTexts.set(sk, bucket);
    seenHashes.set(hashString(fingerprint(content)), i);

    blocks[i] = { ...b, content };
  }

  // Drop emptied duplicate paragraphs
  const compacted = blocks.filter((b) => !(b.type === 'paragraph' && typeof b.content === 'string' && !b.content.trim()));
  const nextDraft = { ...draft, blocks: compacted };

  // FAQ / summary / tip link-anchor repetition (body-aware; still scan protected for findings only)
  const adviceSnips: string[] = [];
  for (const b of compacted) {
    const text = blockPlain(b);
    if (!text) continue;
    if (/\b(recommend|you should|best (?:option|choice)|ideal for)\b/i.test(text)) {
      const snip = fingerprint(text).slice(0, 100);
      if (adviceSnips.some((a) => similarityScore(a, snip) >= 0.85)) {
        findings.push({
          code: 'repeated_recommendation',
          message: 'Repeated recommendation pattern detected',
          severity: 'warn',
          location: b.id,
        });
      } else {
        adviceSnips.push(snip);
      }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const residualDupes = findings.filter((f) =>
    ['duplicate_paragraph', 'similar_paragraph', 'section_echo'].includes(f.code)
  ).length;
  let remainingHard = 0;
  const bodyParas = compacted.filter(
    (b) => !isProtectedBlock(b) && typeof b.content === 'string' && b.content.trim().length > 40
  );
  for (let i = 0; i < bodyParas.length; i++) {
    for (let j = 0; j < i; j++) {
      if (
        similarityScore(String(bodyParas[i].content), String(bodyParas[j].content)) >=
        PARAGRAPH_SIM_THRESHOLD
      ) {
        remainingHard += 1;
      }
    }
  }

  const score =
    remainingHard > 0
      ? Math.max(0, 40 - remainingHard * 10)
      : Math.max(55, 100 - residualDupes * 5 - errors);
  const status =
    remainingHard > 0
      ? 'FAIL'
      : statusFromScore(score, false, findings.some((f) => f.severity === 'warn'));

  return {
    draft: nextDraft,
    removed,
    result: {
      category: 'repeated_content',
      status: remainingHard > 0 ? 'FAIL' : status === 'FAIL' && remainingHard === 0 ? 'WARNING' : status,
      score: remainingHard > 0 ? score : Math.max(score, remainingHard === 0 ? 70 : score),
      findings:
        remainingHard > 0
          ? [
              ...findings,
              {
                code: 'residual_duplicates',
                message: `${remainingHard} paragraph pair(s) still above threshold`,
                severity: 'error',
              },
            ]
          : findings,
      repaired: removed,
    },
  };
}
