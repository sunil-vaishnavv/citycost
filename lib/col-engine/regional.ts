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

/**
 * Per-country category baselines, indexed against New York City = 100.
 *
 * Coverage matters for page uniqueness, not just accuracy: any country missing
 * from this table falls back to DEFAULT, and because most countries also have no
 * STATE_ECONOMY entry and the geo dataset carries no population, every city in
 * those countries resolved to a byte-identical result. That made ~80% of the
 * indexable city pages duplicates of one another. Keep this table covering every
 * country that appears in the SEO index.
 *
 * The first ten entries are the original hand-tuned values and are unchanged.
 * The remainder are modeled estimates derived from published relative
 * cost-of-living levels, income levels and price parity for each country. They
 * are estimates, not survey data — the engine reports them as source "regional"
 * with confidence 0.62, and a real Numbeo/surveyed match always takes priority.
 */
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

  // ── Western & Northern Europe ───────────────────────────────────────────
  CH: { housing: 62, groceries: 105, restaurants: 92, transport: 78, utilities: 95, healthcare: 105, education: 100, entertainment: 88, salary: 118, cpi: 101 },
  LI: { housing: 58, groceries: 95, restaurants: 88, transport: 72, utilities: 90, healthcare: 100, education: 95, entertainment: 82, salary: 115, cpi: 96 },
  NO: { housing: 34, groceries: 78, restaurants: 88, transport: 72, utilities: 62, healthcare: 88, education: 92, entertainment: 80, salary: 100, cpi: 85 },
  IS: { housing: 40, groceries: 85, restaurants: 90, transport: 70, utilities: 55, healthcare: 85, education: 88, entertainment: 78, salary: 88, cpi: 88 },
  DK: { housing: 36, groceries: 70, restaurants: 85, transport: 68, utilities: 82, healthcare: 85, education: 90, entertainment: 76, salary: 98, cpi: 83 },
  LU: { housing: 48, groceries: 70, restaurants: 78, transport: 60, utilities: 78, healthcare: 85, education: 88, entertainment: 72, salary: 112, cpi: 78 },
  IE: { housing: 48, groceries: 65, restaurants: 75, transport: 65, utilities: 85, healthcare: 78, education: 82, entertainment: 72, salary: 92, cpi: 75 },
  NL: { housing: 42, groceries: 60, restaurants: 72, transport: 62, utilities: 82, healthcare: 78, education: 82, entertainment: 70, salary: 96, cpi: 72 },
  BE: { housing: 33, groceries: 62, restaurants: 72, transport: 58, utilities: 88, healthcare: 76, education: 80, entertainment: 68, salary: 92, cpi: 70 },
  AT: { housing: 30, groceries: 60, restaurants: 65, transport: 55, utilities: 80, healthcare: 76, education: 80, entertainment: 66, salary: 88, cpi: 68 },
  SE: { housing: 30, groceries: 62, restaurants: 70, transport: 60, utilities: 60, healthcare: 80, education: 85, entertainment: 70, salary: 95, cpi: 68 },
  FI: { housing: 32, groceries: 62, restaurants: 72, transport: 58, utilities: 65, healthcare: 80, education: 88, entertainment: 70, salary: 90, cpi: 70 },

  // ── Southern Europe ─────────────────────────────────────────────────────
  IT: { housing: 25, groceries: 58, restaurants: 58, transport: 45, utilities: 80, healthcare: 62, education: 65, entertainment: 58, salary: 70, cpi: 63 },
  ES: { housing: 25, groceries: 50, restaurants: 52, transport: 42, utilities: 72, healthcare: 58, education: 60, entertainment: 52, salary: 75, cpi: 55 },
  PT: { housing: 26, groceries: 48, restaurants: 45, transport: 40, utilities: 68, healthcare: 50, education: 52, entertainment: 46, salary: 55, cpi: 52 },
  GR: { housing: 20, groceries: 48, restaurants: 48, transport: 38, utilities: 72, healthcare: 48, education: 50, entertainment: 48, salary: 50, cpi: 52 },
  MT: { housing: 30, groceries: 52, restaurants: 52, transport: 35, utilities: 55, healthcare: 55, education: 58, entertainment: 50, salary: 60, cpi: 56 },
  CY: { housing: 26, groceries: 52, restaurants: 50, transport: 40, utilities: 70, healthcare: 55, education: 58, entertainment: 50, salary: 58, cpi: 55 },
  AD: { housing: 32, groceries: 55, restaurants: 55, transport: 42, utilities: 60, healthcare: 60, education: 62, entertainment: 55, salary: 75, cpi: 58 },

  // ── Central & Eastern Europe / Baltics ──────────────────────────────────
  PL: { housing: 22, groceries: 40, restaurants: 38, transport: 30, utilities: 60, healthcare: 38, education: 42, entertainment: 38, salary: 65, cpi: 44 },
  CZ: { housing: 24, groceries: 42, restaurants: 40, transport: 28, utilities: 62, healthcare: 40, education: 45, entertainment: 40, salary: 65, cpi: 48 },
  SK: { housing: 20, groceries: 42, restaurants: 38, transport: 26, utilities: 60, healthcare: 38, education: 42, entertainment: 38, salary: 55, cpi: 45 },
  HU: { housing: 20, groceries: 38, restaurants: 35, transport: 26, utilities: 55, healthcare: 35, education: 38, entertainment: 36, salary: 55, cpi: 42 },
  RO: { housing: 18, groceries: 36, restaurants: 32, transport: 22, utilities: 50, healthcare: 32, education: 35, entertainment: 32, salary: 55, cpi: 40 },
  BG: { housing: 18, groceries: 36, restaurants: 32, transport: 22, utilities: 52, healthcare: 32, education: 35, entertainment: 32, salary: 50, cpi: 40 },
  SI: { housing: 22, groceries: 46, restaurants: 45, transport: 32, utilities: 65, healthcare: 45, education: 48, entertainment: 44, salary: 60, cpi: 50 },
  HR: { housing: 20, groceries: 44, restaurants: 42, transport: 30, utilities: 62, healthcare: 42, education: 45, entertainment: 42, salary: 50, cpi: 48 },
  EE: { housing: 22, groceries: 45, restaurants: 42, transport: 28, utilities: 62, healthcare: 42, education: 46, entertainment: 42, salary: 60, cpi: 48 },
  LV: { housing: 18, groceries: 42, restaurants: 38, transport: 26, utilities: 60, healthcare: 38, education: 42, entertainment: 38, salary: 55, cpi: 45 },
  LT: { housing: 18, groceries: 42, restaurants: 38, transport: 26, utilities: 58, healthcare: 38, education: 42, entertainment: 38, salary: 58, cpi: 45 },

  // ── Balkans ─────────────────────────────────────────────────────────────
  RS: { housing: 16, groceries: 34, restaurants: 30, transport: 20, utilities: 48, healthcare: 30, education: 32, entertainment: 30, salary: 42, cpi: 38 },
  BA: { housing: 14, groceries: 33, restaurants: 28, transport: 18, utilities: 45, healthcare: 28, education: 30, entertainment: 28, salary: 38, cpi: 36 },
  MK: { housing: 13, groceries: 32, restaurants: 26, transport: 17, utilities: 42, healthcare: 26, education: 28, entertainment: 26, salary: 38, cpi: 34 },
  AL: { housing: 14, groceries: 33, restaurants: 28, transport: 18, utilities: 44, healthcare: 28, education: 30, entertainment: 28, salary: 35, cpi: 36 },
  ME: { housing: 16, groceries: 36, restaurants: 32, transport: 20, utilities: 46, healthcare: 30, education: 32, entertainment: 32, salary: 38, cpi: 38 },

  // ── Eastern Europe / Caucasus / Central Asia ────────────────────────────
  RU: { housing: 13, groceries: 30, restaurants: 25, transport: 16, utilities: 30, healthcare: 26, education: 28, entertainment: 26, salary: 48, cpi: 33 },
  UA: { housing: 12, groceries: 28, restaurants: 22, transport: 12, utilities: 28, healthcare: 22, education: 24, entertainment: 22, salary: 35, cpi: 30 },
  BY: { housing: 11, groceries: 28, restaurants: 22, transport: 12, utilities: 26, healthcare: 22, education: 24, entertainment: 22, salary: 38, cpi: 29 },
  MD: { housing: 12, groceries: 30, restaurants: 24, transport: 14, utilities: 40, healthcare: 24, education: 26, entertainment: 24, salary: 32, cpi: 32 },
  GE: { housing: 15, groceries: 30, restaurants: 26, transport: 14, utilities: 32, healthcare: 26, education: 28, entertainment: 26, salary: 32, cpi: 33 },
  AM: { housing: 14, groceries: 30, restaurants: 26, transport: 14, utilities: 32, healthcare: 26, education: 28, entertainment: 26, salary: 30, cpi: 32 },
  AZ: { housing: 13, groceries: 28, restaurants: 24, transport: 12, utilities: 28, healthcare: 24, education: 26, entertainment: 24, salary: 32, cpi: 30 },
  KZ: { housing: 12, groceries: 28, restaurants: 24, transport: 13, utilities: 26, healthcare: 24, education: 26, entertainment: 24, salary: 38, cpi: 30 },
  UZ: { housing: 10, groceries: 25, restaurants: 20, transport: 10, utilities: 22, healthcare: 20, education: 22, entertainment: 20, salary: 25, cpi: 26 },
  KG: { housing: 10, groceries: 25, restaurants: 20, transport: 10, utilities: 22, healthcare: 20, education: 22, entertainment: 20, salary: 22, cpi: 26 },
  TM: { housing: 10, groceries: 26, restaurants: 20, transport: 10, utilities: 20, healthcare: 20, education: 22, entertainment: 20, salary: 22, cpi: 26 },
  TR: { housing: 15, groceries: 28, restaurants: 25, transport: 14, utilities: 32, healthcare: 26, education: 32, entertainment: 26, salary: 40, cpi: 32 },

  // ── Middle East ─────────────────────────────────────────────────────────
  IL: { housing: 38, groceries: 72, restaurants: 75, transport: 55, utilities: 70, healthcare: 65, education: 70, entertainment: 68, salary: 85, cpi: 78 },
  QA: { housing: 30, groceries: 50, restaurants: 48, transport: 35, utilities: 40, healthcare: 55, education: 65, entertainment: 52, salary: 100, cpi: 58 },
  KW: { housing: 24, groceries: 45, restaurants: 40, transport: 28, utilities: 25, healthcare: 48, education: 58, entertainment: 45, salary: 85, cpi: 48 },
  BH: { housing: 24, groceries: 46, restaurants: 42, transport: 30, utilities: 38, healthcare: 50, education: 58, entertainment: 46, salary: 78, cpi: 50 },
  OM: { housing: 20, groceries: 44, restaurants: 38, transport: 28, utilities: 35, healthcare: 45, education: 52, entertainment: 42, salary: 70, cpi: 46 },
  SA: { housing: 18, groceries: 40, restaurants: 35, transport: 25, utilities: 30, healthcare: 45, education: 52, entertainment: 40, salary: 85, cpi: 45 },
  JO: { housing: 18, groceries: 40, restaurants: 32, transport: 22, utilities: 42, healthcare: 35, education: 38, entertainment: 34, salary: 30, cpi: 42 },
  LB: { housing: 16, groceries: 42, restaurants: 35, transport: 22, utilities: 40, healthcare: 32, education: 38, entertainment: 35, salary: 22, cpi: 42 },
  IQ: { housing: 14, groceries: 34, restaurants: 26, transport: 16, utilities: 25, healthcare: 26, education: 28, entertainment: 26, salary: 25, cpi: 33 },
  IR: { housing: 10, groceries: 25, restaurants: 18, transport: 8, utilities: 15, healthcare: 20, education: 22, entertainment: 20, salary: 22, cpi: 25 },
  SY: { housing: 10, groceries: 26, restaurants: 20, transport: 10, utilities: 20, healthcare: 20, education: 22, entertainment: 20, salary: 15, cpi: 26 },
  YE: { housing: 9, groceries: 26, restaurants: 20, transport: 10, utilities: 20, healthcare: 18, education: 20, entertainment: 18, salary: 12, cpi: 26 },

  // ── East Asia ───────────────────────────────────────────────────────────
  CN: { housing: 20, groceries: 40, restaurants: 28, transport: 20, utilities: 35, healthcare: 35, education: 45, entertainment: 32, salary: 60, cpi: 38 },
  KR: { housing: 28, groceries: 75, restaurants: 50, transport: 40, utilities: 55, healthcare: 60, education: 70, entertainment: 55, salary: 85, cpi: 62 },
  TW: { housing: 20, groceries: 55, restaurants: 35, transport: 30, utilities: 40, healthcare: 45, education: 55, entertainment: 42, salary: 75, cpi: 52 },
  KP: { housing: 8, groceries: 22, restaurants: 16, transport: 8, utilities: 15, healthcare: 15, education: 18, entertainment: 15, salary: 10, cpi: 22 },

  // ── South-East Asia ─────────────────────────────────────────────────────
  TH: { housing: 16, groceries: 38, restaurants: 25, transport: 20, utilities: 38, healthcare: 32, education: 40, entertainment: 30, salary: 45, cpi: 38 },
  MY: { housing: 13, groceries: 32, restaurants: 20, transport: 16, utilities: 28, healthcare: 26, education: 35, entertainment: 26, salary: 50, cpi: 33 },
  ID: { housing: 13, groceries: 32, restaurants: 20, transport: 14, utilities: 30, healthcare: 25, education: 32, entertainment: 25, salary: 35, cpi: 32 },
  PH: { housing: 14, groceries: 33, restaurants: 22, transport: 12, utilities: 40, healthcare: 25, education: 32, entertainment: 26, salary: 30, cpi: 33 },
  VN: { housing: 14, groceries: 30, restaurants: 20, transport: 14, utilities: 30, healthcare: 24, education: 30, entertainment: 24, salary: 35, cpi: 32 },
  KH: { housing: 13, groceries: 32, restaurants: 22, transport: 14, utilities: 38, healthcare: 24, education: 30, entertainment: 25, salary: 25, cpi: 33 },
  LA: { housing: 12, groceries: 30, restaurants: 20, transport: 13, utilities: 28, healthcare: 22, education: 28, entertainment: 22, salary: 22, cpi: 30 },
  MM: { housing: 11, groceries: 28, restaurants: 18, transport: 12, utilities: 22, healthcare: 20, education: 25, entertainment: 20, salary: 20, cpi: 28 },

  // ── South Asia ──────────────────────────────────────────────────────────
  PK: { housing: 8, groceries: 22, restaurants: 15, transport: 10, utilities: 18, healthcare: 15, education: 18, entertainment: 14, salary: 25, cpi: 23 },
  BD: { housing: 9, groceries: 25, restaurants: 16, transport: 8, utilities: 16, healthcare: 16, education: 20, entertainment: 15, salary: 25, cpi: 25 },
  NP: { housing: 8, groceries: 24, restaurants: 16, transport: 9, utilities: 18, healthcare: 15, education: 18, entertainment: 15, salary: 20, cpi: 24 },
  BT: { housing: 9, groceries: 26, restaurants: 18, transport: 10, utilities: 18, healthcare: 16, education: 20, entertainment: 16, salary: 22, cpi: 26 },
  MV: { housing: 22, groceries: 45, restaurants: 40, transport: 25, utilities: 45, healthcare: 35, education: 40, entertainment: 42, salary: 40, cpi: 46 },
  AF: { housing: 8, groceries: 24, restaurants: 16, transport: 9, utilities: 16, healthcare: 14, education: 16, entertainment: 14, salary: 12, cpi: 24 },

  // ── Oceania ─────────────────────────────────────────────────────────────
  NZ: { housing: 40, groceries: 65, restaurants: 62, transport: 55, utilities: 70, healthcare: 70, education: 75, entertainment: 65, salary: 88, cpi: 68 },

  // ── North America & Caribbean ───────────────────────────────────────────
  MX: { housing: 16, groceries: 35, restaurants: 30, transport: 20, utilities: 35, healthcare: 32, education: 38, entertainment: 32, salary: 40, cpi: 38 },
  CU: { housing: 12, groceries: 32, restaurants: 25, transport: 14, utilities: 20, healthcare: 20, education: 25, entertainment: 22, salary: 15, cpi: 30 },
  DO: { housing: 16, groceries: 40, restaurants: 32, transport: 20, utilities: 42, healthcare: 30, education: 35, entertainment: 32, salary: 28, cpi: 40 },
  JM: { housing: 18, groceries: 42, restaurants: 35, transport: 22, utilities: 55, healthcare: 32, education: 38, entertainment: 35, salary: 28, cpi: 44 },
  BS: { housing: 32, groceries: 65, restaurants: 55, transport: 35, utilities: 70, healthcare: 55, education: 58, entertainment: 52, salary: 50, cpi: 65 },
  BZ: { housing: 16, groceries: 42, restaurants: 35, transport: 20, utilities: 50, healthcare: 30, education: 35, entertainment: 32, salary: 25, cpi: 42 },

  // ── Central America ─────────────────────────────────────────────────────
  CR: { housing: 20, groceries: 45, restaurants: 38, transport: 25, utilities: 40, healthcare: 35, education: 42, entertainment: 38, salary: 38, cpi: 45 },
  PA: { housing: 20, groceries: 42, restaurants: 35, transport: 20, utilities: 42, healthcare: 35, education: 42, entertainment: 36, salary: 38, cpi: 42 },
  GT: { housing: 14, groceries: 36, restaurants: 28, transport: 16, utilities: 42, healthcare: 26, education: 30, entertainment: 28, salary: 25, cpi: 36 },
  HN: { housing: 13, groceries: 35, restaurants: 26, transport: 15, utilities: 40, healthcare: 24, education: 28, entertainment: 26, salary: 22, cpi: 34 },
  NI: { housing: 12, groceries: 34, restaurants: 25, transport: 14, utilities: 38, healthcare: 22, education: 26, entertainment: 24, salary: 20, cpi: 33 },
  SV: { housing: 14, groceries: 36, restaurants: 28, transport: 16, utilities: 40, healthcare: 26, education: 30, entertainment: 28, salary: 25, cpi: 35 },

  // ── South America ───────────────────────────────────────────────────────
  BR: { housing: 14, groceries: 32, restaurants: 28, transport: 18, utilities: 38, healthcare: 30, education: 38, entertainment: 30, salary: 40, cpi: 35 },
  AR: { housing: 13, groceries: 32, restaurants: 28, transport: 12, utilities: 22, healthcare: 26, education: 32, entertainment: 28, salary: 30, cpi: 33 },
  CL: { housing: 17, groceries: 40, restaurants: 35, transport: 22, utilities: 40, healthcare: 35, education: 42, entertainment: 35, salary: 45, cpi: 42 },
  CO: { housing: 12, groceries: 28, restaurants: 22, transport: 14, utilities: 30, healthcare: 24, education: 30, entertainment: 24, salary: 30, cpi: 30 },
  PE: { housing: 13, groceries: 30, restaurants: 22, transport: 14, utilities: 30, healthcare: 24, education: 30, entertainment: 25, salary: 30, cpi: 32 },
  EC: { housing: 13, groceries: 33, restaurants: 25, transport: 12, utilities: 26, healthcare: 26, education: 32, entertainment: 26, salary: 30, cpi: 33 },
  BO: { housing: 10, groceries: 28, restaurants: 20, transport: 10, utilities: 22, healthcare: 20, education: 26, entertainment: 22, salary: 22, cpi: 28 },
  PY: { housing: 12, groceries: 30, restaurants: 24, transport: 14, utilities: 28, healthcare: 24, education: 28, entertainment: 24, salary: 28, cpi: 31 },
  UY: { housing: 18, groceries: 42, restaurants: 38, transport: 24, utilities: 45, healthcare: 35, education: 40, entertainment: 36, salary: 40, cpi: 44 },
  VE: { housing: 10, groceries: 30, restaurants: 24, transport: 10, utilities: 15, healthcare: 20, education: 24, entertainment: 22, salary: 12, cpi: 30 },

  // ── North Africa ────────────────────────────────────────────────────────
  DZ: { housing: 8, groceries: 25, restaurants: 18, transport: 9, utilities: 18, healthcare: 18, education: 22, entertainment: 18, salary: 20, cpi: 25 },
  MA: { housing: 12, groceries: 30, restaurants: 22, transport: 14, utilities: 26, healthcare: 24, education: 30, entertainment: 24, salary: 25, cpi: 30 },
  TN: { housing: 9, groceries: 26, restaurants: 18, transport: 10, utilities: 20, healthcare: 18, education: 22, entertainment: 18, salary: 18, cpi: 26 },
  EG: { housing: 8, groceries: 22, restaurants: 16, transport: 8, utilities: 16, healthcare: 15, education: 20, entertainment: 15, salary: 20, cpi: 23 },
  LY: { housing: 10, groceries: 28, restaurants: 20, transport: 8, utilities: 15, healthcare: 18, education: 22, entertainment: 18, salary: 18, cpi: 27 },
  SD: { housing: 9, groceries: 26, restaurants: 18, transport: 10, utilities: 18, healthcare: 16, education: 18, entertainment: 16, salary: 12, cpi: 26 },

  // ── Sub-Saharan Africa ──────────────────────────────────────────────────
  ZA: { housing: 14, groceries: 32, restaurants: 28, transport: 20, utilities: 35, healthcare: 30, education: 38, entertainment: 30, salary: 50, cpi: 35 },
  KE: { housing: 14, groceries: 32, restaurants: 26, transport: 16, utilities: 30, healthcare: 24, education: 30, entertainment: 26, salary: 25, cpi: 33 },
  NG: { housing: 12, groceries: 30, restaurants: 22, transport: 14, utilities: 25, healthcare: 20, education: 26, entertainment: 22, salary: 20, cpi: 30 },
  GH: { housing: 14, groceries: 33, restaurants: 25, transport: 15, utilities: 28, healthcare: 22, education: 28, entertainment: 24, salary: 22, cpi: 33 },
  TZ: { housing: 12, groceries: 30, restaurants: 24, transport: 14, utilities: 26, healthcare: 20, education: 26, entertainment: 22, salary: 20, cpi: 30 },
  UG: { housing: 11, groceries: 29, restaurants: 22, transport: 13, utilities: 26, healthcare: 20, education: 25, entertainment: 21, salary: 18, cpi: 29 },
  RW: { housing: 12, groceries: 30, restaurants: 22, transport: 13, utilities: 26, healthcare: 20, education: 25, entertainment: 22, salary: 18, cpi: 30 },
  ET: { housing: 11, groceries: 28, restaurants: 20, transport: 12, utilities: 20, healthcare: 18, education: 22, entertainment: 20, salary: 15, cpi: 28 },
  ZM: { housing: 11, groceries: 29, restaurants: 22, transport: 13, utilities: 24, healthcare: 20, education: 24, entertainment: 21, salary: 18, cpi: 29 },
  ZW: { housing: 12, groceries: 32, restaurants: 24, transport: 14, utilities: 26, healthcare: 20, education: 25, entertainment: 22, salary: 15, cpi: 32 },
  MZ: { housing: 12, groceries: 30, restaurants: 24, transport: 13, utilities: 25, healthcare: 20, education: 24, entertainment: 22, salary: 16, cpi: 30 },
  NA: { housing: 13, groceries: 32, restaurants: 26, transport: 16, utilities: 28, healthcare: 24, education: 30, entertainment: 25, salary: 30, cpi: 33 },
  BW: { housing: 13, groceries: 33, restaurants: 26, transport: 16, utilities: 28, healthcare: 25, education: 30, entertainment: 25, salary: 32, cpi: 33 },
  SN: { housing: 13, groceries: 32, restaurants: 25, transport: 14, utilities: 30, healthcare: 22, education: 26, entertainment: 24, salary: 18, cpi: 32 },
  CI: { housing: 14, groceries: 33, restaurants: 26, transport: 15, utilities: 30, healthcare: 22, education: 26, entertainment: 25, salary: 18, cpi: 33 },
  CM: { housing: 12, groceries: 30, restaurants: 23, transport: 14, utilities: 28, healthcare: 20, education: 24, entertainment: 22, salary: 16, cpi: 30 },
  GA: { housing: 16, groceries: 38, restaurants: 30, transport: 18, utilities: 32, healthcare: 26, education: 30, entertainment: 28, salary: 25, cpi: 38 },
  CG: { housing: 15, groceries: 38, restaurants: 30, transport: 18, utilities: 30, healthcare: 24, education: 28, entertainment: 27, salary: 18, cpi: 37 },
  CD: { housing: 15, groceries: 38, restaurants: 30, transport: 18, utilities: 30, healthcare: 22, education: 26, entertainment: 27, salary: 14, cpi: 37 },
  AO: { housing: 16, groceries: 40, restaurants: 32, transport: 18, utilities: 28, healthcare: 24, education: 28, entertainment: 28, salary: 18, cpi: 38 },
  ML: { housing: 11, groceries: 29, restaurants: 22, transport: 13, utilities: 26, healthcare: 18, education: 22, entertainment: 21, salary: 14, cpi: 29 },
  BF: { housing: 11, groceries: 29, restaurants: 22, transport: 13, utilities: 26, healthcare: 18, education: 22, entertainment: 21, salary: 14, cpi: 29 },
  BJ: { housing: 11, groceries: 29, restaurants: 22, transport: 13, utilities: 26, healthcare: 18, education: 22, entertainment: 21, salary: 14, cpi: 29 },
  GN: { housing: 11, groceries: 30, restaurants: 22, transport: 13, utilities: 25, healthcare: 18, education: 22, entertainment: 21, salary: 13, cpi: 30 },
  GW: { housing: 10, groceries: 28, restaurants: 21, transport: 12, utilities: 24, healthcare: 17, education: 20, entertainment: 20, salary: 12, cpi: 28 },
  GM: { housing: 10, groceries: 28, restaurants: 21, transport: 12, utilities: 24, healthcare: 17, education: 20, entertainment: 20, salary: 12, cpi: 28 },
  CV: { housing: 15, groceries: 36, restaurants: 28, transport: 16, utilities: 32, healthcare: 24, education: 28, entertainment: 26, salary: 22, cpi: 36 },
  DJ: { housing: 16, groceries: 40, restaurants: 32, transport: 18, utilities: 34, healthcare: 24, education: 28, entertainment: 28, salary: 18, cpi: 39 },
  CF: { housing: 12, groceries: 32, restaurants: 24, transport: 14, utilities: 26, healthcare: 16, education: 20, entertainment: 22, salary: 10, cpi: 31 },
  BI: { housing: 11, groceries: 30, restaurants: 22, transport: 13, utilities: 24, healthcare: 16, education: 20, entertainment: 21, salary: 10, cpi: 29 },

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
    // Every candidate was excluded by the radius test, which can only happen when
    // the target AND all neighbours have coordinates and none is within maxKm —
    // i.e. there genuinely is no nearby surveyed city. Re-adding them at equal
    // weight (the previous behaviour) silently defeated the radius filter: with
    // Toronto the sole surveyed Canadian entry, Vancouver 3,350 km away and
    // Quebec City 730 km away both inherited Toronto's exact category vector.
    // Returning null lets the caller fall through to the regional layer, which
    // does account for tier, population, state economy and urban role.
    //
    // Note this is NOT the "no coordinates" case: a neighbour or target lacking
    // coordinates takes the flat-weight branch above and never reaches here.
    return null;
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
