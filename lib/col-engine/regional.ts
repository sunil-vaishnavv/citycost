/**
 * State / regional economy factors + distance-weighted nearby blending
 */

import type { CategoryIndices, SurveyedCityRecord } from './types.js';
import { clamp, round1 } from './types.js';

/** State cost factors vs country average (1.0 = average). Documented proxies. */
export const STATE_ECONOMY: Record<string, Record<string, {
  cost: number;
  housing: number;
  income: number;
  urbanization: number;
  tourism: number;
}>> = {
  IN: {
    maharashtra: { cost: 1.1, housing: 1.2, income: 1.15, urbanization: 1.15, tourism: 1.05 },
    delhi: { cost: 1.08, housing: 1.15, income: 1.2, urbanization: 1.25, tourism: 1.1 },
    karnataka: { cost: 1.05, housing: 1.1, income: 1.18, urbanization: 1.1, tourism: 1.0 },
    telangana: { cost: 1.0, housing: 1.0, income: 1.1, urbanization: 1.05, tourism: 0.95 },
    'tamil nadu': { cost: 0.98, housing: 0.98, income: 1.05, urbanization: 1.05, tourism: 1.0 },
    'west bengal': { cost: 0.92, housing: 0.9, income: 0.9, urbanization: 1.0, tourism: 1.0 },
    gujarat: { cost: 0.95, housing: 0.95, income: 1.08, urbanization: 1.05, tourism: 0.95 },
    rajasthan: { cost: 0.88, housing: 0.82, income: 0.85, urbanization: 0.85, tourism: 1.1 },
    'uttar pradesh': { cost: 0.85, housing: 0.8, income: 0.8, urbanization: 0.85, tourism: 0.95 },
    punjab: { cost: 0.92, housing: 0.9, income: 0.95, urbanization: 0.9, tourism: 0.9 },
    haryana: { cost: 0.98, housing: 1.0, income: 1.05, urbanization: 0.95, tourism: 0.85 },
    goa: { cost: 1.08, housing: 1.15, income: 1.0, urbanization: 0.9, tourism: 1.4 },
    kerala: { cost: 0.95, housing: 0.92, income: 1.0, urbanization: 0.95, tourism: 1.2 },
  },
  US: {
    'new york': { cost: 1.25, housing: 1.4, income: 1.2, urbanization: 1.3, tourism: 1.3 },
    california: { cost: 1.2, housing: 1.35, income: 1.25, urbanization: 1.2, tourism: 1.25 },
    massachusetts: { cost: 1.15, housing: 1.25, income: 1.2, urbanization: 1.15, tourism: 1.1 },
    washington: { cost: 1.12, housing: 1.2, income: 1.22, urbanization: 1.1, tourism: 1.05 },
    texas: { cost: 0.95, housing: 0.9, income: 1.05, urbanization: 1.05, tourism: 1.0 },
    florida: { cost: 1.05, housing: 1.1, income: 0.95, urbanization: 1.05, tourism: 1.3 },
    illinois: { cost: 1.05, housing: 1.05, income: 1.05, urbanization: 1.1, tourism: 1.05 },
  },
  GB: {
    england: { cost: 1.0, housing: 1.0, income: 1.0, urbanization: 1.0, tourism: 1.0 },
    scotland: { cost: 0.92, housing: 0.88, income: 0.95, urbanization: 0.9, tourism: 1.1 },
    wales: { cost: 0.9, housing: 0.85, income: 0.9, urbanization: 0.85, tourism: 1.0 },
  },
};

export const COUNTRY_BASELINES: Record<string, CategoryIndices> = {
  US: { housing: 55, groceries: 72, restaurants: 68, transport: 65, utilities: 80, healthcare: 90, education: 85, entertainment: 70, salary: 110, cpi: 70 },
  IN: { housing: 9, groceries: 23, restaurants: 17, transport: 14, utilities: 18, healthcare: 16, education: 18, entertainment: 15, salary: 70, cpi: 24 },
  GB: { housing: 55, groceries: 58, restaurants: 70, transport: 60, utilities: 80, healthcare: 70, education: 75, entertainment: 68, salary: 95, cpi: 68 },
  JP: { housing: 28, groceries: 60, restaurants: 38, transport: 50, utilities: 75, healthcare: 70, education: 72, entertainment: 50, salary: 90, cpi: 55 },
  AE: { housing: 48, groceries: 48, restaurants: 55, transport: 45, utilities: 65, healthcare: 60, education: 65, entertainment: 58, salary: 115, cpi: 58 },
  AU: { housing: 48, groceries: 70, restaurants: 65, transport: 60, utilities: 80, healthcare: 75, education: 78, entertainment: 68, salary: 108, cpi: 72 },
  DE: { housing: 35, groceries: 55, restaurants: 55, transport: 55, utilities: 78, healthcare: 75, education: 78, entertainment: 60, salary: 110, cpi: 65 },
  FR: { housing: 40, groceries: 68, restaurants: 68, transport: 58, utilities: 80, healthcare: 75, education: 80, entertainment: 70, salary: 90, cpi: 70 },
  CA: { housing: 48, groceries: 65, restaurants: 60, transport: 55, utilities: 75, healthcare: 70, education: 75, entertainment: 65, salary: 100, cpi: 68 },
  SG: { housing: 75, groceries: 75, restaurants: 58, transport: 55, utilities: 70, healthcare: 70, education: 80, entertainment: 65, salary: 95, cpi: 82 },
  DEFAULT: { housing: 25, groceries: 42, restaurants: 38, transport: 35, utilities: 50, healthcare: 45, education: 48, entertainment: 40, salary: 60, cpi: 45 },
};

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function getStateEconomy(countryCode: string, state: string) {
  const table = STATE_ECONOMY[countryCode];
  if (!table || !state) {
    return { cost: 1, housing: 1, income: 1, urbanization: 1, tourism: 1 };
  }
  return table[normalize(state)] || { cost: 1, housing: 1, income: 1, urbanization: 1, tourism: 1 };
}

/** Haversine distance in km */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Distance-weighted average of nearby surveyed cities.
 * Weight = 1 / (1 + distanceKm / 50) — closer cities dominate.
 */
export function distanceWeightedCategories(
  targetLat: number | null,
  targetLon: number | null,
  neighbors: SurveyedCityRecord[],
  maxKm = 400
): { categories: CategoryIndices; used: SurveyedCityRecord[]; weights: number[] } | null {
  if (!neighbors.length) return null;

  const scored: Array<{ rec: SurveyedCityRecord; w: number }> = [];

  for (const rec of neighbors) {
    let w = 1;
    if (
      targetLat != null &&
      targetLon != null &&
      rec.latitude != null &&
      rec.longitude != null
    ) {
      const d = haversineKm(targetLat, targetLon, rec.latitude, rec.longitude);
      if (d > maxKm) continue;
      w = 1 / (1 + d / 50);
    } else {
      // Same-state without coords: equal modest weight
      w = 0.6;
    }
    // Prefer larger / higher-tier references slightly for stability
    w *= rec.tier <= 2 ? 1.15 : 1;
    scored.push({ rec, w });
  }

  if (!scored.length) {
    // Fall back to equal weight of all neighbors
    for (const rec of neighbors) scored.push({ rec, w: 1 });
  }

  const sumW = scored.reduce((s, x) => s + x.w, 0);
  const keys: (keyof CategoryIndices)[] = [
    'housing', 'groceries', 'restaurants', 'transport', 'utilities',
    'healthcare', 'education', 'entertainment', 'salary', 'cpi',
  ];
  const out = {} as CategoryIndices;
  for (const k of keys) {
    out[k] = round1(scored.reduce((s, x) => s + x.rec.categories[k] * x.w, 0) / sumW);
  }
  return {
    categories: out,
    used: scored.map((s) => s.rec),
    weights: scored.map((s) => s.w),
  };
}

export function scaleCategories(
  base: CategoryIndices,
  factors: Partial<Record<keyof CategoryIndices, number>>
): CategoryIndices {
  const mul = (k: keyof CategoryIndices, fallback = 1) =>
    round1(base[k] * (factors[k] ?? fallback));
  const housing = mul('housing');
  const groceries = mul('groceries');
  const restaurants = mul('restaurants');
  const transport = mul('transport');
  const utilities = mul('utilities');
  const healthcare = mul('healthcare');
  const education = mul('education');
  const entertainment = mul('entertainment');
  const salary = mul('salary');
  const cpi = round1(
    (groceries + restaurants + transport + utilities + healthcare + entertainment) / 6
  );
  return {
    housing: clamp(housing, 1, 160),
    groceries: clamp(groceries, 5, 160),
    restaurants: clamp(restaurants, 5, 160),
    transport: clamp(transport, 5, 160),
    utilities: clamp(utilities, 5, 160),
    healthcare: clamp(healthcare, 5, 160),
    education: clamp(education, 5, 160),
    entertainment: clamp(entertainment, 5, 160),
    salary: clamp(salary, 10, 180),
    cpi: clamp(cpi, 5, 160),
  };
}
