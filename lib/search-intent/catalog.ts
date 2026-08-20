/**
 * Intent catalog — eligibility lists, page builders, sitemap URLs.
 * Reads SEO indexable cities; does not modify SEO Eligibility Engine.
 */

import { resolveCityCost } from '../city-cost-resolve.js';
import { getCurrencyForCountry } from '../col-engine/currency.js';
import {
  listIndexableCities,
  listIndexableCountries,
  listIndexableComparisons,
  findCityBySlug,
  cityQueryLabel,
  countrySlugFromCode,
  buildCityPageData,
  buildCountryPageData,
} from '../seo-catalog.js';
import type { EligibleCity } from '../seo-eligibility.js';
import type { CityLandingKind, CategoryHubId, CountryGuideKind, IntentLandingPublic } from './types.js';
import {
  CITY_LANDING_KINDS,
  CATEGORY_HUBS,
  COUNTRY_GUIDE_KINDS,
  cityLandingPath,
  categoryHubPath,
  countryGuidePath,
  parseCityLandingPath,
  parseCategoryHubPath,
  parseCountryGuidePath,
} from './intent.js';
import { scoreCityLanding, maxLandingsPerKind, type CityMetricsForIntent } from './quality.js';
import { composeCityLanding, composeCategoryHub, composeCountryGuide } from './landing-pages.js';
import {
  scoreCityLandingPriority,
  scoreCategoryHubPriority,
  scoreCountryGuidePriority,
  compositeRankScore,
  sortByPriorityDesc,
  type KeywordPriorityInternal,
} from './priority.js';
import { cityLandingPath as landingPath } from './intent.js';

type LandingKey = `${CityLandingKind}:${string}`;

let metricsCache: Map<string, CityMetricsForIntent> | null = null;
let eligibleLandingsCache: Map<CityLandingKind, string[]> | null = null;
/** Internal priority cache — never exposed on public payloads. */
let priorityCache: Map<string, KeywordPriorityInternal> | null = null;

function priorityKey(kind: CityLandingKind, slug: string): string {
  return `${kind}:${slug}`;
}

function getOrScorePriority(kind: CityLandingKind, m: CityMetricsForIntent): KeywordPriorityInternal {
  if (!priorityCache) priorityCache = new Map();
  const key = priorityKey(kind, m.pageSlug);
  const hit = priorityCache.get(key);
  if (hit) return hit;
  const scored = scoreCityLandingPriority(kind, m);
  priorityCache.set(key, scored);
  return scored;
}

function metricsFor(rec: EligibleCity): CityMetricsForIntent {
  if (!metricsCache) metricsCache = new Map();
  const hit = metricsCache.get(rec.pageSlug);
  if (hit) return hit;

  const resolved = resolveCityCost(rec);
  const byName = (n: string) => resolved.prices.find((p) => p.item_name === n)?.average_price ?? 0;
  const rent = byName('Apartment (1 bedroom) in City Centre');
  const salary = byName('Average Monthly Net Salary (After Tax)');
  const m: CityMetricsForIntent = {
    pageSlug: rec.pageSlug,
    city: rec.city,
    countryCode: rec.countryCode,
    population: rec.population ?? null,
    cpi: resolved.indices.cpi_index,
    rent,
    salary,
    hasRentSample: rent > 0,
    hasSalarySample: salary > 0,
    confidence_label: resolved.confidence_label,
    data_source: resolved.data_source_label,
    eligibilityHint: rec.scores?.eligibility ?? 50,
  };
  metricsCache.set(rec.pageSlug, m);
  return m;
}

function scoreLandingForKind(
  kind: CityLandingKind,
  rec: EligibleCity
): { slug: string; q: number } | null {
  const m = metricsFor(rec);
  const quality = scoreCityLanding(kind, m);
  if (!quality.index_eligibility) return null;
  const qualityBlend =
    quality.seo_score * 0.35 +
    quality.intent_match_score * 0.35 +
    quality.content_score * 0.2 +
    quality.authority_score * 0.1;
  const priority = getOrScorePriority(kind, m);
  return { slug: rec.pageSlug, q: compositeRankScore(qualityBlend, priority) };
}

function ensureEligibleLandings(): Map<CityLandingKind, string[]> {
  if (eligibleLandingsCache) return eligibleLandingsCache;
  const cap = maxLandingsPerKind();
  const map = new Map<CityLandingKind, string[]>();
  const cities = listIndexableCities();

  for (const kind of CITY_LANDING_KINDS) {
    const scored: Array<{ slug: string; q: number }> = [];
    for (const rec of cities) {
      const row = scoreLandingForKind(kind, rec);
      if (row) scored.push(row);
    }
    scored.sort((a, b) => b.q - a.q);
    map.set(
      kind,
      scored.slice(0, cap).map((s) => s.slug)
    );
  }
  eligibleLandingsCache = map;
  return map;
}

/**
 * Build the intent eligibility cache without monopolizing the event loop.
 * Required so other sitemap handlers (esp. comparisons) can answer Googlebot
 * while this 60–90s catalog warm runs after process start.
 */
export async function warmIntentCatalogAsync(): Promise<void> {
  if (eligibleLandingsCache) return;
  const cap = maxLandingsPerKind();
  const map = new Map<CityLandingKind, string[]>();
  const cities = listIndexableCities();
  let steps = 0;

  for (const kind of CITY_LANDING_KINDS) {
    const scored: Array<{ slug: string; q: number }> = [];
    for (const rec of cities) {
      const row = scoreLandingForKind(kind, rec);
      if (row) scored.push(row);
      steps += 1;
      // Yield after every city so large sitemap responses can flush to Googlebot.
      await new Promise<void>((r) => setImmediate(r));
      if (eligibleLandingsCache) return;
      if (steps % 25 === 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
        if (eligibleLandingsCache) return;
      }
    }
    scored.sort((a, b) => b.q - a.q);
    map.set(
      kind,
      scored.slice(0, cap).map((s) => s.slug)
    );
  }
  if (!eligibleLandingsCache) eligibleLandingsCache = map;
}

export function isCityLandingIndexable(kind: CityLandingKind, pageSlug: string): boolean {
  const map = ensureEligibleLandings();
  return (map.get(kind) || []).includes(pageSlug);
}

export function listIndexableCityLandingUrls(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/$/, '');
  const map = ensureEligibleLandings();
  const ranked: Array<{ url: string; score: number }> = [];
  for (const kind of CITY_LANDING_KINDS) {
    for (const slug of map.get(kind) || []) {
      const rec = findCityBySlug(slug);
      if (!rec) continue;
      const m = metricsFor(rec);
      const priority = getOrScorePriority(kind, m);
      ranked.push({
        url: `${base}${cityLandingPath(kind, slug)}`,
        score: priority.priority_score,
      });
    }
  }
  return sortByPriorityDesc(ranked, (r) => r.score).map((r) => r.url);
}

export function listIndexableCategoryUrls(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/$/, '');
  const ranked = CATEGORY_HUBS.map((id) => ({
    url: `${base}${categoryHubPath(id)}`,
    score: scoreCategoryHubPriority(id).priority_score,
  }));
  return sortByPriorityDesc(ranked, (r) => r.score).map((r) => r.url);
}

export function listIndexableCountryGuideUrls(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/$/, '');
  const countries = listIndexableCountries();
  const cities = listIndexableCities();
  const countBySlug = new Map<string, number>();
  for (const c of cities) {
    const s = countrySlugFromCode(c.countryCode);
    countBySlug.set(s, (countBySlug.get(s) || 0) + 1);
  }
  const ranked: Array<{ url: string; score: number }> = [];
  for (const c of countries) {
    const n = countBySlug.get(c.slug) || 0;
    if (n < 2) continue;
    for (const kind of COUNTRY_GUIDE_KINDS) {
      ranked.push({
        url: `${base}${countryGuidePath(kind, c.slug)}`,
        score: scoreCountryGuidePriority(kind, n).priority_score,
      });
    }
  }
  return sortByPriorityDesc(ranked, (r) => r.score).map((r) => r.url);
}

function eligibleKindsForSlug(pageSlug: string): CityLandingKind[] {
  const map = ensureEligibleLandings();
  return CITY_LANDING_KINDS.filter((k) => (map.get(k) || []).includes(pageSlug));
}

export function buildCityLandingPageData(kind: CityLandingKind, slug: string): IntentLandingPublic | null {
  if (!isCityLandingIndexable(kind, slug)) return null;
  const rec = findCityBySlug(slug);
  if (!rec) return null;
  const cityPage = buildCityPageData(slug);
  if (!cityPage) return null;
  const m = metricsFor(rec);
  const nearby = cityPage.nearby.map((n) => ({ city: n.city, slug: n.slug }));
  const comparisons = cityPage.related_comparisons.map((c) => ({ label: c.label, slug: c.slug }));
  const kinds = eligibleKindsForSlug(rec.pageSlug);

  // Build internal link-priority map for related ordering (scores stay internal).
  const linkPriority = new Map<string, number>();
  for (const k of kinds) {
    linkPriority.set(landingPath(k, rec.pageSlug), getOrScorePriority(k, m).priority_score);
  }
  for (const n of nearby.slice(0, 8)) {
    const nearRec = findCityBySlug(n.slug);
    if (nearRec) {
      linkPriority.set(`/city/${n.slug}`, getOrScorePriority('living-in', metricsFor(nearRec)).priority_score);
    }
  }

  return composeCityLanding({
    kind,
    city: rec.city,
    state: rec.state,
    country: rec.country,
    countrySlug: countrySlugFromCode(rec.countryCode),
    pageSlug: rec.pageSlug,
    currency: cityPage.currency,
    symbol: cityPage.symbol,
    rent_1br: m.rent || undefined,
    salary: m.salary || undefined,
    cpi: m.cpi || undefined,
    confidence_label: m.confidence_label,
    data_source: m.data_source,
    eligibleKinds: kinds,
    nearby,
    comparisons,
    linkPriority,
  });
}

export function buildCategoryHubPageData(id: CategoryHubId): IntentLandingPublic | null {
  const cities = listIndexableCities();
  const rows = cities.map((rec) => {
    const m = metricsFor(rec);
    return {
      city: rec.city,
      slug: rec.pageSlug,
      cpi: m.cpi,
      rent: m.rent,
      country: rec.country,
    };
  });
  // Require minimum coverage
  const usable = rows.filter((r) => r.cpi > 0 || r.rent > 0);
  if (usable.length < 5) return null;
  return composeCategoryHub({ id, cities: usable });
}

export function buildCountryGuidePageData(
  kind: CountryGuideKind,
  countrySlug: string
): IntentLandingPublic | null {
  const country = buildCountryPageData(countrySlug);
  if (!country || country.cities.length < 2) return null;
  const fx = getCurrencyForCountry(country.code);
  void fx;
  return composeCountryGuide({
    kind,
    name: country.name,
    slug: country.slug,
    code: country.code,
    cities: country.cities.map((c) => ({ city: c.city, slug: c.slug, cpi: c.cpi, rent: c.rent })),
    comparisons: country.top_comparisons,
    avg_cpi: country.avg_cpi,
  });
}

export function buildIntentPageFromPath(pathname: string): IntentLandingPublic | null {
  const city = parseCityLandingPath(pathname);
  if (city) return buildCityLandingPageData(city.kind, city.slug);
  const cat = parseCategoryHubPath(pathname);
  if (cat) return buildCategoryHubPageData(cat);
  const guide = parseCountryGuidePath(pathname);
  if (guide) return buildCountryGuidePageData(guide.kind, guide.slug);
  return null;
}

export function getIntentIndexStats() {
  const map = ensureEligibleLandings();
  let landings = 0;
  const by_kind: Record<string, number> = {};
  let priority_sum = 0;
  let priority_n = 0;
  for (const kind of CITY_LANDING_KINDS) {
    const slugs = map.get(kind) || [];
    by_kind[kind] = slugs.length;
    landings += slugs.length;
    for (const slug of slugs.slice(0, 50)) {
      const rec = findCityBySlug(slug);
      if (!rec) continue;
      priority_sum += getOrScorePriority(kind, metricsFor(rec)).priority_score;
      priority_n++;
    }
  }
  const countries = listIndexableCountryGuideUrls('https://citycost.online').length;
  return {
    city_landings: landings,
    by_kind,
    category_hubs: CATEGORY_HUBS.length,
    country_guides: countries,
    max_per_kind: maxLandingsPerKind(),
    /** Aggregate only — never per-page priority. */
    avg_priority_sample: priority_n ? Math.round(priority_sum / priority_n) : null,
    keyword_priority_engine: true,
    topic_silos: true,
  };
}

/** Internal lookup for ops/future generation — do not attach to public responses. */
export function peekKeywordPriorityInternal(
  kind: CityLandingKind,
  pageSlug: string
): KeywordPriorityInternal | null {
  const rec = findCityBySlug(pageSlug);
  if (!rec) return null;
  return getOrScorePriority(kind, metricsFor(rec));
}

export function resetIntentCaches() {
  metricsCache = null;
  eligibleLandingsCache = null;
  priorityCache = null;
}

export type { LandingKey };
