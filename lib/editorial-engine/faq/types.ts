import type { DraftBlock, WriterDraftPayload } from '../writer/draft-validate.js';
import type { ResearchPack } from '../research/schema.js';

export interface FaqItem {
  q: string;
  a: string;
  id?: string;
}

export interface FaqGenerateInput {
  research: ResearchPack;
  /** Short article summary / excerpt for context only */
  article_summary: string;
  /** Primary + secondary SEO keywords if available */
  seo_keywords?: string[];
  articleId?: number | null;
  /** Skip FAQ AI on first Writer pass — deterministic FAQs are fast and pass validation. */
  preferDeterministic?: boolean;
}

export interface FaqValidationIssue {
  code: string;
  message: string;
  question?: string;
}

export interface FaqValidationResult {
  ok: boolean;
  issues: FaqValidationIssue[];
  scores: {
    human_writing: number;
    helpful_content: number;
    readability: number;
    search_intent: number;
  };
}

export interface FaqGenerateResult {
  ok: boolean;
  items: FaqItem[];
  block: DraftBlock;
  validation: FaqValidationResult;
  source: 'ai' | 'deterministic' | 'mixed';
  message: string;
}

export interface FaqApplyResult {
  ok: boolean;
  draft: WriterDraftPayload;
  faq_count: number;
  source: FaqGenerateResult['source'];
  validation: FaqValidationResult;
  message: string;
}

export type FaqQuestionKind =
  | 'what'
  | 'how_much'
  | 'worth'
  | 'can'
  | 'why'
  | 'which'
  | 'generic';
