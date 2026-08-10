/**
 * Helpfulness Pipeline — Real World Examples → Natural Links → Decision Support →
 * Helpful Content upgrades, then validators. Body-section scoped; Block Integrity preserved.
 * Runs AFTER Content Quality Engine / BEFORE Internal Link Engine + Quality Audit.
 *
 * Note: applyNaturalLinks here only naturalizes existing anchors. Creating missing
 * CityCost path mentions is owned by the mandatory Internal Link Engine stage that
 * runs after this pipeline (humanize/CQ/helpfulness can strip links).
 */

import type { WriterDraftPayload } from '../draft-validate.js';
import {
  ensureDraftIntegrity,
  snapshotProtected,
  type ProtectedSnapshot,
} from './block-integrity.js';
import type { GuideId } from './types.js';
import { applyRealWorldExamples, type ExampleEngineReport } from './example-engine.js';
import { applyNaturalLinks, type NaturalLinkReport } from './link-engine.js';
import {
  applyDecisionSupport,
  type DecisionSupportReport,
} from './decision-support-engine.js';
import { applyHelpfulContent, scoreHelpfulDraft, type HelpfulContentReport } from './helpful-content.js';
import {
  applyActionableValueBlocks,
  type ActionableValueReport,
} from './actionable-value-blocks.js';
import {
  runHelpfulnessValidators,
  type HelpfulnessValidatorResult,
} from './helpfulness-validators.js';

export interface HelpfulnessContext {
  guideId: GuideId;
  country?: string;
  city?: string;
  city_b?: string;
  known_facts?: string[];
}

export interface HelpfulnessDebugReport {
  examples_added: number;
  decision_blocks_added: number;
  helpful_tips_added: number;
  natural_anchors_fixed: number;
  links_trimmed: number;
  sections_upgraded: string[];
  helpful_score_before: number;
  helpful_score_after: number;
  block_save: boolean;
  block_reasons: string[];
  validators: HelpfulnessValidatorResult[];
  example?: ExampleEngineReport;
  links?: NaturalLinkReport;
  decision?: DecisionSupportReport;
  helpful?: HelpfulContentReport;
  actionable?: ActionableValueReport;
}

export interface HelpfulnessPipelineResult {
  draft: WriterDraftPayload;
  report: HelpfulnessDebugReport;
  block_save: boolean;
}

function withIntegrity(draft: WriterDraftPayload, snapshot: ProtectedSnapshot): WriterDraftPayload {
  return ensureDraftIntegrity(draft, snapshot).draft;
}

export function formatHelpfulnessDebug(report: HelpfulnessDebugReport): string {
  return [
    `examples_added=${report.examples_added}`,
    `decision_blocks_added=${report.decision_blocks_added}`,
    `helpful_tips_added=${report.helpful_tips_added}`,
    `natural_anchors_fixed=${report.natural_anchors_fixed}`,
    `links_trimmed=${report.links_trimmed}`,
    `helpful_score=${report.helpful_score_before}->${report.helpful_score_after}`,
    `sections_upgraded=${report.sections_upgraded.length}`,
    `block_save=${report.block_save ? 'yes' : 'no'}`,
    report.block_reasons.length ? `reasons=${report.block_reasons.join('|')}` : 'reasons=none',
  ].join(';');
}

/**
 * Apply all four helpfulness engines, preserve protected blocks, then validate.
 */
export function runHelpfulnessPipeline(input: {
  draft: WriterDraftPayload;
  context: HelpfulnessContext;
}): HelpfulnessPipelineResult {
  const snapshot = snapshotProtected(input.draft.blocks || []);
  const entities = {
    country: input.context.country,
    city: input.context.city,
    city_b: input.context.city_b,
    known_facts: input.context.known_facts,
  };

  let draft = input.draft;
  const sections_upgraded = new Set<string>();
  const helpful_score_before = scoreHelpfulDraft(draft).score;

  // 1. Real World Examples
  const examples = applyRealWorldExamples({
    draft,
    guideId: input.context.guideId,
    entities,
  });
  draft = withIntegrity(examples.draft, snapshot);
  for (const s of examples.report.sections_upgraded) sections_upgraded.add(s);

  // 2. Natural Links
  const links = applyNaturalLinks(draft);
  draft = withIntegrity(links.draft, snapshot);

  // 3. Decision Support
  const decision = applyDecisionSupport({
    draft,
    guideId: input.context.guideId,
    entities,
  });
  draft = withIntegrity(decision.draft, snapshot);
  for (const s of decision.report.sections_upgraded) sections_upgraded.add(s);

  // 4. Helpful Content upgrades
  const helpful = applyHelpfulContent({
    draft,
    guideId: input.context.guideId,
    entities,
  });
  draft = withIntegrity(helpful.draft, snapshot);
  for (const s of helpful.report.sections_upgraded) sections_upgraded.add(s);

  // 5. Actionable Value Blocks (guide-type registry)
  const actionable = applyActionableValueBlocks({
    draft,
    guideId: input.context.guideId,
    entities,
  });
  draft = withIntegrity(actionable.draft, snapshot);
  if (actionable.report.blocks_added) {
    sections_upgraded.add('actionable_value_blocks');
  }

  // Re-run natural links after upgrades (new tips may not have slugs, but keep order stable)
  const links2 = applyNaturalLinks(draft);
  draft = withIntegrity(links2.draft, snapshot);

  const helpful_score_after = scoreHelpfulDraft(draft).score;
  const validation = runHelpfulnessValidators(draft, input.context.guideId);

  const report: HelpfulnessDebugReport = {
    examples_added: examples.report.examples_added,
    decision_blocks_added: decision.report.decision_blocks_added,
    helpful_tips_added: helpful.report.helpful_tips_added + actionable.report.blocks_added,
    natural_anchors_fixed:
      links.report.natural_anchors_fixed + links2.report.natural_anchors_fixed,
    links_trimmed: links.report.links_trimmed + links2.report.links_trimmed,
    sections_upgraded: [...sections_upgraded],
    helpful_score_before,
    helpful_score_after,
    block_save: validation.block_save,
    block_reasons: validation.block_reasons,
    validators: validation.validators,
    example: examples.report,
    links: {
      ...links.report,
      natural_anchors_fixed:
        links.report.natural_anchors_fixed + links2.report.natural_anchors_fixed,
      links_trimmed: links.report.links_trimmed + links2.report.links_trimmed,
    },
    decision: decision.report,
    helpful: {
      ...helpful.report,
      helpful_score_before,
      helpful_score_after,
    },
    actionable: actionable.report,
  };

  return {
    draft,
    report,
    block_save: validation.block_save,
  };
}
