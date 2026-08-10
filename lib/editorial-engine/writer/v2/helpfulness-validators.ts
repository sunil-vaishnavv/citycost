/**
 * Helpfulness validators — Real Example, Natural Link, Decision, Helpful Content.
 * Reject draft when thresholds breach (wired via helpfulness pipeline block_save).
 */

import type { WriterDraftPayload } from '../draft-validate.js';
import type { GuideId } from './types.js';
import { draftSectionChunks } from './section-chunks.js';
import { sectionHasExample } from './example-engine.js';
import { hasVisibleSlugAnchors } from './link-engine.js';
import { draftHasDecisionGuidance, sectionHasDecisionGuidance } from './decision-support-engine.js';
import {
  scoreHelpfulDraft,
  sectionHasPracticalAdvice,
  sectionIsDefinitionOnly,
} from './helpful-content.js';
import {
  validateActionableValue,
} from './actionable-value-blocks.js';

export type HelpfulnessValidatorId =
  | 'real_example'
  | 'natural_link'
  | 'decision'
  | 'helpful_content'
  | 'actionable_value';

export interface HelpfulnessFinding {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'error';
}

export interface HelpfulnessValidatorResult {
  id: HelpfulnessValidatorId;
  ok: boolean;
  score: number;
  findings: HelpfulnessFinding[];
}

/** >30% sections without practical advice → reject */
export const MAX_NO_ADVICE_RATIO = 0.3;
/** >20% definition-only sections → reject */
export const MAX_DEFINITION_ONLY_RATIO = 0.2;

export function validateRealExamples(
  draft: WriterDraftPayload,
  _guideId?: GuideId
): HelpfulnessValidatorResult {
  const chunks = draftSectionChunks(draft);
  const findings: HelpfulnessFinding[] = [];
  let withExample = 0;
  for (const c of chunks) {
    if (sectionHasExample(c.text)) withExample += 1;
    else {
      findings.push({
        code: 'missing_example',
        message: `Section "${c.heading}" lacks a practical real-world example`,
        severity: 'warn',
      });
    }
  }
  const ratio = chunks.length ? withExample / chunks.length : 1;
  // Soft score: prefer majority of sections with examples; hard fail only if none exist on multi-section drafts
  const ok = chunks.length === 0 || withExample > 0;
  const score = Math.round(Math.min(100, ratio * 100));
  if (!ok) {
    findings.push({
      code: 'no_examples',
      message: 'Draft has no practical real-world examples',
      severity: 'error',
    });
  }
  return { id: 'real_example', ok, score, findings };
}

export function validateNaturalLinks(draft: WriterDraftPayload): HelpfulnessValidatorResult {
  const findings: HelpfulnessFinding[] = [];
  const hasSlugs = hasVisibleSlugAnchors(draft);
  if (hasSlugs) {
    findings.push({
      code: 'slug_anchors',
      message: 'Visible text still contains slug-style or CTA link anchors',
      severity: 'error',
    });
  }
  return {
    id: 'natural_link',
    ok: !hasSlugs,
    score: hasSlugs ? 0 : 100,
    findings,
  };
}

export function validateDecisionGuidance(draft: WriterDraftPayload): HelpfulnessValidatorResult {
  const chunks = draftSectionChunks(draft);
  const findings: HelpfulnessFinding[] = [];
  let withDecision = 0;
  for (const c of chunks) {
    if (sectionHasDecisionGuidance(c.text)) withDecision += 1;
  }
  const hasAny = draftHasDecisionGuidance(draft);
  if (!hasAny) {
    findings.push({
      code: 'no_decision_guidance',
      message: 'No decision guidance found in the draft',
      severity: 'error',
    });
  } else if (chunks.length >= 2 && withDecision / chunks.length < 0.5) {
    findings.push({
      code: 'sparse_decision_guidance',
      message: 'Fewer than half of sections include decision guidance',
      severity: 'warn',
    });
  }
  const score = hasAny
    ? Math.round(Math.min(100, (withDecision / Math.max(1, chunks.length)) * 100 + 20))
    : 0;
  return { id: 'decision', ok: hasAny, score, findings };
}

export function validateHelpfulContentV2(draft: WriterDraftPayload): HelpfulnessValidatorResult {
  const stats = scoreHelpfulDraft(draft);
  const findings: HelpfulnessFinding[] = [];
  let ok = true;

  if (stats.missingAdviceRatio > MAX_NO_ADVICE_RATIO) {
    ok = false;
    findings.push({
      code: 'too_little_practical_advice',
      message: `More than ${MAX_NO_ADVICE_RATIO * 100}% of sections lack practical advice (${(stats.missingAdviceRatio * 100).toFixed(0)}%)`,
      severity: 'error',
    });
  }
  if (stats.definitionOnlyRatio > MAX_DEFINITION_ONLY_RATIO) {
    ok = false;
    findings.push({
      code: 'too_many_definitions',
      message: `More than ${MAX_DEFINITION_ONLY_RATIO * 100}% of sections are definition-only (${(stats.definitionOnlyRatio * 100).toFixed(0)}%)`,
      severity: 'error',
    });
  }

  // Per-section diagnostics
  for (const c of draftSectionChunks(draft)) {
    if (!sectionHasPracticalAdvice(c.text)) {
      findings.push({
        code: 'section_no_advice',
        message: `Section "${c.heading}" has no practical advice element`,
        severity: 'warn',
      });
    }
    if (sectionIsDefinitionOnly(c.text)) {
      findings.push({
        code: 'section_definition_only',
        message: `Section "${c.heading}" reads as definition-only`,
        severity: 'warn',
      });
    }
  }

  return {
    id: 'helpful_content',
    ok,
    score: stats.score,
    findings,
  };
}

/** Enforce guide-type actionable value blocks (decision support, not explanation-only). */
export function validateActionableValueGate(
  draft: WriterDraftPayload,
  guideId: GuideId
): HelpfulnessValidatorResult {
  const v = validateActionableValue(draft, guideId);
  return {
    id: 'actionable_value',
    ok: v.ok,
    score: v.score,
    findings: v.findings,
  };
}

export function runHelpfulnessValidators(draft: WriterDraftPayload, guideId: GuideId): {
  validators: HelpfulnessValidatorResult[];
  block_save: boolean;
  block_reasons: string[];
} {
  const validators = [
    validateRealExamples(draft, guideId),
    validateNaturalLinks(draft),
    validateDecisionGuidance(draft),
    validateHelpfulContentV2(draft),
    validateActionableValueGate(draft, guideId),
  ];
  const block_reasons: string[] = [];
  for (const v of validators) {
    if (!v.ok) {
      for (const f of v.findings.filter((x) => x.severity === 'error')) {
        block_reasons.push(`${v.id}:${f.code}`);
      }
      if (!v.findings.some((x) => x.severity === 'error')) {
        block_reasons.push(`${v.id}:fail`);
      }
    }
  }
  return {
    validators,
    block_save: block_reasons.length > 0,
    block_reasons: [...new Set(block_reasons)],
  };
}
