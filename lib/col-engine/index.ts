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

import { Country } from 'country-state-city';
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
import { fetchNumbeoCity, type NumbeoCityResult } from './providers/numbeo.js';
import {
  categoriesToIndexMetrics,
  type CategoryIndices,
  type ColEngineResult,
  type InternalSource,
  type CityTier,
  type SurveyedCityRecord,
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

/**
 * Full country-name -> ISO index, built once from the geographic dataset.
 * COUNTRY_NAME_TO_CODE above only covers 22 names/aliases; relying on it alone
 * left ~120 countries unresolved, and resolveQuery used to turn an unresolved
 * country into 'US'. That silently priced Andorran and Dominican cities off US
 * surveyed data in US dollars.
 */
let countryNameIndex: Map<string, string> | null = null;
function countryNameToCode(): Map<string, string> {
  if (countryNameIndex) return countryNameIndex;
  const m = new Map<string, string>();
  for (const c of Country.getAllCountries()) {
    if (!c.isoCode || c.isoCode.length !== 2 || !c.name) continue;
    const key = normalize(c.name);
    if (!m.has(key)) m.set(key, c.isoCode);
  }
  countryNameIndex = m;
  return m;
}

function countryCodeFromName(country: string): string {
  const key = normalize(country);
  if (!key) return '';
  return COUNTRY_NAME_TO_CODE[key] || countryNameToCode().get(key) || '';
}

function resolveQuery(query: string, hints?: ColResolveHints): {
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
  // The caller's already-resolved country always wins: the SEO catalog knows the
  // ISO code for certain, while parsing a display label is best-effort.
  let countryCode = (hints?.countryCode || '').trim().toUpperCase();
  let latitude: number | null = null;
  let longitude: number | null = null;
  let population: number | null = null;

  // One geographic lookup, used both to disambiguate the label and to enrich it.
  let hits: ReturnType<typeof searchGeoCities> = [];
  try {
    hits = searchGeoCities(query, 10);
  } catch {
    /* geo optional */
  }
  const wantedCity = normalize(cityName);

  if (parts.length >= 3) {
    state = parts[1];
    country = parts[parts.length - 1];
    countryCode = countryCode || countryCodeFromName(country);
  } else if (parts.length === 2) {
    // "Atlanta, Georgia" is ambiguous: Georgia is a US state AND a country, as are
    // Niger (a Nigerian state), Luxembourg (a Belgian province) and others. Since
    // countryCodeFromName() now resolves every country name, letting the country
    // reading win unconditionally would price Atlanta as Tbilisi. Ask the
    // geographic dataset first: if a real city of this name sits in a subdivision
    // called parts[1], parts[1] is a state.
    const asState = hits.find(
      (h) => normalize(h.city) === wantedCity && normalize(h.state) === normalize(parts[1])
    );
    const asCountryCode = countryCodeFromName(parts[1]);
    if (asState) {
      state = parts[1];
      country = country || asState.country;
      countryCode = countryCode || asState.countryCode;
    } else if (asCountryCode) {
      country = parts[1];
      countryCode = countryCode || asCountryCode;
    } else {
      state = parts[1];
    }
  }

  // Geo enrichment. This must run even when the country was already parsed from the
  // label ("Bangkok, Bangkok, Thailand"): population and coordinates come only from
  // here. Without them resolveCityTier() returns tier 5 for every city,
  // populationFactors() stays neutral, and the distance-weighted nearby layer can
  // never run — collapsing every non-surveyed city onto the identical
  // COUNTRY_BASELINES.DEFAULT output. Known fields are never overwritten.
  {
    const inCountry = countryCode ? hits.filter((h) => h.countryCode === countryCode) : [];
    const pool = inCountry.length ? inCountry : hits;
    const match =
      pool.find(
        (h) => normalize(h.city) === wantedCity && (!state || normalize(h.state) === normalize(state))
      ) ||
      pool.find((h) => normalize(h.city) === wantedCity) ||
      pool.find((h) => normalize(h.city).startsWith(wantedCity)) ||
      null;
    if (match) {
      city = cityName;
      state = state || match.state;
      country = country || match.country;
      countryCode = countryCode || match.countryCode;
      latitude = latitude ?? match.latitude;
      longitude = longitude ?? match.longitude;
      population = population ?? match.population;
    }
  }

  // Deliberately no 'US' fallback: an unknown country must stay unknown so it
  // falls to COUNTRY_BASELINES.DEFAULT rather than borrowing US costs/currency.
  return { city, state, country, countryCode, latitude, longitude, population };
}

/**
 * Fill in coordinates for surveyed registry entries that lack them.
 *
 * distanceWeightedCategories() applies its radius filter only when BOTH the
 * target and the neighbour have coordinates; a neighbour without them is
 * included at a flat weight at *any* distance. Eleven registry entries carry no
 * coordinates (nine Indian cities, Toronto, Singapore), so Toronto counted as a
 * nearby city for Vancouver 3,350 km away and for Quebec City 730 km away. With
 * Toronto the only surveyed Canadian entry it was also the only member of the
 * blend, so both cities inherited its category vector verbatim and rendered
 * byte-identical pages.
 *
 * The coordinates come from the same geographic dataset the rest of the engine
 * uses. Curated cost figures are never touched — this only restores the radius
 * behaviour the nearby layer was always meant to have.
 */
const surveyedCoordCache = new Map<string, { lat: number; lon: number } | null>();

function withGeoCoords(records: SurveyedCityRecord[]): SurveyedCityRecord[] {
  return records.map((rec) => {
    if (rec.latitude != null && rec.longitude != null) return rec;

    const key = `${normalize(rec.city)}|${rec.countryCode}`;
    let coord = surveyedCoordCache.get(key);
    if (coord === undefined) {
      coord = null;
      try {
        const want = normalize(rec.city);
        const hits = searchGeoCities(`${rec.city}, ${rec.country}`, 10);
        const match =
          hits.find((h) => h.countryCode === rec.countryCode && normalize(h.city) === want) ||
          null;
        if (match?.latitude != null && match.longitude != null) {
          coord = { lat: match.latitude, lon: match.longitude };
        }
      } catch {
        /* geo optional */
      }
      surveyedCoordCache.set(key, coord);
    }

    return coord ? { ...rec, latitude: coord.lat, longitude: coord.lon } : rec;
  });
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
 * Caller-supplied signals. The SEO catalog already knows each city's tier,
 * capital/metro status and coordinates; without passing them in, the engine has
 * to re-derive everything from a display string and every non-surveyed city in a
 * country resolves identically. Hints only ever fill gaps or refine the regional
 * layer — a surveyed or Numbeo match still wins.
 */
export interface ColResolveHints {
  /**
   * ISO country code the caller already resolved. Always wins over parsing the
   * display label, and prevents an unmatched country name from falling through
   * to a generic baseline.
   */
  countryCode?: string | null;
  tier?: CityTier | null;
  population?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  isCapital?: boolean;
  isMajor?: boolean;
  isTourismOrBusiness?: boolean;
  /** Km from the country's primary indexed city; drives the regional cost gradient. */
  distanceFromPrimaryKm?: number | null;
}

/**
 * Urban-role multipliers for the regional layer, applied on top of the country
 * baseline. Capitals and primary metros carry higher housing and wages than
 * outlying towns in the same country; cost decays with distance from the
 * national economic centre. Bounded and documented — no random factors.
 */
function urbanRoleFactors(hints: ColResolveHints | undefined): {
  housing: number;
  salary: number;
  restaurants: number;
  entertainment: number;
  cost: number;
} {
  const f = { housing: 1, salary: 1, restaurants: 1, entertainment: 1, cost: 1 };
  if (!hints) return f;

  if (hints.isCapital) {
    f.housing *= 1.18;
    f.salary *= 1.12;
    f.cost *= 1.08;
  } else if (hints.isMajor) {
    f.housing *= 1.1;
    f.salary *= 1.06;
    f.cost *= 1.04;
  }
  if (hints.isTourismOrBusiness) {
    f.restaurants *= 1.07;
    f.entertainment *= 1.08;
    f.cost *= 1.02;
  }

  // Distance decay from the national primary city: full weight at 0 km,
  // tapering to 0.82 at ~800 km and no further.
  const d = hints.distanceFromPrimaryKm;
  if (d != null && d > 0) {
    const decay = Math.max(0.82, 1 - Math.min(d, 800) / 800 * 0.18);
    f.housing *= decay;
    f.salary *= decay;
    f.cost *= 0.5 + decay * 0.5;
  }
  return f;
}

/**
 * Resolution context shared by BOTH entry points.
 *
 * The sync and async resolvers used to carry duplicated copies of the
 * surveyed -> nearby -> regional logic, and only the sync one accepted caller
 * hints. That made /city/bangkok-bangkok-thailand and
 * /api/city_prices?query=Bangkok... report different rent and salary for the
 * same city. There is now exactly one set of calculation rules:
 * buildResolutionContext + resolveCore. The only thing the async path adds is
 * the ability to await the optional Numbeo call.
 */
interface ResolutionContext {
  city: string;
  state: string;
  country: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
  tier: CityTier;
  surveyed: ReturnType<typeof findSurveyedCity>;
}

function buildResolutionContext(query: string, hints?: ColResolveHints): ResolutionContext {
  const resolved = resolveQuery(query, hints);
  let { city, state, country, countryCode, latitude, longitude, population } = resolved;

  // Caller-supplied facts fill gaps a display label cannot carry.
  population = population ?? hints?.population ?? null;
  latitude = latitude ?? hints?.latitude ?? null;
  longitude = longitude ?? hints?.longitude ?? null;

  // Enrich coords/population from surveyed registry if known
  const surveyedPeek = findSurveyedCity(city, state, countryCode);
  if (surveyedPeek) {
    population = population ?? surveyedPeek.population ?? null;
    latitude = latitude ?? surveyedPeek.latitude ?? null;
    longitude = longitude ?? surveyedPeek.longitude ?? null;
    if (!state && surveyedPeek.state) state = surveyedPeek.state;
    if (!country) country = surveyedPeek.country;
  }

  const tier = hints?.tier ?? resolveCityTier(city, population);
  const surveyed = findSurveyedCity(city, state, countryCode);

  return { city, state, country, countryCode, latitude, longitude, population, tier, surveyed };
}

/**
 * The single cost-resolution ladder:
 *   1a surveyed registry -> 1b Numbeo -> 2 distance-weighted nearby -> 3/4 regional.
 * `numbeo` is pre-fetched by the async caller; the sync caller passes null.
 */
function resolveCore(
  query: string,
  ctx: ResolutionContext,
  hints: ColResolveHints | undefined,
  numbeo: NumbeoCityResult | null
): ColEngineResult {
  const { city, state, country, countryCode, latitude, longitude, population, tier, surveyed } = ctx;

  // -- LAYER 1a: Surveyed registry --------------------------------------
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

  // -- LAYER 1b: Numbeo API (optional, async callers only) ---------------
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

  // -- LAYER 2+5: Nearby / distance-weighted -----------------------------
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

  const weighted = distanceWeightedCategories(latitude, longitude, withGeoCoords(nearbyUnique), 500);
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

  // -- LAYER 3+4+6+7: Regional / country x tier x population x economy ---
  const countryBase = COUNTRY_BASELINES[countryCode] || COUNTRY_BASELINES.DEFAULT;
  const role = urbanRoleFactors(hints);
  const categories = scaleCategories(
    applyTierPopState(countryBase, tier, population, countryCode, state),
    {
      housing: role.housing,
      salary: role.salary,
      restaurants: role.restaurants,
      entertainment: role.entertainment,
      groceries: role.cost,
      transport: role.cost,
      utilities: role.cost,
      cpi: role.cost,
    }
  );
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
        ? `Regional estimate from ${country || countryCode || 'unknown country'} / ${state} baselines.`
        : `Country-level estimate for ${countryCode || 'unknown country'}.`,
      `City tier ${tier}; population ${population ?? 'unknown'}.`,
      'Per-category factors applied (housing, groceries, restaurants, transport, utilities, salary).',
      'Adjusted for the city role within the country (capital / metro status and distance from the national centre).',
    ],
  });
}

/**
 * Resolve full COL payload for a city query (async: may consult Numbeo).
 * Pass `hints` so the result matches exactly what the city page renders.
 */
export async function resolveCityCostOfLiving(
  query: string,
  options?: { numbeoKey?: string; hints?: ColResolveHints }
): Promise<ColEngineResult> {
  const hints = options?.hints;
  const ctx = buildResolutionContext(query, hints);
  // Numbeo is Layer 1b - only consulted when the surveyed registry has no entry.
  const numbeo = ctx.surveyed
    ? null
    : await fetchNumbeoCity(query, options?.numbeoKey || process.env.NUMBEO_API_KEY);
  return resolveCore(query, ctx, hints, numbeo);
}

/** Sync entry point for callers that cannot await (skips Numbeo only). */
export function resolveCityCostOfLivingSync(
  query: string,
  hints?: ColResolveHints
): ColEngineResult {
  return resolveCore(query, buildResolutionContext(query, hints), hints, null);
}

export { getCurrencyForCountry, sameCountry, convertCurrency } from './currency.js';
export type { ColEngineResult, DataSourceLabel } from './types.js';
