/**
 * Content Quality Engine orchestrator.
 * Pipeline (integrity-safe): repetition → content-memory/cross-section →
 * sentence repair → expansion → guide → human writing → leakage → helpful →
 * country → FAQ → summary → section diversity → final editor → score.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import {
  ensureDraftIntegrity,
  snapshotProtected,
  type ProtectedSnapshot,
} from '../block-integrity.js';
import { checkCrossSectionSimilarity } from '../cross-section-similarity.js';
import { detectAndRepairRepetition } from './repetition-detector.js';
import { repairSentences } from './sentence-repair.js';
import { expandContentMeaningfully } from './content-expansion.js';
import { validateGuideType } from './guide-validator.js';
import { validateAndHumanizeWriting } from './human-writing-validator.js';
import { validateAndStripPromptLeakage } from './prompt-leakage-validator.js';
import { validateHelpfulContent } from './helpful-content-validator.js';
import { validateCountrySpecific } from './country-specific-validator.js';
import { validateFaq } from './faq-validator.js';
import { validateSummary } from './summary-validator.js';
import { diversifySections } from './section-diversity.js';
import { runFinalEditor } from './final-editor.js';
import { buildDebugReport, formatQualityDebug } from './score.js';
import type {
  ContentQualityInput,
  ContentQualityResult,
  ValidatorResult,
} from './types.js';

function withIntegrity(
  draft: WriterDraftPayload,
  snapshot: ProtectedSnapshot
): WriterDraftPayload {
  return ensureDraftIntegrity(draft, snapshot).draft;
}

/**
 * Run the full Content Quality Engine.
 * Rewrites are body-aware; protected intro/toc/faq/summary restored via integrity.
 */
export function runContentQualityEngine(input: ContentQualityInput): ContentQualityResult {
  const snapshot = snapshotProtected(input.draft.blocks || []);
  let draft = input.draft;
  const validators: ValidatorResult[] = [];

  let repeated_paragraphs_removed = 0;
  let sentences_repaired = 0;
  let leakage_removed = 0;
  let sections_rewritten = 0;
  let examples_added = 0;
  let expansion_words_added = 0;
  let ai_cliches_removed = 0;

  // 1. Repetition
  {
    const r = detectAndRepairRepetition(draft);
    draft = withIntegrity(r.draft, snapshot);
    repeated_paragraphs_removed = r.removed;
    validators.push(r.result);
  }

  // 1b. Content memory + cross-section similarity (NEW VALUE only)
  {
    const r = checkCrossSectionSimilarity(draft, { repair: true });
    draft = withIntegrity(r.draft, snapshot);
    sections_rewritten += r.report.sections_rewritten;
    validators.push(r.result);
  }

  // 2. Sentence repair
  {
    const r = repairSentences(draft);
    draft = withIntegrity(r.draft, snapshot);
    sentences_repaired = r.repaired;
    validators.push(r.result);
  }

  // 3. Meaningful expansion (never fake pad)
  {
    const r = expandContentMeaningfully({
      draft,
      guideId: input.guideId,
      country: input.country,
      city: input.city,
      articleMinWords: input.articleMinWords,
    });
    draft = withIntegrity(r.draft, snapshot);
    examples_added = r.examples_added;
    expansion_words_added = r.expansion_words_added;
    validators.push(r.result);
  }

  // 4. Guide type
  validators.push(validateGuideType(draft, input.guideId));

  // 5. Human writing (AI phrase blacklist + rhythm)
  {
    const r = validateAndHumanizeWriting(draft);
    draft = withIntegrity(r.draft, snapshot);
    ai_cliches_removed = r.cliches_removed;
    validators.push(r.result);
  }

  // 6. Prompt leakage
  {
    const r = validateAndStripPromptLeakage(draft);
    draft = withIntegrity(r.draft, snapshot);
    leakage_removed = r.leakage_removed;
    validators.push(r.result);
  }

  // 7. Helpful content
  {
    const r = validateHelpfulContent(draft);
    draft = withIntegrity(r.draft, snapshot);
    sections_rewritten += r.sections_rewritten;
    validators.push(r.result);
  }

  // 8. Country-specific
  validators.push(
    validateCountrySpecific(draft, {
      guideId: input.guideId,
      country: input.country,
    })
  );

  // 9. FAQ
  {
    const r = validateFaq(draft);
    draft = withIntegrity(r.draft, snapshot);
    sections_rewritten += r.rewritten;
    validators.push(r.result);
  }

  // 10. Summary
  {
    const r = validateSummary(draft);
    draft = withIntegrity(r.draft, snapshot);
    sections_rewritten += r.rewritten;
    validators.push(r.result);
  }

  // 11. Section diversity
  {
    const r = diversifySections(draft);
    draft = withIntegrity(r.draft, snapshot);
    sections_rewritten += r.rewritten;
    validators.push(r.result);
  }

  // 12. Final editor
  {
    const r = runFinalEditor(draft);
    draft = withIntegrity(r.draft, snapshot);
    validators.push(r.result);
  }

  // Re-validate hard categories after all repairs (fresh pass on residual issues)
  const postRepetition = detectAndRepairRepetition(draft);
  draft = withIntegrity(postRepetition.draft, snapshot);
  repeated_paragraphs_removed += postRepetition.removed;
  replaceValidator(validators, postRepetition.result);

  const postCross = checkCrossSectionSimilarity(draft, { repair: true });
  draft = withIntegrity(postCross.draft, snapshot);
  sections_rewritten += postCross.report.sections_rewritten;
  replaceValidator(validators, postCross.result);

  const postSentences = repairSentences(draft);
  draft = withIntegrity(postSentences.draft, snapshot);
  sentences_repaired += postSentences.repaired;
  replaceValidator(validators, postSentences.result);

  const postHuman = validateAndHumanizeWriting(draft);
  draft = withIntegrity(postHuman.draft, snapshot);
  ai_cliches_removed += postHuman.cliches_removed;
  replaceValidator(validators, postHuman.result);

  const postLeak = validateAndStripPromptLeakage(draft);
  draft = withIntegrity(postLeak.draft, snapshot);
  leakage_removed += postLeak.leakage_removed;
  replaceValidator(validators, postLeak.result);

  replaceValidator(validators, validateGuideType(draft, input.guideId));

  const report = buildDebugReport(validators, {
    repeated_paragraphs_removed,
    sentences_repaired,
    leakage_removed,
    sections_rewritten,
    examples_added,
    expansion_words_added,
    ai_cliches_removed,
  });

  return {
    draft,
    score: report.final_score,
    block_save: report.block_save,
    report,
    validators,
  };
}

function replaceValidator(list: ValidatorResult[], next: ValidatorResult): void {
  const idx = list.findIndex((v) => v.category === next.category);
  if (idx >= 0) list[idx] = next;
  else list.push(next);
}

export { formatQualityDebug, buildDebugReport };
export type { ContentQualityInput, ContentQualityResult, ValidatorResult };
export { hasFakeExpansionPattern } from './content-expansion.js';
export { BLOCK_SAVE_CATEGORIES } from './types.js';
