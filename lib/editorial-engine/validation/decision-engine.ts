/**
 * Deterministic decision engine — single final status for Review + Revision.
 *
 * Critical fail → needs_manual_review
 * Else score >= threshold (+ gates) → approved (review / READY)
 * Else → revision (draft)
 */

import type { RuleValidatorResult } from '../reviewer/rule-validator.js';
import type { AiReviewerResult } from '../reviewer/ai-reviewer.js';
import type { DuplicateDetectorResult } from '../reviewer/duplicate-detector.js';

export type PipelineDecision = 'approved' | 'revision' | 'manual_review';

export type ArticlePipelineStatus = 'review' | 'draft' | 'needs_manual_review';

export interface DecisionInput {
  overall_score: number;
  threshold: number;
  rules: RuleValidatorResult;
  ai: AiReviewerResult;
  /** SEO / links / schema gate from rules */
  seo_pass: boolean;
  readability_pass: boolean;
  /** After max revisions exhausted */
  revisions_exhausted?: boolean;
  /** Body-only near-duplicate scan — critical (>=0.95) only forces manual review */
  duplicate?: Pick<
    DuplicateDetectorResult,
    'decision' | 'is_duplicate' | 'is_warning' | 'max_similarity' | 'matched_article' | 'matches'
  > | null;
}

export interface DecisionResult {
  decision: PipelineDecision;
  status: ArticlePipelineStatus;
  critical_fail: boolean;
  critical_reasons: string[];
  reasons: string[];
  ready: boolean;
}

/** Codes that force manual review (non-auto-fixable critical). */
export const CRITICAL_RULE_CODES = new Set([
  'hallucination',
  'research_contract',
  'invented_statistics',
  'unsafe_content',
  'missing_legal_disclaimer',
  'broken_json_ld',
  'corrupted_markdown',
  'missing_entire_section',
  'near_duplicate_critical',
]);

export function collectCriticalReasons(
  rules: RuleValidatorResult,
  ai: AiReviewerResult
): string[] {
  const reasons: string[] = [];
  for (const f of rules.failed_rules || []) {
    if (f.auto_fixable) continue;
    if (f.severity === 'critical' || CRITICAL_RULE_CODES.has(f.code)) {
      reasons.push(f.message);
    }
  }
  if (rules.critical_fail) {
    for (const f of rules.failed_rules || []) {
      if (!reasons.includes(f.message)) reasons.push(f.message);
    }
  }
  // AI may flag research/hallucination — only if not structural rediscovery.
  // Do NOT treat bare "research" (e.g. "research prompt") as critical.
  const aiCritical = (ai.issues || []).filter((i) =>
    /hallucin|invented|fabricat|unsafe|research contract|false claim|made-up/i.test(i)
  );
  reasons.push(...aiCritical.slice(0, 4));
  if (
    ai.rewrite_required &&
    /hallucin|invent(?:ed|ing)?|unsafe|research contract|false claim|made-up/i.test(
      ai.summary || ''
    )
  ) {
    reasons.push(ai.summary || 'AI marked rewrite_required for critical content issues');
  }
  return [...new Set(reasons)].filter(Boolean);
}

function duplicateManualReason(
  duplicate: NonNullable<DecisionInput['duplicate']>
): string {
  const matched =
    duplicate.matched_article?.title ||
    duplicate.matched_article?.slug ||
    duplicate.matches?.[0]?.slug ||
    'another article';
  return `Near-duplicate content (similarity ${duplicate.max_similarity} vs "${matched}")`;
}

/**
 * Soft AI-only failure: deterministic gates + score already READY, but AI style
 * flags (rewrite_required / !passed) blocked approval. Fix Issues can skip the
 * expensive STYLE rewrite + full reviewer model and finalize with revisions_exhausted.
 */
export function isSoftAiOnlyFailure(input: {
  overall_score: number;
  threshold: number;
  rules: Pick<RuleValidatorResult, 'passed' | 'seo_pass' | 'auto_fixable' | 'failed_rules'>;
  ai: Pick<AiReviewerResult, 'passed' | 'rewrite_required' | 'score'>;
  readability_score: number;
  critical_fail?: boolean;
}): boolean {
  if (input.critical_fail) return false;
  const lengthMinFail = (input.rules.auto_fixable || [])
    .concat(input.rules.failed_rules || [])
    .some((f) => f.code === 'word_count_low');
  const scorePass = input.overall_score >= input.threshold;
  const validatorPass = Boolean(input.rules.passed);
  const seoPass = Boolean(input.rules.seo_pass);
  const readabilityPass = input.readability_score >= 55;
  const aiScore = input.ai.score ?? 0;
  const aiBlocking = !input.ai.passed || Boolean(input.ai.rewrite_required);
  return (
    scorePass &&
    validatorPass &&
    seoPass &&
    readabilityPass &&
    !lengthMinFail &&
    aiScore >= 55 &&
    aiBlocking
  );
}

type RuleFindingLike = { code?: string; severity?: string; message?: string };

/**
 * Score already clears threshold; the only major hard-floor blocker is word_count_low.
 * Fix Issues should expand deterministically and finalize with reused AI judgment —
 * a full AI re-review of filler expansion often tanks score and must not undo progress.
 */
export function isLengthPrimaryFailure(input: {
  overall_score: number;
  threshold: number;
  critical_fail?: boolean;
  findings?: RuleFindingLike[] | null;
  auto_fixable?: RuleFindingLike[] | null;
  failed_rules?: RuleFindingLike[] | null;
}): boolean {
  if (input.critical_fail) return false;
  if (input.overall_score < input.threshold) return false;
  const all = [
    ...(input.auto_fixable || []),
    ...(input.failed_rules || []),
    ...(input.findings || []),
  ];
  const hasWordLow = all.some((f) => f.code === 'word_count_low');
  if (!hasWordLow) return false;
  const otherMajors = all.filter(
    (f) =>
      f.code !== 'word_count_low' &&
      f.code !== 'word_count_below_target' &&
      (f.severity === 'major' || f.severity === 'critical')
  );
  return otherMajors.length === 0;
}

/**
 * Score-regression rollback policy for single-cycle revision.
 * Never undo a hard length-floor win — that caused the "expand then revert to 1656" bug.
 */
export function shouldRollbackOnScoreRegression(input: {
  scoreBefore: number;
  scoreAfter: number;
  wordsBefore: number;
  wordsAfter: number;
  minWords: number;
  /** Points below before-score required to consider a severe drop (default 12). */
  severeDropPoints?: number;
}): boolean {
  if (!(input.scoreAfter < input.scoreBefore)) return false;
  const minWords = Math.max(1, input.minWords || 0);
  const lengthFloorWon =
    input.wordsBefore < minWords && input.wordsAfter >= minWords;
  if (lengthFloorWon) return false;
  // Meaningful progress toward the floor — keep the expanded draft.
  const gained = input.wordsAfter - input.wordsBefore;
  if (
    input.wordsBefore < minWords &&
    gained >= Math.min(200, Math.max(80, Math.floor(minWords * 0.08)))
  ) {
    return false;
  }
  const severe = input.severeDropPoints ?? 12;
  return input.scoreAfter < input.scoreBefore - severe;
}

/**
 * Deterministic decision — does NOT set status itself; caller persists.
 */
export function decidePipeline(input: DecisionInput): DecisionResult {
  const critical_reasons = collectCriticalReasons(input.rules, input.ai);
  const dup = input.duplicate;
  const dupCritical =
    Boolean(dup) && (dup!.decision === 'manual_review' || dup!.is_duplicate);
  if (dupCritical) {
    const msg = duplicateManualReason(dup!);
    if (!critical_reasons.includes(msg)) critical_reasons.push(msg);
  }
  const critical_fail =
    critical_reasons.length > 0 || Boolean(input.rules.critical_fail) || dupCritical;

  if (critical_fail) {
    return {
      decision: 'manual_review',
      status: 'needs_manual_review',
      critical_fail: true,
      critical_reasons,
      reasons: critical_reasons,
      ready: false,
    };
  }

  const validatorPass = Boolean(input.rules.passed);
  const aiPass = Boolean(input.ai.passed) && !input.ai.rewrite_required;
  const scorePass = input.overall_score >= input.threshold;
  // Hard length floor blocks READY even though word_count_low is auto-fixable.
  const lengthMinFail = (input.rules.auto_fixable || [])
    .concat(input.rules.failed_rules || [])
    .some((f) => f.code === 'word_count_low');
  const ready =
    validatorPass &&
    aiPass &&
    input.seo_pass &&
    input.readability_pass &&
    scorePass &&
    !lengthMinFail;

  if (ready) {
    return {
      decision: 'approved',
      status: 'review',
      critical_fail: false,
      critical_reasons: [],
      reasons: [],
      ready: true,
    };
  }

  const dupWarning =
    Boolean(dup) &&
    !dupCritical &&
    (dup!.decision === 'warning' || dup!.is_warning);
  const warningReason = dupWarning
    ? `Similarity warning (${dup!.max_similarity}) — continue review`
    : '';

  // Score / soft fails → revision (not manual).
  // `revisions_exhausted` means final review of the single-cycle path — NOT a multi-loop budget.
  if (input.revisions_exhausted) {
    // Soft AI style flags (rewrite_required / !passed) must not block READY when every
    // deterministic gate + score threshold already clear — matches reviewer calibration.
    const softAiOk =
      scorePass &&
      validatorPass &&
      input.seo_pass &&
      input.readability_pass &&
      !lengthMinFail &&
      (input.ai.score ?? 0) >= 55;
    if (softAiOk) {
      return {
        decision: 'approved',
        status: 'review',
        critical_fail: false,
        critical_reasons: [],
        reasons: [],
        ready: true,
      };
    }
    // Non-critical exhaustion stays draft — NOT needs_manual_review
    return {
      decision: 'revision',
      status: 'draft',
      critical_fail: false,
      critical_reasons: [],
      reasons: [
        !scorePass
          ? `Score ${input.overall_score} < threshold ${input.threshold}`
          : 'Soft quality gates still failing after single-cycle revision',
        !input.readability_pass ? 'Readability gate failed' : '',
        lengthMinFail
          ? (input.rules.auto_fixable || []).find((f) => f.code === 'word_count_low')?.message ||
            'Word count below minimum'
          : '',
        warningReason,
        ...((input.rules.auto_fixable || [])
          .filter((f) => f.code !== 'word_count_low')
          .slice(0, 4)
          .map((f) => f.message) || []),
      ].filter(Boolean),
      ready: false,
    };
  }

  return {
    decision: 'revision',
    status: 'draft',
    critical_fail: false,
    critical_reasons: [],
    reasons: [
      !validatorPass || lengthMinFail
        ? lengthMinFail
          ? (input.rules.auto_fixable || []).find((f) => f.code === 'word_count_low')?.message ||
            'Word count below minimum'
          : 'Rule validator has auto-fixable failures'
        : '',
      !aiPass ? 'AI reviewer did not pass' : '',
      !scorePass ? `Score ${input.overall_score} < threshold ${input.threshold}` : '',
      !input.seo_pass ? 'SEO gate failed' : '',
      !input.readability_pass ? 'Readability gate failed' : '',
      warningReason,
    ].filter(Boolean),
    ready: false,
  };
}
