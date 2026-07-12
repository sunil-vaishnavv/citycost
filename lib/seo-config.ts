/**
 * SEO indexing configuration — scale without code changes.
 *
 * Cities:     SEO_MAX_CITIES=500|1000|5000|10000
 * Comparisons: SEO_MAX_COMPARISONS=10000|50000|100000
 */

function readEnv(name: string): string | undefined {
  // Vite browser bundles do not define `process`; guard for isomorphic imports.
  try {
    if (typeof process !== 'undefined' && process.env && process.env[name] != null) {
      return process.env[name];
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function envInt(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw == null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw == null || raw === '') return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const SEO_INDEX_CONFIG = {
  /** Soft cap on indexable city pages. */
  maxIndexableCities: envInt('SEO_MAX_CITIES', 500),

  /**
   * Soft cap on comparison pages (Comparison Eligibility Engine).
   * Raise to 10000 / 50000 / 100000 via env — no code change.
   */
  maxIndexableComparisons: envInt('SEO_MAX_COMPARISONS', 10000),

  /** Minimum city eligibility score (0–100). */
  minEligibilityScore: envFloat('SEO_MIN_ELIGIBILITY', 52),

  /** Minimum city content-quality score. */
  minContentScore: envFloat('SEO_MIN_CONTENT', 55),

  /** Minimum comparison eligibility score to index a pair. */
  minComparisonScore: envFloat('SEO_MIN_COMPARISON_SCORE', 42),

  /** When population is known, require at least this many (unless higher priority flags). */
  minPopulation: envInt('SEO_MIN_POPULATION', 80_000),

  /**
   * @deprecated Country pages are no longer gated by city count.
   * Kept for backwards-compatible env reading only.
   */
  minCitiesPerCountry: envInt('SEO_MIN_CITIES_PER_COUNTRY', 0),

  /** Same-country / peer fan-out per city when filling comparison volume. */
  comparisonsPerCitySameCountry: envInt('SEO_COMPS_PER_CITY', 12),

  /** Max cities per country used for all-pairs same-country comparisons. */
  maxCitiesPerCountryForComps: envInt('SEO_COMP_CITIES_PER_COUNTRY', 40),

  /** Top global cities used for cross-border all-pairs. */
  topGlobalCitiesForCrossComps: envInt('SEO_CROSS_TOP_CITIES', 80),

  /** Legacy seed cap (engine now score-ranks; kept for compatibility). */
  maxCrossBorderComparisons: envInt('SEO_CROSS_BORDER_COMPS', 400),

  /** Max cities listed on a country page. */
  maxCitiesOnCountryPage: envInt('SEO_COUNTRY_CITY_LIST', 40),

  /** Require coordinates OR surveyed data to avoid thin geo stubs. */
  requireCoordsOrSurveyed: true,

  /** Drop cities whose names are extremely short / numeric-only. */
  minCityNameLength: 2,
} as const;

export type SeoIndexConfig = typeof SEO_INDEX_CONFIG;
