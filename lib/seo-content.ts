/**
 * SEO content uniqueness helpers — deterministic, page-specific copy.
 * Prevents duplicate titles/descriptions/FAQs/summaries across the index.
 */

import type { EligibleCity } from './seo-eligibility.js';

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(seed: number, options: T[]): T {
  return options[seed % options.length];
}

export function uniqueCityTitle(city: string, country: string, state?: string): string {
  const loc = state ? `${city}, ${state}` : city;
  const seed = hashSeed(`${loc}|${country}|title`);
  const variants = [
    `Cost of Living in ${loc}, ${country} (2026) — Rent, Salary & Prices | CityCost Global`,
    `${loc} Cost of Living Guide (${country}, 2026) | CityCost Global`,
    `Living Costs in ${loc}, ${country}: Rent, Groceries & Salary | CityCost Global`,
    `${city} ${country} Cost of Living Index 2026 | CityCost Global`,
  ];
  return pick(seed, variants);
}

export function uniqueCityDescription(
  city: string,
  country: string,
  opts: { rent: number; salary: number; cpi: number; symbol: string; currency: string; state?: string }
): string {
  const loc = opts.state ? `${city}, ${opts.state}` : city;
  const seed = hashSeed(`${loc}|${country}|desc|${opts.cpi}|${opts.rent}`);
  const variants = [
    `Explore the cost of living in ${loc}, ${country}. Typical 1BR rent ${opts.symbol}${Math.round(opts.rent).toLocaleString()} ${opts.currency}, net salary ~${opts.symbol}${Math.round(opts.salary).toLocaleString()}, CPI ${opts.cpi} (NYC=100). Compare nearby cities and plan relocation budgets.`,
    `${loc} living costs explained: housing, groceries, transport, utilities, and restaurants in ${opts.currency}. CPI ${opts.cpi}. Side-by-side city comparisons for movers, students, and remote workers.`,
    `How expensive is ${city}? Cost-of-living snapshot for ${loc}, ${country} with rent, salary, and price basket context — plus FAQs and related comparisons.`,
  ];
  return pick(seed, variants);
}

export function uniqueCitySummary(
  city: EligibleCity,
  opts: { cpi: number; rent: number; salary: number; pp: number; symbol: string; currency: string; note: string; source: string }
): string {
  const seed = hashSeed(`${city.pageSlug}|summary|${opts.cpi}|${opts.rent}`);
  const loc = city.state ? `${city.city}, ${city.state}` : city.city;
  const openings = [
    `${loc} in ${city.country} presents a distinct cost profile for households and relocators.`,
    `For anyone evaluating ${city.city} against peer markets, local prices and purchasing power matter as much as headline salaries.`,
    `${city.city}'s living-cost picture blends housing pressure, everyday basket prices, and wage levels in ${opts.currency}.`,
  ];
  const middles = [
    `Current reference CPI is ${opts.cpi} (NYC=100), with 1-bedroom centre rent near ${opts.symbol}${Math.round(opts.rent).toLocaleString()} and average net salary around ${opts.symbol}${Math.round(opts.salary).toLocaleString()}.`,
    `Indexed CPI sits at ${opts.cpi}, while typical city-centre rent is about ${opts.symbol}${Math.round(opts.rent).toLocaleString()} ${opts.currency} and net pay averages ${opts.symbol}${Math.round(opts.salary).toLocaleString()}.`,
  ];
  const closings = [
    `Local purchasing power index is ${opts.pp}. Data confidence reflects ${opts.source}. ${opts.note}`,
    `Purchasing power scores ${opts.pp} on our index. Source: ${opts.source}. ${opts.note}`,
  ];
  return `${pick(seed, openings)} ${pick(seed >> 3, middles)} ${pick(seed >> 7, closings)}`.trim();
}

export function uniqueCityFaqs(
  city: EligibleCity,
  opts: {
    cpi: number;
    rentIdx: number;
    rent: number;
    salary: number;
    symbol: string;
    currency: string;
    source: string;
    nearby: string[];
  }
): Array<{ q: string; a: string }> {
  const seed = hashSeed(`${city.pageSlug}|faq`);
  const loc = city.state ? `${city.city}, ${city.state}` : city.city;
  const nearbyLine = opts.nearby.length
    ? `Nearby indexed options include ${opts.nearby.slice(0, 3).join(', ')}.`
    : `Use the comparator to benchmark ${city.city} against any other city.`;

  const sets: Array<Array<{ q: string; a: string }>> = [
    [
      {
        q: `Is ${city.city} expensive to live in?`,
        a: `${loc} has a CPI of ${opts.cpi} (NYC=100) and rent index ${opts.rentIdx}. Whether it feels expensive depends on your income; average net salary is about ${opts.symbol}${Math.round(opts.salary).toLocaleString()} ${opts.currency}.`,
      },
      {
        q: `What is average rent in ${city.city}?`,
        a: `A reference 1-bedroom apartment in the city centre averages about ${opts.symbol}${Math.round(opts.rent).toLocaleString()} ${opts.currency} per month.`,
      },
      {
        q: `What currency is used in ${city.city}?`,
        a: `${city.city}, ${city.country} prices are shown in ${opts.currency}.`,
      },
      {
        q: `How reliable is cost data for ${city.city}?`,
        a: `This page uses ${opts.source}. Confidence varies by whether surveyed baskets, nearby references, or regional models underpin the estimate.`,
      },
      {
        q: `Which cities near ${city.city} should I compare?`,
        a: nearbyLine,
      },
    ],
    [
      {
        q: `What does it cost to live in ${loc}?`,
        a: `Expect a CPI near ${opts.cpi} with housing often the largest monthly line item at roughly ${opts.symbol}${Math.round(opts.rent).toLocaleString()} for a central 1BR.`,
      },
      {
        q: `How much do people earn in ${city.city}?`,
        a: `Average monthly net salary (after tax) is approximately ${opts.symbol}${Math.round(opts.salary).toLocaleString()} ${opts.currency} in our reference basket.`,
      },
      {
        q: `Is ${city.city} good for remote workers?`,
        a: `Remote workers should weigh rent (${opts.symbol}${Math.round(opts.rent).toLocaleString()}) against connectivity and lifestyle costs. Compare purchasing power with your income city before moving.`,
      },
      {
        q: `Does ${city.city} use ${opts.currency}?`,
        a: `Yes — cost figures for ${city.city}, ${city.country} are denominated in ${opts.currency}.`,
      },
      {
        q: `Where can I compare ${city.city} side by side?`,
        a: `${nearbyLine} Open any comparison route for charts, baskets, and AI analysis.`,
      },
    ],
  ];
  return pick(seed, sets);
}

export function uniqueCountrySummary(
  name: string,
  opts: { cities: number; currency: string; cpi: number; rent: number; salary: number; symbol: string; cheap: string; expensive: string }
): string {
  const seed = hashSeed(`${name}|country|${opts.cpi}|${opts.cities}`);
  const variants = [
    `${name} cost-of-living overview covers ${opts.cities} indexed cities in ${opts.currency}. Average CPI ~${opts.cpi} (NYC=100), typical net salary ~${opts.symbol}${opts.salary.toLocaleString()}, and average 1BR centre rent ~${opts.symbol}${opts.rent.toLocaleString()}. ${opts.cheap} tends to sit on the more affordable end of this set, while ${opts.expensive} is toward the higher housing/cost tier.`,
    `Across ${opts.cities} SEO-indexed markets in ${name}, the blended CPI is about ${opts.cpi}. Household budgets often hinge on rent (avg ${opts.symbol}${opts.rent.toLocaleString()}) versus wages (avg ${opts.symbol}${opts.salary.toLocaleString()} ${opts.currency}). Compare ${opts.cheap} and ${opts.expensive} for a quick affordability spread.`,
  ];
  return pick(seed, variants);
}

export function uniqueCountryFaqs(
  name: string,
  opts: { currency: string; symbol: string; cpi: number; rent: number; cheap: string; expensive: string }
): Array<{ q: string; a: string }> {
  return [
    {
      q: `What is the average cost of living in ${name}?`,
      a: `Among indexed cities in ${name}, average CPI (excl. rent) is about ${opts.cpi} (NYC=100). Average 1-bedroom city-centre rent is roughly ${opts.symbol}${opts.rent.toLocaleString()} ${opts.currency}.`,
    },
    {
      q: `Which is the cheapest indexed city in ${name}?`,
      a: `In the current index, ${opts.cheap} ranks among the lowest 1BR city-centre rents.`,
    },
    {
      q: `Which is the most expensive indexed city in ${name}?`,
      a: `${opts.expensive} tends to show higher housing costs within this ${name} set.`,
    },
    {
      q: `What currency is used in ${name}?`,
      a: `${name} costs are presented in ${opts.currency} (${opts.symbol.trim()}).`,
    },
    {
      q: `How do I compare cities inside ${name}?`,
      a: `Open city pages or run a side-by-side comparison for rent, groceries, transport, utilities, salary, and purchasing power.`,
    },
  ];
}

export interface CompareSeoEnrichment {
  executive_summary: string;
  winner_summary: string;
  detailed_analysis: string;
  category_winners: Array<{ category: string; winner: string; note: string; gapPct?: number }>;
  budget_comparison: string;
  monthly_savings: string;
  cost_difference_pct: number;
  who_should_move: string;
  who_should_not_move: string;
  students: string;
  families: string;
  retirees: string;
  remote_workers: string;
  professionals: string;
  student_perspective: string;
  family_perspective: string;
  remote_worker_perspective: string;
  retirement_perspective: string;
  pros: { cityA: string[]; cityB: string[] };
  cons: { cityA: string[]; cityB: string[] };
  faqs: Array<{ q: string; a: string }>;
  internal_link_hints: Array<{ label: string; href: string }>;
  /** Additive structured decision fields */
  overall_winner?: { city: string; reason: string; costDifferencePct: number };
  monthly_difference?: {
    amountUsd: number | null;
    pct: number;
    cheaperCity: string;
    dearerCity: string;
    mode: 'basket' | 'cpi';
    summary: string;
  };
  biggest_difference?: { category: string; winner: string; gapPct: number; note: string } | null;
  best_for?: Array<{ persona: string; city: string; reason: string }>;
  key_takeaways?: string[];
}

export function buildCompareEnrichment(
  cityA: string,
  cityB: string,
  data?: { cpiA?: number; cpiB?: number; rentA?: number; rentB?: number; ppA?: number; ppB?: number }
): CompareSeoEnrichment {
  const a = cityA.split(',')[0].trim();
  const b = cityB.split(',')[0].trim();
  const cpiA = data?.cpiA ?? 50;
  const cpiB = data?.cpiB ?? 50;
  const rentA = data?.rentA ?? 50;
  const rentB = data?.rentB ?? 50;
  const ppA = data?.ppA ?? 50;
  const ppB = data?.ppB ?? 50;

  const cheaper = cpiA <= cpiB ? a : b;
  const dearer = cpiA <= cpiB ? b : a;
  const diff = Math.abs(((cpiB - cpiA) / Math.max(cpiA, 1)) * 100);
  const rentWinner = rentA <= rentB ? a : b;
  const ppWinner = ppA >= ppB ? a : b;
  const seed = hashSeed(`${a}|${b}|${cpiA}|${cpiB}|enrich-v2`);

  const winner_summary = pick(seed, [
    `${cheaper} leads on overall consumer prices, with a CPI gap near ${diff.toFixed(0)}% versus ${dearer} in this pairing.`,
    `Everyday costs favor ${cheaper} over ${dearer} by roughly ${diff.toFixed(0)}% on the CPI lens used here.`,
  ]);

  const executive_summary = pick(seed >> 2, [
    `Executive takeaway: ${cheaper} is the lower everyday-cost market, ${rentWinner} wins on rent index, and ${ppWinner} offers stronger local purchasing power. Relocators should still validate neighbourhood rents and visa constraints before committing.`,
    `Headline: choose ${cheaper} to stretch a fixed budget, ${rentWinner} if housing is the binding constraint, and weigh ${ppWinner} when local wages fund local prices.`,
  ]);

  const detailed_analysis = pick(seed >> 4, [
    `Detailed analysis of ${a} vs ${b}: CPI sits at ${cpiA} vs ${cpiB} (NYC=100), rent indices at ${rentA} vs ${rentB}, and purchasing power at ${ppA} vs ${ppB}. The ${diff.toFixed(0)}% CPI spread implies different grocery, dining, and service burdens even before housing. Cross-check transport passes and utilities in the full basket, because category winners can diverge from the headline CPI.`,
    `${a} and ${b} diverge where wages and shelter meet. With CPI ${cpiA}/${cpiB} and rent ${rentA}/${rentB}, a household earning a typical local salary will feel purchasing power skew toward ${ppWinner}. Treat CBD averages as ceilings in hot markets and floors in softer suburbs.`,
  ]);

  const students = pick(seed >> 5, [
    `Students comparing ${a} and ${b} should prioritize ${rentWinner} for housing load, then map campus-to-neighbourhood transport. Shared flats can erase city-wide rent gaps; meal plans and part-time wages matter as much as CPI.`,
  ]);
  const families = pick(seed >> 6, [
    `Families should stress-test schooling, healthcare access, and 2–3BR rents—not only 1BR CBD figures. Purchasing power currently leans ${ppWinner}, but commute times can erase savings.`,
  ]);
  const retirees = pick(seed >> 7, [
    `Retirees on fixed income usually prefer ${cheaper}, unless healthcare networks or climate make ${dearer} worth the premium.`,
  ]);
  const remote_workers = pick(seed >> 8, [
    `Remote workers can arbitrage by living in ${cheaper} while billing higher-wage markets—if visas, banking, and fibre are solid. Coworking density often favors larger hubs even when CPI is higher.`,
  ]);
  const professionals = pick(seed >> 9, [
    `Career professionals should weight industry clusters and after-tax pay over raw CPI. ${dearer} may still win if compensation and mobility outweigh living costs.`,
  ]);

  const slugA = a.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const slugB = b.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  return {
    executive_summary,
    winner_summary,
    detailed_analysis,
    category_winners: [
      { category: 'Overall CPI', winner: cheaper, note: 'Lower everyday cost index.' },
      { category: 'Rent', winner: rentWinner, note: 'Lower rent index between the two cities.' },
      { category: 'Purchasing power', winner: ppWinner, note: 'Higher local purchasing power on an average salary.' },
    ],
    budget_comparison: pick(seed >> 10, [
      `Budget lens: everyday basket pressure is lighter in ${cheaper}; shelter pressure is lighter in ${rentWinner}; wage stretch favors ${ppWinner}. Model a three-line budget (rent, food+transit, discretionary) before choosing.`,
      `Monthly budget planning between ${a} and ${b} should start with rent (${rentWinner} advantage), then groceries/dining (aligned with ${cheaper}), then salary reality (${ppWinner}).`,
    ]),
    monthly_savings: pick(seed >> 11, [
      `Moving toward ${cheaper} can free cash on day-to-day spend; housing savings materialize mainly when your unit tracks ${rentWinner}'s rent index rather than a luxury micro-market.`,
      `Estimated lifestyle savings skew to ${cheaper} on CPI, with housing upside concentrated in ${rentWinner}. Exact monthly savings depend on household size and neighbourhood.`,
    ]),
    cost_difference_pct: Math.round(diff),
    who_should_move: `Consider ${cheaper} if you prioritize stretching a fixed salary and predictable everyday costs versus ${dearer}.`,
    who_should_not_move: `Prefer ${dearer} if your income, industry, or support network is anchored there and already funds the premium.`,
    students,
    families,
    retirees,
    remote_workers,
    professionals,
    student_perspective: students,
    family_perspective: families,
    remote_worker_perspective: remote_workers,
    retirement_perspective: retirees,
    pros: {
      cityA: [
        cpiA <= cpiB ? `${a}: lower overall CPI in this pairing` : `${a}: deeper amenities / market premium`,
        ppA >= ppB ? `${a}: stronger local purchasing power` : `${a}: may suit high earners already based here`,
        rentA <= rentB ? `${a}: lower rent index` : `${a}: housing trade-off for location prestige`,
      ],
      cityB: [
        cpiB <= cpiA ? `${b}: lower overall CPI in this pairing` : `${b}: deeper amenities / market premium`,
        ppB >= ppA ? `${b}: stronger local purchasing power` : `${b}: may suit high earners already based here`,
        rentB <= rentA ? `${b}: lower rent index` : `${b}: housing trade-off for location prestige`,
      ],
    },
    cons: {
      cityA: [
        cpiA > cpiB ? `${a}: higher everyday costs versus ${b}` : `${a}: possibly thinner premium career clusters`,
        rentA > rentB ? `${a}: higher rent index` : `${a}: bargains may sit outside preferred districts`,
      ],
      cityB: [
        cpiB > cpiA ? `${b}: higher everyday costs versus ${a}` : `${b}: possibly thinner premium career clusters`,
        rentB > rentA ? `${b}: higher rent index` : `${b}: bargains may sit outside preferred districts`,
      ],
    },
    faqs: [
      {
        q: `Is it cheaper to live in ${a} or ${b}?`,
        a: `On CPI, ${cheaper} is cheaper than ${dearer} by roughly ${diff.toFixed(0)}% in this comparison.`,
      },
      {
        q: `Which city has lower rent, ${a} or ${b}?`,
        a: `${rentWinner} has the lower rent index between the two.`,
      },
      {
        q: `Which city has better purchasing power for professionals?`,
        a: `${ppWinner} shows higher local purchasing power; professionals should still compare after-tax offers.`,
      },
      {
        q: `Should a remote worker choose ${a} or ${b}?`,
        a: remote_workers,
      },
      {
        q: `Is ${a} or ${b} better for families and students?`,
        a: `Families: lean on schooling and 2–3BR rents (purchasing power favors ${ppWinner}). Students: housing index favors ${rentWinner}.`,
      },
      {
        q: `How large is the cost gap between ${a} and ${b}?`,
        a: `The CPI gap is about ${diff.toFixed(0)}%. Housing and wages can widen or shrink the effective monthly difference.`,
      },
    ],
    internal_link_hints: [
      { label: `${a} cost of living`, href: `/compare/${slugA}-vs-${slugB}` },
      { label: `${a} vs ${b} overview`, href: `/compare/${slugA}-vs-${slugB}` },
    ],
  };
}

export interface CitySeoSections {
  living_overview: string;
  economy: string;
  housing: string;
  transportation: string;
  utilities: string;
  lifestyle: string;
  climate: string;
  pros: string[];
  cons: string[];
  ai_insights: string;
}

export function buildCitySeoSections(
  city: EligibleCity,
  opts: {
    cpi: number;
    rent: number;
    salary: number;
    pp: number;
    transport: number;
    utilities: number;
    groceries: number;
    restaurants: number;
    symbol: string;
    currency: string;
    source: string;
    nearby: string[];
  }
): CitySeoSections {
  const seed = hashSeed(`${city.pageSlug}|sections|${opts.cpi}|${opts.rent}|${opts.salary}`);
  const loc = city.state ? `${city.city}, ${city.state}` : city.city;
  const pop = city.population ? `${city.population.toLocaleString()} residents (estimate)` : 'a population that varies by metro definition';

  const living_overview = pick(seed, [
    `${loc} is a ${city.country} market where everyday living costs, housing, and wages interact tightly. With roughly ${pop}, relocators should treat CBD averages as a starting point and adjust for neighbourhood micro-markets.`,
    `Living in ${city.city} means balancing a CPI of ${opts.cpi} (NYC=100) against local salaries near ${opts.symbol}${Math.round(opts.salary).toLocaleString()} ${opts.currency}. ${loc} rewards shoppers who compare districts, not just city-wide indexes.`,
  ]);

  const economy = pick(seed >> 2, [
    `Economically, ${city.city} reflects ${city.country}'s broader wage and service-price structure. Net pay around ${opts.symbol}${Math.round(opts.salary).toLocaleString()} and purchasing power ${opts.pp} frame how far income stretches after rent.`,
    `${city.city}'s cost-to-income relationship is captured by salary ~${opts.symbol}${Math.round(opts.salary).toLocaleString()} ${opts.currency} versus CPI ${opts.cpi}. Sectors concentrated in the metro can pull wages above or below this reference.`,
  ]);

  const housing = pick(seed >> 3, [
    `Housing is usually the largest line item: a reference 1BR city-centre lease is about ${opts.symbol}${Math.round(opts.rent).toLocaleString()} ${opts.currency}. Suburban or older stock can undercut that figure substantially.`,
    `Expect centre-city rents near ${opts.symbol}${Math.round(opts.rent).toLocaleString()} ${opts.currency} for a 1BR benchmark. Families should model 2–3BR premiums and deposit norms separately from the headline number.`,
  ]);

  const transportation = pick(seed >> 4, [
    `Local transport tickets average about ${opts.symbol}${opts.transport.toLocaleString()} ${opts.currency} one-way in our basket. Commuters should compare monthly passes and ride-hail density against owning a car.`,
    `Getting around ${city.city} hinges on transit coverage versus car dependence. A one-way local ticket near ${opts.symbol}${opts.transport.toLocaleString()} ${opts.currency} is only a proxy—peak congestion and last-mile gaps matter.`,
  ]);

  const utilities = pick(seed >> 5, [
    `Basic utilities for an 85m² flat run near ${opts.symbol}${Math.round(opts.utilities).toLocaleString()} ${opts.currency} in the reference basket, before internet and mobile plans.`,
    `Utility budgets in ${loc} often land around ${opts.symbol}${Math.round(opts.utilities).toLocaleString()} ${opts.currency} for a mid-size apartment; climate-driven heating or cooling can swing seasonal bills.`,
  ]);

  const lifestyle = pick(seed >> 6, [
    `Lifestyle costs show up in groceries (sample milk ~${opts.symbol}${opts.groceries.toLocaleString()}) and casual dining (~${opts.symbol}${opts.restaurants.toLocaleString()} for an inexpensive meal). Nightlife and international schooling sit well above these anchors.`,
    `${city.city} day-to-day living mixes market groceries and restaurant meals that track local CPI more than tourist menus. Build a personal basket before trusting a single index.`,
  ]);

  const climate = city.latitude != null
    ? pick(seed >> 7, [
        `Climate context: ${city.city} sits near latitude ${city.latitude.toFixed(1)}°, so seasonal heating or cooling needs can quietly reshape utility spend beyond the annual average.`,
        `At roughly ${city.latitude.toFixed(1)}° latitude, ${city.city}'s seasons influence clothing, energy, and outdoor lifestyle costs—factor this when comparing with equatorial or continental peers.`,
      ])
    : pick(seed >> 7, [
        `Climate specifics vary across ${city.country}; check regional normals for heating/cooling weeks that affect utilities and clothing budgets.`,
        `Without a single climate station for every neighbourhood, treat energy seasonality as a planning buffer when budgeting for ${city.city}.`,
      ]);

  const pros = [
    pick(seed >> 8, [`Purchasing power index around ${opts.pp}`, `Clear ${opts.currency} pricing for budget planning`]),
    pick(seed >> 9, [`Documented rent benchmark (${opts.symbol}${Math.round(opts.rent).toLocaleString()})`, `Comparable CPI (${opts.cpi}) against global peers`]),
    opts.nearby.length
      ? `Nearby indexed cities (${opts.nearby.slice(0, 3).join(', ')}) for side-by-side checks`
      : `Works well as a base city in the global comparator`,
  ];

  const cons = [
    pick(seed >> 10, [`Centre rents can outpace suburban reality`, `City-wide averages hide neighbourhood spikes`]),
    pick(seed >> 11, [`Tourist districts inflate dining and transport samples`, `Data confidence depends on ${opts.source}`]),
    opts.cpi > 60
      ? `Relatively elevated CPI versus many emerging markets`
      : `Lower absolute prices may pair with thinner global flight connectivity`,
  ];

  const ai_insights = pick(seed >> 12, [
    `AI insight: ${loc} is best evaluated as rent-to-wage fit first, CPI second. If your income is foreign-denominated, ${city.city}'s lower local prices can unlock lifestyle upside—if visa and healthcare access hold. Source: ${opts.source}.`,
    `AI insight: Treat ${city.city}'s ${opts.symbol}${Math.round(opts.rent).toLocaleString()} rent and ${opts.symbol}${Math.round(opts.salary).toLocaleString()} salary as a ratio problem. Households above that ratio can absorb lifestyle premiums; those below should target outer districts or peer cities. ${opts.source}.`,
  ]);

  return {
    living_overview,
    economy,
    housing,
    transportation,
    utilities,
    lifestyle,
    climate,
    pros,
    cons,
    ai_insights,
  };
}

export function uniqueCountrySummaryEmpty(name: string, currency: string): string {
  const seed = hashSeed(`${name}|empty|${currency}`);
  return pick(seed, [
    `${name} is included in the CityCost country index with currency ${currency}. Indexed city coverage expands as eligible metros clear quality gates—use the comparator to benchmark any city pair while country-level aggregates deepen.`,
    `Cost-of-living coverage for ${name} (${currency}) starts at the country layer: currency, FAQ, and related markets. As high-quality city pages qualify, rankings for cheapest/most expensive metros appear automatically.`,
  ]);
}

export function uniqueCountryFaqsEmpty(name: string, currency: string): Array<{ q: string; a: string }> {
  return [
    {
      q: `What currency is used in ${name}?`,
      a: `${name} costs are typically expressed in ${currency}.`,
    },
    {
      q: `Does CityCost have city pages for ${name}?`,
      a: `City pages appear when locations pass the SEO eligibility engine (verified data, capitals, major metros, and other quality signals)—not every settlement is indexed.`,
    },
    {
      q: `How can I compare living costs related to ${name}?`,
      a: `Use the homepage comparator with any city in ${name} or abroad. Country pages link to eligible cities and popular comparisons as coverage grows.`,
    },
    {
      q: `Is ${name} expensive overall?`,
      a: `National averages hide large city-to-city spreads. Compare specific metros rather than relying on a single country headline.`,
    },
    {
      q: `Where should I start researching a move to ${name}?`,
      a: `Start with currency (${currency}), shortlist target cities, then run side-by-side rent, grocery, and salary comparisons.`,
    },
  ];
}
