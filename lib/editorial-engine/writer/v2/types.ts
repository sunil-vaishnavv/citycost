/**
 * Writer Engine v2 — shared types (architecture revision).
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';

export type GuideId =
  | 'country'
  | 'city'
  | 'comparison'
  | 'salary'
  | 'rent'
  | 'food'
  | 'healthcare'
  | 'student'
  | 'visa'
  | 'moving'
  | 'retirement'
  | 'budget'
  | 'remote'
  | 'travel'
  | 'tax';

export type PersonaId =
  | 'young_professional'
  | 'married_couple'
  | 'family_with_children'
  | 'digital_nomad'
  | 'remote_worker'
  | 'retired_couple'
  | 'budget_traveller'
  | 'luxury_traveller'
  | 'international_student'
  | 'indian_student'
  | 'us_student'
  | 'eu_student'
  | 'investor'
  | 'entrepreneur'
  | 'backpacker'
  | 'job_seeker'
  | 'freelancer'
  | 'general';

export type StyleId =
  | 'professional'
  | 'conversational'
  | 'analytical'
  | 'financial'
  | 'government'
  | 'academic'
  | 'journalistic'
  | 'decision_first'
  | 'storytelling'
  | 'minimalist'
  | 'friendly'
  | 'authoritative'
  | 'consultative';

export type SectionKey =
  | 'intro'
  | 'overview'
  | 'housing'
  | 'food'
  | 'transport'
  | 'healthcare'
  | 'salary'
  | 'education'
  | 'lifestyle'
  | 'tax'
  | 'visa'
  | 'neighbourhoods'
  | 'utilities'
  | 'safety'
  | 'budget'
  | 'regional'
  | 'major_cities'
  | 'pros'
  | 'cons'
  | 'recommendation'
  | 'who_should'
  | 'remote'
  | 'culture'
  | 'commute'
  | 'schools'
  | 'faq'
  | 'summary';

export interface PersonaProfile {
  id: PersonaId;
  label: string;
  confidence: number;
  tone: string;
  example_bias: string;
  advice_angle: string;
  section_priority: Partial<Record<SectionKey, number>>;
  faq_framing: string;
  summary_stance: string;
}

export interface StyleProfile {
  id: StyleId;
  label: string;
  constraints: string[];
  sentence_guidance: string;
}

export interface OutlineSection {
  key: SectionKey;
  heading: string;
  priority: number;
  min_words: number;
  max_words: number;
  evidence_mode: 'full' | 'shrink' | 'uncertainty' | 'omit';
  brief: string;
}

export interface EditorialPlan {
  guide_id: GuideId;
  content_type: string;
  persona: PersonaProfile;
  style: StyleProfile;
  search_intent: 'informational' | 'commercial' | 'transactional' | 'navigational';
  purpose: string;
  depth: 'standard' | 'deep';
  outline: OutlineSection[];
  forbidden_behaviours: string[];
  link_max: number;
  entities: {
    country?: string;
    city?: string;
    city_b?: string;
  };
}

export interface GuideSpecificSectionWriter {
  /** Unique id — never shared across guides, e.g. country.housing */
  id: string;
  guide_id: GuideId;
  section_key: SectionKey;
  label: string;
  voice: string;
  writing_rules: string[];
  anti_patterns: string[];
  buildBrief(input: {
    plan: EditorialPlan;
    section: OutlineSection;
    factsDigest: string;
    priorDigests: string[];
  }): string;
}

export interface KnowledgeGapReport {
  section_key: SectionKey;
  heading: string;
  coverage: number;
  action: 'write' | 'shrink' | 'uncertainty' | 'omit';
  reason: string;
}

export type SimilarityLayer =
  | 'sentence'
  | 'paragraph'
  | 'heading'
  | 'outline'
  | 'faq'
  | 'summary'
  | 'advice'
  | 'transition'
  | 'cta'
  | 'opening'
  | 'closing'
  | 'internal_link'
  | 'statistics'
  | 'entity'
  | 'rhythm'
  | 'fingerprint';

export interface SimilarityLayerResult {
  layer: SimilarityLayer;
  score: number;
  threshold: number;
  breached: boolean;
  detail?: string;
}

export interface QualityAuditReport {
  ok: boolean;
  critical: string[];
  soft: string[];
  scores: Record<string, number>;
  knowledge_gaps: KnowledgeGapReport[];
  similarity: SimilarityLayerResult[];
}

export interface WriterV2Result {
  ok: boolean;
  draft?: WriterDraftPayload;
  plan?: EditorialPlan;
  audit?: QualityAuditReport;
  errors: string[];
  message: string;
  /** Writer pipeline stage active when failure occurred */
  failed_stage?: import('../../jobs/draft-job-types.js').DraftJobStage;
  error_category?: string;
  debug: {
    writer_engine: string;
    guide_id?: GuideId;
    persona?: PersonaId;
    style?: StyleId;
    outline_headings?: string[];
    section_writer_ids?: string[];
    word_budget?: string;
    word_ensure?: string;
    content_quality?: string;
    content_quality_score?: number;
    content_quality_report?: {
      repeated_paragraphs_removed: number;
      sentences_repaired: number;
      leakage_removed: number;
      sections_rewritten: number;
      examples_added: number;
      expansion_words_added: number;
      ai_cliches_removed: number;
      final_score: number;
      block_save: boolean;
      block_reasons: string[];
    };
    helpfulness?: string;
    helpfulness_report?: {
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
    };
    internal_link_engine?: string;
    internal_link_report?: {
      natural_anchors_fixed: number;
      sections_touched: string[];
      links_trimmed: number;
      path_mentions: number;
      links_created: number;
      paths_injected: string[];
      repair_rounds: number;
      ok: boolean;
    };
    quality_gates?: string;
    quality_gates_report?: {
      ok: boolean;
      block_save: boolean;
      block_reasons: string[];
    };
    final_words?: number;
    section_actuals?: Array<{
      key: string;
      heading: string;
      target: number;
      min: number;
      actual: number;
      expansions: number;
    }>;
    draft_integrity?: {
      block_count: number;
      unique_ids: number;
      duplicate_ids: string[];
      intro: 'present' | 'missing';
      toc: 'present' | 'missing';
      faq: 'present' | 'missing';
      summary: 'present' | 'missing';
      order_valid: boolean;
      integrity: 'PASS' | 'FAIL';
      notes: string[];
    };
    passes: Array<{ kind: string; meta?: string; error?: string; latency_ms?: number }>;
    failed_stage?: import('../../jobs/draft-job-types.js').DraftJobStage;
    error_category?: string;
    tokens_in: number;
    tokens_out: number;
    generation_time_ms: number;
    model: string;
  };
}

export type { DraftBlock, WriterDraftPayload };
