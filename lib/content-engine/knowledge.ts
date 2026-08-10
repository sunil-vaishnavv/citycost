/**
 * Knowledge graph builders — facts from COL / SEO catalog data only.
 * Never invent population, industries, climate, airports, etc.
 */

import { getCurrencyForCountry } from '../col-engine/currency.js';
import { resolveCityCostOfLivingSync } from '../col-engine/index.js';
import type { EligibleCity } from '../seo-eligibility.js';
import type { CityKnowledge, CountryKnowledge, CompareKnowledge } from './types.js';

function byPrice(prices: Array<{ item_name: string; average_price: number }>, name: string): number | null {
  const hit = prices.find((p) => p.item_name === name);
  if (!hit || !Number.isFinite(hit.average_price)) return null;
  return hit.average_price;
}

export function buildCityKnowledge(
  rec: EligibleCity,
  opts: {
    countrySlug: string;
    nearby: Array<{ city: string; slug: string; state?: string }>;
    related_comparisons: Array<{ slug: string; label: string }>;
  }
): CityKnowledge {
  const resolved = resolveCityCostOfLivingSync(rec.label || [rec.city, rec.state, rec.country].filter(Boolean).join(', '));
  const fx = getCurrencyForCountry(rec.countryCode);
  const prices = resolved.prices;

  return {
    city: rec.city,
    state: rec.state || null,
    country: rec.country,
    countryCode: rec.countryCode,
    countrySlug: opts.countrySlug,
    pageSlug: rec.pageSlug,
    label: rec.label,
    population: rec.population ?? null,
    currency: fx.code,
    symbol: fx.symbol,
    timezone: rec.timezone || null,
    latitude: rec.latitude ?? null,
    longitude: rec.longitude ?? null,
    tier: rec.tier ?? null,
    indices: {
      cpi: resolved.indices.cpi_index,
      rent: resolved.indices.rent_index,
      groceries: resolved.indices.groceries_index,
      restaurants: resolved.indices.restaurant_price_index,
      purchasing_power: resolved.indices.local_purchasing_power_index,
    },
    prices: {
      rent_1br: byPrice(prices, 'Apartment (1 bedroom) in City Centre'),
      salary: byPrice(prices, 'Average Monthly Net Salary (After Tax)'),
      milk: byPrice(prices, 'Milk (regular), (1 liter)'),
      transport: byPrice(prices, 'One-way Ticket (Local Transport)'),
      utilities: byPrice(prices, 'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment'),
      meal: byPrice(prices, 'Meal, Inexpensive Restaurant'),
    },
    data_source: resolved.data_source_label,
    confidence_label: resolved.confidence_label,
    estimation_note: resolved.estimation_note || null,
    is_capital: !!rec.isCapital,
    is_tourism_or_business: !!rec.isTourismOrBusiness,
    nearby_cities: opts.nearby,
    related_comparisons: opts.related_comparisons,
    unavailable: ['nearby_airports', 'climate', 'major_industries', 'education', 'healthcare', 'safety'],
  };
}

export function buildCountryKnowledge(input: {
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
}): CountryKnowledge {
  const popSum = input.cities.reduce((s, c) => s + (c.population || 0), 0);
  return {
    code: input.code,
    slug: input.slug,
    name: input.name,
    currency: input.currency,
    symbol: input.symbol,
    exchange_rate: input.exchange_rate,
    indexed_city_count: input.cities.length,
    population_indexed: popSum > 0 ? popSum : null,
    avg_cpi: input.avg_cpi,
    avg_rent: input.avg_rent,
    avg_salary: input.avg_salary,
    avg_groceries: input.avg_groceries,
    cheapest: input.cheapest,
    expensive: input.expensive,
    metros: input.metros,
    top_comparisons: input.top_comparisons,
    related_countries: input.related_countries,
  };
}

export function buildCompareKnowledge(input: {
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
}): CompareKnowledge {
  return { ...input };
}

/** Stable fingerprint of factual inputs — cache invalidation key. */
export function fingerprintKnowledge(obj: object): string {
  const json = JSON.stringify(obj);
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
