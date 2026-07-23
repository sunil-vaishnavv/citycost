/**
 * SEO Comparison Eligibility Engine
 * Ranks city-vs-city pages by demand / importance signals.
 * Scale 10k → 50k → 100k via SEO_MAX_COMPARISONS only.
 */

import { SEO_INDEX_CONFIG } from './seo-config.js';
import type { EligibleCity } from './seo-eligibility.js';
import { seoSlug } from './seo-eligibility.js';

export interface ComparisonCandidate {
  slug: string;
  cityA: string;
  cityB: string;
  queryA: string;
  queryB: string;
  pageSlugA: string;
  pageSlugB: string;
  score: number;
  reasons: string[];
}

/** Internal pair quality — never send to public clients. */
export interface ComparisonQualityInternal {
  seo_score: number;
  content_score: number;
  uniqueness_score: number;
  readability_score: number;
  index_quality: number;
  thin_content_flag: boolean;
  duplicate_risk: number;
  eligibility_score: number;
}

const STUDENT_DEST = new Set([
  'boston', 'london', 'oxford', 'cambridge', 'melbourne', 'sydney', 'toronto',
  'montreal', 'berlin', 'amsterdam', 'paris', 'barcelona', 'madrid', 'dublin',
  'singapore', 'tokyo', 'seoul', 'beijing', 'shanghai', 'delhi', 'bengaluru',
  'bangalore', 'mumbai', 'pune', 'chennai', 'hyderabad', 'manchester', 'edinburgh',
]);

const REMOTE_WORK = new Set([
  'lisbon', 'porto', 'bali', 'denpasar', 'bangkok', 'chiang mai', 'mexico city',
  'medellín', 'medellin', 'buenos aires', 'tbilisi', 'tallinn', 'berlin',
  'amsterdam', 'dubai', 'singapore', 'austin', 'miami', 'barcelona', 'valencia',
  'prague', 'budapest', 'warsaw', 'cape town', 'ho chi minh city',
]);

const TOURISM = new Set([
  'paris', 'london', 'rome', 'venice', 'florence', 'barcelona', 'dubai', 'tokyo',
  'bangkok', 'singapore', 'new york', 'new york city', 'las vegas', 'orlando',
  'sydney', 'melbourne', 'istanbul', 'cairo', 'marrakesh', 'cape town', 'bali',
  'phuket', 'cancun', 'cancún', 'hong kong', 'seoul', 'prague', 'vienna',
]);

const MIGRATION_CORRIDORS: Array<[string, string, string, string]> = [
  ['IN', 'GB', 'mumbai', 'london'],
  ['IN', 'AE', 'mumbai', 'dubai'],
  ['IN', 'AE', 'delhi', 'dubai'],
  ['IN', 'US', 'hyderabad', 'san francisco'],
  ['IN', 'SG', 'bengaluru', 'singapore'],
  ['IN', 'SG', 'chennai', 'singapore'],
  ['MX', 'US', 'mexico city', 'los angeles'],
  ['PH', 'AE', 'manila', 'dubai'],
  ['PK', 'AE', 'karachi', 'dubai'],
  ['NG', 'GB', 'lagos', 'london'],
  ['BR', 'PT', 'são paulo', 'lisbon'],
  ['BR', 'PT', 'sao paulo', 'lisbon'],
  ['CN', 'SG', 'shanghai', 'singapore'],
  ['AU', 'SG', 'sydney', 'singapore'],
  ['CA', 'US', 'toronto', 'new york'],
  ['PL', 'DE', 'warsaw', 'berlin'],
  ['TR', 'DE', 'istanbul', 'berlin'],
  ['EG', 'AE', 'cairo', 'dubai'],
  ['ZA', 'GB', 'johannesburg', 'london'],
  ['VN', 'SG', 'ho chi minh city', 'singapore'],
];

function norm(s: string): string {
  return s.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function haversineKm(
  a: { latitude: number | null; longitude: number | null },
  b: { latitude: number | null; longitude: number | null }
): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function labelOf(c: EligibleCity): string {
  return c.label || [c.city, c.state, c.country].filter(Boolean).join(', ');
}

function pairSlug(a: EligibleCity, b: EligibleCity): { slug: string; slugA: string; slugB: string } {
  let slugA = a.compareSlug;
  let slugB = b.compareSlug;
  if (slugA === slugB) {
    slugA = seoSlug([a.city, a.countryCode]);
    slugB = seoSlug([b.city, b.countryCode]);
  }
  return { slug: `${slugA}-vs-${slugB}`, slugA, slugB };
}

/**
 * Score a comparison pair (0–100+ before clamp). Higher = more index-worthy.
 */
export function scoreComparisonPair(a: EligibleCity, b: EligibleCity): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const na = norm(a.city);
  const nb = norm(b.city);
  const cross = a.countryCode !== b.countryCode;

  // Base from city eligibility / importance
  score += (a.scores.eligibility + b.scores.eligibility) * 0.18;
  reasons.push('city_eligibility_blend');

  // Search demand / frequently compared
  if (a.isFrequentlyCompared || b.isFrequentlyCompared) {
    score += 12;
    reasons.push('search_demand_frequent_compare');
  }

  // Population
  const pop = (a.population || 0) + (b.population || 0);
  if (pop >= 10_000_000) { score += 14; reasons.push('high_combined_population'); }
  else if (pop >= 3_000_000) { score += 10; reasons.push('population'); }
  else if (pop >= 500_000) { score += 6; reasons.push('population'); }

  // Business / major / tourism
  if (a.isMajor || b.isMajor) { score += 8; reasons.push('business_importance'); }
  if (a.isTourismOrBusiness || b.isTourismOrBusiness || TOURISM.has(na) || TOURISM.has(nb)) {
    score += 8;
    reasons.push('tourism_popularity');
  }

  // Capitals
  if (a.isCapital || b.isCapital) {
    score += 10;
    reasons.push('capital_cities');
  }
  if (a.isCapital && b.isCapital && cross) {
    score += 8;
    reasons.push('capital_to_capital');
  }

  // Cross-border popularity
  if (cross) {
    score += 7;
    reasons.push('cross_border');
  } else {
    score += 5;
    reasons.push('same_country_relevance');
  }

  // Distance relevance (nearby same-country OR iconic long-haul corridors)
  const km = haversineKm(a, b);
  if (km != null) {
    if (!cross && km < 800) { score += 9; reasons.push('distance_relevance_regional'); }
    else if (cross && km > 2000 && km < 12000) { score += 6; reasons.push('distance_relevance_corridor'); }
  }

  // Migration patterns
  for (const [ca, cb, cityA, cityB] of MIGRATION_CORRIDORS) {
    const match =
      (a.countryCode === ca && b.countryCode === cb && (na === cityA || nb === cityB || na === cityB || nb === cityA)) ||
      (a.countryCode === cb && b.countryCode === ca && (na === cityA || nb === cityB || na === cityB || nb === cityA));
    if (match || (a.countryCode === ca && b.countryCode === cb) || (a.countryCode === cb && b.countryCode === ca)) {
      if (match) { score += 14; reasons.push('migration_pattern'); break; }
      if (a.countryCode !== b.countryCode && ((a.countryCode === ca && b.countryCode === cb) || (a.countryCode === cb && b.countryCode === ca))) {
        score += 6;
        reasons.push('migration_corridor_countries');
        break;
      }
    }
  }

  // Student destinations
  if (STUDENT_DEST.has(na) || STUDENT_DEST.has(nb)) {
    score += 7;
    reasons.push('student_destination');
  }

  // Remote work
  if (REMOTE_WORK.has(na) || REMOTE_WORK.has(nb)) {
    score += 7;
    reasons.push('remote_work_popularity');
  }

  // Cost / salary difference significance (tier & eligibility spread as proxy without COL calls)
  const tierDiff = Math.abs(a.tier - b.tier);
  const eligDiff = Math.abs(a.scores.eligibility - b.scores.eligibility);
  if (tierDiff >= 2 || eligDiff >= 20) {
    score += 10;
    reasons.push('cost_difference_significance');
  } else if (tierDiff >= 1 || eligDiff >= 10) {
    score += 5;
    reasons.push('moderate_cost_spread');
  }

  // Salary / purchasing-power proxy via surveyed baskets
  if (a.hasCuratedBasket || b.hasCuratedBasket) {
    score += 6;
    reasons.push('salary_cost_data_richness');
  }

  // Soft penalty: near-identical names
  if (na === nb) score -= 15;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons: [...new Set(reasons)] };
}

export function buildComparisonQuality(score: number, a: EligibleCity, b: EligibleCity): ComparisonQualityInternal {
  const uniqueness = Math.min(100, 55 + (a.pageSlug.length + b.pageSlug.length) % 20 + (score > 70 ? 15 : 8));
  const content = Math.min(100, 50 + Math.round(score * 0.35) + (a.hasSurveyed || b.hasSurveyed ? 10 : 0));
  const readability = 78 + ((a.city.length + b.city.length) % 12);
  const thin = score < SEO_INDEX_CONFIG.minComparisonScore || content < 50;
  const dupRisk = a.compareSlug === b.compareSlug ? 70 : Math.max(5, 40 - Math.abs(a.scores.eligibility - b.scores.eligibility));
  const indexQuality = Math.round(score * 0.4 + content * 0.25 + uniqueness * 0.2 + readability * 0.15);

  return {
    seo_score: score,
    content_score: content,
    uniqueness_score: uniqueness,
    readability_score: Math.min(100, readability),
    index_quality: Math.min(100, indexQuality),
    thin_content_flag: thin,
    duplicate_risk: dupRisk,
    eligibility_score: score,
  };
}

/**
 * Build ranked comparison index from eligible cities.
 */
export function listEligibleComparisons(cities: EligibleCity[]): ComparisonCandidate[] {
  const max = SEO_INDEX_CONFIG.maxIndexableComparisons;
  const minScore = SEO_INDEX_CONFIG.minComparisonScore;
  const candidates: ComparisonCandidate[] = [];
  const seen = new Set<string>();
  const seenSlugs = new Set<string>();

  const push = (a: EligibleCity, b: EligibleCity) => {
    if (a.pageSlug === b.pageSlug) return;
    const { score, reasons } = scoreComparisonPair(a, b);
    if (score < minScore) return;
    const { slug } = pairSlug(a, b);
    const key = [a.pageSlug, b.pageSlug].sort().join('|');
    if (seen.has(key) || seenSlugs.has(slug)) return;
    seen.add(key);
    seenSlugs.add(slug);
    candidates.push({
      slug,
      cityA: a.city,
      cityB: b.city,
      queryA: labelOf(a),
      queryB: labelOf(b),
      pageSlugA: a.pageSlug,
      pageSlugB: b.pageSlug,
      score,
      reasons,
    });
  };

  // Same-country: all pairs (quality-filtered by score)
  const byCountry = new Map<string, EligibleCity[]>();
  for (const c of cities) {
    const list = byCountry.get(c.countryCode) || [];
    list.push(c);
    byCountry.set(c.countryCode, list);
  }
  for (const list of byCountry.values()) {
    const ranked = [...list].sort((x, y) => y.scores.eligibility - x.scores.eligibility);
    const cap = Math.min(ranked.length, SEO_INDEX_CONFIG.maxCitiesPerCountryForComps);
    const slice = ranked.slice(0, cap);
    for (let i = 0; i < slice.length; i++) {
      for (let j = i + 1; j < slice.length; j++) push(slice[i], slice[j]);
    }
  }

  // Cross-border among top global cities
  const topGlobal = [...cities]
    .sort((a, b) => b.scores.eligibility - a.scores.eligibility)
    .slice(0, SEO_INDEX_CONFIG.topGlobalCitiesForCrossComps);
  for (let i = 0; i < topGlobal.length; i++) {
    for (let j = i + 1; j < topGlobal.length; j++) {
      if (topGlobal[i].countryCode === topGlobal[j].countryCode) continue;
      push(topGlobal[i], topGlobal[j]);
    }
  }

  // Explicit migration corridors
  const find = (name: string, code: string) =>
    cities.find((c) => norm(c.city) === norm(name) && c.countryCode === code);
  for (const [ca, cb, cityA, cityB] of MIGRATION_CORRIDORS) {
    const A = find(cityA, ca) || cities.find((c) => c.countryCode === ca && c.isCapital);
    const B = find(cityB, cb) || cities.find((c) => c.countryCode === cb && c.isCapital);
    if (A && B) push(A, B);
  }

  // Fan-out: each city vs next N peers by eligibility (fills volume toward config cap)
  const rankedAll = [...cities].sort((a, b) => b.scores.eligibility - a.scores.eligibility);
  const fan = SEO_INDEX_CONFIG.comparisonsPerCitySameCountry;
  for (let i = 0; i < rankedAll.length; i++) {
    let added = 0;
    for (let j = i + 1; j < rankedAll.length && added < fan + 4; j++) {
      push(rankedAll[i], rankedAll[j]);
      added++;
    }
  }

  // Prefer higher score if any slug collision slipped through.
  const bySlug = new Map<string, ComparisonCandidate>();
  for (const c of candidates) {
    const prev = bySlug.get(c.slug);
    if (!prev || c.score > prev.score) bySlug.set(c.slug, c);
  }

  return [...bySlug.values()]
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, max);
}
