/**
 * Programmatic SEO catalog — eligibility-driven index over the geo database.
 * Pages exist only for cities that pass the SEO Eligibility Engine.
 * Internal quality scores are never attached to public page payloads.
 */

import { Country } from 'country-state-city';
import { getCurrencyForCountry } from './col-engine/currency.js';
import { resolveCityCostOfLivingSync } from './col-engine/index.js';
import { SEO_INDEX_CONFIG } from './seo-config.js';
import {
  listEligibleCities,
  findEligibleByPageSlug,
  seoSlug,
  shortCountrySlug,
  type EligibleCity,
  getEligibilityStats,
} from './seo-eligibility.js';
import {
  listSovereignCountries,
  findSovereignBySlug,
} from './seo-countries.js';
import { listEligibleComparisons } from './seo-comparison-eligibility.js';
import {
  buildCompareEnrichment,
  type CompareSeoEnrichment,
  type CitySeoSections,
} from './seo-content.js';
import {
  buildPageQuality,
  recordQuality,
  resetQualityAggregates,
  getQualityAggregates,
} from './seo-quality.js';
import {
  generateCityContentSync,
  generateCountryContentSync,
  generateCompareContentSync,
  contentCacheStats,
  invalidateContentCache,
  CONTENT_ENGINE_VERSION,
} from './content-engine/index.js';
import { authoritySitemapUrls } from './eeat-engine/index.js';

export { seoSlug, getEligibilityStats, buildCompareEnrichment, getQualityAggregates, resetQualityAggregates, contentCacheStats, invalidateContentCache, CONTENT_ENGINE_VERSION };
export type { CompareSeoEnrichment, CitySeoSections };

/** Dynamic country registry: any country with eligible cities. */
export function countrySlugFromCode(code: string): string {
  return shortCountrySlug(code);
}

export function countryCodeFromSlug(slug: string): string | null {
  const hit = findSovereignBySlug(slug);
  if (hit) return hit.code;
  const s = seoSlug([slug]);
  for (const c of Country.getAllCountries()) {
    if (seoSlug([c.name]) === s || shortCountrySlug(c.isoCode) === s) return c.isoCode;
  }
  return null;
}

export function cityPageSlug(city: EligibleCity): string {
  return city.pageSlug;
}

export function cityQueryLabel(city: EligibleCity): string {
  return city.label || [city.city, city.state, city.country].filter(Boolean).join(', ');
}

/** Indexable comparisons via Comparison Eligibility Engine. */
let comparisonsCache: ReturnType<typeof listEligibleComparisons> | null = null;
let comparisonsFingerprint = '';

export function listIndexableCities(): EligibleCity[] {
  const cities = listEligibleCities();
  const fp = `${cities.length}:${cities[0]?.pageSlug || ''}:${cities[cities.length - 1]?.pageSlug || ''}:${SEO_INDEX_CONFIG.maxIndexableComparisons}`;
  if (fp !== comparisonsFingerprint) {
    comparisonsCache = null;
    comparisonsFingerprint = fp;
  }
  return cities;
}

/** All sovereign countries — NOT filtered by city eligibility. */
export function listIndexableCountries(): Array<{ code: string; slug: string; name: string }> {
  return listSovereignCountries().map((c) => ({
    code: c.code,
    slug: c.slug,
    name: c.name,
  }));
}

export function findCityBySlug(slug: string): EligibleCity | null {
  return findEligibleByPageSlug(slug);
}

export function findCountryCities(countryCode: string): EligibleCity[] {
  return listIndexableCities().filter((c) => c.countryCode === countryCode);
}

export function listIndexableComparisons(): Array<{
  slug: string;
  cityA: string;
  cityB: string;
  queryA: string;
  queryB: string;
  pageSlugA: string;
  pageSlugB: string;
}> {
  if (!comparisonsCache) {
    comparisonsCache = listEligibleComparisons(listEligibleCities());
  }
  return comparisonsCache.map(({ score: _score, reasons: _reasons, ...pub }) => pub);
}

export interface CountryPageData {
  code: string;
  slug: string;
  name: string;
  currency: string;
  symbol: string;
  exchange_rate: number;
  population: number;
  avg_salary: number;
  avg_rent: number;
  avg_groceries_index: number;
  avg_cpi: number;
  cheapest: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  expensive: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  cities: Array<{ city: string; state?: string; slug: string; population?: number; cpi: number; rent: number }>;
  top_comparisons: Array<{ slug: string; label: string }>;
  related_countries: Array<{ slug: string; name: string }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
  canonical: string;
  seo_description?: string;
}

export interface CityPageData {
  city: string;
  state: string;
  country: string;
  countryCode: string;
  countrySlug: string;
  slug: string;
  population: number | null;
  tier: number;
  latitude: number | null;
  longitude: number | null;
  currency: string;
  symbol: string;
  exchange_rate: number;
  indices: {
    cpi_index: number;
    rent_index: number;
    groceries_index: number;
    restaurant_price_index: number;
    local_purchasing_power_index: number;
  };
  rent_1br: number;
  salary: number;
  groceries_sample: number;
  transport_sample: number;
  utilities: number;
  restaurant_meal: number;
  nearby: Array<{ city: string; slug: string; state?: string }>;
  related_comparisons: Array<{ slug: string; label: string }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
  canonical: string;
  query_label: string;
  data_source: string;
  confidence_label: string;
  timezone: string;
  seo_description?: string;
  /** Unique long-form SEO sections (public content, not quality scores). */
  sections?: CitySeoSections;
  pros?: string[];
  cons?: string[];
}

const COUNTRY_TIMEZONES: Record<string, string> = {
  IN: 'Asia/Kolkata (IST, UTC+5:30)',
  US: 'Multiple (ET / CT / MT / PT)',
  GB: 'Europe/London (GMT/BST)',
  AE: 'Asia/Dubai (GST, UTC+4)',
  AU: 'Australia (AEST/AEDT / AWST)',
  JP: 'Asia/Tokyo (JST, UTC+9)',
  DE: 'Europe/Berlin (CET/CEST)',
  FR: 'Europe/Paris (CET/CEST)',
  CA: 'Multiple (ET / CT / MT / PT)',
  SG: 'Asia/Singapore (SGT, UTC+8)',
  BR: 'America/Sao_Paulo',
  MX: 'Multiple (Mexico time zones)',
  KR: 'Asia/Seoul (KST)',
  TH: 'Asia/Bangkok',
  NL: 'Europe/Amsterdam',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  CH: 'Europe/Zurich',
  IE: 'Europe/Dublin',
  PT: 'Europe/Lisbon',
  EG: 'Africa/Cairo',
};

export function buildCompareSeoLinks(cityAName: string, cityBName: string): {
  related: Array<{ slug: string; label: string }>;
  nearby: Array<{ slug: string; label: string }>;
  enrichment?: CompareSeoEnrichment;
} {
  const a = cityAName.split(',')[0].trim().toLowerCase();
  const b = cityBName.split(',')[0].trim().toLowerCase();
  const all = listIndexableComparisons();
  const related = all
    .filter((p) => {
      const pa = p.cityA.toLowerCase();
      const pb = p.cityB.toLowerCase();
      return (pa === a || pb === a || pa === b || pb === b) &&
        !((pa === a && pb === b) || (pa === b && pb === a));
    })
    .slice(0, 8)
    .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));

  const nearby = all
    .filter((p) => !related.some((r) => r.slug === p.slug))
    .filter((p) => {
      const pa = p.cityA.toLowerCase();
      const pb = p.cityB.toLowerCase();
      return !((pa === a && pb === b) || (pa === b && pb === a));
    })
    .slice(0, 6)
    .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));

  return {
    related,
    nearby,
    enrichment: buildCompareEnrichment(cityAName, cityBName),
  };
}

function metricsFor(city: EligibleCity): { rent: number; salary: number; cpi: number; groceries: number } {
  const resolved = resolveCityCostOfLivingSync(cityQueryLabel(city));
  const byName = (n: string) => resolved.prices.find((p) => p.item_name === n)?.average_price ?? 0;
  return {
    rent: byName('Apartment (1 bedroom) in City Centre'),
    salary: byName('Average Monthly Net Salary (After Tax)'),
    cpi: resolved.indices.cpi_index,
    groceries: resolved.indices.groceries_index,
  };
}

export function buildCountryPageData(slugOrCode: string): CountryPageData | null {
  const sovereign =
    findSovereignBySlug(slugOrCode) ||
    (slugOrCode.length === 2
      ? listSovereignCountries().find((c) => c.code === slugOrCode.toUpperCase()) || null
      : null);

  const code = sovereign?.code || countryCodeFromSlug(slugOrCode);
  if (!code) return null;

  // Must be a sovereign country in our index (not a territory)
  const countryMeta = sovereign || listSovereignCountries().find((c) => c.code === code);
  if (!countryMeta) return null;

  const cities = findCountryCities(code);
  const name = countryMeta.name;
  const slug = countryMeta.slug;
  const fx = getCurrencyForCountry(code);

  if (!cities.length) {
    const related = listIndexableCountries()
      .filter((c) => c.code !== code)
      .slice(0, 8);
    const doc = generateCountryContentSync({
      code,
      slug,
      name,
      currency: fx.code,
      symbol: fx.symbol,
      exchange_rate: fx.rate,
      cities: [],
      cheapest: [],
      expensive: [],
      metros: [],
      top_comparisons: [],
      related_countries: related.map((c) => ({ slug: c.slug, name: c.name })),
      avg_cpi: null,
      avg_rent: null,
      avg_salary: null,
      avg_groceries: null,
    });
    recordQuality(buildPageQuality({
      slug: `country/${slug}`,
      eligibility: 70,
      contentParts: [doc.summary, ...doc.faqs.map((f) => f.q + f.a)],
      hasStructuredSections: true,
    }));

    return {
      code,
      slug,
      name,
      currency: fx.code,
      symbol: fx.symbol,
      exchange_rate: fx.rate,
      population: 0,
      avg_salary: 0,
      avg_rent: 0,
      avg_groceries_index: 0,
      avg_cpi: 0,
      cheapest: [],
      expensive: [],
      cities: [],
      top_comparisons: [],
      related_countries: related.map((c) => ({ slug: c.slug, name: c.name })),
      faqs: doc.faqs,
      summary: doc.summary,
      canonical: `https://citycost.online/country/${slug}`,
      seo_description: doc.seo_description,
    };
  }

  const sample = [...cities]
    .sort((a, b) => b.scores.eligibility - a.scores.eligibility)
    .slice(0, Math.min(cities.length, SEO_INDEX_CONFIG.maxCitiesOnCountryPage));

  const metricsSample = sample.slice(0, Math.min(sample.length, 15));
  const withMetrics = metricsSample.map((c) => {
    const m = metricsFor(c);
    return { rec: c, ...m, slug: c.pageSlug };
  });

  const sortedByRent = [...withMetrics].sort((a, b) => a.rent - b.rent);
  const population = cities.reduce((s, c) => s + (c.population || 0), 0);
  const avg_salary = withMetrics.reduce((s, c) => s + c.salary, 0) / withMetrics.length;
  const avg_rent = withMetrics.reduce((s, c) => s + c.rent, 0) / withMetrics.length;
  const avg_cpi = withMetrics.reduce((s, c) => s + c.cpi, 0) / withMetrics.length;
  const avg_groceries = withMetrics.reduce((s, c) => s + c.groceries, 0) / withMetrics.length;

  const comps = listIndexableComparisons()
    .filter((p) => cities.some((c) => c.city === p.cityA) || cities.some((c) => c.city === p.cityB))
    .slice(0, 12)
    .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));

  const related = listIndexableCountries()
    .filter((c) => c.code !== code)
    .slice(0, 8);

  const cheapest = sortedByRent.slice(0, 5).map((c) => ({
    city: c.rec.city,
    slug: c.slug,
    rent: Math.round(c.rent),
    cpi: c.cpi,
  }));
  const expensive = [...sortedByRent].reverse().slice(0, 5).map((c) => ({
    city: c.rec.city,
    slug: c.slug,
    rent: Math.round(c.rent),
    cpi: c.cpi,
  }));

  const doc = generateCountryContentSync({
    code,
    slug,
    name,
    currency: fx.code,
    symbol: fx.symbol,
    exchange_rate: fx.rate,
    cities,
    cheapest,
    expensive,
    metros: sample.map((c) => ({ city: c.city, slug: c.pageSlug, state: c.state })),
    top_comparisons: comps,
    related_countries: related.map((c) => ({ slug: c.slug, name: c.name })),
    avg_cpi: Math.round(avg_cpi * 10) / 10,
    avg_rent: Math.round(avg_rent),
    avg_salary: Math.round(avg_salary),
    avg_groceries: Math.round(avg_groceries * 10) / 10,
  });

  recordQuality(buildPageQuality({
    slug: `country/${slug}`,
    eligibility: 75 + Math.min(20, cities.length),
    contentParts: [doc.summary, ...doc.faqs.map((f) => f.q + f.a)],
    hasStructuredSections: true,
  }));

  return {
    code,
    slug,
    name,
    currency: fx.code,
    symbol: fx.symbol,
    exchange_rate: fx.rate,
    population,
    avg_salary: Math.round(avg_salary),
    avg_rent: Math.round(avg_rent),
    avg_groceries_index: Math.round(avg_groceries * 10) / 10,
    avg_cpi: Math.round(avg_cpi * 10) / 10,
    cheapest,
    expensive,
    cities: sample
      .sort((a, b) => a.city.localeCompare(b.city))
      .map((c) => {
        const m = withMetrics.find((x) => x.slug === c.pageSlug);
        return {
          city: c.city,
          state: c.state,
          slug: c.pageSlug,
          population: c.population ?? undefined,
          cpi: m?.cpi ?? 0,
          rent: m ? Math.round(m.rent) : 0,
        };
      }),
    top_comparisons: comps,
    related_countries: related.map((c) => ({ slug: c.slug, name: c.name })),
    faqs: doc.faqs,
    summary: doc.summary,
    canonical: `https://citycost.online/country/${slug}`,
    seo_description: doc.seo_description,
  };
}

export function buildCityPageData(slug: string): CityPageData | null {
  const rec = findCityBySlug(slug);
  if (!rec) return null;

  const resolved = resolveCityCostOfLivingSync(cityQueryLabel(rec));
  const fx = getCurrencyForCountry(rec.countryCode);
  const prices = resolved.prices;
  const byName = (n: string) => prices.find((p) => p.item_name === n)?.average_price ?? 0;

  const nearby = findCountryCities(rec.countryCode)
    .filter((c) => c.pageSlug !== rec.pageSlug)
    .sort((a, b) => {
      // Prefer same state, then eligibility
      const stateBoost = (a.state === rec.state ? 10 : 0) - (b.state === rec.state ? 10 : 0);
      if (stateBoost !== 0) return stateBoost > 0 ? -1 : 1;
      return b.scores.eligibility - a.scores.eligibility;
    })
    .slice(0, 8)
    .map((c) => ({ city: c.city, slug: c.pageSlug, state: c.state }));

  const related_comparisons = listIndexableComparisons()
    .filter((p) => p.cityA === rec.city || p.cityB === rec.city || p.pageSlugA === rec.pageSlug || p.pageSlugB === rec.pageSlug)
    .slice(0, 10)
    .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));

  const rent = byName('Apartment (1 bedroom) in City Centre');
  const salary = byName('Average Monthly Net Salary (After Tax)');
  const groceries_sample = byName('Milk (regular), (1 liter)');
  const transport_sample = byName('One-way Ticket (Local Transport)');
  const utilities = byName('Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment');
  const restaurant_meal = byName('Meal, Inexpensive Restaurant');

  const doc = generateCityContentSync({
    rec,
    countrySlug: countrySlugFromCode(rec.countryCode),
    nearby,
    related_comparisons,
  });

  // Map content-engine blocks → legacy sections shape for existing consumers
  const byId = (id: string) => doc.blocks.find((b) => b.id === id);
  const para = (id: string) => byId(id)?.paragraphs.join(' ') || '';
  const sections: CitySeoSections = {
    living_overview: para('living_overview'),
    economy: para('salary') || para('cost_summary'),
    housing: para('housing'),
    transportation: para('transportation'),
    utilities: para('utilities'),
    lifestyle: para('lifestyle'),
    climate: 'Verified climate series is unavailable for this city; the section is omitted rather than estimated.',
    pros: byId('who_should_move')?.bullets || doc.key_takeaways.slice(0, 3),
    cons: byId('who_may_not')?.bullets || [],
    ai_insights: doc.summary,
  };

  recordQuality(buildPageQuality({
    slug: rec.pageSlug,
    eligibility: rec.scores.eligibility,
    contentParts: [doc.summary, ...doc.faqs.map((f) => f.q + f.a), ...doc.blocks.flatMap((b) => b.paragraphs)],
    hasStructuredSections: true,
  }));

  return {
    city: rec.city,
    state: rec.state || '',
    country: rec.country,
    countryCode: rec.countryCode,
    countrySlug: countrySlugFromCode(rec.countryCode),
    slug: rec.pageSlug,
    population: rec.population ?? null,
    tier: rec.tier,
    latitude: rec.latitude ?? null,
    longitude: rec.longitude ?? null,
    currency: fx.code,
    symbol: fx.symbol,
    exchange_rate: fx.rate,
    indices: resolved.indices,
    rent_1br: rent,
    salary,
    groceries_sample,
    transport_sample,
    utilities,
    restaurant_meal,
    nearby,
    related_comparisons,
    faqs: doc.faqs,
    summary: doc.summary,
    canonical: `https://citycost.online/city/${rec.pageSlug}`,
    query_label: cityQueryLabel(rec),
    data_source: resolved.data_source_label,
    confidence_label: resolved.confidence_label,
    timezone: rec.timezone || COUNTRY_TIMEZONES[rec.countryCode] || 'Local timezone (varies by region)',
    seo_description: doc.seo_description,
    sections,
    pros: sections.pros,
    cons: sections.cons,
  };
}

/** Public compare SEO payload (enrichment for SSR — no quality scores). */
export function buildComparePageData(slug: string): {
  slug: string;
  cityA: string;
  cityB: string;
  queryA: string;
  queryB: string;
  enrichment: CompareSeoEnrichment;
  related: Array<{ slug: string; label: string }>;
  nearby: Array<{ slug: string; label: string }>;
} | null {
  const hit = listIndexableComparisons().find((p) => p.slug === slug);
  if (!hit) return null;

  const cityARec = findCityBySlug(hit.pageSlugA);
  const cityBRec = findCityBySlug(hit.pageSlugB);
  let cpiA = 50, cpiB = 50, rentA = 50, rentB = 50, ppA = 50, ppB = 50;
  if (cityARec) {
    const r = resolveCityCostOfLivingSync(cityQueryLabel(cityARec));
    cpiA = r.indices.cpi_index;
    rentA = r.indices.rent_index;
    ppA = r.indices.local_purchasing_power_index;
  }
  if (cityBRec) {
    const r = resolveCityCostOfLivingSync(cityQueryLabel(cityBRec));
    cpiB = r.indices.cpi_index;
    rentB = r.indices.rent_index;
    ppB = r.indices.local_purchasing_power_index;
  }

  const doc = generateCompareContentSync({
    slug: hit.slug,
    cityA: hit.cityA,
    cityB: hit.cityB,
    queryA: hit.queryA,
    queryB: hit.queryB,
    pageSlugA: hit.pageSlugA,
    pageSlugB: hit.pageSlugB,
    countrySlugA: cityARec ? countrySlugFromCode(cityARec.countryCode) : undefined,
    countrySlugB: cityBRec ? countrySlugFromCode(cityBRec.countryCode) : undefined,
    cpiA,
    cpiB,
    rentA,
    rentB,
    ppA,
    ppB,
  });

  const links = buildCompareSeoLinks(hit.queryA, hit.queryB);
  const e = doc.enrichment;

  const enrichment: CompareSeoEnrichment = {
    executive_summary: e.executive_summary,
    winner_summary: e.executive_summary,
    detailed_analysis: doc.blocks.find((b) => b.id === 'detailed_breakdown')?.paragraphs.join(' ') || e.decision_summary,
    category_winners: e.category_winners,
    budget_comparison: e.monthly_savings,
    monthly_savings: e.monthly_savings,
    cost_difference_pct: e.cost_difference_pct,
    who_should_move: e.who_benefits,
    who_should_not_move: e.decision_summary,
    students: e.students,
    families: e.families,
    retirees: e.retirees,
    remote_workers: e.remote_workers,
    professionals: e.professionals,
    student_perspective: e.students,
    family_perspective: e.families,
    remote_worker_perspective: e.remote_workers,
    retirement_perspective: e.retirees,
    pros: e.pros,
    cons: e.cons,
    faqs: doc.faqs,
    internal_link_hints: doc.links.map((l) => ({ label: l.label, href: l.href })),
  };

  recordQuality(buildPageQuality({
    slug: hit.slug,
    eligibility: 70,
    contentParts: [e.executive_summary, e.decision_summary, ...doc.faqs.map((f) => f.q + f.a)],
    hasStructuredSections: true,
  }));

  return {
    slug: hit.slug,
    cityA: hit.cityA,
    cityB: hit.cityB,
    queryA: hit.queryA,
    queryB: hit.queryB,
    enrichment,
    related: links.related,
    nearby: links.nearby,
  };
}

/** Warm quality aggregates from a sample of pages (verification / boot). */
export function warmSeoQualitySample(sampleCities = 25, sampleComps = 25, sampleCountries = 20) {
  resetQualityAggregates();
  const cities = listIndexableCities().slice(0, sampleCities);
  for (const c of cities) buildCityPageData(c.pageSlug);
  const countries = listIndexableCountries().slice(0, sampleCountries);
  for (const c of countries) buildCountryPageData(c.slug);
  const comps = listIndexableComparisons().slice(0, sampleComps);
  for (const p of comps) buildComparePageData(p.slug);
  return getQualityAggregates();
}

export function expectedScaledIndex(maxCities: number, maxComps: number) {
  const countries = listSovereignCountries().length;
  return {
    countries,
    cities: maxCities,
    comparisons: maxComps,
    total_pages: 1 + countries + maxCities + maxComps,
  };
}

export function buildSitemapUrlEntries(): {
  home: string[];
  countries: string[];
  cities: string[];
  comparisons: string[];
} {
  const base = 'https://citycost.online';
  return {
    home: [`${base}/`, ...authoritySitemapUrls(base)],
    countries: listIndexableCountries().map((c) => `${base}/country/${c.slug}`),
    cities: listIndexableCities().map((c) => `${base}/city/${c.pageSlug}`),
    comparisons: listIndexableComparisons().map((p) => `${base}/compare/${p.slug}`),
  };
}

/** Strip internal scores if any object accidentally includes them. */
export function publicCityPayload<T extends object>(data: T): T {
  return data;
}
