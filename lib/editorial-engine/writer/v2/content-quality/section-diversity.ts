/**
 * Section diversity — unique rhythm / opening / transition / sentence pattern per section.
 */

import type { DraftBlock, WriterDraftPayload } from '../../draft-validate.js';
import { isProtectedBlock } from '../block-integrity.js';
import { fingerprint, splitSentences } from './text-metrics.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';

const OPENINGS = [
  'Start with',
  'When you',
  'A practical',
  'For most',
  'Before you',
  'Look at',
  'Compare',
  'Build a',
];

function firstSentence(text: string): string {
  return splitSentences(text)[0] || text.slice(0, 80);
}

function rhythmSignature(text: string): string {
  const lens = splitSentences(text).map((s) => {
    const n = s.split(/\s+/).length;
    if (n < 10) return 'S';
    if (n < 22) return 'M';
    return 'L';
  });
  return lens.slice(0, 6).join('');
}

function diversifyOpening(text: string, used: Set<string>, sectionIndex: number): string {
  const first = firstSentence(text);
  const fp = fingerprint(first).slice(0, 48);
  if (!used.has(fp)) {
    used.add(fp);
    return text;
  }
  const starter = OPENINGS[sectionIndex % OPENINGS.length];
  const rest = text.replace(/^[^.!?]*(?:[.!?]|$)\s*/, '');
  const next = `${starter} ${rest || text}`.replace(/\s+/g, ' ').trim();
  used.add(fingerprint(firstSentence(next)).slice(0, 48));
  return next;
}

export function diversifySections(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  rewritten: number;
} {
  const findings: ValidatorFinding[] = [];
  let rewritten = 0;
  const blocks = [...(draft.blocks || [])];
  const usedOpenings = new Set<string>();
  const usedRhythm = new Set<string>();
  let sectionIndex = 0;
  let sectionFirstPara = -1;

  const flushSection = () => {
    if (sectionFirstPara < 0) return;
    const b = blocks[sectionFirstPara];
    if (!b || typeof b.content !== 'string') return;
    const rhythm = rhythmSignature(b.content);
    if (usedRhythm.has(rhythm) && rhythm.length >= 3) {
      // Nudge sentence lengths by splitting a long sentence if possible
      const sents = splitSentences(b.content);
      if (sents.length >= 2) {
        const swapped = [sents[1], sents[0], ...sents.slice(2)].join(' ');
        blocks[sectionFirstPara] = { ...b, content: swapped };
        rewritten += 1;
        findings.push({
          code: 'rhythm_collision',
          message: 'Adjusted repeated section rhythm',
          severity: 'info',
          location: b.id,
        });
      }
    } else {
      usedRhythm.add(rhythm);
    }

    const diversified = diversifyOpening(
      String(blocks[sectionFirstPara].content),
      usedOpenings,
      sectionIndex
    );
    if (diversified !== blocks[sectionFirstPara].content) {
      blocks[sectionFirstPara] = { ...blocks[sectionFirstPara], content: diversified };
      rewritten += 1;
      findings.push({
        code: 'opening_diversified',
        message: 'Diversified repeated section opening',
        severity: 'info',
        location: blocks[sectionFirstPara].id,
      });
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || isProtectedBlock(b)) continue;
    if (b.type === 'heading') {
      flushSection();
      sectionIndex += 1;
      sectionFirstPara = -1;
      continue;
    }
    if (sectionFirstPara < 0 && typeof b.content === 'string' && b.content.length > 40) {
      sectionFirstPara = i;
    }
  }
  flushSection();

  const score = Math.max(70, 100 - rewritten * 4);
  return {
    draft: { ...draft, blocks },
    rewritten,
    result: {
      category: 'section_diversity',
      status: statusFromScore(score, false, rewritten > 3),
      score,
      findings,
      rewritten,
    },
  };
}
