/**
 * Cost-of-Living Engine — shared types
 * Layers: Real → Nearby → Regional → Country (never invent randomly)
 */

import type { IndexMetrics, PriceItem } from '../../src/types.js';

export type CityTier = 1 | 2 | 3 | 4 | 5;

/** Canonical source labels exposed to API/UI */
export type DataSourceLabel =
  | 'Real'
  | 'API'
  | 'Government'
  | 'Cached'
  | 'Nearby'
  | 'Regional'
  | 'Estimated'
  | 'Country'
  | 'Unknown';

export type InternalSource =
  | 'surveyed'
  | 'numbeo'
  | 'cache_verified'
  | 'cache'
  | 'nearby'
  | 'regional'
  | 'country'
  | 'estimated';

export interface CategoryIndices {
  housing: number;
  groceries: number;
  restaurants: number;
  transport: number;
  utilities: number;
  healthcare: number;
  education: number;
  entertainment: number;
  salary: number;
  /** Overall CPI excl. rent (derived) */
  cpi: number;
}

export interface CityResolution {
  city: string;
  state: string;
  country: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
  tier: CityTier;
  currency: string;
  symbol: string;
  /** Local units per 1 USD */
  exchangeRate: number;
}

export interface ColEngineResult {
  city_id: number;
  name: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
  currency: string;
  symbol: string;
  exchange_rate: number;
  indices: IndexMetrics;
  categories: CategoryIndices;
  prices: PriceItem[];
  tier: CityTier;
  population: number | null;
  data_source: string;
  data_source_label: DataSourceLabel;
  confidence: number;
  confidence_label: string;
  confidence_stars: number;
  estimation_note: string;
  explanation: string[];
  is_estimated: boolean;
  is_verified: boolean;
}

export interface SurveyedCityRecord {
  city: string;
  state?: string;
  countryCode: string;
  country: string;
  /** Optional absolute population estimate */
  population?: number;
  tier: CityTier;
  latitude?: number;
  longitude?: number;
  /** Numbeo-style indices, NYC = 100 */
  categories: CategoryIndices;
  /**
   * Optional absolute basket in LOCAL currency.
   * When present, used instead of scaling NYC USD baselines.
   */
  localBasket?: Partial<Record<string, number>>;
  provider: 'surveyed' | 'government' | 'open_dataset';
  asOf?: string;
}

export function categoriesToIndexMetrics(c: CategoryIndices): IndexMetrics {
  return {
    cpi_index: round1(c.cpi),
    rent_index: round1(c.housing),
    groceries_index: round1(c.groceries),
    restaurant_price_index: round1(c.restaurants),
    local_purchasing_power_index: round1(c.salary),
  };
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
