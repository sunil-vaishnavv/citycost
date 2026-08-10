import type { EligibleCity } from '../../seo-eligibility.js';

/** High-demand migration corridors (countryA, countryB, cityA, cityB). */
export const EDITORIAL_MIGRATION_CORRIDORS: Array<[string, string, string, string]> = [
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
  ['US', 'GB', 'new york', 'london'],
  ['US', 'FR', 'new york', 'paris'],
  ['DE', 'GB', 'berlin', 'london'],
  ['DE', 'FR', 'berlin', 'paris'],
  ['JP', 'SG', 'tokyo', 'singapore'],
  ['KR', 'SG', 'seoul', 'singapore'],
  ['AU', 'GB', 'sydney', 'london'],
  ['CA', 'GB', 'toronto', 'london'],
];

/** Global hubs that may appear in major international comparisons. */
const MAJOR_HUB_CITIES = new Set([
  'london',
  'new york',
  'paris',
  'berlin',
  'tokyo',
  'singapore',
  'dubai',
  'sydney',
  'toronto',
  'los angeles',
  'san francisco',
  'hong kong',
  'amsterdam',
  'madrid',
  'rome',
  'mumbai',
  'delhi',
  'bengaluru',
  'bangalore',
  'shanghai',
  'seoul',
  'istanbul',
  'mexico city',
  'são paulo',
  'sao paulo',
  'lisbon',
  'dublin',
  'zurich',
  'vienna',
  'copenhagen',
  'stockholm',
  'munich',
  'hamburg',
  'manchester',
  'lyon',
  'barcelona',
  'melbourne',
  'vancouver',
  'chicago',
  'boston',
  'austin',
  'miami',
  'abu dhabi',
  'bangkok',
  'kuala lumpur',
  'jakarta',
  'manila',
  'lagos',
  'cairo',
  'johannesburg',
  'warsaw',
  'prague',
  'budapest',
  'athens',
  'helsinki',
  'oslo',
  'brussels',
  'milan',
  'frankfurt',
]);

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

export type ComparisonTier = 'same_country' | 'migration_corridor' | 'major_international' | 'rejected';

export interface ComparisonPolicyResult {
  allowed: boolean;
  tier: ComparisonTier;
  reason: string;
  demandBoost: number;
}

function isMigrationCorridor(a: EligibleCity, b: EligibleCity): boolean {
  const na = norm(a.city);
  const nb = norm(b.city);
  for (const [ca, cb, cityA, cityB] of EDITORIAL_MIGRATION_CORRIDORS) {
    const matchForward =
      a.countryCode === ca &&
      b.countryCode === cb &&
      (na === cityA || na.includes(cityA) || cityA.includes(na)) &&
      (nb === cityB || nb.includes(cityB) || cityB.includes(nb));
    const matchReverse =
      a.countryCode === cb &&
      b.countryCode === ca &&
      (na === cityB || na.includes(cityB) || cityB.includes(na)) &&
      (nb === cityA || nb.includes(cityA) || cityA.includes(nb));
    if (matchForward || matchReverse) return true;
  }
  return false;
}

function isMajorHub(city: EligibleCity): boolean {
  const n = norm(city.city);
  if (MAJOR_HUB_CITIES.has(n)) return true;
  return (
    city.isFrequentlyCompared &&
    city.scores.eligibility >= 72 &&
    (city.isCapital || city.isMajor || (city.population != null && city.population >= 1_000_000))
  );
}

/**
 * Editorial comparison gate: same-country, migration corridor, or major international hubs only.
 * Rejects meaningless worldwide pairings (e.g. Berlin vs Djibouti).
 */
export function evaluateComparisonPair(a: EligibleCity, b: EligibleCity): ComparisonPolicyResult {
  if (a.pageSlug === b.pageSlug) {
    return { allowed: false, tier: 'rejected', reason: 'Same city', demandBoost: 0 };
  }

  if (a.countryCode === b.countryCode) {
    const elig = (a.scores.eligibility + b.scores.eligibility) / 2;
    if (elig < 40 && !a.isCapital && !b.isCapital && !a.isMajor && !b.isMajor) {
      return {
        allowed: false,
        tier: 'rejected',
        reason: 'Weak same-country pair (low eligibility)',
        demandBoost: 0,
      };
    }
    return {
      allowed: true,
      tier: 'same_country',
      reason: 'Same-country comparison — strong topical cluster fit',
      demandBoost: 12 + Math.min(20, Math.round(elig / 5)),
    };
  }

  if (isMigrationCorridor(a, b)) {
    return {
      allowed: true,
      tier: 'migration_corridor',
      reason: 'Known high-demand migration corridor',
      demandBoost: 22,
    };
  }

  if (isMajorHub(a) && isMajorHub(b)) {
    const elig = (a.scores.eligibility + b.scores.eligibility) / 2;
    if (elig < 65) {
      return {
        allowed: false,
        tier: 'rejected',
        reason: 'Cross-border hubs below demand threshold',
        demandBoost: 0,
      };
    }
    return {
      allowed: true,
      tier: 'major_international',
      reason: 'Major international hub comparison with search demand',
      demandBoost: 16 + Math.min(12, Math.round((elig - 65) / 3)),
    };
  }

  return {
    allowed: false,
    tier: 'rejected',
    reason: 'Unrealistic cross-country pairing without SEO demand',
    demandBoost: 0,
  };
}

export function findCityByNameCode(
  cities: EligibleCity[],
  name: string,
  code: string
): EligibleCity | undefined {
  const n = norm(name);
  return (
    cities.find((c) => c.countryCode === code && norm(c.city) === n) ||
    cities.find((c) => c.countryCode === code && (norm(c.city).includes(n) || n.includes(norm(c.city))))
  );
}
