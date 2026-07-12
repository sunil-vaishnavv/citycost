/**
 * City tier + population model
 * Tier 1 metro … Tier 5 rural/town
 */

import type { CityTier } from './types.js';

const TIER1 = new Set([
  'new york', 'new york city', 'london', 'tokyo', 'paris', 'singapore', 'hong kong',
  'dubai', 'sydney', 'los angeles', 'san francisco', 'mumbai', 'delhi', 'new delhi',
  'beijing', 'shanghai', 'seoul',
]);

const TIER2 = new Set([
  'chicago', 'boston', 'seattle', 'houston', 'miami', 'toronto', 'vancouver',
  'manchester', 'birmingham', 'edinburgh', 'osaka', 'melbourne', 'brisbane',
  'abu dhabi', 'berlin', 'munich', 'amsterdam', 'madrid', 'rome', 'milan',
  'bengaluru', 'bangalore', 'hyderabad', 'chennai', 'kolkata', 'pune',
  'ahmedabad', 'jaipur', 'chandigarh', 'lucknow', 'surat', 'lyon',
]);

const TIER3 = new Set([
  'buffalo', 'portland', 'austin', 'denver', 'philadelphia', 'san diego',
  'leeds', 'glasgow', 'liverpool', 'yokohama', 'perth', 'adelaide',
  'sharjah', 'marseille', 'hamburg', 'valencia', 'nagpur', 'indore',
  'coimbatore', 'visakhapatnam', 'patna', 'bhopal', 'kota',
]);

const TIER4 = new Set([
  'jodhpur', 'udaipur', 'ajmer', 'bikaner', 'mysore', 'kochi', 'alwar',
  'bhilwara', 'sikar', 'pali',
]);

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Resolve tier from known lists, else infer from population.
 */
export function resolveCityTier(cityName: string, population: number | null | undefined): CityTier {
  const n = normalize(cityName);
  if (TIER1.has(n)) return 1;
  if (TIER2.has(n)) return 2;
  if (TIER3.has(n)) return 3;
  if (TIER4.has(n)) return 4;

  if (population != null && population > 0) {
    if (population >= 5_000_000) return 1;
    if (population >= 1_000_000) return 2;
    if (population >= 300_000) return 3;
    if (population >= 80_000) return 4;
    return 5;
  }
  return 5;
}

/**
 * Category-specific multipliers relative to a Tier-2 baseline (= 1.0).
 * Documented — not a single global factor.
 */
export function tierCategoryFactors(tier: CityTier): {
  housing: number;
  groceries: number;
  restaurants: number;
  transport: number;
  utilities: number;
  healthcare: number;
  education: number;
  entertainment: number;
  salary: number;
} {
  switch (tier) {
    case 1:
      return { housing: 1.45, groceries: 1.12, restaurants: 1.28, transport: 1.2, utilities: 1.1, healthcare: 1.15, education: 1.2, entertainment: 1.35, salary: 1.35 };
    case 2:
      return { housing: 1.0, groceries: 1.0, restaurants: 1.0, transport: 1.0, utilities: 1.0, healthcare: 1.0, education: 1.0, entertainment: 1.0, salary: 1.0 };
    case 3:
      return { housing: 0.78, groceries: 0.92, restaurants: 0.85, transport: 0.88, utilities: 0.95, healthcare: 0.9, education: 0.88, entertainment: 0.82, salary: 0.85 };
    case 4:
      return { housing: 0.58, groceries: 0.86, restaurants: 0.72, transport: 0.75, utilities: 0.9, healthcare: 0.82, education: 0.78, entertainment: 0.65, salary: 0.72 };
    case 5:
    default:
      return { housing: 0.42, groceries: 0.8, restaurants: 0.6, transport: 0.65, utilities: 0.85, healthcare: 0.75, education: 0.7, entertainment: 0.5, salary: 0.6 };
  }
}

/**
 * Soft population adjustment vs a 1M reference city.
 * log curve so megacities don't explode.
 */
export function populationFactors(population: number | null | undefined): {
  housing: number;
  salary: number;
  transport: number;
  restaurants: number;
  groceries: number;
} {
  if (population == null || population <= 0) {
    return { housing: 1, salary: 1, transport: 1, restaurants: 1, groceries: 1 };
  }
  const ref = 1_000_000;
  const ratio = Math.log10(Math.max(population, 10_000)) / Math.log10(ref);
  // Bound roughly 0.75 … 1.25
  const bounded = Math.min(1.25, Math.max(0.75, ratio));
  return {
    housing: 0.85 + bounded * 0.15,
    salary: 0.88 + bounded * 0.12,
    transport: 0.9 + bounded * 0.1,
    restaurants: 0.9 + bounded * 0.1,
    groceries: 0.95 + bounded * 0.05,
  };
}
