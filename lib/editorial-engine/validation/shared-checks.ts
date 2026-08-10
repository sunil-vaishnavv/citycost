/**
 * Shared deterministic validation — same library Reviewer uses.
 * Revision estimates progress with these checks (no parallel rule sets).
 */

import type { EditorialSettings } from '../types.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { ResearchPack } from '../writer/research-engine.js';
import { analyzeReadability, type ReadabilityResult } from '../reviewer/readability.js';
import { runRuleValidator, type RuleValidatorResult } from '../reviewer/rule-validator.js';
import {
  scoreEeat,
  scoreHelpfulContent,
  scoreHumanWriting,
  scoreSearchIntent,
  type HeuristicScore,
} from '../reviewer/scorers.js';
import { clampScore } from '../reviewer/text-utils.js';
import type { QualityReport } from '../reviewer/quality-report.js';
import type { IssueCategory } from './issue-plan.js';
import { buildIssuePlan } from './issue-plan.js';

export interface SharedDeterministicChecks {
  rules: RuleValidatorResult;
  readability: ReadabilityResult;
  eeat: HeuristicScore;
  search_intent: HeuristicScore;
  human_writing: HeuristicScore;
  helpful_content: HeuristicScore;
}

/** Exact deterministic suite used inside reviewArticle before AI. */
export function runSharedDeterministicChecks(input: {
  draft: WriterDraftPayload;
  settings: EditorialSettings;
  research?: ResearchPack | null;
  qualityRules?: Record<string, unknown> | null;
}): SharedDeterministicChecks {
  const research = input.research ?? null;
  return {
    rules: runRuleValidator({
      draft: input.draft,
      settings: input.settings,
      research,
      qualityRules: input.qualityRules,
    }),
    readability: analyzeReadability(input.draft),
    eeat: scoreEeat(input.draft, research),
    search_intent: scoreSearchIntent(input.draft, research),
    human_writing: scoreHumanWriting(input.draft),
    helpful_content: scoreHelpfulContent(input.draft, research),
  };
}

/**
 * Estimate overall score holding AI from the prior QualityReport.
 * Same weights as assembleQualityReport: Rules 30% · AI 40% · SEO 15% · Readability 15%.
 */
export function estimateScoreFromChecks(
  checks: SharedDeterministicChecks,
  prior: QualityReport
): number {
  const ai = prior.scores?.ai_review ?? prior.ai_review?.score ?? 50;
  const seo = prior.scores?.seo ?? (checks.rules.seo_pass ? 85 : 50);
  const readability = clampScore(
    (prior.ai_review?.scores?.readability ?? ai) * 0.35 + checks.readability.score * 0.65
  );

  return clampScore(
    checks.rules.score * 0.3 + ai * 0.4 + seo * 0.15 + readability * 0.15
  );
}

export function estimateCategoryIssueCount(
  draft: WriterDraftPayload,
  report: QualityReport,
  settings: EditorialSettings,
  research: ResearchPack | null,
  category: IssueCategory,
  qualityRules?: Record<string, unknown> | null
): { estimated_score: number; category_issue_count: number; checks: SharedDeterministicChecks } {
  const checks = runSharedDeterministicChecks({
    draft,
    settings,
    research,
    qualityRules,
  });
  // Synthesize a lightweight report shell for plan building
  const shell: QualityReport = {
    ...report,
    rule_validator: checks.rules,
    readability: checks.readability,
    eeat: checks.eeat,
    search_intent: checks.search_intent,
    human_writing: checks.human_writing,
    helpful_content: checks.helpful_content,
    scores: {
      ...report.scores,
      rule_validator: checks.rules.score,
      readability: checks.readability.score,
      eeat: checks.eeat.score,
      search_intent: checks.search_intent.score,
      human_writing: checks.human_writing.score,
      helpful_content: checks.helpful_content.score,
    },
  };
  const plan = buildIssuePlan(shell, draft);
  const category_issue_count =
    plan.categories.find((c) => c.category === category)?.issues.length ?? 0;
  return {
    estimated_score: estimateScoreFromChecks(checks, report),
    category_issue_count,
    checks,
  };
}

export interface ProgressGateResult {
  allow_save: boolean;
  old_score: number;
  estimated_score: number;
  issues_before: number;
  issues_after: number;
  reason: string;
}

/** Only save when estimated improvement exists (score up or category issues down). */
export function evaluateProgressGate(input: {
  old_score: number;
  estimated_score: number;
  issues_before: number;
  issues_after: number;
}): ProgressGateResult {
  const scoreGain = input.estimated_score - input.old_score;
  const issuesRemoved = input.issues_before - input.issues_after;
  if (scoreGain >= 0.8 || issuesRemoved >= 1) {
    return {
      allow_save: true,
      ...input,
      reason:
        scoreGain >= 0.8
          ? `Estimated score +${scoreGain.toFixed(1)}`
          : `Estimated ${issuesRemoved} issue(s) removed in target category`,
    };
  }
  return {
    allow_save: false,
    ...input,
    reason: `No estimated improvement (Δscore ${scoreGain.toFixed(1)}, issues ${input.issues_before}→${input.issues_after})`,
  };
}
