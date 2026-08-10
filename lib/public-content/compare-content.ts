/**
 * Compare-page public content — live indices + optional enrichment.
 */

import type { CompareSeoEnrichment } from '../seo-content.js';
import type { FaqItem, ProseSection, TocItem } from './types.js';

export type CompareSide = {
  city: string;
  country?: string;
  currency?: string;
  symbol?: string;
  cpi: number;
  rent_index: number;
  groceries_index: number;
  restaurant_index: number;
  purchasing_power: number;
  rent_1br?: number;
  salary?: number;
  transport?: number;
  utilities?: number;
  groceries_sample?: number;
  restaurant_meal?: number;
};

export type CompareContentInput = {
  cityA: string;
  cityB: string;
  a: CompareSide;
  b: CompareSide;
  enrichment?: CompareSeoEnrichment | null;
  cityPages?: Array<{ label: string; href: string }>;
  countryPages?: Array<{ label: string; href: string }>;
};

function pctDiff(base: number, other: number): number {
  if (!base) return 0;
  return Math.round(Math.abs(((other - base) / base) * 100));
}

function cheaperBy(aVal: number, bVal: number, aName: string, bName: string): string {
  return aVal <= bVal ? aName : bName;
}

export function buildCompareToc(): TocItem[] {
  return [
    { id: 'compare-summary', label: 'Comparison summary' },
    { id: 'compare-housing', label: 'Housing' },
    { id: 'compare-food', label: 'Food' },
    { id: 'compare-transport', label: 'Transport' },
    { id: 'compare-healthcare', label: 'Healthcare' },
    { id: 'compare-salary', label: 'Salary' },
    { id: 'compare-pros', label: 'Pros' },
    { id: 'compare-cons', label: 'Cons' },
    { id: 'compare-recommendation', label: 'Recommendation' },
    { id: 'compare-faq', label: 'FAQ' },
    { id: 'compare-related', label: 'Related comparisons' },
  ];
}

export function buildCompareSummary(d: CompareContentInput): ProseSection {
  const { a, b, cityA, cityB, enrichment } = d;
  const cpiWinner = cheaperBy(a.cpi, b.cpi, cityA, cityB);
  const rentWinner = cheaperBy(a.rent_index, b.rent_index, cityA, cityB);
  const ppWinner = a.purchasing_power >= b.purchasing_power ? cityA : cityB;
  const gap = pctDiff(a.cpi, b.cpi);

  return {
    id: 'compare-summary',
    title: `${cityA} vs ${cityB}: comparison summary`,
    paragraphs: [
      enrichment?.executive_summary ||
        `Executive takeaway: everyday CPI favors ${cpiWinner} (gap ~${gap}%), rent index favors ${rentWinner}, and local purchasing power favors ${ppWinner}. Validate neighbourhood rents and visas before relocating.`,
      enrichment?.winner_summary ||
        `On CPI (NYC=100), ${cityA} sits at ${a.cpi} versus ${cityB} at ${b.cpi}. Rent indices are ${a.rent_index} vs ${b.rent_index}; purchasing power ${a.purchasing_power} vs ${b.purchasing_power}.`,
      enrichment?.detailed_analysis ||
        `Detailed lens: groceries ${a.groceries_index} vs ${b.groceries_index}, restaurants ${a.restaurant_index} vs ${b.restaurant_index}. Category winners can diverge from headline CPI—model housing and wages separately.`,
    ],
  };
}

export function buildCompareHousing(d: CompareContentInput): ProseSection {
  const { a, b, cityA, cityB } = d;
  const winner = cheaperBy(a.rent_index, b.rent_index, cityA, cityB);
  const gap = pctDiff(a.rent_index, b.rent_index);
  const rentA = a.rent_1br && a.symbol ? `${a.symbol}${Math.round(a.rent_1br).toLocaleString('en-US')}` : null;
  const rentB = b.rent_1br && b.symbol ? `${b.symbol}${Math.round(b.rent_1br).toLocaleString('en-US')}` : null;
  return {
    id: 'compare-housing',
    title: 'Housing comparison',
    paragraphs: [
      `Rent index: ${cityA} ${a.rent_index} vs ${cityB} ${b.rent_index} — ${winner} is lower by about ${gap}% on this lens.${
        rentA || rentB
          ? ` Sample centre 1BR: ${cityA} ${rentA || 'n/a'}${a.currency ? ` ${a.currency}` : ''} · ${cityB} ${rentB || 'n/a'}${b.currency ? ` ${b.currency}` : ''}.`
          : ''
      }`,
      `Families should stress-test 2–3BR premiums; students should price shared flats. A cheaper suburb in the dearer city can beat a prestige district in the cheaper city.`,
    ],
  };
}

export function buildCompareFood(d: CompareContentInput): ProseSection {
  const { a, b, cityA, cityB } = d;
  const gWinner = cheaperBy(a.groceries_index, b.groceries_index, cityA, cityB);
  const rWinner = cheaperBy(a.restaurant_index, b.restaurant_index, cityA, cityB);
  return {
    id: 'compare-food',
    title: 'Food & groceries comparison',
    paragraphs: [
      `Groceries index: ${cityA} ${a.groceries_index} vs ${cityB} ${b.groceries_index} (${gWinner} lower). Restaurant index: ${a.restaurant_index} vs ${b.restaurant_index} (${rWinner} lower).`,
      `Home cooking usually tracks groceries; dining out tracks restaurant prices and tourist premiums. Build a personal basket before trusting a single index.`,
    ],
  };
}

export function buildCompareTransport(d: CompareContentInput): ProseSection {
  const { a, b, cityA, cityB } = d;
  const tA = a.transport && a.symbol ? `${a.symbol}${a.transport}` : null;
  const tB = b.transport && b.symbol ? `${b.symbol}${b.transport}` : null;
  return {
    id: 'compare-transport',
    title: 'Transport comparison',
    paragraphs: [
      `Local transport ticket samples: ${cityA} ${tA || 'see city page'} · ${cityB} ${tB || 'see city page'}. Pair transit with housing—long commutes erase rent savings.`,
      `Car-dependent metros add insurance, parking, and fuel outside the core basket. Prefer monthly pass quotes from local operators when commuting daily.`,
    ],
  };
}

export function buildCompareHealthcare(d: CompareContentInput): ProseSection {
  const { cityA, cityB, a, b } = d;
  return {
    id: 'compare-healthcare',
    title: 'Healthcare comparison',
    paragraphs: [
      `CityCost does not invent clinic or insurance quotes for ${cityA} vs ${cityB}. Use purchasing power (${a.purchasing_power} vs ${b.purchasing_power}) and salary samples as affordability context, then collect provider quotes for your status (citizen, expat, employer plan).`,
      `Retirees and families should treat healthcare as a separate decision axis from CPI. Public access rules differ by country even when everyday prices look similar.`,
    ],
  };
}

export function buildCompareSalary(d: CompareContentInput): ProseSection {
  const { a, b, cityA, cityB } = d;
  const ppWinner = a.purchasing_power >= b.purchasing_power ? cityA : cityB;
  const sA = a.salary && a.symbol ? `${a.symbol}${Math.round(a.salary).toLocaleString('en-US')}` : null;
  const sB = b.salary && b.symbol ? `${b.symbol}${Math.round(b.salary).toLocaleString('en-US')}` : null;
  return {
    id: 'compare-salary',
    title: 'Salary & purchasing power',
    paragraphs: [
      `Net salary samples: ${cityA} ${sA || 'n/a'} · ${cityB} ${sB || 'n/a'}. Local purchasing power favors ${ppWinner} (${a.purchasing_power} vs ${b.purchasing_power}).`,
      d.enrichment?.professionals ||
        `Career professionals should weight industry clusters and after-tax offers over raw CPI. Remote workers may arbitrage by living in the lower-CPI city while billing higher-wage markets—if visas allow.`,
    ],
  };
}

export function buildCompareProsCons(d: CompareContentInput): {
  pros: ProseSection;
  cons: ProseSection;
} {
  const { enrichment, cityA, cityB, a, b } = d;
  const prosA =
    enrichment?.pros?.cityA ||
    [
      a.cpi <= b.cpi ? `${cityA}: lower overall CPI` : `${cityA}: deeper premium-market amenities`,
      a.rent_index <= b.rent_index ? `${cityA}: lower rent index` : `${cityA}: housing trade-off for location`,
      a.purchasing_power >= b.purchasing_power
        ? `${cityA}: stronger local purchasing power`
        : `${cityA}: may suit high earners already based here`,
    ];
  const prosB =
    enrichment?.pros?.cityB ||
    [
      b.cpi <= a.cpi ? `${cityB}: lower overall CPI` : `${cityB}: deeper premium-market amenities`,
      b.rent_index <= a.rent_index ? `${cityB}: lower rent index` : `${cityB}: housing trade-off for location`,
      b.purchasing_power >= a.purchasing_power
        ? `${cityB}: stronger local purchasing power`
        : `${cityB}: may suit high earners already based here`,
    ];
  const consA =
    enrichment?.cons?.cityA ||
    [
      a.cpi > b.cpi ? `${cityA}: higher everyday costs vs ${cityB}` : `${cityA}: possibly thinner premium clusters`,
      a.rent_index > b.rent_index ? `${cityA}: higher rent index` : `${cityA}: bargains may sit outside preferred districts`,
    ];
  const consB =
    enrichment?.cons?.cityB ||
    [
      b.cpi > a.cpi ? `${cityB}: higher everyday costs vs ${cityA}` : `${cityB}: possibly thinner premium clusters`,
      b.rent_index > a.rent_index ? `${cityB}: higher rent index` : `${cityB}: bargains may sit outside preferred districts`,
    ];

  return {
    pros: {
      id: 'compare-pros',
      title: 'Pros',
      paragraphs: [`Strengths that stand out in this pairing:`],
      bullets: [...prosA, ...prosB],
    },
    cons: {
      id: 'compare-cons',
      title: 'Cons',
      paragraphs: [`Trade-offs to weigh before moving:`],
      bullets: [...consA, ...consB],
    },
  };
}

export function buildCompareRecommendation(d: CompareContentInput): ProseSection {
  const { enrichment, cityA, cityB, a, b } = d;
  const cheaper = cheaperBy(a.cpi, b.cpi, cityA, cityB);
  const dearer = cheaper === cityA ? cityB : cityA;
  return {
    id: 'compare-recommendation',
    title: 'Recommendation',
    paragraphs: [
      enrichment?.who_should_move ||
        `Consider ${cheaper} if you prioritize stretching a fixed salary and predictable everyday costs versus ${dearer}.`,
      enrichment?.who_should_not_move ||
        `Prefer ${dearer} if your income, industry, or support network is anchored there and already funds the premium.`,
      enrichment?.remote_workers ||
        `Remote workers: arbitrage toward ${cheaper} only when visas, banking, and connectivity are solid.`,
      enrichment?.families ||
        `Families: stress-test schooling and 2–3BR rents—not only 1BR CBD figures.`,
      enrichment?.budget_comparison ||
        `Budget lens: everyday basket pressure is lighter in ${cheaper}; re-check rent index and purchasing power before you commit.`,
    ],
  };
}

export function buildCompareFaqs(d: CompareContentInput): FaqItem[] {
  if (d.enrichment?.faqs?.length) return d.enrichment.faqs.slice(0, 12);
  const { cityA, cityB, a, b } = d;
  const cheaper = cheaperBy(a.cpi, b.cpi, cityA, cityB);
  const dearer = cheaper === cityA ? cityB : cityA;
  const gap = pctDiff(a.cpi, b.cpi);
  const rentWinner = cheaperBy(a.rent_index, b.rent_index, cityA, cityB);
  const ppWinner = a.purchasing_power >= b.purchasing_power ? cityA : cityB;
  return [
    {
      q: `Is it cheaper to live in ${cityA} or ${cityB}?`,
      a: `On CPI, ${cheaper} is cheaper than ${dearer} by roughly ${gap}% in this comparison.`,
    },
    {
      q: `Which city has lower rent, ${cityA} or ${cityB}?`,
      a: `${rentWinner} has the lower rent index (${Math.min(a.rent_index, b.rent_index)} vs ${Math.max(a.rent_index, b.rent_index)}).`,
    },
    {
      q: `Which city has better purchasing power?`,
      a: `${ppWinner} shows higher local purchasing power (${Math.max(a.purchasing_power, b.purchasing_power)} vs ${Math.min(a.purchasing_power, b.purchasing_power)}).`,
    },
    {
      q: `How do groceries compare between ${cityA} and ${cityB}?`,
      a: `Groceries index: ${cityA} ${a.groceries_index} vs ${cityB} ${b.groceries_index}.`,
    },
    {
      q: `Should a remote worker choose ${cityA} or ${cityB}?`,
      a: `Remote workers often prefer the lower-CPI side (${cheaper}) when income is foreign-denominated—confirm visas and connectivity first.`,
    },
    {
      q: `Is ${cityA} or ${cityB} better for families?`,
      a: `Families should prioritize 2–3BR rents, schooling, and healthcare access. Purchasing power currently favors ${ppWinner}.`,
    },
  ];
}
