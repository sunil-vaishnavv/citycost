/**
 * Pure comparison decision builder — indices & prices in, structured decision out.
 * No invented lifestyle claims; skip categories when data is missing.
 */

export interface ComparisonDecisionCitySide {
  name: string;
  cpi: number;
  rent: number;
  groceries: number;
  restaurants: number;
  purchasingPower: number;
  /** Local currency → USD (or site base) rate; price / rate ≈ USD */
  exchangeRate?: number;
  rent1br?: number | null;
  utilities?: number | null;
  internet?: number | null;
  transport?: number | null;
  salary?: number | null;
}

export interface CategoryWinner {
  category: string;
  winner: string;
  note: string;
  /** Absolute % gap used for ranking (0 if tie / unknown). */
  gapPct: number;
}

export interface OverallWinner {
  city: string;
  reason: string;
  costDifferencePct: number;
}

export interface MonthlyDifference {
  /** Absolute basket delta in USD when both baskets convertible; otherwise null. */
  amountUsd: number | null;
  /** Relative gap % (CPI or basket). */
  pct: number;
  cheaperCity: string;
  dearerCity: string;
  mode: 'basket' | 'cpi';
  summary: string;
}

export interface BestForItem {
  persona: string;
  city: string;
  reason: string;
}

export interface BiggestDifference {
  category: string;
  winner: string;
  gapPct: number;
  note: string;
}

export interface ComparisonDecision {
  overall_winner: OverallWinner;
  monthly: MonthlyDifference;
  category_winners: CategoryWinner[];
  biggest_difference: BiggestDifference | null;
  best_for: BestForItem[];
  key_takeaways: string[];
}

function usable(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function pctGap(a: number, b: number): number {
  const base = Math.max(a, 1);
  return Math.abs(((b - a) / base) * 100);
}

function lowerWins(
  category: string,
  cityA: string,
  cityB: string,
  valA: number,
  valB: number,
  label: string
): CategoryWinner | null {
  if (!usable(valA) || !usable(valB)) return null;
  const winner = valA <= valB ? cityA : cityB;
  const gap = Math.round(pctGap(valA, valB));
  const lo = Math.min(valA, valB);
  const hi = Math.max(valA, valB);
  return {
    category,
    winner,
    note: `${label} ${lo} vs ${hi} (lower is better)`,
    gapPct: gap,
  };
}

function higherWins(
  category: string,
  cityA: string,
  cityB: string,
  valA: number,
  valB: number,
  label: string
): CategoryWinner | null {
  if (!usable(valA) || !usable(valB)) return null;
  const winner = valA >= valB ? cityA : cityB;
  const gap = Math.round(pctGap(valA, valB));
  const hi = Math.max(valA, valB);
  const lo = Math.min(valA, valB);
  return {
    category,
    winner,
    note: `${label} ${hi} vs ${lo} (higher is better)`,
    gapPct: gap,
  };
}

function toUsd(local: number, rate: number | undefined): number | null {
  if (!usable(local) || !usable(rate)) return null;
  return local / rate;
}

function basketUsd(side: ComparisonDecisionCitySide): number | null {
  const rent = toUsd(side.rent1br ?? 0, side.exchangeRate);
  const util = toUsd(side.utilities ?? 0, side.exchangeRate);
  const net = toUsd(side.internet ?? 0, side.exchangeRate);
  if (rent == null || util == null || net == null) return null;
  if (!usable(side.rent1br) || !usable(side.utilities) || !usable(side.internet)) return null;
  return rent + util + net;
}

/**
 * Build decision insights from paired city metrics. Deterministic and side-effect free.
 */
export function buildComparisonDecision(
  cityA: ComparisonDecisionCitySide,
  cityB: ComparisonDecisionCitySide
): ComparisonDecision {
  const a = cityA.name;
  const b = cityB.name;

  const category_winners: CategoryWinner[] = [];

  const housing = lowerWins('Housing', a, b, cityA.rent, cityB.rent, 'Rent index');
  if (housing) category_winners.push(housing);

  const food = lowerWins('Food', a, b, cityA.groceries, cityB.groceries, 'Groceries index');
  if (food) category_winners.push(food);

  const transport = lowerWins(
    'Transport',
    a,
    b,
    cityA.transport ?? 0,
    cityB.transport ?? 0,
    'One-way ticket'
  );
  if (transport) category_winners.push(transport);

  const utilities = lowerWins(
    'Utilities',
    a,
    b,
    cityA.utilities ?? 0,
    cityB.utilities ?? 0,
    'Utilities (85m²)'
  );
  if (utilities) category_winners.push(utilities);

  const internet = lowerWins(
    'Internet',
    a,
    b,
    cityA.internet ?? 0,
    cityB.internet ?? 0,
    'Internet'
  );
  if (internet) category_winners.push(internet);

  const restaurants = lowerWins(
    'Restaurants',
    a,
    b,
    cityA.restaurants,
    cityB.restaurants,
    'Restaurant index'
  );
  if (restaurants) category_winners.push(restaurants);

  const salary = higherWins('Salary', a, b, cityA.salary ?? 0, cityB.salary ?? 0, 'Avg net salary');
  if (salary) category_winners.push(salary);

  const pp = higherWins(
    'Purchasing Power',
    a,
    b,
    cityA.purchasingPower,
    cityB.purchasingPower,
    'PP index'
  );
  if (pp) category_winners.push(pp);

  // Overall CPI always included when usable
  const overallCpi = lowerWins('Overall CPI', a, b, cityA.cpi, cityB.cpi, 'CPI');
  // Keep CPI for overall winner math even if we also list it separately for takeaways
  const cheaper = usable(cityA.cpi) && usable(cityB.cpi)
    ? cityA.cpi <= cityB.cpi
      ? a
      : b
    : a;
  const dearer = cheaper === a ? b : a;
  const costDifferencePct =
    usable(cityA.cpi) && usable(cityB.cpi) ? Math.round(pctGap(cityA.cpi, cityB.cpi)) : 0;

  const gapSorted = [...category_winners].sort((x, y) => y.gapPct - x.gapPct);
  const topGaps = gapSorted.filter((g) => g.gapPct > 0).slice(0, 2);
  const reasonParts = topGaps.map((g) => `${g.category} (${g.gapPct}% gap, ${g.winner} ahead)`);
  const overall_winner: OverallWinner = {
    city: cheaper,
    reason:
      reasonParts.length > 0
        ? `Lower overall CPI; largest measurable gaps: ${reasonParts.join('; ')}.`
        : `Lower overall CPI versus ${dearer} (~${costDifferencePct}% gap).`,
    costDifferencePct,
  };

  const basketA = basketUsd(cityA);
  const basketB = basketUsd(cityB);
  let monthly: MonthlyDifference;
  if (basketA != null && basketB != null) {
    const cheaperCity = basketA <= basketB ? a : b;
    const dearerCity = cheaperCity === a ? b : a;
    const amountUsd = Math.round(Math.abs(basketA - basketB));
    const pct = Math.round(pctGap(basketA, basketB));
    monthly = {
      amountUsd,
      pct,
      cheaperCity,
      dearerCity,
      mode: 'basket',
      summary: `Estimated monthly housing+utilities+internet basket is about $${amountUsd.toLocaleString('en-US')} lower in ${cheaperCity} than in ${dearerCity} (~${pct}% gap; converted via exchange rates).`,
    };
  } else {
    monthly = {
      amountUsd: null,
      pct: costDifferencePct,
      cheaperCity: cheaper,
      dearerCity: dearer,
      mode: 'cpi',
      summary: `Estimated relative everyday-cost gap is ~${costDifferencePct}% (CPI), favoring ${cheaper}. Absolute monthly dollar difference is not shown because a full convertible rent+utilities+internet basket was unavailable for both cities.`,
    };
  }

  const biggest =
    gapSorted.length && gapSorted[0].gapPct > 0
      ? {
          category: gapSorted[0].category,
          winner: gapSorted[0].winner,
          gapPct: gapSorted[0].gapPct,
          note: gapSorted[0].note,
        }
      : overallCpi && overallCpi.gapPct > 0
        ? {
            category: overallCpi.category,
            winner: overallCpi.winner,
            gapPct: overallCpi.gapPct,
            note: overallCpi.note,
          }
        : null;

  const rentWinner = housing?.winner ?? cheaper;
  const ppWinner = pp?.winner ?? cheaper;
  const cpiWinner = cheaper;

  const best_for: BestForItem[] = [
    {
      persona: 'Students',
      city: rentWinner,
      reason: housing
        ? `Lower housing / rent index (${housing.gapPct}% gap).`
        : `Lower overall CPI when rent index is unavailable.`,
    },
    {
      persona: 'Families',
      city: rentWinner,
      reason: housing
        ? `Housing is typically the largest household line; rent index favors ${rentWinner}${pp ? `; purchasing power favors ${ppWinner}` : ''}.`
        : `CPI favors ${cpiWinner} when rent data is incomplete.`,
    },
    {
      persona: 'Remote Workers',
      city: cpiWinner,
      reason: `Everyday cost index (CPI) favors ${cpiWinner} (~${costDifferencePct}% gap).`,
    },
    {
      persona: 'Budget Living',
      city: cpiWinner,
      reason: `Lowest overall consumer-price index in this pair.`,
    },
  ];

  const key_takeaways: string[] = [];
  key_takeaways.push(
    `${cheaper} is the overall cost winner on CPI (~${costDifferencePct}% lower everyday-cost index than ${dearer}).`
  );
  if (housing) {
    key_takeaways.push(`Housing: ${housing.winner} leads on rent index (${housing.gapPct}% gap).`);
  }
  if (food) {
    key_takeaways.push(`Food / groceries: ${food.winner} is lower (${food.gapPct}% gap).`);
  }
  if (pp) {
    key_takeaways.push(`Purchasing power: ${pp.winner} scores higher (${pp.gapPct}% gap).`);
  }
  if (biggest && biggest.category !== 'Housing' && biggest.category !== 'Food') {
    key_takeaways.push(
      `Largest category gap: ${biggest.category} (${biggest.gapPct}%), favoring ${biggest.winner}.`
    );
  }
  if (monthly.mode === 'basket' && monthly.amountUsd != null) {
    key_takeaways.push(
      `Sample monthly basket (1BR + utilities + internet) is ~$${monthly.amountUsd.toLocaleString('en-US')} cheaper in ${monthly.cheaperCity}.`
    );
  } else {
    key_takeaways.push(monthly.summary);
  }

  // Deduplicate and cap 3–6
  const seen = new Set<string>();
  const takeaways = key_takeaways.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  }).slice(0, 6);

  while (takeaways.length < 3 && overallCpi) {
    takeaways.push(`Compare full price baskets below — category winners can diverge from headline CPI.`);
    break;
  }

  // Prefer listing richer category set: include Overall CPI in winners table for consumers
  const winnersForDisplay = [...category_winners];
  if (overallCpi && !winnersForDisplay.some((w) => w.category === 'Overall CPI')) {
    winnersForDisplay.unshift(overallCpi);
  }

  return {
    overall_winner,
    monthly,
    category_winners: winnersForDisplay,
    biggest_difference: biggest,
    best_for,
    key_takeaways: takeaways.slice(0, 6),
  };
}
