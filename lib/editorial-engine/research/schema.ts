/**
 * Research Pack schema (v3) — sole structured brief the Writer may consume.
 */

export const RESEARCH_PACK_VERSION = '3.0.0';

export interface ResearchLinkRef {
  href: string;
  label: string;
  kind?: 'city' | 'country' | 'comparison' | 'tool' | 'authority' | 'hub' | 'article';
  slug?: string;
}

export interface ResearchEntities {
  cities: string[];
  countries: string[];
  currencies: string[];
  transportation: string[];
  universities: string[];
  neighbourhoods: string[];
  government_programs: string[];
  visa_names: string[];
  healthcare_systems: string[];
  other: string[];
}

export interface OutlineSection {
  id: string;
  heading: string;
  level: 2 | 3;
  purpose: string;
  children?: OutlineSection[];
  required_elements?: string[];
}

export interface ResearchKeywords {
  primary_keyword: string;
  secondary_keywords: string[];
  long_tail_keywords: string[];
  question_keywords: string[];
  semantic_keywords: string[];
  lsi_keywords: string[];
}

export interface ResearchPackValidation {
  ok: boolean;
  missing_fields: string[];
  warnings: string[];
  checked_at: string;
  schema_version: string;
}

export interface WriterResearchContract {
  sole_source: 'research_pack';
  must_follow_outline: true;
  must_use_pack_intent: true;
  must_not_invent_entities: true;
  must_not_invent_statistics: true;
  must_not_guess_intent: true;
  must_answer_searcher_questions: true;
  required_faq_count_min: number;
  required_h2_count_min: number;
}

/**
 * Full Research Pack.
 * Legacy Writer/Reviewer fields are preserved for backward compatibility.
 */
export interface ResearchPack {
  schema_version: string;

  /** Topic identity */
  topic: {
    id: number;
    title: string;
    content_type: string;
    slug: string;
    priority_score: number;
  };

  intent: string;
  search_intent: string;
  persona: string;
  /** @deprecated use persona — kept for Writer/Reviewer compat */
  reader_persona: string;

  primary_keyword: string;
  /** @deprecated use primary_keyword */
  target_keyword: string;
  secondary_keywords: string[];
  long_tail_keywords: string[];
  question_keywords: string[];
  semantic_keywords: string[];
  lsi_keywords: string[];

  article_angle: string;
  searcher_questions: string[];
  /** @deprecated use searcher_questions */
  search_questions: string[];

  user_pain_points: string[];
  decision_criteria: string[];
  common_mistakes: string[];

  supporting_facts: string[];
  required_statistics: string[];
  known_data_gaps: string[];
  facts_must_not_invent: string[];
  disclaimer_requirements: string[];

  related_cities: ResearchLinkRef[];
  related_countries: ResearchLinkRef[];
  related_comparison_pages: ResearchLinkRef[];
  internal_link_candidates: ResearchLinkRef[];

  content_cluster: string | null;
  parent_pillar: string | null;
  child_articles: string[];

  entities: ResearchEntities;
  /** Flattened entity labels for legacy consumers */
  primary_entity: string;
  secondary_entities: string[];

  required_h2: string[];
  required_h3: string[];
  required_faq: string[];
  required_tables: string[];
  required_comparison_blocks: string[];
  required_calculators: string[];

  /** Structured outline the Writer must follow */
  outline: OutlineSection[];
  /** Flat outline strings for legacy consumers */
  recommended_outline: string[];

  eeat_opportunities: string[];
  writer_contract: WriterResearchContract;
  validation: ResearchPackValidation;
  grounding_sources?: Array<{
    id: number;
    title: string;
    url: string;
    domain: string;
    retrievedAt: string;
    snippet?: string;
  }>;
  grounded_facts?: Array<{
    category: string;
    statement: string;
    city?: string;
    figure?: string;
    sourceId: number;
    sourceIds?: number[];
    citationRef: string;
  }>;
  /** Legacy field: was a hardcoded 96 on older packs; no longer written. */
  rag_accuracy_score?: number;
  /** Outcome of live grounding for this pack (live | no_evidence | unavailable | error). */
  rag_status?: string;
  rag_error?: string;
  rag_model?: string;
}

export class ResearchPackValidationError extends Error {
  readonly missing_fields: string[];
  readonly warnings: string[];

  constructor(missing_fields: string[], warnings: string[] = []) {
    super(
      `Research Pack validation failed. Missing: ${missing_fields.join(', ') || 'unknown'}`
    );
    this.name = 'ResearchPackValidationError';
    this.missing_fields = missing_fields;
    this.warnings = warnings;
  }
}
