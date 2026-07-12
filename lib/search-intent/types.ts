/**
 * Search Intent / Traffic Growth Engine — types.
 * Keyword clusters & quality scores are internal only.
 */

export const SEARCH_INTENT_VERSION = '1.1.0';

export type SearchIntentId =
  | 'cost_comparison'
  | 'living_cost'
  | 'moving'
  | 'salary'
  | 'rent'
  | 'students'
  | 'families'
  | 'remote_workers'
  | 'retirement'
  | 'digital_nomads'
  | 'cheapest_cities'
  | 'most_expensive_cities'
  | 'country_comparison'
  | 'city_comparison'
  | 'budget_planning'
  | 'housing'
  | 'transportation'
  | 'healthcare'
  | 'education'
  | 'safety'
  | 'taxes'
  | 'utilities'
  | 'lifestyle';

/** City-scoped landing page kinds (URL segment → intent). */
export type CityLandingKind =
  | 'living-in'
  | 'rent'
  | 'salary'
  | 'students'
  | 'families'
  | 'remote-work'
  | 'retirement'
  | 'moving-to'
  | 'digital-nomads';

export type CategoryHubId =
  | 'students'
  | 'families'
  | 'remote-workers'
  | 'retirement'
  | 'digital-nomads'
  | 'cheapest-cities'
  | 'most-expensive-cities';

export type CountryGuideKind =
  | 'living-in-country'
  | 'best-cities'
  | 'student-cities'
  | 'family-cities'
  | 'retirement-cities'
  | 'remote-work-cities';

export interface KeywordClusterInternal {
  primary: string;
  secondary: string[];
  long_tail: string[];
  related_questions: string[];
  search_intent: SearchIntentId;
}

/** Internal quality — never expose on public API. */
export interface IntentQualityInternal {
  seo_score: number;
  intent_match_score: number;
  content_score: number;
  authority_score: number;
  duplicate_risk: number;
  index_eligibility: boolean;
}

export interface LinkNode {
  label: string;
  href: string;
  rel:
    | 'parent'
    | 'child'
    | 'sibling'
    | 'related_guide'
    | 'related_city'
    | 'related_comparison'
    | 'related_category'
    | 'related_country';
}

export interface TopicalGraph {
  parent?: LinkNode;
  children: LinkNode[];
  siblings: LinkNode[];
  related_guides: LinkNode[];
  related_cities: LinkNode[];
  related_comparisons: LinkNode[];
  related_categories: LinkNode[];
  related_countries: LinkNode[];
}

/** Public silo structure (links only — never includes priority scores). */
export interface TopicSiloPublic {
  parent_topic: LinkNode | null;
  child_topics: LinkNode[];
  sibling_topics: LinkNode[];
  authority_hub: LinkNode;
  cluster_hub: LinkNode;
  layer: string;
}

export interface IntentLandingPublic {
  kind: 'city_landing' | 'category_hub' | 'country_guide';
  path: string;
  title: string;
  h1: string;
  description: string;
  intro: string;
  sections: Array<{ id: string; title: string; paragraphs: string[]; bullets?: string[] }>;
  faqs: Array<{ q: string; a: string }>;
  graph: TopicalGraph;
  /** Semantic topic silo — structural links only. */
  topic_silo: TopicSiloPublic;
  city?: {
    name: string;
    slug: string;
    country: string;
    countrySlug: string;
    currency: string;
    symbol: string;
    rent_1br?: number;
    salary?: number;
    cpi?: number;
    confidence_label?: string;
    data_source?: string;
  };
  country?: { name: string; slug: string; code: string };
  category?: CategoryHubId;
  landing_kind?: CityLandingKind;
  guide_kind?: CountryGuideKind;
  last_updated: string;
  /** Public transparency only — not internal scores. */
  indexable: true;
}
