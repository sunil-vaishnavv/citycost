/**
 * Landing-page quality & eligibility (internal).
 * Does not modify SEO Eligibility Engine — layers intent-specific gates on indexable cities.
 */

import type { IntentQualityInternal, CityLandingKind } from './types.js';

export interface CityMetricsForIntent {
  pageSlug: string;
  city: string;
  countryCode: string;
  population: number | null;
  cpi: number;
  rent: number;
  salary: number;
  hasRentSample: boolean;
  hasSalarySample: boolean;
  confidence_label: string;
  data_source: string;
  eligibilityHint: number; // from eligible scores if available, else 50
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function scoreCityLanding(
  kind: CityLandingKind,
  m: CityMetricsForIntent
): IntentQualityInternal {
  let intent_match = 55;
  let content = 50;
  let authority = 45;
  let seo = 50;

  // Data richness
  if (m.hasRentSample) {
    content += 12;
    seo += 8;
  }
  if (m.hasSalarySample) {
    content += 12;
    seo += 8;
  }
  if (m.cpi > 0) {
    content += 8;
    seo += 6;
  }
  if (m.population && m.population > 100_000) {
    authority += 10;
    seo += 5;
  }
  if (m.population && m.population > 1_000_000) {
    authority += 8;
  }

  const conf = (m.confidence_label || '').toLowerCase();
  if (conf.includes('verif') || conf.includes('survey') || conf.includes('curat')) {
    authority += 15;
    content += 8;
  }
  if (conf.includes('estim')) {
    content -= 5;
    authority -= 5;
  }

  // Intent-specific requirements
  switch (kind) {
    case 'rent':
      intent_match = m.hasRentSample ? 88 : 35;
      break;
    case 'salary':
      intent_match = m.hasSalarySample ? 88 : 35;
      break;
    case 'living-in':
    case 'moving-to':
      intent_match = m.cpi > 0 && (m.hasRentSample || m.hasSalarySample) ? 85 : 40;
      break;
    case 'students':
    case 'families':
    case 'remote-work':
    case 'retirement':
    case 'digital-nomads':
      intent_match = m.hasRentSample || m.hasSalarySample ? 78 : 42;
      break;
  }

  seo = clamp(seo + intent_match * 0.15 + m.eligibilityHint * 0.1);
  content = clamp(content);
  authority = clamp(authority);
  intent_match = clamp(intent_match);

  const duplicate_risk = clamp(100 - content * 0.4 - intent_match * 0.3);

  const index_eligibility =
    intent_match >= 60 &&
    content >= 55 &&
    seo >= 50 &&
    duplicate_risk < 70 &&
    (m.hasRentSample || m.hasSalarySample || m.cpi > 0);

  return {
    seo_score: seo,
    intent_match_score: intent_match,
    content_score: content,
    authority_score: authority,
    duplicate_risk,
    index_eligibility,
  };
}

/** Max city landings per kind (env override). Scales with SEO city caps. */
export function maxLandingsPerKind(): number {
  let raw: string | undefined;
  let citiesRaw: string | undefined;
  try {
    if (typeof process !== 'undefined' && process.env) {
      raw = process.env.INTENT_MAX_LANDINGS_PER_KIND;
      citiesRaw = process.env.SEO_MAX_CITIES;
    }
  } catch {
    /* browser */
  }
  if (raw && Number.isFinite(Number(raw))) return Math.max(50, Number(raw));
  const cities = Number(citiesRaw || 500);
  return Math.min(Math.max(cities, 100), 10_000);
}
