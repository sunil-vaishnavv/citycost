/**
 * Corruption checks for Revision — rollback ONLY on these failures.
 * Score drops are NOT corruption.
 * Word-count regression below article_length_min IS corruption (must not shrink past hard min).
 */

import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { countDraftWords } from '../writer/draft-validate.js';

export interface CorruptionResult {
  corrupted: boolean;
  reasons: string[];
}

export interface CorruptionOptions {
  /** Hard minimum from settings.article_length_min — reject shrinks below this floor. */
  minWords?: number;
}

function hasType(draft: WriterDraftPayload, type: string): boolean {
  return (draft.blocks || []).some((b) => b.type === type);
}

function hasToc(draft: WriterDraftPayload): boolean {
  return (draft.blocks || []).some(
    (b) =>
      (b.type === 'heading' && /table of contents|^contents$/i.test(b.heading || '')) ||
      (b.type === 'list' &&
        /table of contents|contents/i.test(String(b.heading || '') + String(b.content || '')))
  );
}

/**
 * Detect corrupted revision output vs the pre-revision draft.
 */
export function detectDraftCorruption(
  before: WriterDraftPayload,
  after: WriterDraftPayload,
  opts?: CorruptionOptions
): CorruptionResult {
  const reasons: string[] = [];
  const beforeBlocks = before.blocks || [];
  const afterBlocks = after.blocks || [];

  if (!afterBlocks.length) {
    reasons.push('All content blocks missing');
  }

  // Catastrophic block loss
  if (beforeBlocks.length >= 6 && afterBlocks.length < Math.max(4, Math.floor(beforeBlocks.length * 0.45))) {
    reasons.push(
      `Block count collapsed ${beforeBlocks.length} → ${afterBlocks.length}`
    );
  }

  const beforeWords = countDraftWords(before);
  const afterWords = countDraftWords(after);
  if (beforeWords >= 800 && afterWords < Math.floor(beforeWords * 0.45)) {
    reasons.push(`Word count collapsed ${beforeWords} → ${afterWords}`);
  }

  const minWords = opts?.minWords;
  if (
    typeof minWords === 'number' &&
    minWords > 0 &&
    afterWords < beforeWords &&
    afterWords < minWords
  ) {
    // Never accept a revision that shrinks the draft below the hard minimum.
    reasons.push(
      `Word count fell below minimum ${minWords} (${beforeWords} → ${afterWords})`
    );
  }

  // Required sections that existed must not disappear
  for (const type of ['intro', 'faq', 'summary'] as const) {
    if (hasType(before, type) && !hasType(after, type)) {
      reasons.push(`Missing required section after revision: ${type}`);
    }
  }

  if (hasToc(before) && !hasToc(after)) {
    reasons.push('Table of contents removed');
  }

  // Empty draft shell
  const emptyBodies = afterBlocks.filter((b) => {
    if (b.type === 'heading') return false;
    const raw = JSON.stringify(b.content ?? '');
    return raw.replace(/[\s"\[\]{}null]/g, '').length < 2;
  }).length;
  if (afterBlocks.length >= 4 && emptyBodies >= Math.ceil(afterBlocks.length * 0.5)) {
    reasons.push('Majority of body blocks are empty');
  }

  // Meta wiped when it previously existed
  if ((before.meta_title || '').trim() && !(after.meta_title || '').trim()) {
    reasons.push('meta_title wiped');
  }
  if ((before.meta_description || '').trim() && !(after.meta_description || '').trim()) {
    reasons.push('meta_description wiped');
  }

  return { corrupted: reasons.length > 0, reasons };
}
