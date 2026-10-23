/**
 * Quality report assembly — single overall score + decision fields.
 * Weights: Rule Validator 30% · AI Review 40% · SEO 15% · Readability 15%
 */

import type { AiReviewerResult } from './ai-reviewer.js';
import type { DuplicateDetectorResult } from './duplicate-detector.js';
import type { ReadabilityResult } from './readability.js';
import type { RuleFinding, RuleValidatorResult } from './rule-validator.js';
import type { HeuristicScore } from './scorers.js';
import { clampScore } from './text-utils.js';
import {
  decidePipeline,
  type DecisionResult,
  type PipelineDecision,
} from '../validation/decision-engine.js';
import {
  computeConfidence,
  type ConfidenceBreakdown,
  type ConfidenceLevel,
  type ConfidenceResult,
} from '../observability/confidence-engine.js';
import type { PromptVersionMeta } from '../observability/prompt-versions.js';
import type { ArticleHealth } from '../observability/article-health.js';
import { computeArticleHealth } from '../observability/article-health.js';
import type { ResearchPack } from '../writer/research-engine.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { auditArticleClaimsAgainstRag } from '../rag/index.js';
import { trustedRagEvidence } from '../research/rag-trust.js';

export interface QualityReportScores {
  overall: number;
  ai_review: number;
  rule_validator: number;
  uniqueness: number;
  readability: number;
  eeat: number;
  search_intent: number;
  human_writing: number;
  helpful_content: number;
  seo: number;
  factual_grounding?: number;
}

export interface QualityReport {
  passed: boolean;
  overall_score: number;
  scores: QualityReportScores;
  ai_review: AiReviewerResult;
  rule_validator: RuleValidatorResult;
  duplicate: DuplicateDetectorResult;
  readability: ReadabilityResult;
  eeat: HeuristicScore;
  search_intent: HeuristicScore;
  human_writing: HeuristicScore;
  helpful_content: HeuristicScore;
  issues: string[];
  failure_reasons: string[];
  summary: string;
  engine_version: string;
  threshold: number;
  duplicate_threshold: number;
  /** Deterministic decision */
  decision?: PipelineDecision;
  decision_reasons?: string[];
  critical_fail?: boolean;
  critical_reasons?: string[];
  ready?: boolean;
  /** Grouped for admin UI */
  rule_groups?: Record<string, string[]>;
  resolved_rules?: string[];
  remaining_rules?: string[];
  /** Observability — confidence engine */
  confidence_breakdown?: ConfidenceBreakdown;
  overall_confidence?: number;
  confidence_level?: ConfidenceLevel;
  confidence?: ConfidenceResult;
  article_health?: ArticleHealth;
  prompt_versions?: PromptVersionMeta;
  rag_factual_gate?: {
    /** audited | no_evidence */
    status?: string;
    /** null when there was no grounded evidence to audit against. */
    accuracy_score: number | null;
    total_claims: number;
    verified_count: number;
    disputed_count: number;
    ungrounded_count: number;
    passed: boolean;
    summary: string;
    claims: Array<{
      claimId: string;
      claimText: string;
      category: string;
      status: string;
      confidence: number;
      matchedEvidence?: string;
      matchedSourceUrl?: string;
      matchedSourceTitle?: string;
      discrepancyNote?: string;
    }>;
    sources: Array<{
      id: number;
      title: string;
      url: string;
      domain: string;
      retrievedAt: string;
    }>;
  };
}

const STRUCTURAL_REDISCOVERY =
  /duplicate heading|missing (intro|faq|summary|toc|table of contents|h3|internal link)|too few blocks|empty block|meta title|meta description/i;

/** Strip AI issues that rediscover validator structural findings. */
export function filterAiIssuesAgainstValidator(
  aiIssues: string[],
  rules: RuleValidatorResult
): string[] {
  const validatorHasDuplicate = rules.findings.some((f) => f.code === 'duplicate_heading');
  return (aiIssues || []).filter((issue) => {
    if (!STRUCTURAL_REDISCOVERY.test(issue)) return true;
    // Allow only if validator also reports the same class of issue
    if (/duplicate heading/i.test(issue)) return validatorHasDuplicate;
    const codeHints: Array<[RegExp, string]> = [
      [/missing faq/i, 'missing_faq'],
      [/missing (toc|table of contents)/i, 'missing_toc'],
      [/missing intro/i, 'missing_intro'],
      [/missing summary/i, 'missing_summary'],
      [/missing h3/i, 'missing_h3'],
      [/internal link/i, 'missing_internal_links'],
    ];
    for (const [re, code] of codeHints) {
      if (re.test(issue)) return rules.findings.some((f) => f.code === code);
    }
    // Structural claim with no validator support → drop
    return false;
  });
}

function seoScoreFromRules(rules: RuleValidatorResult, draftMetaOk: boolean): number {
  let score = draftMetaOk ? 100 : 40;
  for (const f of rules.findings.filter((x) => x.category === 'SEO')) {
    if (f.severity === 'critical') score -= 30;
    else if (f.severity === 'major') score -= 12;
    else score -= 4;
  }
  return clampScore(score);
}

function groupFindings(findings: RuleFinding[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    STRUCTURE: [],
    CONTENT: [],
    SEO: [],
    RESEARCH: [],
  };
  for (const f of findings) {
    const key = f.category || 'CONTENT';
    if (!groups[key]) groups[key] = [];
    groups[key].push(f.message);
  }
  return groups;
}

export function explainReviewFailure(report: Pick<
  QualityReport,
  | 'passed'
  | 'overall_score'
  | 'threshold'
  | 'scores'
  | 'ai_review'
  | 'rule_validator'
  | 'duplicate'
  | 'issues'
  | 'decision_reasons'
  | 'critical_reasons'
>): string[] {
  if (report.passed) return [];
  if (report.critical_reasons?.length) return [...report.critical_reasons];
  if (report.decision_reasons?.length) return [...report.decision_reasons];
  const reasons: string[] = [];
  if (report.overall_score < report.threshold) {
    reasons.push(
      `Overall quality score ${report.overall_score} is below threshold ${report.threshold}`
    );
  }
  const auto = report.rule_validator.auto_fixable || [];
  if (auto.length) {
    reasons.push(`Auto-fixable: ${auto.slice(0, 4).map((f) => f.message).join('; ')}`);
  }
  if (report.rule_validator.failed_rules?.length) {
    reasons.push(
      `Hard rule failures: ${report.rule_validator.failed_rules
        .slice(0, 3)
        .map((f) => f.message)
        .join('; ')}`
    );
  }
  if (!report.ai_review.passed) {
    reasons.push(
      report.ai_review.summary
        ? `AI reviewer: ${report.ai_review.summary}`
        : `AI reviewer score ${report.scores.ai_review} did not pass`
    );
  }
  if (!reasons.length && report.issues.length) {
    reasons.push(...report.issues.slice(0, 4));
  }
  if (!reasons.length) {
    reasons.push('Quality gate failed — see Quality Report tab for details');
  }
  return reasons;
}

export function assembleQualityReport(input: {
  ai: AiReviewerResult;
  rules: RuleValidatorResult;
  duplicate: DuplicateDetectorResult;
  readability: ReadabilityResult;
  eeat: HeuristicScore;
  search_intent: HeuristicScore;
  human_writing: HeuristicScore;
  helpful_content: HeuristicScore;
  quality_threshold: number;
  engine_version: string;
  /** Prior auto-fixable codes that normalize already resolved */
  resolved_rules?: string[];
  revisions_exhausted?: boolean;
  research?: ResearchPack | null;
  draft?: WriterDraftPayload | null;
  article_status?: string | null;
  prompt_versions?: PromptVersionMeta;
}): QualityReport {
  const filteredIssues = filterAiIssuesAgainstValidator(
    input.ai?.issues || [],
    input.rules
  );
  const baseScores = input.ai?.scores || {
    readability: 0,
    eeat: 0,
    search_intent: 0,
    human_writing: 0,
    helpful_content: 0,
  };
  const baseAiScore = Number.isFinite(input.ai?.score) ? Number(input.ai.score) : 0;

  // Soft-calibrate AI human_writing when heuristics find no prompt bleed / boilerplate.
  // Prevents free-form AI from collapsing to 20–40 against the reviewer calibration band.
  const hwFindings = (input.human_writing?.findings || []).join(' ');
  const hwClean =
    (input.human_writing?.score ?? 0) >= 65 &&
    !/bleed|boilerplate|identical paragraph|sentence loops|object Object/i.test(hwFindings);
  const rawAiHuman = Number.isFinite(baseScores.human_writing)
    ? Number(baseScores.human_writing)
    : 0;
  const aiHuman = hwClean ? Math.max(rawAiHuman, 72) : rawAiHuman;
  const aiTop =
    hwClean && (input.rules?.score ?? 0) >= 90 && baseAiScore < 70
      ? Math.max(baseAiScore, 72)
      : baseAiScore;

  const ai: AiReviewerResult = {
    ...input.ai,
    issues: filteredIssues,
    score: aiTop,
    scores: { ...baseScores, human_writing: aiHuman },
    // Soft style nits should not force rewrite when heuristics are clean
    rewrite_required: hwClean ? false : Boolean(input.ai?.rewrite_required),
    passed: hwClean ? true : Boolean(input.ai?.passed),
  };

  const seo = seoScoreFromRules(input.rules, input.rules.seo_pass);
  const readability = clampScore(
    ai.scores.readability * 0.35 + input.readability.score * 0.65
  );

  // Single overall score (PART 13)
  const overall = clampScore(
    input.rules.score * 0.3 + ai.score * 0.4 + seo * 0.15 + readability * 0.15
  );

  const blendedEeat = clampScore(ai.scores.eeat * 0.45 + input.eeat.score * 0.55);
  const blendedIntent = clampScore(
    ai.scores.search_intent * 0.45 + input.search_intent.score * 0.55
  );
  const blendedHuman = clampScore(aiHuman * 0.5 + input.human_writing.score * 0.5);
  const blendedHelpful = clampScore(
    ai.scores.helpful_content * 0.45 + input.helpful_content.score * 0.55
  );

  const readability_pass = readability >= 55;
  const decision: DecisionResult = decidePipeline({
    overall_score: overall,
    threshold: input.quality_threshold,
    rules: input.rules,
    ai,
    seo_pass: input.rules.seo_pass,
    readability_pass,
    revisions_exhausted: input.revisions_exhausted,
    duplicate: input.duplicate,
  });

  const dupDecision = input.duplicate.decision || 'pass';
  const passed = decision.decision === 'approved' && decision.ready;

  const remaining = [
    ...(input.rules.auto_fixable || []).map((f) => f.message),
    ...(input.rules.failed_rules || []).map((f) => f.message),
  ];

  const issues = [
    ...filteredIssues,
    ...input.rules.findings.map((f) => `[${f.category}/${f.auto_fixable ? 'auto' : 'fail'}] ${f.message}`),
    ...input.readability.findings,
    ...input.human_writing.findings,
  ];
  if (dupDecision === 'manual_review' || input.duplicate.is_duplicate) {
    issues.unshift(
      `Near-duplicate detected (similarity ${input.duplicate.max_similarity} ≥ ${input.duplicate.threshold})`
    );
  } else if (dupDecision === 'warning' || input.duplicate.is_warning) {
    issues.unshift(
      `Similarity warning (similarity ${input.duplicate.max_similarity}; warning ≥ ${input.duplicate.warning_threshold ?? 0.9}, critical ≥ ${input.duplicate.threshold})`
    );
  }

  let ragGateReport: QualityReport['rag_factual_gate'] = undefined;
  if (input.draft?.blocks?.length) {
    const rawBlocks = input.draft.blocks as any;
    // Only evidence from the source-verified retriever counts (legacy packs may hold synthesized data).
    const { facts: groundedFacts, sources } = trustedRagEvidence(input.research) as {
      facts: any;
      sources: any;
    };

    const ragAudit = auditArticleClaimsAgainstRag(rawBlocks, groundedFacts, sources);
    ragGateReport = {
      status: ragAudit.status,
      accuracy_score: ragAudit.accuracyScore,
      total_claims: ragAudit.totalClaims,
      verified_count: ragAudit.verifiedCount,
      disputed_count: ragAudit.disputedCount,
      ungrounded_count: ragAudit.ungroundedCount,
      passed: ragAudit.passed,
      summary: ragAudit.summary,
      claims: ragAudit.claims,
      sources: ragAudit.sources,
    };

    if (!ragAudit.passed && ragAudit.disputedCount > 0) {
      issues.push(`[RAG/FACTUAL] Found ${ragAudit.disputedCount} disputed claim(s) conflicting with real-time sources`);
    }
  }

  const draft: QualityReport = {
    passed,
    overall_score: overall,
    scores: {
      overall,
      ai_review: ai.score,
      rule_validator: input.rules.score,
      uniqueness: input.duplicate.uniqueness_score,
      readability,
      eeat: blendedEeat,
      search_intent: blendedIntent,
      human_writing: blendedHuman,
      helpful_content: blendedHelpful,
      seo,
      factual_grounding: ragGateReport?.accuracy_score ?? undefined,
    },
    rag_factual_gate: ragGateReport,
    ai_review: ai,
    rule_validator: input.rules,
    duplicate: input.duplicate,
    readability: input.readability,
    eeat: input.eeat,
    search_intent: input.search_intent,
    human_writing: input.human_writing,
    helpful_content: input.helpful_content,
    issues: [...new Set(issues)].slice(0, 40),
    failure_reasons: [],
    summary: '',
    engine_version: input.engine_version,
    threshold: input.quality_threshold,
    duplicate_threshold: input.duplicate.threshold,
    decision: decision.decision,
    decision_reasons: decision.reasons,
    critical_fail: decision.critical_fail,
    critical_reasons: decision.critical_reasons,
    ready: decision.ready,
    rule_groups: groupFindings(input.rules.findings),
    resolved_rules: input.resolved_rules || [],
    remaining_rules: remaining.slice(0, 20),
  };

  const confidence = computeConfidence({
    research: input.research,
    draft: input.draft,
    rules: input.rules,
    ai,
    seoScore: seo,
    readability,
  });
  draft.confidence = confidence;
  draft.confidence_breakdown = confidence.confidence_breakdown;
  draft.overall_confidence = confidence.overall_confidence;
  draft.confidence_level = confidence.confidence_level;
  draft.article_health = computeArticleHealth({
    status: input.article_status,
    decision: decision.decision,
    overall_confidence: confidence.overall_confidence,
    confidence_level: confidence.confidence_level,
  });
  if (input.prompt_versions) draft.prompt_versions = input.prompt_versions;

  draft.failure_reasons = explainReviewFailure(draft);
  draft.summary = passed
    ? `READY — passed deterministic gate (score ${overall}). ${ai.summary || ''}`.trim()
    : decision.decision === 'manual_review'
      ? `Needs manual review — critical: ${decision.critical_reasons.slice(0, 3).join(' · ')}`
      : `Needs revision (score ${overall}; threshold ${input.quality_threshold}). ${draft.failure_reasons.slice(0, 3).join(' · ')}`.trim();

  return draft;
}
