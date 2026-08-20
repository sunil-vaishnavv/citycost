/**
 * Single resolution point for the cost of living of an indexed city.
 *
 * Every public surface — city pages, country averages, comparisons, intent
 * landings and the knowledge/content engine — must resolve through here.
 *
 * Two reasons this exists rather than each caller invoking the COL engine:
 *
 *  1. Consistency. The same city has to report the same rent and salary on
 *     /city/x, /rent/x and /country/y, otherwise the pages contradict one
 *     another.
 *  2. Uniqueness. The COL engine is handed a display label ("Sétif, Sétif,
 *     Algeria") and cannot recover tier, capital status or coordinates from it.
 *     Without those hints every non-surveyed city in a country resolved to a
 *     byte-identical result, which made the pages duplicates of one another and
 *     caused Google to fold them into a single canonical cluster.
 *
 * Lives at lib/ root (not in seo-catalog) because content-engine needs it and
 * seo-catalog already imports content-engine.
 */

import {
  resolveCityCostOfLiving,
  resolveCityCostOfLivingSync,
  type ColResolveHints,
} from './col-engine/index.js';
import { haversineKm } from './col-engine/regional.js';
import type { CityTier } from './col-engine/types.js';
import type { ColEngineResult } from './col-engine/types.js';
import { listEligibleCities, type EligibleCity } from './seo-eligibility.js';

/** Display label used as the engine query. */
export function cityLabelFor(rec: EligibleCity): string {
  return rec.label || [rec.city, rec.state, rec.country].filter(Boolean).join(', ');
}

/**
 * Is this record really the national capital?
 *
 * The eligibility engine flags `isCapital` on a plain city-name match, so any
 * same-named town inherits it — Costa Rica's capital is San José in San José
 * Province, but the index only contains the San José in Alajuela Province, which
 * would otherwise be priced as a national capital.
 *
 * Genuine capitals in this dataset satisfy at least one corroborating signal:
 * they are well-known enough to be frequently compared (Bangkok), they sit in a
 * same-named administrative division (Bern, Bern), or they are their country's
 * top-scoring indexed city (Warsaw). A lone name match with none of these is
 * treated as an ordinary town.
 */
function isNationalCapital(rec: EligibleCity, topInCountry: EligibleCity | null): boolean {
  if (!rec.isCapital) return false;
  if (rec.isFrequentlyCompared) return true;
  if (rec.state && norm(rec.state) === norm(rec.city)) return true;
  return topInCountry ? topInCountry.pageSlug === rec.pageSlug : false;
}

function norm(s: string): string {
  return s.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Country's primary indexed city — the capital when it is in the index, else the
 * highest-scoring one. Origin for the regional cost gradient.
 */
const primaryCityCache = new Map<string, EligibleCity | null>();
let primaryCacheStamp = '';

function primaryCityFor(countryCode: string): EligibleCity | null {
  const all = listEligibleCities();
  const stamp = `${all.length}:${all[0]?.pageSlug || ''}`;
  if (stamp !== primaryCacheStamp) {
    primaryCityCache.clear();
    primaryCacheStamp = stamp;
  }
  const cached = primaryCityCache.get(countryCode);
  if (cached !== undefined) return cached;

  const pool = all.filter((c) => c.countryCode === countryCode);
  const topInCountry =
    pool.slice().sort((a, b) => b.scores.eligibility - a.scores.eligibility)[0] || null;
  const primary = pool.find((c) => isNationalCapital(c, topInCountry)) || topInCountry;
  primaryCityCache.set(countryCode, primary);
  return primary;
}

/**
 * Tier for an indexed city.
 *
 * resolveCityTier() infers tier from population, and the geo dataset carries no
 * population, so it falls back to curated name lists that only cover US/UK/India
 * cities — leaving national capitals such as Bangkok or Vienna at tier 5 (rural
 * town). Where the catalog knows a city is a capital or a frequently-compared
 * metro, use that instead.
 *
 * Deliberately NOT keyed off `isMajor`: that flag is true whenever the city name
 * equals its state name (Sétif, Béchar…), which says nothing about city size.
 */
function tierFor(rec: EligibleCity, capital: boolean): CityTier {
  const known = (rec.tier || 5) as CityTier;
  if (known < 5) return known;
  if (capital) return 2;
  if (rec.isFrequentlyCompared) return 3;
  return 5;
}

/**
 * The catalog signals for one indexed city.
 *
 * Exported so the async/API path can resolve the very same city with the very
 * same inputs — a city page and the calculator must never disagree.
 */
export function hintsFor(rec: EligibleCity): ColResolveHints {
  const primary = primaryCityFor(rec.countryCode);
  const capital = primary != null && primary.pageSlug === rec.pageSlug && rec.isCapital;
  let distanceFromPrimaryKm: number | null = null;
  if (
    primary &&
    primary.pageSlug !== rec.pageSlug &&
    rec.latitude != null &&
    rec.longitude != null &&
    primary.latitude != null &&
    primary.longitude != null
  ) {
    distanceFromPrimaryKm = haversineKm(
      rec.latitude,
      rec.longitude,
      primary.latitude,
      primary.longitude
    );
  }

  return {
    countryCode: rec.countryCode,
    tier: tierFor(rec, capital),
    population: rec.population,
    latitude: rec.latitude,
    longitude: rec.longitude,
    isCapital: capital,
    isMajor: rec.isMajor,
    isTourismOrBusiness: rec.isTourismOrBusiness,
    distanceFromPrimaryKm,
  };
}

/** Resolve cost of living for an indexed city, with all catalog signals applied. */
export function resolveCityCost(rec: EligibleCity): ColEngineResult {
  return resolveCityCostOfLivingSync(cityLabelFor(rec), hintsFor(rec));
}

/**
 * Match a free-text query ("Bangkok, Bangkok, Thailand") back to an indexed city.
 *
 * /api/city_prices receives a label, not a slug. Without this the API would
 * resolve the city with no hints and report different numbers than the city
 * page does for the same place.
 */
const labelIndexCache = new Map<string, EligibleCity>();
let labelIndexStamp = '';

function labelIndex(): Map<string, EligibleCity> {
  const all = listEligibleCities();
  const stamp = `${all.length}:${all[0]?.pageSlug || ''}`;
  if (stamp !== labelIndexStamp) {
    labelIndexCache.clear();
    for (const c of all) {
      const keys = [
        cityLabelFor(c),
        [c.city, c.state, c.country].filter(Boolean).join(', '),
        [c.city, c.country].filter(Boolean).join(', '),
        c.pageSlug,
      ];
      for (const k of keys) {
        const nk = norm(k);
        if (nk && !labelIndexCache.has(nk)) labelIndexCache.set(nk, c);
      }
    }
    labelIndexStamp = stamp;
  }
  return labelIndexCache;
}

export function findIndexedCityByQuery(query: string): EligibleCity | null {
  const idx = labelIndex();
  return idx.get(norm(query)) || null;
}

/**
 * Async resolution for a free-text query (API / calculator path).
 * Uses the indexed city's hints when the query names a city we publish, so the
 * API and the city page always agree; otherwise resolves the query directly.
 */
export async function resolveCityCostByQuery(
  query: string,
  options?: { numbeoKey?: string }
): Promise<ColEngineResult> {
  const rec = findIndexedCityByQuery(query);
  return resolveCityCostOfLiving(rec ? cityLabelFor(rec) : query, {
    numbeoKey: options?.numbeoKey,
    hints: rec ? hintsFor(rec) : undefined,
  });
}
