/**
 * Human writing validator — AI Phrase Blacklist + residual detection; rewrite naturally.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import { isProtectedBlock } from '../block-integrity.js';
import {
  applyAiPhraseBlacklist,
  detectAiPhrases,
  diversifyParagraphOpenings,
  varySentenceRhythm,
} from '../ai-phrase-blacklist.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';

export function validateAndHumanizeWriting(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  cliches_removed: number;
} {
  const findings: ValidatorFinding[] = [];
  let cliches_removed = 0;
  const paraTexts: string[] = [];
  const paraIndexes: number[] = [];

  const blocks = (draft.blocks || []).map((b, i) => {
    if (isProtectedBlock(b) && b.type !== 'intro' && b.type !== 'summary') return b;
    if (typeof b.content !== 'string') return b;
    let content = b.content;

    const bl = applyAiPhraseBlacklist(content);
    if (bl.hits.length) {
      cliches_removed += bl.hits.length;
      content = bl.text;
      for (const id of bl.hits.slice(0, 3)) {
        findings.push({
          code: id,
          message: `Removed AI phrase (${id})`,
          severity: 'warn',
          location: b.id,
        });
      }
    }

    const rhythm = varySentenceRhythm(content);
    if (rhythm.changed) {
      content = rhythm.text;
      cliches_removed += 1;
    }

    if (b.type === 'paragraph' || b.type === 'tip') {
      paraIndexes.push(i);
      paraTexts.push(content);
    }

    content = content.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
    return { ...b, content };
  });

  const diversified = diversifyParagraphOpenings(paraTexts);
  if (diversified.changed) {
    for (let k = 0; k < paraIndexes.length; k++) {
      const idx = paraIndexes[k];
      const b = blocks[idx];
      if (b && typeof b.content === 'string' && diversified.paragraphs[k] !== b.content) {
        blocks[idx] = { ...b, content: diversified.paragraphs[k] };
        cliches_removed += 1;
        findings.push({
          code: 'opening_diversified',
          message: 'Diversified repeated paragraph opening',
          severity: 'info',
          location: b.id,
        });
      }
    }
  }

  const blob = blocks.map((b) => (typeof b.content === 'string' ? b.content : '')).join('\n');
  const residual = detectAiPhrases(blob);
  for (const id of residual) {
    findings.push({
      code: `residual_${id}`,
      message: `Residual AI phrase: ${id}`,
      severity: 'error',
    });
  }

  const score =
    residual.length > 0
      ? Math.max(0, 35 - residual.length * 8)
      : Math.max(75, 100 - cliches_removed * 2);

  return {
    draft: { ...draft, blocks },
    cliches_removed,
    result: {
      category: 'human_writing',
      status: residual.length > 0 ? 'FAIL' : statusFromScore(score, false, cliches_removed > 0),
      score: residual.length > 0 ? score : Math.max(score, 80),
      findings,
      rewritten: cliches_removed,
    },
  };
}
