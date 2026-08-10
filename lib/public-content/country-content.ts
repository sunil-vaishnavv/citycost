/**
 * Country-page public content — data-aware sections unique per country.
 */

import type { FaqItem, ProseSection, TocItem } from './types.js';

export type CountryContentInput = {
  name: string;
  slug: string;
  currency: string;
  symbol: string;
  population: number;
  avg_salary: number;
  avg_rent: number;
  avg_cpi: number;
  avg_groceries_index: number;
  cheapest: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  expensive: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  cities: Array<{ city: string; state?: string; slug: string; cpi: number; rent: number }>;
  top_comparisons: Array<{ slug: string; label: string }>;
  most_compared_cities?: Array<{ city: string; slug: string; state?: string; compare_count: number }>;
  related_countries: Array<{ slug: string; name: string }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
};

function fmt(n: number, symbol: string) {
  if (!n || n <= 0) return null;
  return `${symbol}${Math.round(n).toLocaleString('en-US')}`;
}

export function buildCountryToc(d: CountryContentInput): TocItem[] {
  const items: TocItem[] = [
    { id: 'country-overview', label: 'Country overview' },
    { id: 'regional-differences', label: 'Regional differences' },
    { id: 'living-expenses', label: 'Living expenses' },
    { id: 'major-cities', label: 'Major cities' },
    { id: 'monthly-budgets', label: 'Monthly budget examples' },
  ];
  if (d.related_countries.length) items.push({ id: 'related-countries', label: 'Related countries' });
  if (d.top_comparisons.length) items.push({ id: 'related-comparisons', label: 'Comparisons' });
  items.push({ id: 'country-faq', label: 'FAQ' });
  items.push({ id: 'country-conclusion', label: 'Conclusion' });
  return items;
}

export function buildCountryIntro(d: CountryContentInput): string {
  const n = d.cities.length;
  return `Cost of living in ${d.name}: ${n} indexed ${n === 1 ? 'city' : 'cities'} in ${d.currency}, average CPI ~${d.avg_cpi} (NYC=100), typical 1BR centre rent ~${fmt(d.avg_rent, d.symbol) || 'varies'}, average net salary ~${fmt(d.avg_salary, d.symbol) || 'varies'}. Use city pages and comparisons below to see regional spreads—national averages hide large metro gaps.`;
}

export function buildCountryOverviewSection(d: CountryContentInput): ProseSection {
  return {
    id: 'country-overview',
    title: `${d.name} overview`,
    paragraphs: [
      d.summary,
      `${d.name} costs on CityCost are presented in ${d.currency} (${d.symbol.trim()}). Across ${d.cities.length} indexed markets, blended CPI is about ${d.avg_cpi}, groceries index ~${d.avg_groceries_index}, and average centre 1BR rent ~${fmt(d.avg_rent, d.symbol) || 'n/a'}. Population summed across indexed cities is a coverage signal (${d.population ? d.population.toLocaleString('en-US') : 'varies'}), not a census substitute.`,
      `Start here when you know the country but not the metro. Shortlist from cheapest vs expensive lists, open city pages for basket samples, then run side-by-side comparisons for your finalists.`,
    ],
  };
}

export function buildCountryRegionalSection(d: CountryContentInput): ProseSection {
  const cheap = d.cheapest[0];
  const dear = d.expensive[0];
  const paragraphs = [
    `Regional differences inside ${d.name} often exceed the gap between ${d.name} and a neighbouring country. Housing is the usual driver: the same national currency can buy a very different lifestyle in a secondary city versus a global hub.`,
  ];
  if (cheap && dear && cheap.slug !== dear.slug) {
    paragraphs.push(
      `In the current index, ${cheap.city} sits toward the more affordable end (1BR ~${fmt(cheap.rent, d.symbol)}, CPI ${cheap.cpi}), while ${dear.city} is toward the higher housing/cost tier (1BR ~${fmt(dear.rent, d.symbol)}, CPI ${dear.cpi}). Treat these as bookends—not every neighbourhood matches the city average.`
    );
  } else if (d.cities.length === 0) {
    paragraphs.push(
      `Indexed city coverage for ${d.name} is still growing. Use the calculator with any city name while country-level aggregates deepen, and check back as eligible metros clear quality gates.`
    );
  } else {
    paragraphs.push(
      `Compare multiple ${d.name} metros rather than relying on a single headline. Open the city list below and sort mentally by rent versus CPI before committing to a relocation shortlist.`
    );
  }
  if (d.most_compared_cities?.length) {
    paragraphs.push(
      `Most compared cities in this set include ${d.most_compared_cities
        .slice(0, 4)
        .map((c) => c.city)
        .join(', ')}—useful when you want pairs people already research.`
    );
  }
  return { id: 'regional-differences', title: 'Regional differences', paragraphs };
}

export function buildCountryLivingExpensesSection(d: CountryContentInput): ProseSection {
  return {
    id: 'living-expenses',
    title: 'Living expenses',
    paragraphs: [
      `Everyday living expenses in ${d.name} are best read through CPI (~${d.avg_cpi}), groceries index (~${d.avg_groceries_index}), and rent. Average net salary ~${fmt(d.avg_salary, d.symbol) || 'varies'} ${d.currency} frames how far local wages stretch after housing.`,
      `Utilities, transport, and dining samples appear on individual city pages. Healthcare premiums and international school fees are household-specific overlays—use salary and purchasing-power context from city pages, then collect local quotes. Currency risk matters for cross-border earners: freeze a planning FX scenario rather than chasing daily noise.`,
    ],
  };
}

export function buildCountryMajorCitiesSection(d: CountryContentInput): ProseSection {
  const names = d.cities
    .slice(0, 8)
    .map((c) => c.city)
    .join(', ');
  return {
    id: 'major-cities',
    title: `Major cities in ${d.name}`,
    paragraphs: [
      d.cities.length
        ? `${d.name} indexed coverage includes ${d.cities.length} ${d.cities.length === 1 ? 'city' : 'cities'}${names ? `: ${names}${d.cities.length > 8 ? ', and more' : ''}` : ''}. Each city page lists rent, salary, groceries, transport, utilities, and dining samples with confidence labels.`
        : `City pages for ${d.name} appear when locations pass SEO eligibility (verified data, capitals, major metros, and other quality signals).`,
      `Use cheapest/expensive lists as a first filter, then open city pages for basket detail. Cross-link to related countries when your decision is truly cross-border.`,
    ],
  };
}

export function buildCountryBudgetSection(d: CountryContentInput): ProseSection {
  const cheap = d.cheapest[0];
  const dear = d.expensive[0];
  const midRent = d.avg_rent;
  const bullets: string[] = [];
  if (cheap) {
    bullets.push(
      `Lean budget city example — ${cheap.city}: centre 1BR ~${fmt(cheap.rent, d.symbol)} ${d.currency}, CPI ${cheap.cpi}. Add utilities, transit, and food from that city page.`
    );
  }
  if (midRent > 0) {
    bullets.push(
      `Mid-market sketch — average indexed 1BR ~${fmt(midRent, d.symbol)} ${d.currency} with average CPI ~${d.avg_cpi} and average net salary ~${fmt(d.avg_salary, d.symbol) || 'n/a'}.`
    );
  }
  if (dear && (!cheap || dear.slug !== cheap.slug)) {
    bullets.push(
      `Premium hub example — ${dear.city}: centre 1BR ~${fmt(dear.rent, d.symbol)} ${d.currency}, CPI ${dear.cpi}. Expect higher dining and service premiums near tourist/CBD cores.`
    );
  }
  return {
    id: 'monthly-budgets',
    title: 'Monthly budget examples',
    paragraphs: [
      `These sketches use on-page rent and CPI signals for ${d.name}. They are planning anchors, not leases or payroll quotes. Scale food and transit from the specific city page you choose.`,
    ],
    bullets: bullets.length
      ? bullets
      : [
          `Build a three-line budget (rent, essentials, lifestyle) once you pick a metro in ${d.name}.`,
        ],
  };
}

export function buildCountryConclusion(d: CountryContentInput): ProseSection {
  const related = d.related_countries
    .slice(0, 3)
    .map((c) => c.name)
    .join(', ');
  return {
    id: 'country-conclusion',
    title: `Next steps for ${d.name}`,
    paragraphs: [
      `Treat ${d.name} as a map of metros, not a single cost number. Average CPI ~${d.avg_cpi} and average rent ~${fmt(d.avg_rent, d.symbol) || 'n/a'} hide large city-to-city spreads—shortlist two or three cities, compare them in the calculator, and read each city page’s confidence label.`,
      related
        ? `Related country hubs worth browsing: ${related}. Full methodology and data-source tiers are documented on the authority pages linked in Trust & data transparency.`
        : `Full methodology and data-source tiers are documented on the Methodology and Data Sources pages.`,
    ],
  };
}

export function expandCountryFaqs(d: CountryContentInput): FaqItem[] {
  const base = [...(d.faqs || [])];
  const cheap = d.cheapest[0];
  const dear = d.expensive[0];
  const extras: FaqItem[] = [
    {
      q: `How much does it cost to live in ${d.name} per month?`,
      a: `Among indexed cities, average centre 1BR rent is about ${fmt(d.avg_rent, d.symbol) || 'n/a'} ${d.currency} and average CPI is ~${d.avg_cpi}. Your monthly total depends on the metro—compare ${cheap?.city || 'an affordable city'} with ${dear?.city || 'a premium hub'} before budgeting.`,
    },
    {
      q: `Which cities in ${d.name} should I compare first?`,
      a:
        d.most_compared_cities?.length
          ? `Start with ${d.most_compared_cities
              .slice(0, 3)
              .map((c) => c.city)
              .join(', ')}, then use cheapest/expensive lists to expand your shortlist.`
          : `Open the city list on this page and run 2–3 pairs in the homepage calculator.`,
    },
    {
      q: `Is ${d.name} expensive compared with nearby countries?`,
      a: relatedCountriesAnswer(d),
    },
  ];
  const seen = new Set(base.map((f) => f.q.toLowerCase()));
  for (const e of extras) {
    if (!seen.has(e.q.toLowerCase())) base.push(e);
  }
  return base.slice(0, 12);
}

function relatedCountriesAnswer(d: CountryContentInput): string {
  if (d.related_countries.length) {
    return `Open related hubs such as ${d.related_countries
      .slice(0, 3)
      .map((c) => c.name)
      .join(', ')} and compare specific city pairs—country headlines hide metro variance. ${d.name}'s blended CPI is about ${d.avg_cpi}.`;
  }
  return `${d.name}'s blended CPI is about ${d.avg_cpi}. Compare specific metros rather than country averages alone.`;
}
