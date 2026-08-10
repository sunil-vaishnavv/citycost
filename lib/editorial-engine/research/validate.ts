import {
  RESEARCH_PACK_VERSION,
  type ResearchPack,
  type ResearchPackValidation,
} from './schema.js';

const REQUIRED_STRING_FIELDS: Array<keyof ResearchPack> = [
  'schema_version',
  'intent',
  'search_intent',
  'persona',
  'reader_persona',
  'primary_keyword',
  'target_keyword',
  'article_angle',
  'primary_entity',
];

const REQUIRED_ARRAY_FIELDS: Array<keyof ResearchPack> = [
  'secondary_keywords',
  'long_tail_keywords',
  'question_keywords',
  'semantic_keywords',
  'lsi_keywords',
  'searcher_questions',
  'search_questions',
  'user_pain_points',
  'decision_criteria',
  'common_mistakes',
  'supporting_facts',
  'required_statistics',
  'known_data_gaps',
  'facts_must_not_invent',
  'disclaimer_requirements',
  'related_cities',
  'related_countries',
  'related_comparison_pages',
  'internal_link_candidates',
  'child_articles',
  'secondary_entities',
  'required_h2',
  'required_h3',
  'required_faq',
  'required_tables',
  'required_comparison_blocks',
  'required_calculators',
  'outline',
  'recommended_outline',
  'eeat_opportunities',
];

/**
 * Validate a Research Pack before it may be passed to the Writer.
 */
export function validateResearchPack(pack: ResearchPack): ResearchPackValidation {
  const missing_fields: string[] = [];
  const warnings: string[] = [];

  if (!pack || typeof pack !== 'object') {
    return {
      ok: false,
      missing_fields: ['research_pack'],
      warnings: [],
      checked_at: new Date().toISOString(),
      schema_version: RESEARCH_PACK_VERSION,
    };
  }

  if (!pack.topic?.title || !pack.topic?.content_type) {
    missing_fields.push('topic.title', 'topic.content_type');
  }

  for (const key of REQUIRED_STRING_FIELDS) {
    const v = pack[key];
    if (typeof v !== 'string' || !v.trim()) missing_fields.push(String(key));
  }

  for (const key of REQUIRED_ARRAY_FIELDS) {
    const v = pack[key];
    if (!Array.isArray(v)) missing_fields.push(String(key));
  }

  if (!pack.entities || typeof pack.entities !== 'object') {
    missing_fields.push('entities');
  } else {
    for (const k of [
      'cities',
      'countries',
      'currencies',
      'transportation',
      'universities',
      'neighbourhoods',
      'government_programs',
      'visa_names',
      'healthcare_systems',
      'other',
    ] as const) {
      if (!Array.isArray(pack.entities[k])) missing_fields.push(`entities.${k}`);
    }
  }

  if (!pack.writer_contract || pack.writer_contract.sole_source !== 'research_pack') {
    missing_fields.push('writer_contract.sole_source');
  }

  // Quantitative quality gates
  if (Array.isArray(pack.searcher_questions) && pack.searcher_questions.length < 20) {
    missing_fields.push('searcher_questions(min_20)');
  }
  if (Array.isArray(pack.required_h2) && pack.required_h2.length < 8) {
    missing_fields.push('required_h2(min_8)');
  }
  if (Array.isArray(pack.required_faq) && pack.required_faq.length < 6) {
    missing_fields.push('required_faq(min_6)');
  }
  if (Array.isArray(pack.outline) && pack.outline.length < 8) {
    missing_fields.push('outline(min_8_sections)');
  }
  if (Array.isArray(pack.secondary_keywords) && pack.secondary_keywords.length < 4) {
    missing_fields.push('secondary_keywords(min_4)');
  }
  if (Array.isArray(pack.semantic_keywords) && pack.semantic_keywords.length < 8) {
    missing_fields.push('semantic_keywords(min_8)');
  }
  if (Array.isArray(pack.supporting_facts) && pack.supporting_facts.length < 1) {
    warnings.push('supporting_facts is empty — Writer must rely on careful general framing only');
  }
  if (Array.isArray(pack.internal_link_candidates) && pack.internal_link_candidates.length < 3) {
    warnings.push('Fewer than 3 internal link candidates');
  }
  if (!pack.content_cluster) {
    warnings.push('content_cluster is null');
  }
  if (!pack.parent_pillar) {
    warnings.push('parent_pillar is null');
  }
  if (pack.entities && pack.entities.cities.length < 1 && pack.entities.countries.length < 1) {
    warnings.push('No city/country entities extracted');
  }

  // Legacy mirrors must stay in sync
  if (
    pack.primary_keyword &&
    pack.target_keyword &&
    pack.primary_keyword !== pack.target_keyword
  ) {
    warnings.push('primary_keyword and target_keyword diverge');
  }
  if (
    Array.isArray(pack.searcher_questions) &&
    Array.isArray(pack.search_questions) &&
    pack.searcher_questions[0] &&
    pack.search_questions[0] &&
    pack.searcher_questions[0] !== pack.search_questions[0]
  ) {
    warnings.push('searcher_questions and search_questions are out of sync');
  }

  return {
    ok: missing_fields.length === 0,
    missing_fields,
    warnings,
    checked_at: new Date().toISOString(),
    schema_version: RESEARCH_PACK_VERSION,
  };
}
