/**
 * City-page public content — data-aware sections unique per city.
 */

import type { CitySeoSections } from '../seo-content.js';
import type { FaqItem, ProseSection, TocItem } from './types.js';

export type CityContentInput = {
  city: string;
  state: string;
  country: string;
  countrySlug: string;
  slug: string;
  currency: string;
  symbol: string;
  population: number | null;
  indices: {
    cpi_index: number;
    rent_index: number;
    groceries_index: number;
    restaurant_price_index: number;
    local_purchasing_power_index: number;
  };
  rent_1br: number;
  salary: number;
  groceries_sample: number;
  transport_sample: number;
  utilities: number;
  restaurant_meal: number;
  summary: string;
  data_source: string;
  confidence_label: string;
  nearby: Array<{ city: string; slug: string; state?: string }>;
  similar_cost_cities?: Array<{ city: string; slug: string; state?: string; cpi: number }>;
  related_comparisons: Array<{ slug: string; label: string }>;
  faqs: Array<{ q: string; a: string }>;
  sections?: CitySeoSections;
  pros?: string[];
  cons?: string[];
  estimation_note?: string | null;
};

function fmt(n: number, symbol: string) {
  if (!n || n <= 0) return null;
  return `${symbol}${Math.round(n).toLocaleString('en-US')}`;
}

function loc(d: CityContentInput) {
  return d.state ? `${d.city}, ${d.state}` : d.city;
}

export function buildCityToc(d: CityContentInput): TocItem[] {
  const items: TocItem[] = [
    { id: 'city-overview', label: 'City overview' },
    { id: 'housing', label: 'Housing' },
    { id: 'food', label: 'Food & groceries' },
    { id: 'transport', label: 'Transport' },
    { id: 'healthcare', label: 'Healthcare' },
    { id: 'education', label: 'Education' },
    { id: 'salary', label: 'Salary & purchasing power' },
    { id: 'monthly-budget', label: 'Typical monthly budget' },
  ];
  if (d.nearby.length) items.push({ id: 'related-cities', label: 'Related cities' });
  if (d.related_comparisons.length) items.push({ id: 'related-comparisons', label: 'Comparisons' });
  items.push({ id: 'city-faq', label: 'FAQ' });
  items.push({ id: 'city-conclusion', label: 'Conclusion' });
  return items;
}

export function buildCityIntro(d: CityContentInput): string {
  const rent = fmt(d.rent_1br, d.symbol);
  const salary = fmt(d.salary, d.symbol);
  const parts = [
    `Cost of living in ${loc(d)}, ${d.country}: CPI ${d.indices.cpi_index} (NYC=100), rent index ${d.indices.rent_index}, purchasing power ${d.indices.local_purchasing_power_index}.`,
  ];
  if (rent) parts.push(`Reference 1BR centre rent about ${rent} ${d.currency}.`);
  if (salary) parts.push(`Average net salary near ${salary} ${d.currency}.`);
  parts.push(
    `Use the figures below with nearby cities and side-by-side comparisons before you relocate. Confidence: ${d.confidence_label}.`
  );
  return parts.join(' ');
}

export function buildCityOverviewSection(d: CityContentInput): ProseSection {
  const fromEngine = d.sections?.living_overview?.trim();
  const pop = d.population ? `${d.population.toLocaleString('en-US')} residents (estimate)` : null;
  const paragraphs = [
    fromEngine ||
      `${loc(d)} is an indexed ${d.country} market on CityCost. Everyday costs (CPI ${d.indices.cpi_index}), housing pressure (rent index ${d.indices.rent_index}), and wage stretch (purchasing power ${d.indices.local_purchasing_power_index}) should be read together—not as a single score.`,
    pop
      ? `Population context: roughly ${pop}. Metro definitions vary; treat CBD averages as a starting point and adjust for the district you would actually live in.`
      : `Metro definitions vary across ${d.country}; treat city-wide averages as planning anchors and validate neighbourhood rents independently.`,
    d.sections?.economy ||
      `Economic context: net pay reference ${fmt(d.salary, d.symbol) || 'varies'} ${d.currency} versus CPI ${d.indices.cpi_index}. Sectors concentrated in the metro can pull wages above or below this benchmark.`,
  ];
  if (d.estimation_note) paragraphs.push(d.estimation_note);
  return { id: 'city-overview', title: `${d.city} overview`, paragraphs };
}

export function buildCityHousingSection(d: CityContentInput): ProseSection {
  const rent = fmt(d.rent_1br, d.symbol);
  return {
    id: 'housing',
    title: 'Housing costs',
    paragraphs: [
      d.sections?.housing ||
        `Housing is usually the largest line item in ${d.city}. ${
          rent
            ? `A reference 1-bedroom city-centre lease is about ${rent} ${d.currency} per month.`
            : `Centre-city rent samples are limited for this market—use the rent index (${d.indices.rent_index}) and local listings.`
        } The rent index of ${d.indices.rent_index} (NYC=100) helps compare shelter pressure with other metros.`,
      `Suburban or older stock can undercut CBD averages substantially. Families should model 2–3BR premiums and deposits; students should price shared flats near transit. Cross-check ${d.city} against nearby peers on this site before locking a budget.`,
    ],
  };
}

export function buildCityFoodSection(d: CityContentInput): ProseSection {
  const milk = fmt(d.groceries_sample, d.symbol);
  const meal = fmt(d.restaurant_meal, d.symbol);
  return {
    id: 'food',
    title: 'Food & groceries',
    paragraphs: [
      d.sections?.lifestyle ||
        `Food costs in ${d.city} track the groceries index (${d.indices.groceries_index}) and restaurant price index (${d.indices.restaurant_price_index}). ${
          milk ? `A sample staple (milk 1L) is about ${milk} ${d.currency}.` : ''
        } ${meal ? `An inexpensive restaurant meal samples near ${meal} ${d.currency}.` : ''}`.trim(),
      `Tourist corridors often inflate dining samples. Build a personal basket (home cooking vs eating out) and compare with similar-cost cities linked below. Groceries usually move with CPI more tightly than luxury dining.`,
    ],
  };
}

export function buildCityTransportSection(d: CityContentInput): ProseSection {
  const ticket = fmt(d.transport_sample, d.symbol);
  return {
    id: 'transport',
    title: 'Transport',
    paragraphs: [
      d.sections?.transportation ||
        `Getting around ${d.city} hinges on transit coverage versus car dependence. ${
          ticket
            ? `A one-way local ticket samples near ${ticket} ${d.currency} in our basket.`
            : `Local ticket samples are thin here—compare monthly passes and ride-hail density using local sources.`
        }`,
      `Commuters should price monthly passes and last-mile gaps; car ownership adds insurance, parking, and fuel outside this basket. Pair transport with housing: a cheaper suburb can erase savings if every commute is long.`,
    ],
  };
}

export function buildCityHealthcareSection(d: CityContentInput): ProseSection {
  return {
    id: 'healthcare',
    title: 'Healthcare',
    paragraphs: [
      `CityCost’s core basket does not quote insurance premiums or clinic fees for ${d.city}, because those vary by citizenship, employer plan, and provider network. Use salary (${fmt(d.salary, d.symbol) || 'local wages'}) and purchasing power (${d.indices.local_purchasing_power_index}) as affordability context, then collect local quotes.`,
      `Expats and digital nomads should budget a separate healthcare line—public access rules differ across ${d.country}. Retirees on fixed income should stress-test out-of-pocket exposure, not only CPI. See Methodology for what is and is not in the index.`,
    ],
  };
}

export function buildCityEducationSection(d: CityContentInput): ProseSection {
  return {
    id: 'education',
    title: 'Education',
    paragraphs: [
      `International school fees and university housing are outside the standard CityCost price basket for ${d.city}. Families should overlay tuition and childcare on top of rent (${fmt(d.rent_1br, d.symbol) || 'local rents'}) and groceries index ${d.indices.groceries_index}.`,
      `Students comparing ${d.city} with peers should prioritize rent index ${d.indices.rent_index}, transit samples, and part-time wage reality via purchasing power ${d.indices.local_purchasing_power_index}. Use related comparisons below for campus-city alternatives in ${d.country} and abroad.`,
    ],
  };
}

export function buildCitySalarySection(d: CityContentInput): ProseSection {
  const salary = fmt(d.salary, d.symbol);
  return {
    id: 'salary',
    title: 'Salary & purchasing power',
    paragraphs: [
      d.sections?.economy ||
        `Average monthly net salary (after tax) in our reference for ${d.city} is ${
          salary ? `${salary} ${d.currency}` : 'limited in coverage'
        }. Local purchasing power scores ${d.indices.local_purchasing_power_index}.`,
      `If your income is foreign-denominated, ${d.city}'s CPI of ${d.indices.cpi_index} can unlock lifestyle upside when visas and banking work. If you earn locally, prioritize the rent-to-wage ratio: centre rent ${fmt(d.rent_1br, d.symbol) || 'n/a'} versus net pay. Source tier: ${d.data_source}.`,
    ],
  };
}

export function buildCityBudgetSection(d: CityContentInput): ProseSection {
  const rent = d.rent_1br > 0 ? d.rent_1br : 0;
  const util = d.utilities > 0 ? d.utilities : 0;
  const transit = d.transport_sample > 0 ? d.transport_sample * 40 : 0; // rough commuting month
  const food =
    d.groceries_sample > 0 || d.restaurant_meal > 0
      ? Math.max(d.groceries_sample * 30, 0) + Math.max(d.restaurant_meal * 8, 0)
      : 0;
  const essentials = rent + util + transit + food;
  const modest = essentials > 0 ? essentials * 1.15 : 0;
  const comfortable = essentials > 0 ? essentials * 1.45 : 0;

  const paragraphs = [
    `Illustrative single-adult monthly sketch for ${d.city} using on-page samples (not a quote): ${
      rent ? `rent ~${fmt(rent, d.symbol)}` : 'rent (from listings)'
    }, ${util ? `utilities ~${fmt(util, d.symbol)}` : 'utilities'}, transit scaled from ticket samples, and a mixed grocery/dining allowance. ${
      essentials > 0
        ? `Core essentials land near ${fmt(essentials, d.symbol)} ${d.currency}; a modest lifestyle buffer ~${fmt(modest, d.symbol)}; a more comfortable buffer ~${fmt(comfortable, d.symbol)}.`
        : `Samples are incomplete—build your own three-line budget from local listings.`
    }`,
    `Compare essentials with net salary ${fmt(d.salary, d.symbol) || '(local wages)'}. If rent alone exceeds ~35–40% of net pay, look at outer districts or similar-cost cities linked below. Utilities notes: ${d.sections?.utilities || `mid-size apartment utilities sample ${fmt(d.utilities, d.symbol) || 'varies'} ${d.currency}`}.`,
  ];

  return {
    id: 'monthly-budget',
    title: 'Typical monthly budget',
    paragraphs,
    bullets: [
      `CPI ${d.indices.cpi_index} · Rent index ${d.indices.rent_index} · PP ${d.indices.local_purchasing_power_index}`,
      `Currency: ${d.currency}`,
      `Confidence: ${d.confidence_label}`,
    ],
  };
}

export function buildCityConclusion(d: CityContentInput): ProseSection {
  const nearby = d.nearby
    .slice(0, 3)
    .map((n) => n.city)
    .join(', ');
  return {
    id: 'city-conclusion',
    title: `Planning a move to ${d.city}`,
    paragraphs: [
      `${loc(d)} is best evaluated as rent-to-wage fit first, CPI second. With CPI ${d.indices.cpi_index}, rent index ${d.indices.rent_index}, and purchasing power ${d.indices.local_purchasing_power_index}, decide which constraint binds your household—shelter, everyday prices, or local wages.`,
      nearby
        ? `Next steps: open ${nearby} for nearby alternatives, run a side-by-side in the calculator, and read Methodology if confidence is ${d.confidence_label}. Country context: cost of living in ${d.country}.`
        : `Next steps: run ${d.city} against your current city in the calculator, review related comparisons, and read Methodology for source tiers.`,
      d.sections?.ai_insights || d.summary,
    ],
  };
}

export function expandCityFaqs(d: CityContentInput): FaqItem[] {
  const base = [...(d.faqs || [])];
  const extras: FaqItem[] = [
    {
      q: `What is a realistic monthly budget in ${d.city}?`,
      a: `Start with centre 1BR rent (${fmt(d.rent_1br, d.symbol) || 'local listings'}), add utilities (${fmt(d.utilities, d.symbol) || 'estimate'}), transit, and groceries/dining. Compare the total with net salary ${fmt(d.salary, d.symbol) || 'in local currency'} and purchasing power ${d.indices.local_purchasing_power_index}.`,
    },
    {
      q: `How does ${d.city} compare on groceries and dining?`,
      a: `Groceries index ${d.indices.groceries_index}, restaurant index ${d.indices.restaurant_price_index}. Sample milk ${fmt(d.groceries_sample, d.symbol) || 'n/a'}; inexpensive meal ${fmt(d.restaurant_meal, d.symbol) || 'n/a'} ${d.currency}.`,
    },
    {
      q: `Where can I compare ${d.city} with other cities?`,
      a:
        d.related_comparisons.length > 0
          ? `Try ${d.related_comparisons
              .slice(0, 3)
              .map((c) => c.label)
              .join('; ')}, or use the homepage calculator with any pair.`
          : `Use the homepage calculator to compare ${d.city} with any other city, and open the ${d.country} country page for peer metros.`,
    },
  ];
  const seen = new Set(base.map((f) => f.q.toLowerCase()));
  for (const e of extras) {
    if (!seen.has(e.q.toLowerCase())) base.push(e);
  }
  return base.slice(0, 12);
}
