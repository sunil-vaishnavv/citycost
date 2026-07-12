/**
 * Keyword Priority Engine — INTERNAL ONLY.
 * Scores landing pages for demand, value, intent, competition, opportunity.
 * Never serialize onto public API / HTML payloads.
 */

import type { CityLandingKind, CategoryHubId, CountryGuideKind } from './types.js';
import type { CityMetricsForIntent } from './quality.js';
import { landingKindToIntent, categoryToIntent } from './intent.js';

export interface KeywordPriorityInternal {
  estimated_search_demand: number;
  business_value: number;
  intent_strength: number;
  competition_level: number;
  traffic_opportunity: number;
  /** Weighted composite 0–100 used for ranking. */
  priority_score: number;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** Base demand priors by landing kind (relative, not absolute search volume). */
const CITY_KIND_DEMAND: Record<CityLandingKind, number> = {
  'living-in': 92,
  rent: 88,
  salary: 84,
  'moving-to': 78,
  students: 72,
  families: 70,
  'remote-work': 74,
  retirement: 68,
  'digital-nomads': 66,
};

const CITY_KIND_BUSINESS: Record<CityLandingKind, number> = {
  'living-in': 90,
  rent: 86,
  salary: 88,
  'moving-to': 82,
  students: 70,
  families: 78,
  'remote-work': 80,
  retirement: 72,
  'digital-nomads': 68,
};

const CITY_KIND_INTENT: Record<CityLandingKind, number> = {
  'living-in': 90,
  rent: 94,
  salary: 92,
  'moving-to': 88,
  students: 86,
  families: 86,
  'remote-work': 84,
  retirement: 84,
  'digital-nomads': 82,
};

/** Higher = more competitive SERP (reduces opportunity). */
const CITY_KIND_COMPETITION: Record<CityLandingKind, number> = {
  'living-in': 70,
  rent: 65,
  salary: 68,
  'moving-to': 55,
  students: 50,
  families: 52,
  'remote-work': 58,
  retirement: 48,
  'digital-nomads': 60,
};

const CATEGORY_DEMAND: Record<CategoryHubId, number> = {
  students: 75,
  families: 74,
  'remote-workers': 78,
  retirement: 70,
  'digital-nomads': 72,
  'cheapest-cities': 88,
  'most-expensive-cities': 80,
};

const GUIDE_DEMAND: Record<CountryGuideKind, number> = {
  'living-in-country': 85,
  'best-cities': 82,
  'student-cities': 70,
  'family-cities': 72,
  'retirement-cities': 68,
  'remote-work-cities': 74,
};

function popBoost(population: number | null): number {
  if (population == null || population <= 0) return 0;
  if (population >= 5_000_000) return 18;
  if (population >= 1_000_000) return 14;
  if (population >= 500_000) return 10;
  if (population >= 100_000) return 6;
  return 2;
}

function dataBoost(m: CityMetricsForIntent): number {
  let b = 0;
  if (m.hasRentSample) b += 6;
  if (m.hasSalarySample) b += 6;
  if (m.cpi > 0) b += 4;
  const conf = (m.confidence_label || '').toLowerCase();
  if (conf.includes('verif') || conf.includes('survey') || conf.includes('curat')) b += 8;
  if (conf.includes('estim')) b -= 4;
  return b;
}

export function scoreCityLandingPriority(
  kind: CityLandingKind,
  m: CityMetricsForIntent
): KeywordPriorityInternal {
  const estimated_search_demand = clamp(CITY_KIND_DEMAND[kind] + popBoost(m.population) * 0.6);
  const business_value = clamp(CITY_KIND_BUSINESS[kind] + dataBoost(m) * 0.5 + (m.eligibilityHint || 50) * 0.15);
  const intent_strength = clamp(CITY_KIND_INTENT[kind] + (m.hasRentSample || m.hasSalarySample ? 6 : -8));
  const competition_level = clamp(
    CITY_KIND_COMPETITION[kind] + (m.population && m.population > 2_000_000 ? 12 : 0)
  );
  const traffic_opportunity = clamp(
    estimated_search_demand * 0.45 +
      intent_strength * 0.25 +
      (100 - competition_level) * 0.3 +
      dataBoost(m) * 0.2
  );
  const priority_score = clamp(
    estimated_search_demand * 0.25 +
      business_value * 0.2 +
      intent_strength * 0.2 +
      traffic_opportunity * 0.25 +
      (100 - competition_level) * 0.1
  );

  void landingKindToIntent(kind);
  return {
    estimated_search_demand,
    business_value,
    intent_strength,
    competition_level,
    traffic_opportunity,
    priority_score,
  };
}

export function scoreCategoryHubPriority(id: CategoryHubId): KeywordPriorityInternal {
  const estimated_search_demand = CATEGORY_DEMAND[id];
  const business_value = id === 'cheapest-cities' || id === 'remote-workers' ? 86 : 78;
  const intent_strength = 88;
  const competition_level = id.includes('cheapest') || id.includes('expensive') ? 72 : 55;
  const traffic_opportunity = clamp(estimated_search_demand * 0.5 + (100 - competition_level) * 0.5);
  const priority_score = clamp(
    estimated_search_demand * 0.3 + business_value * 0.2 + intent_strength * 0.2 + traffic_opportunity * 0.3
  );
  void categoryToIntent(id);
  return {
    estimated_search_demand,
    business_value,
    intent_strength,
    competition_level,
    traffic_opportunity,
    priority_score,
  };
}

export function scoreCountryGuidePriority(kind: CountryGuideKind, cityCount: number): KeywordPriorityInternal {
  const estimated_search_demand = clamp(GUIDE_DEMAND[kind] + Math.min(12, cityCount));
  const business_value = clamp(80 + Math.min(10, cityCount / 2));
  const intent_strength = 86;
  const competition_level = kind === 'living-in-country' ? 68 : 52;
  const traffic_opportunity = clamp(estimated_search_demand * 0.5 + (100 - competition_level) * 0.5);
  const priority_score = clamp(
    estimated_search_demand * 0.3 + business_value * 0.2 + intent_strength * 0.2 + traffic_opportunity * 0.3
  );
  return {
    estimated_search_demand,
    business_value,
    intent_strength,
    competition_level,
    traffic_opportunity,
    priority_score,
  };
}

/** Blend quality + keyword priority for generation / sitemap ranking. */
export function compositeRankScore(qualityBlend: number, priority: KeywordPriorityInternal): number {
  return priority.priority_score * 0.55 + qualityBlend * 0.45;
}

export function sortByPriorityDesc<T>(items: T[], scoreOf: (item: T) => number): T[] {
  return [...items].sort((a, b) => scoreOf(b) - scoreOf(a));
}
