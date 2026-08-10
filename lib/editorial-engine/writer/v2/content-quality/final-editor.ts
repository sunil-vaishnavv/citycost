/**
 * Final editor — senior editor pass for flow/tone/continuity without changing facts.
 * Deterministic (no full regen). Integrity-safe: skips protected FAQ/TOC; light touch on intro/summary.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import { isProtectedBlock } from '../block-integrity.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';

const FLOW_FIXES: Array<{ re: RegExp; to: string }> = [
  { re: /\bHowever,\s+However,/gi, to: 'However,' },
  { re: /\bAlso,\s+Also,/gi, to: 'Also,' },
  { re: /\bThis this\b/gi, to: 'This' },
  { re: /\s+—\s+—\s+/g, to: ' — ' },
  { re: /\b(\w+)\,\s+\1\b/gi, to: '$1' },
];

function preserveNumbers(before: string, after: string): string {
  const numsBefore = before.match(/\d+(?:[.,]\d+)?%?/g) || [];
  const numsAfter = after.match(/\d+(?:[.,]\d+)?%?/g) || [];
  if (numsBefore.join('|') === numsAfter.join('|')) return after;
  return before; // refuse edits that alter numeric facts
}

export function runFinalEditor(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
} {
  const findings: ValidatorFinding[] = [];
  let edits = 0;
  const blocks = (draft.blocks || []).map((b, i) => {
    if (b.type === 'faq' || (isProtectedBlock(b) && b.type !== 'intro' && b.type !== 'summary')) {
      return b;
    }
    if (typeof b.content !== 'string') return b;
    let content = b.content;
    for (const f of FLOW_FIXES) {
      const next = content.replace(f.re, f.to);
      if (next !== content) {
        content = next;
        edits += 1;
      }
    }
    // Continuity: if paragraph starts with same 6 words as previous body paragraph, soften
    if (i > 0 && blocksPrevOpening(draft, i) && content.length > 60) {
      const prevOpen = blocksPrevOpening(draft, i)!;
      const curOpen = content.split(/\s+/).slice(0, 6).join(' ').toLowerCase();
      if (prevOpen === curOpen) {
        content = content.replace(/^(\S+\s+){1,3}/, 'From there, ');
        edits += 1;
        findings.push({
          code: 'continuity_softened',
          message: 'Softened consecutive identical openings',
          severity: 'info',
          location: b.id,
        });
      }
    }
    content = content.replace(/\s{2,}/g, ' ').trim();
    content = preserveNumbers(b.content, content);
    return { ...b, content };
  });

  findings.push({
    code: 'final_editor_pass',
    message: `Applied ${edits} continuity/flow edit(s)`,
    severity: 'info',
  });

  return {
    draft: { ...draft, blocks },
    result: {
      category: 'final_editor',
      status: 'PASS',
      score: 100,
      findings,
      rewritten: edits,
    },
  };
}

function blocksPrevOpening(draft: WriterDraftPayload, index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const b = draft.blocks[i];
    if (!b || isProtectedBlock(b)) continue;
    if (typeof b.content !== 'string' || b.content.length < 40) continue;
    return b.content.split(/\s+/).slice(0, 6).join(' ').toLowerCase();
  }
  return null;
}
