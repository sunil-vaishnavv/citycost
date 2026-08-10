/**
 * Pre-save Quality Gates — repair automatically; do not save low-quality drafts.
 * Order: Cross-section similarity → Human writing → Helpful/Actionable →
 * FAQ → Summary → Final Sanitizer last.
 */

import type { WriterDraftPayload } from '../draft-validate.js';
import {
  ensureDraftIntegrity,
  snapshotProtected,
  type ProtectedSnapshot,
} from './block-integrity.js';
import type { GuideId } from './types.js';
import {
  checkCrossSectionSimilarity,
  formatCrossSectionDebug,
  type CrossSectionSimilarityReport,
} from './cross-section-similarity.js';
import {
  detectHumanWritingIssues,
  humanizeDeterministicWithReport,
} from './humanization.js';
import {
  applyActionableValueBlocks,
  validateActionableValue,
  type ActionableValueReport,
} from './actionable-value-blocks.js';
import { validateHelpfulContent } from './content-quality/helpful-content-validator.js';
import { validateFaq } from './content-quality/faq-validator.js';
import { validateSummary } from './content-quality/summary-validator.js';
import {
  formatFinalSanitizerDebug,
  runFinalSanitizer,
  type FinalSanitizerReport,
} from './final-sanitizer.js';
import { applyHelpfulContent } from './helpful-content.js';
import { applyDecisionSupport } from './decision-support-engine.js';
import type { ValidatorResult } from './content-quality/types.js';

export interface QualityGatesInput {
  draft: WriterDraftPayload;
  guideId: GuideId;
  country?: string;
  city?: string;
  city_b?: string;
  /** Optional protected snapshot — restored after each mutating gate */
  snapshot?: ProtectedSnapshot;
}

export interface QualityGatesReport {
  cross_section: CrossSectionSimilarityReport;
  human_writing_ok: boolean;
  human_phrases_removed: number;
  actionable: ActionableValueReport;
  helpful_ok: boolean;
  faq_ok: boolean;
  summary_ok: boolean;
  sanitizer: FinalSanitizerReport;
  validators: ValidatorResult[];
  block_save: boolean;
  block_reasons: string[];
  ok: boolean;
}

export interface QualityGatesResult {
  draft: WriterDraftPayload;
  report: QualityGatesReport;
}

function withIntegrity(
  draft: WriterDraftPayload,
  snapshot?: ProtectedSnapshot
): WriterDraftPayload {
  if (!snapshot) return draft;
  return ensureDraftIntegrity(draft, snapshot).draft;
}

/**
 * Run all new quality gates with auto-repair.
 * Final Sanitizer is last so earlier rewrites cannot leave broken punctuation.
 */
export function runPreSaveQualityGates(input: QualityGatesInput): QualityGatesResult {
  const snapshot = input.snapshot ?? snapshotProtected(input.draft.blocks || []);
  let draft = input.draft;
  const validators: ValidatorResult[] = [];
  const entities = {
    country: input.country,
    city: input.city,
    city_b: input.city_b,
  };
  let human_phrases_removed = 0;
  let actionableReport: ActionableValueReport = {
    blocks_added: 0,
    kinds_added: [],
    missing_before: [],
  };

  // 1. Cross-section similarity + content memory
  {
    const cross = checkCrossSectionSimilarity(draft, { repair: true });
    draft = withIntegrity(cross.draft, snapshot);
    validators.push(cross.result);
  }

  // 2. Human writing detector + blacklist repair
  {
    const hum = humanizeDeterministicWithReport(draft, input.guideId);
    draft = withIntegrity(hum.draft, snapshot);
    human_phrases_removed = hum.report.phrases_removed;
    let detect = detectHumanWritingIssues(draft);
    if (!detect.ok) {
      const again = humanizeDeterministicWithReport(draft, input.guideId);
      draft = withIntegrity(again.draft, snapshot);
      human_phrases_removed += again.report.phrases_removed;
      detect = detectHumanWritingIssues(draft);
    }
    validators.push({
      category: 'human_writing',
      status: detect.ok ? 'PASS' : 'FAIL',
      score: detect.score,
      findings: detect.residual.map((id) => ({
        code: id,
        message: `Residual AI phrase: ${id}`,
        severity: 'error' as const,
      })),
      rewritten: human_phrases_removed,
    });
  }

  // 3. Helpful content + actionable value blocks + decision support
  {
    const decision = applyDecisionSupport({
      draft,
      guideId: input.guideId,
      entities,
    });
    draft = withIntegrity(decision.draft, snapshot);

    const helpful = applyHelpfulContent({
      draft,
      guideId: input.guideId,
      entities,
    });
    draft = withIntegrity(helpful.draft, snapshot);

    const actionable = applyActionableValueBlocks({
      draft,
      guideId: input.guideId,
      entities,
    });
    draft = withIntegrity(actionable.draft, snapshot);
    actionableReport = actionable.report;

    const helpVal = validateHelpfulContent(draft);
    draft = withIntegrity(helpVal.draft, snapshot);
    validators.push(helpVal.result);

    let actionFinal = validateActionableValue(draft, input.guideId);
    if (!actionFinal.ok) {
      const again = applyActionableValueBlocks({
        draft,
        guideId: input.guideId,
        entities,
      });
      draft = withIntegrity(again.draft, snapshot);
      actionableReport = {
        blocks_added: actionableReport.blocks_added + again.report.blocks_added,
        kinds_added: [...actionableReport.kinds_added, ...again.report.kinds_added],
        missing_before: actionableReport.missing_before,
      };
      actionFinal = validateActionableValue(draft, input.guideId);
    }
    validators.push({
      category: 'actionable_value',
      status: actionFinal.ok ? 'PASS' : 'FAIL',
      score: actionFinal.score,
      findings: actionFinal.findings.map((f) => ({
        code: f.code,
        message: f.message,
        severity: f.severity,
      })),
    });
  }

  // 4. FAQ
  {
    const faq = validateFaq(draft);
    draft = withIntegrity(faq.draft, snapshot);
    validators.push(faq.result);
  }

  // 5. Summary
  {
    const summary = validateSummary(draft);
    draft = withIntegrity(summary.draft, snapshot);
    validators.push(summary.result);
  }

  // 6. Final Sanitizer LAST
  {
    let san = runFinalSanitizer(draft);
    draft = withIntegrity(san.draft, snapshot);
    validators.push(...san.validators);
    if (!san.report.ok) {
      san = runFinalSanitizer(draft);
      draft = withIntegrity(san.draft, snapshot);
    }
  }

  // Final verification (repair:false for cross-section so we don't churn)
  const crossFinal = checkCrossSectionSimilarity(draft, { repair: true });
  draft = withIntegrity(crossFinal.draft, snapshot);
  const humFinal = detectHumanWritingIssues(draft);
  const actionCheck = validateActionableValue(draft, input.guideId);
  const helpCheck = validateHelpfulContent(draft);
  const faqCheck = validateFaq(draft);
  draft = withIntegrity(faqCheck.draft, snapshot);
  const summaryCheck = validateSummary(draft);
  draft = withIntegrity(summaryCheck.draft, snapshot);
  const sanFinal = runFinalSanitizer(draft);
  draft = withIntegrity(sanFinal.draft, snapshot);

  const finalReasons: string[] = [];
  if (!crossFinal.report.ok) finalReasons.push('cross_section_similarity:residual');
  if (!humFinal.ok) finalReasons.push('human_writing:residual_ai_phrases');
  if (!actionCheck.ok) finalReasons.push('actionable_value:missing_blocks');
  if (!sanFinal.report.ok) finalReasons.push('final_sanitizer:residual');

  return {
    draft,
    report: {
      cross_section: crossFinal.report,
      human_writing_ok: humFinal.ok,
      human_phrases_removed,
      actionable: actionableReport,
      helpful_ok: helpCheck.result.status !== 'FAIL' && actionCheck.ok,
      faq_ok: faqCheck.result.status !== 'FAIL',
      summary_ok: summaryCheck.result.status !== 'FAIL',
      sanitizer: sanFinal.report,
      validators,
      block_save: finalReasons.length > 0,
      block_reasons: finalReasons,
      ok: finalReasons.length === 0,
    },
  };
}

export function formatQualityGatesDebug(report: QualityGatesReport): string {
  return [
    `ok=${report.ok ? 'yes' : 'no'}`,
    `block_save=${report.block_save ? 'yes' : 'no'}`,
    `cross=${formatCrossSectionDebug(report.cross_section)}`,
    `human=${report.human_writing_ok ? 'pass' : 'fail'}`,
    `helpful=${report.helpful_ok ? 'pass' : 'fail'}`,
    `faq=${report.faq_ok ? 'pass' : 'fail'}`,
    `summary=${report.summary_ok ? 'pass' : 'fail'}`,
    `sanitizer=${formatFinalSanitizerDebug(report.sanitizer)}`,
    report.block_reasons.length ? `reasons=${report.block_reasons.join('|')}` : 'reasons=none',
  ].join(';');
}
