/**
 * Calculation ledger — the single approved source for numbers a draft may state
 * about city costs. Built deterministically from CityCost's own dataset
 * (resolveCityCost), never from model output.
 *
 * Definitions are explicit so prose cannot conflate:
 * - the "core monthly basket" (1-bed city-centre rent + utilities + internet)
 *   with total cost of living;
 * - the "modeled remainder" (average net salary − basket) with disposable
 *   income or savings (food, transport, tax changes etc. are not deducted);
 * - currency conversion with cost-of-living equivalence.
 *
 * Fails closed: a side without a real catalog record is excluded, a
 * cross-currency difference is only computed with a usable FX rate, and the
 * FX table's lack of a reference date is disclosed rather than invented.
 */

import { findCityBySlug } from '../../seo-catalog.js';
import { resolveCityCost } from '../../city-cost-resolve.js';

const ITEM = {
  rent: 'Apartment (1 bedroom) in City Centre',
  utilities: 'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment',
  internet: 'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)',
  transport: 'One-way Ticket (Local Transport)',
  salary: 'Average Monthly Net Salary (After Tax)',
} as const;

export const BASKET_DEFINITION =
  'core monthly basket = 1-bedroom city-centre rent + basic utilities (85 m²) + internet; it is NOT total cost of living (food, transport, health and leisure are excluded)';
export const REMAINDER_DEFINITION =
  'modeled remainder = average monthly net salary − core monthly basket; it is NOT disposable income or savings, because food, transport and other spending are not deducted';
export const FX_TABLE_NOTE =
  "converted with CityCost's reference exchange-rate table, which has no recorded reference date — treat converted amounts as approximate";

export interface LedgerSide {
  city: string;
  page_slug: string;
  country_code: string;
  currency: string;
  symbol: string;
  /** Local units per 1 USD from the reference table. */
  fx_per_usd: number | null;
  data_source: string;
  is_estimated: boolean;
  rent_1br_centre: number | null;
  utilities_85m2: number | null;
  internet: number | null;
  transport_one_way: number | null;
  net_salary: number | null;
  /** rent + utilities + internet, local currency; null when any input is missing. */
  core_basket: number | null;
  /** net_salary − core_basket, local currency; null when either is missing. */
  modeled_remainder: number | null;
}

export interface LedgerDifference {
  /** Absolute core-basket difference. */
  amount: number;
  currency: string;
  symbol: string;
  cheaper: string;
  dearer: string;
  /** How much higher the dearer basket is, relative to the cheaper one. */
  dearer_higher_pct: number;
  /** How much lower the cheaper basket is, relative to the dearer one. */
  cheaper_lower_pct: number;
  basis: 'same_currency' | 'usd_converted';
}

export interface CalculationLedger {
  kind: 'city' | 'comparison';
  status: 'complete' | 'partial' | 'unavailable';
  sides: LedgerSide[];
  same_currency: boolean;
  difference: LedgerDifference | null;
  /** Housing-only winner (lower rent), when both rents exist. */
  rent_cheaper: string | null;
  /** Absolute 1-bed city-centre rent difference (same currency as `difference`), when computable. */
  rent_difference: number | null;
  fx: { basis: 'none' | 'static_reference_table'; as_of: null; note: string | null };
  definitions: { basket: string; remainder: string };
  missing: string[];
  data_sources: string[];
}

function usable(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function round(n: number): number {
  return Math.round(n);
}

export function resolveLedgerSide(pageSlug: string): LedgerSide | null {
  const rec = findCityBySlug(pageSlug);
  if (!rec) return null;
  const r = resolveCityCost(rec);
  const price = (name: string): number | null => {
    const hit = r.prices.find((p) => p.item_name === name);
    return hit && usable(hit.average_price) ? hit.average_price : null;
  };
  const rent = price(ITEM.rent);
  const utilities = price(ITEM.utilities);
  const internet = price(ITEM.internet);
  const salary = price(ITEM.salary);
  const basket = usable(rent) && usable(utilities) && usable(internet) ? round(rent + utilities + internet) : null;
  return {
    city: rec.city,
    page_slug: rec.pageSlug,
    country_code: rec.countryCode,
    currency: r.currency,
    symbol: r.symbol,
    fx_per_usd: usable(r.exchange_rate) ? r.exchange_rate : null,
    data_source: r.data_source_label,
    is_estimated: r.is_estimated,
    rent_1br_centre: rent != null ? round(rent) : null,
    utilities_85m2: utilities != null ? round(utilities) : null,
    internet: internet != null ? round(internet) : null,
    transport_one_way: price(ITEM.transport),
    net_salary: salary != null ? round(salary) : null,
    core_basket: basket,
    modeled_remainder: basket != null && usable(salary) ? round(salary - basket) : null,
  };
}

/** Build the ledger for one city or a two-city comparison (page slugs from the catalog). */
export function buildCalculationLedger(pageSlugs: string[]): CalculationLedger | null {
  const wanted = pageSlugs.filter(Boolean).slice(0, 2);
  if (!wanted.length) return null;
  const sides = wanted.map(resolveLedgerSide).filter((s): s is LedgerSide => Boolean(s));
  const missing: string[] = [];
  for (const slug of wanted) if (!sides.some((s) => s.page_slug === slug)) missing.push(`no catalog record for ${slug}`);
  for (const s of sides) {
    if (s.core_basket == null) missing.push(`${s.city}: core basket inputs incomplete`);
    if (s.net_salary == null) missing.push(`${s.city}: net salary unavailable`);
  }
  const kind: CalculationLedger['kind'] = wanted.length === 2 ? 'comparison' : 'city';
  const same_currency = sides.length === 2 ? sides[0]!.currency === sides[1]!.currency : true;

  let difference: LedgerDifference | null = null;
  let fxBasis: CalculationLedger['fx']['basis'] = 'none';
  let rent_cheaper: string | null = null;
  let rent_difference: number | null = null;
  if (kind === 'comparison' && sides.length === 2) {
    const [a, b] = sides as [LedgerSide, LedgerSide];
    if (a.rent_1br_centre != null && b.rent_1br_centre != null) {
      const ra = same_currency ? a.rent_1br_centre : a.fx_per_usd ? a.rent_1br_centre / a.fx_per_usd : null;
      const rb = same_currency ? b.rent_1br_centre : b.fx_per_usd ? b.rent_1br_centre / b.fx_per_usd : null;
      if (ra != null && rb != null) {
        rent_cheaper = ra <= rb ? a.city : b.city;
        rent_difference = round(Math.abs(ra - rb));
      }
    }
    if (a.core_basket != null && b.core_basket != null) {
      if (same_currency) {
        const cheaperSide = a.core_basket <= b.core_basket ? a : b;
        const dearerSide = cheaperSide === a ? b : a;
        difference = {
          amount: round(dearerSide.core_basket! - cheaperSide.core_basket!),
          currency: a.currency,
          symbol: a.symbol,
          cheaper: cheaperSide.city,
          dearer: dearerSide.city,
          dearer_higher_pct: round(((dearerSide.core_basket! - cheaperSide.core_basket!) / cheaperSide.core_basket!) * 100),
          cheaper_lower_pct: round(((dearerSide.core_basket! - cheaperSide.core_basket!) / dearerSide.core_basket!) * 100),
          basis: 'same_currency',
        };
      } else if (a.fx_per_usd && b.fx_per_usd) {
        fxBasis = 'static_reference_table';
        const ua = a.core_basket / a.fx_per_usd;
        const ub = b.core_basket / b.fx_per_usd;
        const cheaper = ua <= ub ? a : b;
        const dearer = cheaper === a ? b : a;
        const lo = Math.min(ua, ub);
        const hi = Math.max(ua, ub);
        difference = {
          amount: round(hi - lo),
          currency: 'USD',
          symbol: '$',
          cheaper: cheaper.city,
          dearer: dearer.city,
          dearer_higher_pct: round(((hi - lo) / lo) * 100),
          cheaper_lower_pct: round(((hi - lo) / hi) * 100),
          basis: 'usd_converted',
        };
      } else {
        missing.push('exchange rate unavailable — cross-currency difference not computed');
      }
    }
  }

  const status: CalculationLedger['status'] = !sides.length
    ? 'unavailable'
    : missing.length
      ? 'partial'
      : 'complete';
  return {
    kind,
    status,
    sides,
    same_currency,
    difference,
    rent_cheaper,
    rent_difference,
    fx: { basis: fxBasis, as_of: null, note: fxBasis === 'static_reference_table' ? FX_TABLE_NOTE : null },
    definitions: { basket: BASKET_DEFINITION, remainder: REMAINDER_DEFINITION },
    missing,
    data_sources: [...new Set(sides.map((s) => s.data_source))],
  };
}

function money(symbol: string, n: number): string {
  return `${symbol}${Math.round(n).toLocaleString('en-US')}`;
}

/** Canonical lines handed to the writer. Values are final — prose must not recompute them. */
export function ledgerFactLines(ledger: CalculationLedger | null | undefined): string[] {
  if (!ledger || ledger.status === 'unavailable') return [];
  const lines: string[] = [
    `CityCost figures below are final: quote them as given and do not compute other differences.`,
    `Definition — ${ledger.definitions.basket}.`,
    `Definition — ${ledger.definitions.remainder}.`,
  ];
  for (const s of ledger.sides) {
    const parts = [
      s.rent_1br_centre != null ? `1-bed city-centre rent ${money(s.symbol, s.rent_1br_centre)}/month` : null,
      s.utilities_85m2 != null ? `utilities ${money(s.symbol, s.utilities_85m2)}/month` : null,
      s.internet != null ? `internet ${money(s.symbol, s.internet)}/month` : null,
      s.core_basket != null ? `core monthly basket ${money(s.symbol, s.core_basket)}` : null,
      s.net_salary != null ? `average net salary ${money(s.symbol, s.net_salary)}/month` : null,
      s.modeled_remainder != null ? `modeled remainder ${money(s.symbol, s.modeled_remainder)}/month` : null,
    ].filter(Boolean);
    lines.push(
      `${s.city} (${s.currency}; ${s.is_estimated ? 'CityCost modelled estimate' : 'CityCost surveyed data'}): ${parts.join('; ')}.`
    );
  }
  if (ledger.difference) {
    const d = ledger.difference;
    lines.push(
      `Core monthly basket difference: ${money(d.symbol, d.amount)} lower in ${d.cheaper} than in ${d.dearer} (${d.cheaper} ${d.cheaper_lower_pct}% lower; ${d.dearer} ${d.dearer_higher_pct}% higher)${
        d.basis === 'usd_converted' ? ` (${FX_TABLE_NOTE})` : ' (same currency, no conversion)'
      }.`
    );
  }
  if (ledger.rent_cheaper) {
    const sym = ledger.difference?.symbol || (ledger.same_currency ? ledger.sides[0]?.symbol : '$') || '';
    lines.push(
      `Housing: 1-bed city-centre rent is lower in ${ledger.rent_cheaper}${
        ledger.rent_difference != null ? ` by ${money(sym, ledger.rent_difference)}/month (rent only, not the whole basket)` : ''
      }.`
    );
  }
  for (const m of ledger.missing) lines.push(`No figure available: ${m} — do not state one.`);
  return lines;
}
