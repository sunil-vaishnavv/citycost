/**
 * Content Intelligence Engine — public API.
 * Pipeline: Facts → Templates → Optional refine → Quality → Cache → Serve
 */

import type { EligibleCity } from '../seo-eligibility.js';
import { buildCityKnowledge, buildCountryKnowledge, buildCompareKnowledge, fingerprintKnowledge } from './knowledge.js';
import { composeCityBlocks, composeCountryBlocks } from './sections.js';
import { generateCityFaqs, generateCountryFaqs } from './faq.js';
import { composeCompareDocument } from './comparison.js';
import { scoreContentDocument } from './quality.js';
import { readContentCache, writeContentCache, invalidateContentCache, contentCacheStats } from './cache.js';
import { refineBlocksOptional } from './renderer.js';
import {
  CONTENT_ENGINE_VERSION,
  type CityContentDocument,
  type CountryContentDocument,
  type CompareContentDocument,
  type ContentMeta,
  type CachedEnvelope,
} from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function meta(kind: ContentMeta['kind'], slug: string, dataVersion: string, method: ContentMeta['generation_method'], prev?: ContentMeta): ContentMeta {
  const generated_at = prev?.generated_at || nowIso();
  return {
    content_version: CONTENT_ENGINE_VERSION,
    generated_at,
    last_updated: nowIso(),
    data_version: dataVersion,
    generation_method: method,
    kind,
    slug,
  };
}

export async function generateCityContent(input: {
  rec: EligibleCity;
  countrySlug: string;
  nearby: Array<{ city: string; slug: string; state?: string }>;
  related_comparisons: Array<{ slug: string; label: string }>;
  force?: boolean;
}): Promise<CityContentDocument> {
  const knowledge = buildCityKnowledge(input.rec, {
    countrySlug: input.countrySlug,
    nearby: input.nearby,
    related_comparisons: input.related_comparisons,
  });
  const data_version = fingerprintKnowledge({
    prices: knowledge.prices,
    indices: knowledge.indices,
    population: knowledge.population,
    source: knowledge.data_source,
    confidence: knowledge.confidence_label,
  });

  if (!input.force) {
    const cached = readContentCache<CityContentDocument>('city', knowledge.pageSlug, data_version);
    if (cached) return cached.document;
  }

  let { blocks, key_takeaways, links, summary, seo_description } = composeCityBlocks(knowledge);
  const faqs = generateCityFaqs(knowledge);
  const locked = [
    knowledge.prices.rent_1br != null ? String(Math.round(knowledge.prices.rent_1br)) : '',
    knowledge.prices.salary != null ? String(Math.round(knowledge.prices.salary)) : '',
    String(knowledge.indices.cpi),
  ];
  const refined = await refineBlocksOptional(blocks, { place: knowledge.city, locked_numbers: locked });
  blocks = refined.blocks;

  const word_count = blocks.reduce((s, b) => s + (b.words || 0), 0) + faqs.reduce((s, f) => s + f.q.split(/\s+/).length + f.a.split(/\s+/).length, 0);

  const document: CityContentDocument = {
    meta: meta('city', knowledge.pageSlug, data_version, refined.method),
    knowledge,
    blocks,
    faqs,
    links,
    key_takeaways,
    word_count,
    summary,
    seo_description,
  };

  const fact_present = [
    knowledge.population != null,
    knowledge.prices.rent_1br != null,
    knowledge.prices.salary != null,
    knowledge.prices.transport != null,
    knowledge.prices.utilities != null,
    knowledge.timezone != null,
    knowledge.nearby_cities.length > 0,
  ].filter(Boolean).length;

  const quality = scoreContentDocument({
    blocks,
    faqs,
    word_count,
    fact_fields_present: fact_present,
    fact_fields_possible: 7,
    target_min_words: 800,
    target_max_words: 1500,
    generated_at: document.meta.generated_at,
  });

  const envelope: CachedEnvelope<CityContentDocument> = {
    meta: document.meta,
    data_fingerprint: data_version,
    document,
    quality,
  };
  writeContentCache('city', knowledge.pageSlug, envelope);
  return document;
}

export async function generateCountryContent(input: {
  code: string;
  slug: string;
  name: string;
  currency: string;
  symbol: string;
  exchange_rate: number;
  cities: EligibleCity[];
  cheapest: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  expensive: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  metros: Array<{ city: string; slug: string; state?: string }>;
  top_comparisons: Array<{ slug: string; label: string }>;
  related_countries: Array<{ slug: string; name: string }>;
  avg_cpi: number | null;
  avg_rent: number | null;
  avg_salary: number | null;
  avg_groceries: number | null;
  force?: boolean;
}): Promise<CountryContentDocument> {
  const knowledge = buildCountryKnowledge(input);
  const data_version = fingerprintKnowledge({
    count: knowledge.indexed_city_count,
    avg_cpi: knowledge.avg_cpi,
    avg_rent: knowledge.avg_rent,
    cheapest: knowledge.cheapest,
    expensive: knowledge.expensive,
  });

  if (!input.force) {
    const cached = readContentCache<CountryContentDocument>('country', knowledge.slug, data_version);
    if (cached) return cached.document;
  }

  let { blocks, links, summary, seo_description } = composeCountryBlocks(knowledge);
  const faqs = generateCountryFaqs(knowledge);
  const refined = await refineBlocksOptional(blocks, { place: knowledge.name, locked_numbers: [knowledge.currency] });
  blocks = refined.blocks;

  const word_count = blocks.reduce((s, b) => s + (b.words || 0), 0) + faqs.reduce((s, f) => s + f.q.split(/\s+/).length + f.a.split(/\s+/).length, 0);

  const document: CountryContentDocument = {
    meta: meta('country', knowledge.slug, data_version, refined.method),
    knowledge,
    blocks,
    faqs,
    links,
    word_count,
    summary,
    seo_description,
  };

  const quality = scoreContentDocument({
    blocks,
    faqs,
    word_count,
    fact_fields_present: [knowledge.avg_cpi != null, knowledge.avg_rent != null, knowledge.indexed_city_count > 0, knowledge.cheapest.length > 0].filter(Boolean).length,
    fact_fields_possible: 4,
    target_min_words: 1000,
    target_max_words: 1800,
    generated_at: document.meta.generated_at,
  });

  writeContentCache('country', knowledge.slug, {
    meta: document.meta,
    data_fingerprint: data_version,
    document,
    quality,
  });
  return document;
}

export async function generateCompareContent(input: {
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
  groceriesA?: number;
  groceriesB?: number;
  restaurantsA?: number;
  restaurantsB?: number;
  currencyA?: string;
  currencyB?: string;
  exchangeRateA?: number;
  exchangeRateB?: number;
  rent1brA?: number | null;
  rent1brB?: number | null;
  utilitiesA?: number | null;
  utilitiesB?: number | null;
  internetA?: number | null;
  internetB?: number | null;
  transportA?: number | null;
  transportB?: number | null;
  salaryA?: number | null;
  salaryB?: number | null;
  force?: boolean;
}): Promise<CompareContentDocument> {
  const knowledge = buildCompareKnowledge(input);
  const data_version = fingerprintKnowledge({
    cpiA: knowledge.cpiA,
    cpiB: knowledge.cpiB,
    rentA: knowledge.rentA,
    rentB: knowledge.rentB,
    ppA: knowledge.ppA,
    ppB: knowledge.ppB,
    groceriesA: knowledge.groceriesA,
    groceriesB: knowledge.groceriesB,
    restaurantsA: knowledge.restaurantsA,
    restaurantsB: knowledge.restaurantsB,
    rent1brA: knowledge.rent1brA,
    rent1brB: knowledge.rent1brB,
    salaryA: knowledge.salaryA,
    salaryB: knowledge.salaryB,
  });

  if (!input.force) {
    const cached = readContentCache<CompareContentDocument>('compare', knowledge.slug, data_version);
    if (cached) return cached.document;
  }

  const composed = composeCompareDocument(knowledge, { data_version, generated_at: nowIso() });
  const refined = await refineBlocksOptional(composed.blocks, {
    place: `${knowledge.cityA} vs ${knowledge.cityB}`,
    locked_numbers: [String(knowledge.cpiA), String(knowledge.cpiB), String(knowledge.rentA), String(knowledge.rentB)],
  });

  const document: CompareContentDocument = {
    meta: meta('compare', knowledge.slug, data_version, refined.method),
    knowledge,
    blocks: refined.blocks,
    faqs: composed.faqs,
    links: composed.links,
    enrichment: composed.enrichment,
    word_count: composed.word_count,
  };

  const quality = scoreContentDocument({
    blocks: document.blocks,
    faqs: document.faqs,
    word_count: document.word_count,
    fact_fields_present: 6,
    fact_fields_possible: 6,
    target_min_words: 1200,
    target_max_words: 2000,
    generated_at: document.meta.generated_at,
  });

  writeContentCache('compare', knowledge.slug, {
    meta: document.meta,
    data_fingerprint: data_version,
    document,
    quality,
  });
  return document;
}

/** Sync wrappers for existing catalog (template path is sync; refine is no-op sync when AI off). */
export function generateCityContentSync(input: Parameters<typeof generateCityContent>[0]): CityContentDocument {
  // Template path is synchronous; AI refine disabled by default.
  const knowledge = buildCityKnowledge(input.rec, {
    countrySlug: input.countrySlug,
    nearby: input.nearby,
    related_comparisons: input.related_comparisons,
  });
  const data_version = fingerprintKnowledge({
    prices: knowledge.prices,
    indices: knowledge.indices,
    population: knowledge.population,
    source: knowledge.data_source,
    confidence: knowledge.confidence_label,
  });

  if (!input.force) {
    const cached = readContentCache<CityContentDocument>('city', knowledge.pageSlug, data_version);
    if (cached) return cached.document;
  }

  const { blocks, key_takeaways, links, summary, seo_description } = composeCityBlocks(knowledge);
  const faqs = generateCityFaqs(knowledge);
  const faqWords = faqs.reduce((s, f) => s + f.q.split(/\s+/).length + f.a.split(/\s+/).length, 0);
  const word_count = blocks.reduce((s, b) => s + (b.words || 0), 0) + faqWords;

  const document: CityContentDocument = {
    meta: meta('city', knowledge.pageSlug, data_version, 'template'),
    knowledge,
    blocks,
    faqs,
    links,
    key_takeaways,
    word_count,
    summary,
    seo_description,
  };

  const quality = scoreContentDocument({
    blocks,
    faqs,
    word_count,
    fact_fields_present: 5,
    fact_fields_possible: 7,
    target_min_words: 800,
    target_max_words: 1500,
    generated_at: document.meta.generated_at,
  });

  writeContentCache('city', knowledge.pageSlug, {
    meta: document.meta,
    data_fingerprint: data_version,
    document,
    quality,
  });
  return document;
}

export function generateCountryContentSync(input: Parameters<typeof generateCountryContent>[0]): CountryContentDocument {
  const knowledge = buildCountryKnowledge(input);
  const data_version = fingerprintKnowledge({
    count: knowledge.indexed_city_count,
    avg_cpi: knowledge.avg_cpi,
    avg_rent: knowledge.avg_rent,
    cheapest: knowledge.cheapest,
    expensive: knowledge.expensive,
  });

  if (!input.force) {
    const cached = readContentCache<CountryContentDocument>('country', knowledge.slug, data_version);
    if (cached) return cached.document;
  }

  const { blocks, links, summary, seo_description } = composeCountryBlocks(knowledge);
  const faqs = generateCountryFaqs(knowledge);
  const faqWords = faqs.reduce((s, f) => s + f.q.split(/\s+/).length + f.a.split(/\s+/).length, 0);
  const word_count = blocks.reduce((s, b) => s + (b.words || 0), 0) + faqWords;

  const document: CountryContentDocument = {
    meta: meta('country', knowledge.slug, data_version, 'template'),
    knowledge,
    blocks,
    faqs,
    links,
    word_count,
    summary,
    seo_description,
  };

  writeContentCache('country', knowledge.slug, {
    meta: document.meta,
    data_fingerprint: data_version,
    document,
    quality: scoreContentDocument({
      blocks,
      faqs,
      word_count,
      fact_fields_present: 3,
      fact_fields_possible: 4,
      target_min_words: 1000,
      target_max_words: 1800,
      generated_at: document.meta.generated_at,
    }),
  });
  return document;
}

export function generateCompareContentSync(input: Parameters<typeof generateCompareContent>[0]): CompareContentDocument {
  const knowledge = buildCompareKnowledge(input);
  const data_version = fingerprintKnowledge({
    cpiA: knowledge.cpiA,
    cpiB: knowledge.cpiB,
    rentA: knowledge.rentA,
    rentB: knowledge.rentB,
    ppA: knowledge.ppA,
    ppB: knowledge.ppB,
    groceriesA: knowledge.groceriesA,
    groceriesB: knowledge.groceriesB,
    restaurantsA: knowledge.restaurantsA,
    restaurantsB: knowledge.restaurantsB,
    rent1brA: knowledge.rent1brA,
    rent1brB: knowledge.rent1brB,
    salaryA: knowledge.salaryA,
    salaryB: knowledge.salaryB,
  });

  if (!input.force) {
    const cached = readContentCache<CompareContentDocument>('compare', knowledge.slug, data_version);
    if (cached) return cached.document;
  }

  const composed = composeCompareDocument(knowledge, { data_version, generated_at: nowIso() });
  const document: CompareContentDocument = {
    meta: meta('compare', knowledge.slug, data_version, 'template'),
    knowledge,
    blocks: composed.blocks,
    faqs: composed.faqs,
    links: composed.links,
    enrichment: composed.enrichment,
    word_count: composed.word_count,
  };

  writeContentCache('compare', knowledge.slug, {
    meta: document.meta,
    data_fingerprint: data_version,
    document,
    quality: scoreContentDocument({
      blocks: document.blocks,
      faqs: document.faqs,
      word_count: document.word_count,
      fact_fields_present: 6,
      fact_fields_possible: 6,
      target_min_words: 1200,
      target_max_words: 2000,
      generated_at: document.meta.generated_at,
    }),
  });
  return document;
}

export { invalidateContentCache, contentCacheStats, CONTENT_ENGINE_VERSION, readContentCache };
export type { CityContentDocument, CountryContentDocument, CompareContentDocument };
