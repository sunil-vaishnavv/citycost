/**
 * Content Intelligence Engine — shared types.
 * Public documents never include quality scores.
 */

export const CONTENT_ENGINE_VERSION = '1.1.0';

export type ContentKind = 'city' | 'country' | 'compare';

export interface ContentMeta {
  content_version: string;
  generated_at: string;
  last_updated: string;
  data_version: string;
  generation_method: 'template' | 'template+refine';
  kind: ContentKind;
  slug: string;
}

/** Internal only — never serialize to public API responses. */
export interface ContentQualityInternal {
  content_score: number;
  seo_score: number;
  readability_score: number;
  uniqueness_score: number;
  duplicate_risk: number;
  fact_coverage: number;
  freshness_score: number;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface InternalLink {
  label: string;
  href: string;
  rel?: 'nearby' | 'country' | 'compare' | 'related' | 'popular';
}

export interface ContentBlock {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  /** Word count contribution */
  words?: number;
}

/** Verified facts only — null means omit / unavailable. */
export interface CityKnowledge {
  city: string;
  state: string | null;
  country: string;
  countryCode: string;
  countrySlug: string;
  pageSlug: string;
  label: string;
  population: number | null;
  currency: string;
  symbol: string;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  tier: number | null;
  indices: {
    cpi: number;
    rent: number;
    groceries: number;
    restaurants: number;
    purchasing_power: number;
  };
  prices: {
    rent_1br: number | null;
    salary: number | null;
    milk: number | null;
    transport: number | null;
    utilities: number | null;
    meal: number | null;
  };
  data_source: string;
  confidence_label: string;
  estimation_note: string | null;
  is_capital: boolean;
  is_tourism_or_business: boolean;
  nearby_cities: Array<{ city: string; slug: string; state?: string }>;
  related_comparisons: Array<{ slug: string; label: string }>;
  /** Explicitly unavailable optional domains (anti-hallucination). */
  unavailable: Array<
    'nearby_airports' | 'climate' | 'major_industries' | 'education' | 'healthcare' | 'safety'
  >;
}

export interface CountryKnowledge {
  code: string;
  slug: string;
  name: string;
  currency: string;
  symbol: string;
  exchange_rate: number;
  indexed_city_count: number;
  population_indexed: number | null;
  avg_cpi: number | null;
  avg_rent: number | null;
  avg_salary: number | null;
  avg_groceries: number | null;
  cheapest: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  expensive: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  metros: Array<{ city: string; slug: string; state?: string }>;
  top_comparisons: Array<{ slug: string; label: string }>;
  related_countries: Array<{ slug: string; name: string }>;
}

export interface CompareKnowledge {
  slug: string;
  cityA: string;
  cityB: string;
  queryA: string;
  queryB: string;
  pageSlugA: string;
  pageSlugB: string;
  countrySlugA?: string;
  countrySlugB?: string;
  cpiA: number;
  cpiB: number;
  rentA: number;
  rentB: number;
  ppA: number;
  ppB: number;
  currencyA?: string;
  currencyB?: string;
}

export interface CityContentDocument {
  meta: ContentMeta;
  knowledge: CityKnowledge;
  blocks: ContentBlock[];
  faqs: FaqItem[];
  links: InternalLink[];
  key_takeaways: string[];
  word_count: number;
  /** Mapped convenience fields for existing SEO catalog / UI */
  summary: string;
  seo_description: string;
}

export interface CountryContentDocument {
  meta: ContentMeta;
  knowledge: CountryKnowledge;
  blocks: ContentBlock[];
  faqs: FaqItem[];
  links: InternalLink[];
  word_count: number;
  summary: string;
  seo_description: string;
}

export interface CompareContentDocument {
  meta: ContentMeta;
  knowledge: CompareKnowledge;
  blocks: ContentBlock[];
  faqs: FaqItem[];
  links: InternalLink[];
  enrichment: {
    executive_summary: string;
    category_winners: Array<{ category: string; winner: string; note: string }>;
    monthly_savings: string;
    annual_savings: string;
    cost_difference_pct: number;
    who_benefits: string;
    students: string;
    families: string;
    professionals: string;
    remote_workers: string;
    retirees: string;
    pros: { cityA: string[]; cityB: string[] };
    cons: { cityA: string[]; cityB: string[] };
    decision_summary: string;
  };
  word_count: number;
}

export interface CachedEnvelope<T> {
  meta: ContentMeta;
  data_fingerprint: string;
  document: T;
  quality: ContentQualityInternal;
}
