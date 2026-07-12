/**
 * Production Cost-of-Living Data Engine
 *
 * Priority:
 *  1. Surveyed / real registry (+ optional Numbeo API)
 *  2. Distance-weighted nearby surveyed cities
 *  3. State/regional baselines × tier × population × state economy
 *  4. Country baseline fallback
 *
 * Never invent random multipliers. Every path is documented.
 */

import { searchGeoCities } from '../geo-cities.js';
import { getCurrencyForCountry } from './currency.js';
import { resolveCityTier, tierCategoryFactors, populationFactors } from './tiers.js';
import {
  findSurveyedCity,
  findSurveyedInState,
  findSurveyedInCountry,
} from './surveyed-data.js';
import {
  COUNTRY_BASELINES,
  getStateEconomy,
  distanceWeightedCategories,
  scaleCategories,
} from './regional.js';
import { buildPriceBasket, scaleLocalBasket } from './prices.js';
import { confidenceForSource, mapSourceLabel } from './confidence.js';
import { fetchNumbeoCity } from './providers/numbeo.js';
import {
  categoriesToIndexMetrics,
  type CategoryIndices,
  type ColEngineResult,
  type InternalSource,
  type CityTier,
} from './types.js';

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  india: 'IN', 'united states': 'US', usa: 'US', 'united kingdom': 'GB', uk: 'GB',
  japan: 'JP', 'united arab emirates': 'AE', uae: 'AE', australia: 'AU',
  germany: 'DE', france: 'FR', canada: 'CA', singapore: 'SG', china: 'CN',
  'south korea': 'KR', brazil: 'BR', mexico: 'MX', netherlands: 'NL',
  spain: 'ES', italy: 'IT', 'new zealand': 'NZ', switzerland: 'CH',
};

function countryCodeFromName(country: string): string {
  return COUNTRY_NAME_TO_CODE[normalize(country)] || '';
}

function resolveQuery(query: string): {
  city: string;
  state: string;
  country: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
} {
  const parts = query.split(',').map((p) => p.trim()).filter(Boolean);
  const cityName = parts[0] || query.trim();
  let city = cityName;
  let state = '';
  let country = '';
  let countryCode = '';
  let latitude: number | null = null;
  let longitude: number | null = null;
  let population: number | null = null;

  if (parts.length >= 3) {
    state = parts[1];
    country = parts[parts.length - 1];
    countryCode = countryCodeFromName(country);
  } else if (parts.length === 2) {
    const maybe = countryCodeFromName(parts[1]);
    if (maybe) {
      country = parts[1];
      countryCode = maybe;
    } else {
      state = parts[1];
    }
  }

  if (!countryCode) {
    try {
      const hits = searchGeoCities(query, 5);
      const match =
        hits.find((h) => normalize(h.city) === normalize(cityName)) ||
        hits.find((h) => normalize(h.city).startsWith(normalize(cityName))) ||
        null;
      if (match) {
        city = cityName;
        state = state || match.state;
        country = country || match.country;
        countryCode = match.countryCode;
        latitude = match.latitude;
        longitude = match.longitude;
        population = match.population;
      }
    } catch {
      /* geo optional */
    }
  }

  return { city, state, country, countryCode: countryCode || 'US', latitude, longitude, population };
}

function applyTierPopState(
  base: CategoryIndices,
  tier: CityTier,
  population: number | null,
  countryCode: string,
  state: string
): CategoryIndices {
  const tierF = tierCategoryFactors(tier);
  const popF = populationFactors(population);
  const eco = getStateEconomy(countryCode, state);

  return scaleCategories(base, {
    housing: tierF.housing * popF.housing * eco.housing,
    groceries: tierF.groceries * popF.groceries * eco.cost,
    restaurants: tierF.restaurants * popF.restaurants * eco.cost * (0.9 + eco.tourism * 0.1),
    transport: tierF.transport * popF.transport * eco.urbanization,
    utilities: tierF.utilities * eco.cost,
    healthcare: tierF.healthcare * eco.income,
    education: tierF.education * eco.income,
    entertainment: tierF.entertainment * eco.tourism,
    salary: tierF.salary * popF.salary * eco.income,
    cpi: eco.cost,
  });
}

function finish(opts: {
  query: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
  categories: CategoryIndices;
  source: InternalSource;
  tier: CityTier;
  population: number | null;
  prices?: ColEngineResult['prices'];
  explanation: string[];
  localBasket?: Partial<Record<string, number>> | null;
}): ColEngineResult {
  const currency = getCurrencyForCountry(opts.countryCode);
  const meta = confidenceForSource(opts.source);
  const prices =
    opts.prices ||
    buildPriceBasket(opts.categories, currency, opts.localBasket || null);

  const displayName = [opts.city, opts.state, opts.country].filter(Boolean).join(', ');
  const cityId = opts.query.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  return {
    city_id: cityId,
    name: displayName || opts.query,
    city: opts.city,
    state: opts.state,
    country: opts.country,
    countryCode: opts.countryCode,
    currency: currency.code,
    symbol: currency.symbol,
    exchange_rate: currency.rate,
    indices: categoriesToIndexMetrics(opts.categories),
    categories: opts.categories,
    prices,
    tier: opts.tier,
    population: opts.population,
    data_source: opts.source,
    data_source_label: mapSourceLabel(opts.source),
    confidence: meta.confidence,
    confidence_label: meta.label,
    confidence_stars: meta.stars,
    estimation_note: meta.note,
    explanation: opts.explanation,
    is_estimated: !['surveyed', 'numbeo', 'cache_verified'].includes(opts.source),
    is_verified: opts.source === 'surveyed' || opts.source === 'numbeo' || opts.source === 'cache_verified',
  };
}

/**
 * Resolve full COL payload for a city query.
 */
export async function resolveCityCostOfLiving(
  query: string,
  options?: { numbeoKey?: string }
): Promise<ColEngineResult> {
  const resolved = resolveQuery(query);
  let { city, state, country, countryCode, latitude, longitude, population } = resolved;

  // Enrich coords/population from surveyed registry if known
  const surveyedPeek = findSurveyedCity(city, state, countryCode);
  if (surveyedPeek) {
    population = population ?? surveyedPeek.population ?? null;
    latitude = latitude ?? surveyedPeek.latitude ?? null;
    longitude = longitude ?? surveyedPeek.longitude ?? null;
    if (!state && surveyedPeek.state) state = surveyedPeek.state;
    if (!country) country = surveyedPeek.country;
  }

  const tier = resolveCityTier(city, population);

  // ── LAYER 1a: Surveyed registry ────────────────────────────────────────
  const surveyed = findSurveyedCity(city, state, countryCode);
  if (surveyed) {
    return finish({
      query,
      city: surveyed.city,
      state: surveyed.state || state,
      country: surveyed.country,
      countryCode: surveyed.countryCode,
      categories: surveyed.categories,
      source: 'surveyed',
      tier: surveyed.tier,
      population: surveyed.population ?? population,
      localBasket: surveyed.localBasket || null,
      explanation: [
        `Matched surveyed registry (${surveyed.provider}${surveyed.asOf ? `, as of ${surveyed.asOf}` : ''}).`,
        surveyed.localBasket
          ? 'Absolute local-currency basket used for prices.'
          : 'Category indices converted via per-category NYC baselines.',
      ],
    });
  }

  // ── LAYER 1b: Numbeo API (optional) ────────────────────────────────────
  const numbeo = await fetchNumbeoCity(query, options?.numbeoKey || process.env.NUMBEO_API_KEY);
  if (numbeo) {
    return finish({
      query,
      city,
      state,
      country: country || numbeo.name,
      countryCode: numbeo.countryCodeHint || countryCode,
      categories: numbeo.categories,
      source: 'numbeo',
      tier,
      population,
      prices: numbeo.prices,
      explanation: ['Loaded live Numbeo city_prices API response.'],
    });
  }

  // ── LAYER 2+5: Nearby / distance-weighted ──────────────────────────────
  const nearbyPool = [
    ...findSurveyedInState(state, countryCode, city),
    ...findSurveyedInCountry(countryCode, city).slice(0, 8),
  ];
  // Dedupe by city name
  const seen = new Set<string>();
  const nearbyUnique = nearbyPool.filter((r) => {
    const k = normalize(r.city);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const weighted = distanceWeightedCategories(latitude, longitude, nearbyUnique, 500);
  if (weighted && weighted.used.length > 0) {
    // Adjust from nearby average toward this city's tier/pop (relative to avg neighbor tier ~2)
    const neighborTier = weighted.used.reduce((s, r) => s + r.tier, 0) / weighted.used.length;
    const targetTierF = tierCategoryFactors(tier);
    const neighborTierF = tierCategoryFactors(Math.round(neighborTier) as CityTier);
    const rel: Partial<Record<keyof CategoryIndices, number>> = {
      housing: targetTierF.housing / neighborTierF.housing,
      groceries: targetTierF.groceries / neighborTierF.groceries,
      restaurants: targetTierF.restaurants / neighborTierF.restaurants,
      transport: targetTierF.transport / neighborTierF.transport,
      utilities: targetTierF.utilities / neighborTierF.utilities,
      healthcare: targetTierF.healthcare / neighborTierF.healthcare,
      education: targetTierF.education / neighborTierF.education,
      entertainment: targetTierF.entertainment / neighborTierF.entertainment,
      salary: targetTierF.salary / neighborTierF.salary,
    };
    const popF = populationFactors(population);
    const eco = getStateEconomy(countryCode, state);
    const categories = scaleCategories(weighted.categories, {
      housing: (rel.housing || 1) * popF.housing * eco.housing,
      groceries: (rel.groceries || 1) * popF.groceries * eco.cost,
      restaurants: (rel.restaurants || 1) * popF.restaurants * eco.cost,
      transport: (rel.transport || 1) * popF.transport * eco.urbanization,
      utilities: (rel.utilities || 1) * eco.cost,
      healthcare: (rel.healthcare || 1) * eco.income,
      education: (rel.education || 1) * eco.income,
      entertainment: (rel.entertainment || 1) * eco.tourism,
      salary: (rel.salary || 1) * popF.salary * eco.income,
    });

    // Prefer scaling absolute basket from closest neighbor that has one
    const withBasket = weighted.used.find((u) => u.localBasket);
    let prices = undefined as ColEngineResult['prices'] | undefined;
    if (withBasket?.localBasket) {
      prices = scaleLocalBasket(
        withBasket.localBasket as Record<string, number>,
        withBasket.categories,
        categories,
        getCurrencyForCountry(countryCode).code
      );
    }

    const names = weighted.used.slice(0, 4).map((u) => u.city).join(', ');
    return finish({
      query,
      city,
      state,
      country,
      countryCode,
      categories,
      source: 'nearby',
      tier,
      population,
      prices,
      explanation: [
        `Estimated from nearby surveyed cities: ${names}.`,
        'Distance-weighted blend with tier, population, and state-economy adjustments per category.',
        'These values are estimated using nearby cities and regional averages.',
      ],
    });
  }

  // ── LAYER 3+4+6+7: Regional / country × tier × population × economy ────
  const countryBase = COUNTRY_BASELINES[countryCode] || COUNTRY_BASELINES.DEFAULT;
  const categories = applyTierPopState(countryBase, tier, population, countryCode, state);
  const source: InternalSource = state ? 'regional' : 'country';

  return finish({
    query,
    city,
    state,
    country,
    countryCode,
    categories,
    source,
    tier,
    population,
    explanation: [
      state
        ? `Regional estimate from ${country} / ${state} baselines.`
        : `Country-level estimate for ${countryCode}.`,
      `City tier ${tier}; population ${population ?? 'unknown'}.`,
      'Per-category factors applied (housing, groceries, restaurants, transport, utilities, salary).',
    ],
  });
}

/** Sync wrapper for callers that cannot await (tests / legacy). */
export function resolveCityCostOfLivingSync(query: string): ColEngineResult {
  // Sync path skips Numbeo; surveyed → nearby → regional only
  const resolved = resolveQuery(query);
  let { city, state, country, countryCode, latitude, longitude, population } = resolved;
  const surveyedPeek = findSurveyedCity(city, state, countryCode);
  if (surveyedPeek) {
    population = population ?? surveyedPeek.population ?? null;
    latitude = latitude ?? surveyedPeek.latitude ?? null;
    longitude = longitude ?? surveyedPeek.longitude ?? null;
    if (!state && surveyedPeek.state) state = surveyedPeek.state;
    if (!country) country = surveyedPeek.country;
  }
  const tier = resolveCityTier(city, population);

  const surveyed = findSurveyedCity(city, state, countryCode);
  if (surveyed) {
    return finish({
      query,
      city: surveyed.city,
      state: surveyed.state || state,
      country: surveyed.country,
      countryCode: surveyed.countryCode,
      categories: surveyed.categories,
      source: 'surveyed',
      tier: surveyed.tier,
      population: surveyed.population ?? population,
      localBasket: surveyed.localBasket || null,
      explanation: [`Matched surveyed registry (${surveyed.provider}).`],
    });
  }

  const nearbyPool = [
    ...findSurveyedInState(state, countryCode, city),
    ...findSurveyedInCountry(countryCode, city).slice(0, 8),
  ];
  const seen = new Set<string>();
  const nearbyUnique = nearbyPool.filter((r) => {
    const k = normalize(r.city);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const weighted = distanceWeightedCategories(latitude, longitude, nearbyUnique, 500);
  if (weighted && weighted.used.length > 0) {
    const neighborTier = weighted.used.reduce((s, r) => s + r.tier, 0) / weighted.used.length;
    const targetTierF = tierCategoryFactors(tier);
    const neighborTierF = tierCategoryFactors(Math.round(neighborTier) as CityTier);
    const popF = populationFactors(population);
    const eco = getStateEconomy(countryCode, state);
    const categories = scaleCategories(weighted.categories, {
      housing: (targetTierF.housing / neighborTierF.housing) * popF.housing * eco.housing,
      groceries: (targetTierF.groceries / neighborTierF.groceries) * popF.groceries * eco.cost,
      restaurants: (targetTierF.restaurants / neighborTierF.restaurants) * popF.restaurants * eco.cost,
      transport: (targetTierF.transport / neighborTierF.transport) * popF.transport * eco.urbanization,
      utilities: (targetTierF.utilities / neighborTierF.utilities) * eco.cost,
      healthcare: (targetTierF.healthcare / neighborTierF.healthcare) * eco.income,
      education: (targetTierF.education / neighborTierF.education) * eco.income,
      entertainment: (targetTierF.entertainment / neighborTierF.entertainment) * eco.tourism,
      salary: (targetTierF.salary / neighborTierF.salary) * popF.salary * eco.income,
    });
    const withBasket = weighted.used.find((u) => u.localBasket);
    let prices = undefined as ColEngineResult['prices'] | undefined;
    if (withBasket?.localBasket) {
      prices = scaleLocalBasket(
        withBasket.localBasket as Record<string, number>,
        withBasket.categories,
        categories,
        getCurrencyForCountry(countryCode).code
      );
    }
    return finish({
      query, city, state, country, countryCode, categories, source: 'nearby', tier, population, prices,
      explanation: ['Nearby distance-weighted estimate.', 'These values are estimated using nearby cities and regional averages.'],
    });
  }

  const countryBase = COUNTRY_BASELINES[countryCode] || COUNTRY_BASELINES.DEFAULT;
  const categories = applyTierPopState(countryBase, tier, population, countryCode, state);
  return finish({
    query, city, state, country, countryCode, categories,
    source: state ? 'regional' : 'country',
    tier, population,
    explanation: ['Regional/country baseline estimate with tier and population factors.'],
  });
}

export { getCurrencyForCountry, sameCountry, convertCurrency } from './currency.js';
export type { ColEngineResult, DataSourceLabel } from './types.js';
