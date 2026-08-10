/**
 * Shared Confidence Engine — deterministic 0–100 scores per article stage.
 * Overall weights: Research 20% · Validator 30% · Reviewer 25% · SEO 15% · Readability 10%
 */

import type { QualityReport } from '../reviewer/quality-report.js';
import type { RuleValidatorResult } from '../reviewer/rule-validator.js';
import type { AiReviewerResult } from '../reviewer/ai-reviewer.js';
import type { ReadabilityResult } from '../reviewer/readability.js';
import type { ResearchPack } from '../writer/research-engine.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { clampScore } from '../reviewer/text-utils.js';

export type ConfidenceLevel = 'Excellent' | 'High' | 'Medium' | 'Low';

export interface ConfidenceBreakdown {
  research: number;
  writer: number;
  validator: number;
  reviewer: number;
  seo: number;
  readability: number;
}

export interface ConfidenceResult {
  confidence_breakdown: ConfidenceBreakdown;
  overall_confidence: number;
  confidence_level: ConfidenceLevel;
  weights: {
    research: number;
    validator: number;
    reviewer: number;
    seo: number;
    readability: number;
  };
  computed_at: string;
}

export const CONFIDENCE_WEIGHTS = {
  research: 0.2,
  validator: 0.3,
  reviewer: 0.25,
  seo: 0.15,
  readability: 0.1,
} as const;

export function confidenceLevelFromScore(score: number): ConfidenceLevel {
  if (score >= 95) return 'Excellent';
  if (score >= 90) return 'High';
  if (score >= 80) return 'Medium';
  return 'Low';
}

/** Research pack completeness → 0–100 */
export function scoreResearchConfidence(research: ResearchPack | null | undefined): number {
  if (!research || typeof research !== 'object') return 35;
  let score = 40;
  if (research.target_keyword?.trim()) score += 12;
  if (research.intent?.trim()) score += 8;
  if (research.article_angle?.trim()) score += 8;
  if (Array.isArray(research.search_questions) && research.search_questions.length >= 3) score += 10;
  else if (Array.isArray(research.search_questions) && research.search_questions.length > 0) score += 5;
  if (Array.isArray(research.semantic_keywords) && research.semantic_keywords.length >= 5) score += 8;
  else if (Array.isArray(research.semantic_keywords) && research.semantic_keywords.length > 0) score += 4;
  if (Array.isArray(research.recommended_outline) && research.recommended_outline.length >= 5) score += 10;
  else if (Array.isArray(research.recommended_outline) && research.recommended_outline.length > 0) score += 5;
  if (research.reader_persona?.trim()) score += 4;
  return clampScore(score);
}

/** Writer draft structural completeness → 0–100 */
export function scoreWriterConfidence(draft: WriterDraftPayload | null | undefined): number {
  if (!draft) return 30;
  const blocks = draft.blocks || [];
  let score = 45;
  if (blocks.length >= 8) score += 15;
  else if (blocks.length >= 5) score += 8;
  if (draft.seo_title?.trim()) score += 5;
  if (draft.meta_title?.trim()) score += 5;
  if (draft.meta_description?.trim()) score += 5;
  if (draft.excerpt?.trim()) score += 5;
  const types = new Set(blocks.map((b) => b.type));
  if (types.has('intro')) score += 5;
  if (types.has('faq')) score += 5;
  if (types.has('summary')) score += 5;
  if (types.has('table')) score += 5;
  return clampScore(score);
}

export function computeConfidence(input: {
  research?: ResearchPack | null;
  draft?: WriterDraftPayload | null;
  rules?: RuleValidatorResult | null;
  ai?: AiReviewerResult | null;
  seoScore?: number | null;
  readability?: ReadabilityResult | number | null;
}): ConfidenceResult {
  const research = scoreResearchConfidence(input.research);
  const writer = scoreWriterConfidence(input.draft);
  const validator = clampScore(input.rules?.score ?? 50);
  const reviewer = clampScore(input.ai?.score ?? 50);
  const seo = clampScore(input.seoScore ?? (input.rules?.seo_pass ? 85 : 55));
  const readability =
    typeof input.readability === 'number'
      ? clampScore(input.readability)
      : clampScore(input.readability?.score ?? 55);

  const overall = clampScore(
    research * CONFIDENCE_WEIGHTS.research +
      validator * CONFIDENCE_WEIGHTS.validator +
      reviewer * CONFIDENCE_WEIGHTS.reviewer +
      seo * CONFIDENCE_WEIGHTS.seo +
      readability * CONFIDENCE_WEIGHTS.readability
  );

  return {
    confidence_breakdown: {
      research,
      writer,
      validator,
      reviewer,
      seo,
      readability,
    },
    overall_confidence: overall,
    confidence_level: confidenceLevelFromScore(overall),
    weights: { ...CONFIDENCE_WEIGHTS },
    computed_at: new Date().toISOString(),
  };
}

/** Recompute from an assembled QualityReport (+ optional research/draft). */
export function confidenceFromQualityReport(
  report: QualityReport,
  extras?: { research?: ResearchPack | null; draft?: WriterDraftPayload | null }
): ConfidenceResult {
  return computeConfidence({
    research: extras?.research,
    draft: extras?.draft,
    rules: report.rule_validator,
    ai: report.ai_review,
    seoScore: report.scores?.seo,
    readability: report.scores?.readability,
  });
}
