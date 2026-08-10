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
let comparisonsPublicCache: Array<{
  slug: string;
  cityA: string;
  cityB: string;
  queryA: string;
  queryB: string;
  pageSlugA: string;
  pageSlugB: string;
}> | null = null;
let comparisonsFingerprint = '';

export function listIndexableCities(): EligibleCity[] {
  const cities = listEligibleCities();
  const fp = `${cities.length}:${cities[0]?.pageSlug || ''}:${cities[cities.length - 1]?.pageSlug || ''}:${SEO_INDEX_CONFIG.maxIndexableComparisons}`;
  if (fp !== comparisonsFingerprint) {
    comparisonsCache = null;
    comparisonsPublicCache = null;
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
    comparisonsPublicCache = null;
  }
  if (!comparisonsPublicCache) {
    comparisonsPublicCache = comparisonsCache.map(({ score: _score, reasons: _reasons, ...pub }) => pub);
  }
  return comparisonsPublicCache;
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
  /** Cities that appear most often in indexable comparisons for this country. */
  most_compared_cities: Array<{ city: string; slug: string; state?: string; compare_count: number }>;
  related_countries: Array<{ slug: string; name: string }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
  canonical: string;
  seo_description?: string;
  /** Content-engine meta.last_updated (ISO date). */
  last_updated?: string;
  content_version?: string;
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
  /** Same-country cities with closest CPI (excludes self + nearby). */
  similar_cost_cities: Array<{ city: string; slug: string; state?: string; cpi: number }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
  canonical: string;
  query_label: string;
  data_source: string;
  confidence_label: string;
  timezone: string;
  seo_description?: string;
  /** Content-engine meta.last_updated (ISO date). */
  last_updated?: string;
  content_version?: string;
  estimation_note?: string | null;
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

export type CompareSeoLinkItem = { slug: string; label: string };

export type CompareSeoHubLink = { slug: string; label: string; href: string };

export interface CompareSeoLinksPayload {
  related: CompareSeoLinkItem[];
  nearby: CompareSeoLinkItem[];
  city_pages: CompareSeoHubLink[];
  country_pages: CompareSeoHubLink[];
  cheaper_alternatives: CompareSeoLinkItem[];
  expensive_alternatives: CompareSeoLinkItem[];
  enrichment?: CompareSeoEnrichment;
}

function shortCityName(name: string): string {
  return name.split(',')[0].trim().toLowerCase();
}

function findEligibleCityByName(name: string): EligibleCity | null {
  const n = shortCityName(name);
  if (!n) return null;
  const cities = listIndexableCities();
  return (
    cities.find((c) => c.city.toLowerCase() === n) ||
    cities.find((c) => shortCityName(c.label || '') === n) ||
    null
  );
}

function compInvolvesSlug(
  p: { pageSlugA: string; pageSlugB: string; cityA: string; cityB: string },
  rec: EligibleCity | null,
  name: string
): boolean {
  const n = shortCityName(name);
  if (rec && (p.pageSlugA === rec.pageSlug || p.pageSlugB === rec.pageSlug)) return true;
  return p.cityA.toLowerCase() === n || p.cityB.toLowerCase() === n;
}

function takeUniqueLinks(
  items: CompareSeoLinkItem[],
  limit: number,
  used: Set<string>
): CompareSeoLinkItem[] {
  const out: CompareSeoLinkItem[] = [];
  for (const it of items) {
    if (!it.slug || used.has(it.slug)) continue;
    used.add(it.slug);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Internal linking graph for a comparison pair.
 * related = same-city comps; nearby = comps with geo-nearby peers when possible;
 * cheaper/expensive = comps with lower/higher-CPI peer cities from the catalog.
 */
export function buildCompareSeoLinks(cityAName: string, cityBName: string): CompareSeoLinksPayload {
  const aName = shortCityName(cityAName);
  const bName = shortCityName(cityBName);
  const recA = findEligibleCityByName(cityAName);
  const recB = findEligibleCityByName(cityBName);
  const all = listIndexableComparisons();

  const selfSlugs = new Set(
    all
      .filter((p) => {
        const pa = p.cityA.toLowerCase();
        const pb = p.cityB.toLowerCase();
        return (pa === aName && pb === bName) || (pa === bName && pb === aName);
      })
      .map((p) => p.slug)
  );
  if (recA && recB) {
    for (const p of all) {
      if (
        (p.pageSlugA === recA.pageSlug && p.pageSlugB === recB.pageSlug) ||
        (p.pageSlugA === recB.pageSlug && p.pageSlugB === recA.pageSlug)
      ) {
        selfSlugs.add(p.slug);
      }
    }
  }

  const used = new Set<string>(selfSlugs);

  const relatedPool = all
    .filter((p) => !selfSlugs.has(p.slug))
    .filter(
      (p) =>
        compInvolvesSlug(p, recA, cityAName) || compInvolvesSlug(p, recB, cityBName)
    )
    .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));
  const related = takeUniqueLinks(relatedPool, 10, used);

  // Nearby city comparisons: peers in same country (prefer same state)
  const peerSlugs = new Set<string>();
  const collectPeers = (rec: EligibleCity | null) => {
    if (!rec) return;
    findCountryCities(rec.countryCode)
      .filter((c) => c.pageSlug !== rec.pageSlug)
      .sort((x, y) => {
        const stateBoost = (x.state === rec.state ? 10 : 0) - (y.state === rec.state ? 10 : 0);
        if (stateBoost !== 0) return stateBoost > 0 ? -1 : 1;
        return y.scores.eligibility - x.scores.eligibility;
      })
      .slice(0, 10)
      .forEach((c) => peerSlugs.add(c.pageSlug));
  };
  collectPeers(recA);
  collectPeers(recB);

  const nearbyPool = all
    .filter((p) => !used.has(p.slug))
    .filter((p) => {
      const touchesAB =
        compInvolvesSlug(p, recA, cityAName) || compInvolvesSlug(p, recB, cityBName);
      if (!touchesAB) return false;
      return peerSlugs.has(p.pageSlugA) || peerSlugs.has(p.pageSlugB);
    })
    .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));
  let nearby = takeUniqueLinks(nearbyPool, 8, used);
  // Fallback: high-score comps not yet used (keeps old behavior when geo peers missing)
  if (nearby.length < 4) {
    const fallback = all
      .filter((p) => !used.has(p.slug) && !selfSlugs.has(p.slug))
      .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));
    nearby = [...nearby, ...takeUniqueLinks(fallback, 8 - nearby.length, used)];
  }

  // CPI for A/B + peer candidates (bounded lookups)
  const cpiA = recA ? metricsFor(recA).cpi : 0;
  const cpiB = recB ? metricsFor(recB).cpi : 0;
  const pairMaxCpi = Math.max(cpiA || 0, cpiB || 0);
  const pairMinCpi = Math.min(
    cpiA > 0 ? cpiA : Number.POSITIVE_INFINITY,
    cpiB > 0 ? cpiB : Number.POSITIVE_INFINITY
  );

  const peerRecs: EligibleCity[] = [];
  for (const slug of peerSlugs) {
    const r = findCityBySlug(slug);
    if (r) peerRecs.push(r);
  }
  // Also pull a few high-eligibility same-country peers beyond nearby for cost alts
  for (const rec of [recA, recB]) {
    if (!rec) continue;
    for (const c of findCountryCities(rec.countryCode)
      .filter((x) => x.pageSlug !== rec.pageSlug && !peerSlugs.has(x.pageSlug))
      .sort((x, y) => y.scores.eligibility - x.scores.eligibility)
      .slice(0, 6)) {
      peerRecs.push(c);
    }
  }

  const peerCpi = new Map<string, number>();
  for (const p of peerRecs.slice(0, 16)) {
    const cpi = metricsFor(p).cpi;
    if (cpi > 0) peerCpi.set(p.pageSlug, cpi);
  }

  const cheaperPeerSlugs = new Set(
    [...peerCpi.entries()].filter(([, cpi]) => cpi < pairMinCpi).map(([slug]) => slug)
  );
  const expensivePeerSlugs = new Set(
    [...peerCpi.entries()].filter(([, cpi]) => cpi > pairMaxCpi).map(([slug]) => slug)
  );

  const cheaperPool = all
    .filter((p) => !used.has(p.slug))
    .filter((p) => {
      const touchesAB =
        compInvolvesSlug(p, recA, cityAName) || compInvolvesSlug(p, recB, cityBName);
      if (!touchesAB) return false;
      return cheaperPeerSlugs.has(p.pageSlugA) || cheaperPeerSlugs.has(p.pageSlugB);
    })
    .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));
  const cheaper_alternatives = takeUniqueLinks(cheaperPool, 8, used);

  const expensivePool = all
    .filter((p) => !used.has(p.slug))
    .filter((p) => {
      const touchesAB =
        compInvolvesSlug(p, recA, cityAName) || compInvolvesSlug(p, recB, cityBName);
      if (!touchesAB) return false;
      return expensivePeerSlugs.has(p.pageSlugA) || expensivePeerSlugs.has(p.pageSlugB);
    })
    .map((p) => ({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` }));
  const expensive_alternatives = takeUniqueLinks(expensivePool, 8, used);

  const city_pages: CompareSeoHubLink[] = [];
  if (recA) {
    city_pages.push({
      slug: recA.pageSlug,
      label: recA.state ? `${recA.city}, ${recA.state}` : recA.city,
      href: `/city/${recA.pageSlug}`,
    });
  }
  if (recB && (!recA || recB.pageSlug !== recA.pageSlug)) {
    city_pages.push({
      slug: recB.pageSlug,
      label: recB.state ? `${recB.city}, ${recB.state}` : recB.city,
      href: `/city/${recB.pageSlug}`,
    });
  }

  const country_pages: CompareSeoHubLink[] = [];
  const countrySeen = new Set<string>();
  for (const rec of [recA, recB]) {
    if (!rec) continue;
    const cslug = countrySlugFromCode(rec.countryCode);
    if (!cslug || countrySeen.has(cslug)) continue;
    countrySeen.add(cslug);
    country_pages.push({
      slug: cslug,
      label: rec.country,
      href: `/country/${cslug}`,
    });
  }

  const enrichOpts = (() => {
    if (!recA && !recB) return undefined;
    const idx = (rec: EligibleCity | null) =>
      rec ? resolveCityCostOfLivingSync(cityQueryLabel(rec)).indices : null;
    const idxA = idx(recA);
    const idxB = idx(recB);
    return {
      cpiA: idxA?.cpi_index,
      cpiB: idxB?.cpi_index,
      rentA: idxA?.rent_index,
      rentB: idxB?.rent_index,
      ppA: idxA?.local_purchasing_power_index,
      ppB: idxB?.local_purchasing_power_index,
    };
  })();

  return {
    related,
    nearby,
    city_pages,
    country_pages,
    cheaper_alternatives,
    expensive_alternatives,
    enrichment: buildCompareEnrichment(cityAName, cityBName, enrichOpts),
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
      most_compared_cities: [],
      related_countries: related.map((c) => ({ slug: c.slug, name: c.name })),
      faqs: doc.faqs,
      summary: doc.summary,
      canonical: `https://citycost.online/country/${slug}`,
      seo_description: doc.seo_description,
      last_updated: doc.meta.last_updated?.slice(0, 10) || doc.meta.generated_at?.slice(0, 10),
      content_version: doc.meta.content_version,
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

  const compareCount = new Map<string, number>();
  const cityBySlug = new Map(cities.map((c) => [c.pageSlug, c]));
  const cityByName = new Map<string, EligibleCity>();
  for (const c of cities) {
    if (!cityByName.has(c.city)) cityByName.set(c.city, c);
  }
  for (const p of listIndexableComparisons()) {
    const hits = new Set<string>();
    if (cityBySlug.has(p.pageSlugA)) hits.add(p.pageSlugA);
    if (cityBySlug.has(p.pageSlugB)) hits.add(p.pageSlugB);
    const byA = cityByName.get(p.cityA);
    const byB = cityByName.get(p.cityB);
    if (byA) hits.add(byA.pageSlug);
    if (byB) hits.add(byB.pageSlug);
    for (const pageSlug of hits) {
      compareCount.set(pageSlug, (compareCount.get(pageSlug) || 0) + 1);
    }
  }
  const most_compared_cities = [...compareCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pageSlug, compare_count]) => {
      const c = cityBySlug.get(pageSlug)!;
      return {
        city: c.city,
        slug: c.pageSlug,
        state: c.state,
        compare_count,
      };
    });

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
    most_compared_cities,
    related_countries: related.map((c) => ({ slug: c.slug, name: c.name })),
    faqs: doc.faqs,
    summary: doc.summary,
    canonical: `https://citycost.online/country/${slug}`,
    seo_description: doc.seo_description,
    last_updated: doc.meta.last_updated?.slice(0, 10) || doc.meta.generated_at?.slice(0, 10),
    content_version: doc.meta.content_version,
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
    .slice(0, 10)
    .map((c) => ({ city: c.city, slug: c.pageSlug, state: c.state }));

  const nearbySlugSet = new Set(nearby.map((n) => n.slug));
  const selfCpi = resolved.indices.cpi_index;

  // Similar-cost peers: same country, closest CPI, exclude self + nearby (bounded lookups)
  const similarCandidates = findCountryCities(rec.countryCode)
    .filter((c) => c.pageSlug !== rec.pageSlug && !nearbySlugSet.has(c.pageSlug))
    .sort((a, b) => b.scores.eligibility - a.scores.eligibility)
    .slice(0, 14);
  const similar_cost_cities = similarCandidates
    .map((c) => {
      const cpi = metricsFor(c).cpi;
      return {
        city: c.city,
        slug: c.pageSlug,
        state: c.state,
        cpi,
        gap: Math.abs(cpi - selfCpi),
      };
    })
    .filter((c) => c.cpi > 0)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 8)
    .map(({ city, slug, state, cpi }) => ({ city, slug, state, cpi }));

  const related_comparisons = listIndexableComparisons()
    .filter(
      (p) =>
        p.cityA === rec.city ||
        p.cityB === rec.city ||
        p.pageSlugA === rec.pageSlug ||
        p.pageSlugB === rec.pageSlug
    )
    .slice(0, 12)
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
    similar_cost_cities,
    faqs: doc.faqs,
    summary: doc.summary,
    canonical: `https://citycost.online/city/${rec.pageSlug}`,
    query_label: cityQueryLabel(rec),
    data_source: resolved.data_source_label,
    confidence_label: resolved.confidence_label,
    timezone: rec.timezone || COUNTRY_TIMEZONES[rec.countryCode] || 'Local timezone (varies by region)',
    seo_description: doc.seo_description,
    last_updated: doc.meta.last_updated?.slice(0, 10) || doc.meta.generated_at?.slice(0, 10),
    content_version: doc.meta.content_version,
    estimation_note: resolved.estimation_note || null,
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
  city_pages: CompareSeoHubLink[];
  country_pages: CompareSeoHubLink[];
  cheaper_alternatives: Array<{ slug: string; label: string }>;
  expensive_alternatives: Array<{ slug: string; label: string }>;
  last_updated?: string;
  content_version?: string;
  data_sources?: string[];
} | null {
  const hit = listIndexableComparisons().find((p) => p.slug === slug);
  if (!hit) return null;

  const cityARec = findCityBySlug(hit.pageSlugA);
  const cityBRec = findCityBySlug(hit.pageSlugB);
  let cpiA = 50,
    cpiB = 50,
    rentA = 50,
    rentB = 50,
    ppA = 50,
    ppB = 50,
    groceriesA = 0,
    groceriesB = 0,
    restaurantsA = 0,
    restaurantsB = 0;
  let exchangeRateA: number | undefined;
  let exchangeRateB: number | undefined;
  let rent1brA: number | null = null;
  let rent1brB: number | null = null;
  let utilitiesA: number | null = null;
  let utilitiesB: number | null = null;
  let internetA: number | null = null;
  let internetB: number | null = null;
  let transportA: number | null = null;
  let transportB: number | null = null;
  let salaryA: number | null = null;
  let salaryB: number | null = null;
  let currencyA: string | undefined;
  let currencyB: string | undefined;
  let sourceLabelA: string | undefined;
  let sourceLabelB: string | undefined;

  const byName = (
    prices: Array<{ item_name: string; average_price: number }>,
    name: string
  ): number | null => {
    const hitP = prices.find((p) => p.item_name === name);
    if (!hitP || !Number.isFinite(hitP.average_price) || hitP.average_price <= 0) return null;
    return hitP.average_price;
  };

  if (cityARec) {
    const r = resolveCityCostOfLivingSync(cityQueryLabel(cityARec));
    cpiA = r.indices.cpi_index;
    rentA = r.indices.rent_index;
    ppA = r.indices.local_purchasing_power_index;
    groceriesA = r.indices.groceries_index;
    restaurantsA = r.indices.restaurant_price_index;
    exchangeRateA = r.exchange_rate;
    currencyA = r.currency;
    sourceLabelA = r.data_source_label;
    rent1brA = byName(r.prices, 'Apartment (1 bedroom) in City Centre');
    utilitiesA = byName(
      r.prices,
      'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment'
    );
    internetA = byName(r.prices, 'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)');
    transportA = byName(r.prices, 'One-way Ticket (Local Transport)');
    salaryA = byName(r.prices, 'Average Monthly Net Salary (After Tax)');
  }
  if (cityBRec) {
    const r = resolveCityCostOfLivingSync(cityQueryLabel(cityBRec));
    cpiB = r.indices.cpi_index;
    rentB = r.indices.rent_index;
    ppB = r.indices.local_purchasing_power_index;
    groceriesB = r.indices.groceries_index;
    restaurantsB = r.indices.restaurant_price_index;
    exchangeRateB = r.exchange_rate;
    currencyB = r.currency;
    sourceLabelB = r.data_source_label;
    rent1brB = byName(r.prices, 'Apartment (1 bedroom) in City Centre');
    utilitiesB = byName(
      r.prices,
      'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment'
    );
    internetB = byName(r.prices, 'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)');
    transportB = byName(r.prices, 'One-way Ticket (Local Transport)');
    salaryB = byName(r.prices, 'Average Monthly Net Salary (After Tax)');
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
    groceriesA,
    groceriesB,
    restaurantsA,
    restaurantsB,
    currencyA,
    currencyB,
    exchangeRateA,
    exchangeRateB,
    rent1brA,
    rent1brB,
    utilitiesA,
    utilitiesB,
    internetA,
    internetB,
    transportA,
    transportB,
    salaryA,
    salaryB,
  });

  const links = buildCompareSeoLinks(hit.queryA, hit.queryB);
  const e = doc.enrichment;

  const enrichment: CompareSeoEnrichment = {
    executive_summary: e.executive_summary,
    winner_summary: e.executive_summary,
    detailed_analysis:
      doc.blocks.find((b) => b.id === 'detailed_breakdown')?.paragraphs.join(' ') ||
      e.decision_summary,
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
    overall_winner: e.overall_winner,
    monthly_difference: e.monthly_difference,
    biggest_difference: e.biggest_difference,
    best_for: e.best_for,
    key_takeaways: e.key_takeaways,
  };

  recordQuality(
    buildPageQuality({
      slug: hit.slug,
      eligibility: 70,
      contentParts: [
        e.executive_summary,
        e.decision_summary,
        ...(e.key_takeaways || []),
        ...doc.faqs.map((f) => f.q + f.a),
      ],
      hasStructuredSections: true,
    })
  );

  return {
    slug: hit.slug,
    cityA: hit.cityA,
    cityB: hit.cityB,
    queryA: hit.queryA,
    queryB: hit.queryB,
    enrichment,
    related: links.related,
    nearby: links.nearby,
    city_pages: links.city_pages,
    country_pages: links.country_pages,
    cheaper_alternatives: links.cheaper_alternatives,
    expensive_alternatives: links.expensive_alternatives,
    last_updated: doc.meta.last_updated?.slice(0, 10) || doc.meta.generated_at?.slice(0, 10),
    content_version: doc.meta.content_version,
    data_sources: [sourceLabelA, sourceLabelB].filter(Boolean) as string[],
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
