/**
 * Helpful content validator (Content Quality) — scores sections using shared
 * helpfulness detectors. Upgrades are owned by writer/v2 helpfulness pipeline
 * (runs after CQ); this stage avoids duplicate contradictory rewrites.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';
import {
  scoreHelpfulDraft,
  sectionHasPracticalAdvice,
  sectionIsDefinitionOnly,
} from '../helpful-content.js';
import { draftSectionChunks } from '../section-chunks.js';

export function validateHelpfulContent(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  sections_rewritten: number;
} {
  const findings: ValidatorFinding[] = [];
  const stats = scoreHelpfulDraft(draft);
  const chunks = draftSectionChunks(draft);

  for (const chunk of chunks) {
    if (!sectionHasPracticalAdvice(chunk.text)) {
      findings.push({
        code: 'definition_or_filler',
        message: `Section "${chunk.heading}" lacks practical advice (SO WHAT / HOW / checklist)`,
        severity: 'warn',
        location: chunk.ids[0],
      });
    }
    if (sectionIsDefinitionOnly(chunk.text)) {
      findings.push({
        code: 'definition_only',
        message: `Section "${chunk.heading}" reads as definition-only`,
        severity: 'warn',
        location: chunk.ids[0],
      });
    }
  }

  // Soft score only — helpfulness pipeline applies upgrades after CQ
  const score = stats.score;
  return {
    draft,
    sections_rewritten: 0,
    result: {
      category: 'helpful_content',
      status: statusFromScore(score, false, findings.length > 0),
      score,
      findings,
      rewritten: 0,
    },
  };
}
