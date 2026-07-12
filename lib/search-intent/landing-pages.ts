/**
 * Landing page composers — template content from city/country metrics only.
 * Does not call Content Intelligence Engine.
 */

import type {
  IntentLandingPublic,
  CityLandingKind,
  CategoryHubId,
  CountryGuideKind,
} from './types.js';
import { cityLandingPath, categoryHubPath, countryGuidePath } from './intent.js';
import { KIND_LABEL } from './clusters.js';
import { buildCityLandingGraph, buildCategoryHubGraph, buildCountryGuideGraph } from './related.js';
import { buildCityLandingKeywords } from './keywords.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(symbol: string, n?: number) {
  if (n == null || !Number.isFinite(n)) return null;
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

export function composeCityLanding(input: {
  kind: CityLandingKind;
  city: string;
  state?: string;
  country: string;
  countrySlug: string;
  pageSlug: string;
  currency: string;
  symbol: string;
  rent_1br?: number;
  salary?: number;
  cpi?: number;
  confidence_label?: string;
  data_source?: string;
  eligibleKinds: CityLandingKind[];
  nearby: Array<{ city: string; slug: string }>;
  comparisons: Array<{ label: string; slug: string }>;
  linkPriority?: Map<string, number>;
}): IntentLandingPublic {
  const path = cityLandingPath(input.kind, input.pageSlug);
  const rent = fmt(input.symbol, input.rent_1br);
  const salary = fmt(input.symbol, input.salary);
  const cpi = input.cpi != null ? String(input.cpi) : null;
  const label = KIND_LABEL[input.kind];
  const kw = buildCityLandingKeywords(input.kind, input.city, input.country);
  // kw kept internal — only use related_questions for public FAQs

  const focusParas: Record<CityLandingKind, string[]> = {
    'living-in': [
      `This guide covers the cost of living in ${input.city}, ${input.country} using CityCost indices and sample prices.`,
      cpi ? `Overall CPI on record is ${cpi} (NYC=100).` : `Review rent and salary samples below for budgeting.`,
      rent ? `A reference 1BR city-centre rent is about ${rent} per month.` : '',
      salary ? `Average net salary on record is about ${salary}.` : '',
    ].filter(Boolean),
    rent: [
      `Rent-focused overview for ${input.city}.`,
      rent
        ? `Reference 1-bedroom city-centre rent averages about ${rent} per month.`
        : `A verified centre rent sample is not available — this page is not indexed without rent data.`,
      `Neighbourhoods can diverge from the centre reference; validate local listings before relocating.`,
    ],
    salary: [
      `Salary and purchasing-power framing for ${input.city}.`,
      salary ? `Average monthly net salary (after tax) is about ${salary}.` : `Salary sample unavailable.`,
      rent && salary ? `Stress-test housing by comparing ${rent} rent against ${salary} net pay.` : '',
    ].filter(Boolean),
    students: [
      `${input.city} for students — housing and daily costs matter most.`,
      rent ? `Centre 1BR reference ~${rent}; shared housing is often lower.` : 'Verify campus-area rents locally.',
      `Open the rent and living-in guides in this cluster for deeper numbers.`,
    ],
    families: [
      `Family cost framing for ${input.city} uses rent, groceries, and salary anchors.`,
      rent ? `Housing is usually the largest line item (1BR centre ~${rent}).` : '',
      `Schooling and healthcare are not invented here — verify those separately.`,
    ].filter(Boolean),
    'remote-work': [
      `Remote-work cost lens for ${input.city}: CPI${cpi ? ` ${cpi}` : ''}, rent, and lifestyle spend.`,
      `Visas and connectivity are not verified on this page.`,
      rent ? `Housing reference ~${rent}.` : '',
    ].filter(Boolean),
    retirement: [
      `Retirement planning lens for ${input.city} on fixed or semi-fixed income.`,
      rent ? `Housing reference ~${rent}.` : '',
      salary ? `Local wage midpoint ${salary} is a labour-market signal, not a pension.` : '',
    ].filter(Boolean),
    'moving-to': [
      `Moving to ${input.city}? Start with rent, salary, and CPI before booking flights.`,
      rent ? `Budget for housing near ${rent} (centre 1BR reference).` : '',
      `Use comparison pages in this cluster to pressure-test alternatives.`,
    ].filter(Boolean),
    'digital-nomads': [
      `Digital-nomad cost snapshot for ${input.city}.`,
      cpi ? `CPI ${cpi} helps compare against other hubs.` : '',
      rent ? `Short-term housing often prices above the ${rent} long-lease reference.` : '',
    ].filter(Boolean),
  };

  const faqs = kw.related_questions.slice(0, 4).map((q) => ({
    q,
    a:
      rent || salary || cpi
        ? `Based on CityCost data for ${input.city}: ${[rent && `rent ~${rent}`, salary && `salary ~${salary}`, cpi && `CPI ${cpi}`]
            .filter(Boolean)
            .join('; ')}. See /methodology for how figures are produced.`
        : `Open the main city page for ${input.city} for available metrics.`,
  }));

  return {
    kind: 'city_landing',
    path,
    title: `${label} in ${input.city}, ${input.country} (2026) | CityCost Global`,
    h1: `${label} in ${input.city}`,
    description: `${label} guide for ${input.city}, ${input.country}: costs, context, and links to related CityCost pages.`,
    intro: `Search-intent guide for ${input.city} — part of the ${input.city} topical cluster on CityCost Global.`,
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        paragraphs: focusParas[input.kind],
      },
      {
        id: 'data',
        title: 'Verified signals on this page',
        paragraphs: [
          `Currency: ${input.currency}.`,
          input.data_source ? `Source: ${input.data_source}.` : '',
          input.confidence_label ? `Confidence: ${input.confidence_label}.` : '',
        ].filter(Boolean),
        bullets: [
          rent ? `1BR centre rent: ${rent}` : null,
          salary ? `Net salary: ${salary}` : null,
          cpi ? `CPI: ${cpi}` : null,
        ].filter(Boolean) as string[],
      },
      {
        id: 'cluster',
        title: 'Topic cluster',
        paragraphs: [
          `This page sits in the ${input.city} cluster with living-cost, rent, salary, audience, and moving guides. Use sibling links to stay on-intent without orphan pages.`,
        ],
      },
    ],
    faqs,
    ...(() => {
      const { graph, topic_silo } = buildCityLandingGraph({
        kind: input.kind,
        pageSlug: input.pageSlug,
        city: input.city,
        country: input.country,
        countrySlug: input.countrySlug,
        eligibleKinds: input.eligibleKinds,
        nearby: input.nearby,
        comparisons: input.comparisons,
        linkPriority: input.linkPriority,
      });
      return { graph, topic_silo };
    })(),
    city: {
      name: input.city,
      slug: input.pageSlug,
      country: input.country,
      countrySlug: input.countrySlug,
      currency: input.currency,
      symbol: input.symbol,
      rent_1br: input.rent_1br,
      salary: input.salary,
      cpi: input.cpi,
      confidence_label: input.confidence_label,
      data_source: input.data_source,
    },
    landing_kind: input.kind,
    last_updated: today(),
    indexable: true,
  };
}

export function composeCategoryHub(input: {
  id: CategoryHubId;
  cities: Array<{ city: string; slug: string; cpi: number; rent: number; country: string }>;
}): IntentLandingPublic {
  const path = categoryHubPath(input.id);
  const titles: Record<CategoryHubId, string> = {
    students: 'Best Cities for Students',
    families: 'Best Cities for Families',
    'remote-workers': 'Best Cities for Remote Workers',
    retirement: 'Best Cities for Retirement',
    'digital-nomads': 'Best Cities for Digital Nomads',
    'cheapest-cities': 'Cheapest Cities by Cost of Living',
    'most-expensive-cities': 'Most Expensive Cities by Cost of Living',
  };
  const sorted =
    input.id === 'most-expensive-cities'
      ? [...input.cities].sort((a, b) => b.cpi - a.cpi || b.rent - a.rent)
      : [...input.cities].sort((a, b) => a.cpi - b.cpi || a.rent - b.rent);

  const top = sorted.slice(0, 20);
  const cityLinks = top.map((c) => ({
    label: `${c.city} (${c.country})`,
    href: cityLandingPath(
      input.id === 'students'
        ? 'students'
        : input.id === 'families'
          ? 'families'
          : input.id === 'remote-workers'
            ? 'remote-work'
            : input.id === 'retirement'
              ? 'retirement'
              : input.id === 'digital-nomads'
                ? 'digital-nomads'
                : 'living-in',
      c.slug
    ),
    rel: 'child' as const,
  }));

  return {
    kind: 'category_hub',
    path,
    title: `${titles[input.id]} (2026) | CityCost Global`,
    h1: titles[input.id],
    description: `${titles[input.id]} — ranked from CityCost eligible cities with transparent cost signals.`,
    intro: `Audience and theme hub built from eligible indexed cities. Only cities with sufficient cost data appear.`,
    sections: [
      {
        id: 'best',
        title: 'Featured cities',
        paragraphs: [`Showing ${top.length} cities selected for this hub from the eligible index.`],
        bullets: top.slice(0, 12).map((c) => `${c.city}, ${c.country} — CPI ${c.cpi}`),
      },
      {
        id: 'how',
        title: 'How this list is built',
        paragraphs: [
          'Cities must already pass SEO eligibility and intent landing quality gates. Healthcare, education, and safety rankings are omitted unless verified datasets are attached.',
        ],
      },
    ],
    faqs: [
      {
        q: `How are cities chosen for ${titles[input.id]}?`,
        a: 'From the SEO-eligible city index, filtered by intent quality (rent/salary/CPI coverage) and ranked by cost signals appropriate to the hub.',
      },
    ],
    ...(() => {
      const { graph, topic_silo } = buildCategoryHubGraph(input.id, cityLinks);
      return { graph, topic_silo };
    })(),
    category: input.id,
    last_updated: today(),
    indexable: true,
  };
}

export function composeCountryGuide(input: {
  kind: CountryGuideKind;
  name: string;
  slug: string;
  code: string;
  cities: Array<{ city: string; slug: string; cpi: number; rent: number }>;
  comparisons: Array<{ label: string; slug: string }>;
  avg_cpi?: number | null;
}): IntentLandingPublic {
  const path = countryGuidePath(input.kind, input.slug);
  const titleMap: Record<CountryGuideKind, string> = {
    'living-in-country': `Living in ${input.name}`,
    'best-cities': `Best Cities in ${input.name}`,
    'student-cities': `Student Cities in ${input.name}`,
    'family-cities': `Family Cities in ${input.name}`,
    'retirement-cities': `Retirement Cities in ${input.name}`,
    'remote-work-cities': `Remote Work Cities in ${input.name}`,
  };
  const ranked = [...input.cities].sort((a, b) => a.cpi - b.cpi);

  return {
    kind: 'country_guide',
    path,
    title: `${titleMap[input.kind]} — Cost of Living (2026) | CityCost Global`,
    h1: titleMap[input.kind],
    description: `${titleMap[input.kind]} with cost-of-living context, city lists, and comparisons.`,
    intro: `Country hub guide for ${input.name}. Aggregates eligible cities only — not every settlement.`,
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        paragraphs: [
          `${input.cities.length} eligible cities currently feed this guide.`,
          input.avg_cpi != null ? `Average CPI across the sample: ${input.avg_cpi}.` : '',
        ].filter(Boolean),
      },
      {
        id: 'cities',
        title: 'Cities on this guide',
        paragraphs: ['Open living-in or city pages for full metrics.'],
        bullets: ranked.slice(0, 15).map((c) => `${c.city} — CPI ${c.cpi}`),
      },
    ],
    faqs: [
      {
        q: `How many cities are listed for ${input.name}?`,
        a: `${input.cities.length} eligible cities appear in this guide.`,
      },
    ],
    ...(() => {
      const { graph, topic_silo } = buildCountryGuideGraph({
        kind: input.kind,
        country: input.name,
        countrySlug: input.slug,
        cities: input.cities,
        comparisons: input.comparisons,
      });
      return { graph, topic_silo };
    })(),
    country: { name: input.name, slug: input.slug, code: input.code },
    guide_kind: input.kind,
    last_updated: today(),
    indexable: true,
  };
}
