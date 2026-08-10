/**
 * Content Quality Engine — shared types.
 * Runs after Similarity / before Quality Audit.
 */

import type { GuideId, WriterDraftPayload } from '../types.js';

export type ValidatorStatus = 'PASS' | 'WARNING' | 'FAIL';

export type QualityCategory =
  | 'prompt_leakage'
  | 'repeated_content'
  | 'broken_sentences'
  | 'guide_mismatch'
  | 'human_writing'
  | 'helpful_content'
  | 'country_specific'
  | 'faq_quality'
  | 'summary_quality'
  | 'section_diversity'
  | 'content_expansion'
  | 'final_editor'
  | 'cross_section_similarity'
  | 'actionable_value'
  | 'sentence_integrity'
  | 'paragraph_integrity'
  | 'numeric_sanity'
  | 'formatting_integrity';

/** Hard-fail categories that block save. */
export const BLOCK_SAVE_CATEGORIES: readonly QualityCategory[] = [
  'prompt_leakage',
  'repeated_content',
  'broken_sentences',
  'guide_mismatch',
  'human_writing',
  'cross_section_similarity',
  'actionable_value',
  'sentence_integrity',
  'numeric_sanity',
  'formatting_integrity',
] as const;

export interface ValidatorFinding {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'error';
  location?: string;
}

export interface ValidatorResult {
  category: QualityCategory;
  status: ValidatorStatus;
  score: number; // 0–100
  findings: ValidatorFinding[];
  /** Optional mutation notes for debug */
  repaired?: number;
  rewritten?: number;
}

export interface ContentQualityDebugReport {
  repeated_paragraphs_removed: number;
  sentences_repaired: number;
  leakage_removed: number;
  sections_rewritten: number;
  examples_added: number;
  expansion_words_added: number;
  ai_cliches_removed: number;
  final_score: number;
  validators: ValidatorResult[];
  block_save: boolean;
  block_reasons: string[];
}

export interface ContentQualityResult {
  draft: WriterDraftPayload;
  score: number;
  block_save: boolean;
  report: ContentQualityDebugReport;
  validators: ValidatorResult[];
}

export interface ContentQualityInput {
  draft: WriterDraftPayload;
  guideId: GuideId;
  country?: string;
  city?: string;
  articleMinWords?: number;
  /** Optional AI complete — used only for meaningful expansion / final editor soft polish */
  complete?: (system: string, user: string) => Promise<string>;
}

export const CATEGORY_WEIGHTS: Record<QualityCategory, number> = {
  prompt_leakage: 12,
  repeated_content: 12,
  broken_sentences: 10,
  guide_mismatch: 10,
  human_writing: 10,
  cross_section_similarity: 10,
  actionable_value: 8,
  helpful_content: 6,
  country_specific: 4,
  faq_quality: 4,
  summary_quality: 4,
  section_diversity: 3,
  content_expansion: 3,
  sentence_integrity: 4,
  paragraph_integrity: 3,
  numeric_sanity: 4,
  formatting_integrity: 3,
  final_editor: 2,
};
