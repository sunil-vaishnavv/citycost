/**
 * City & country section composers — data → structured blocks.
 */

import type { CityKnowledge, CountryKnowledge, ContentBlock, InternalLink } from './types.js';
import { fmtMoney, fmtNum, locLabel, blockWords, pickVariant, joinAvailable } from './templates.js';

function unavailableNote(domains: string[]): string {
  return `Verified information is currently unavailable for: ${domains.join(', ').replace(/_/g, ' ')}. Those topics are omitted rather than estimated.`;
}

export function composeCityBlocks(k: CityKnowledge): {
  blocks: ContentBlock[];
  key_takeaways: string[];
  links: InternalLink[];
  summary: string;
  seo_description: string;
} {
  const loc = locLabel(k.city, k.state, k.country);
  const rent = fmtMoney(k.symbol, k.prices.rent_1br, k.currency);
  const salary = fmtMoney(k.symbol, k.prices.salary, k.currency);
  const milk = fmtMoney(k.symbol, k.prices.milk, k.currency);
  const transport = fmtMoney(k.symbol, k.prices.transport, k.currency);
  const utilities = fmtMoney(k.symbol, k.prices.utilities, k.currency);
  const meal = fmtMoney(k.symbol, k.prices.meal, k.currency);
  const cpi = fmtNum(k.indices.cpi);
  const rentIdx = fmtNum(k.indices.rent);
  const pp = fmtNum(k.indices.purchasing_power);
  const seed = k.pageSlug;

  const blocks: ContentBlock[] = [];

  const rentSalaryRatio =
    k.prices.rent_1br != null && k.prices.salary != null && k.prices.salary > 0
      ? Math.round((k.prices.rent_1br / k.prices.salary) * 100)
      : null;

  // Living Overview
  {
    const paras = [
      pickVariant(seed + '|live', [
        `${loc} is indexed for cost-of-living analysis using ${k.data_source} with confidence label "${k.confidence_label}". This page is a structured knowledge document: every number below comes from the CityCost engine or the eligible-city registry — not from generative guesswork.`,
        `Use this ${loc} knowledge page to inspect verified living-cost signals. Figures are composed from CityCost reference data (${k.data_source}, ${k.confidence_label}) and eligibility metadata; optional domains without verified sources are listed as unavailable instead of invented.`,
      ]),
      joinAvailable([
        k.population != null ? `Population estimate on the eligible-city record: ${k.population.toLocaleString()}.` : null,
        k.timezone ? `Primary timezone reference on record: ${k.timezone}.` : null,
        `Local currency for published prices: ${k.currency} (${k.symbol.trim()}).`,
        k.latitude != null && k.longitude != null
          ? `Coordinates on record: ${k.latitude.toFixed(2)}, ${k.longitude.toFixed(2)}.`
          : null,
        k.is_capital ? `${k.city} is flagged as a national capital in eligibility signals.` : null,
        k.is_tourism_or_business ? `${k.city} is flagged as a tourism or business hub in index signals.` : null,
        k.tier != null ? `Internal tier signal on record: ${k.tier}.` : null,
      ]),
      `Readers should treat city-centre references as anchors, then validate neighbourhood leases, taxes, and visas independently before relocating.`,
      unavailableNote(k.unavailable),
    ].filter(Boolean) as string[];
    blocks.push({ id: 'living_overview', title: 'Living Overview', paragraphs: paras, words: blockWords(paras) });
  }

  // Cost of Living Summary
  {
    const paras = [
      joinAvailable([
        cpi ? `Overall consumer price index (CPI) for ${k.city} is ${cpi} where New York City = 100.` : null,
        rentIdx ? `Rent index is ${rentIdx}, isolating housing pressure from the broader CPI basket.` : null,
        `Groceries index: ${fmtNum(k.indices.groceries)}; restaurant price index: ${fmtNum(k.indices.restaurants)}.` ,
        pp ? `Local purchasing power index is ${pp}, describing how far a typical local salary stretches against local prices.` : null,
      ]) || `Cost indices for ${k.city} are derived from the CityCost engine.`,
      pickVariant(seed + '|cpi', [
        `Interpret indices relatively: a CPI below 100 means everyday goods/services are cheaper than the NYC baseline on this methodology; housing and wages can still diverge from that headline.`,
        `Because CPI, rent, and purchasing power can disagree, ${k.city} should be judged on the category that binds your budget — not a single headline score.`,
      ]),
      k.estimation_note || `Confidence label for this city: ${k.confidence_label}.`,
    ];
    blocks.push({ id: 'cost_summary', title: 'Cost of Living Summary', paragraphs: paras, words: blockWords(paras) });
  }

  if (rent || rentIdx) {
    const paras = [
      joinAvailable([
        rent ? `A reference 1-bedroom apartment in the city centre averages about ${rent} per month in the published basket.` : null,
        rentIdx ? `The rent index (${rentIdx}) situates that housing pressure relative to the global baseline used by CityCost.` : null,
        rentSalaryRatio != null
          ? `On published figures, the centre 1BR reference is about ${rentSalaryRatio}% of the average net monthly salary — a stress-test ratio, not a household budget.`
          : null,
      ]),
      `Neighbourhood choice, building age, and furnishings can move actual leases well above or below the city-centre reference. Outer districts often price differently from the CBD sample.`,
      `When comparing ${k.city} to peers, prefer paired rent indices on comparison pages rather than converting foreign rents with informal FX guesses.`,
    ];
    blocks.push({ id: 'housing', title: 'Housing Analysis', paragraphs: paras, words: blockWords(paras) });
  }

  if (transport) {
    const paras = [
      `A one-way local transport ticket averages about ${transport} in the reference basket for ${k.city}.`,
      `That single-ticket proxy does not equal a monthly commute budget: passes, ride-hail, fuel, parking, and last-mile costs can dominate for some households.`,
      `Remote-first workers may underweight transport relative to rent; on-site workers should model peak-hour routes before treating ${transport} as representative.`,
    ];
    blocks.push({ id: 'transportation', title: 'Transportation Analysis', paragraphs: paras, words: blockWords(paras) });
  }

  if (utilities) {
    const paras = [
      `Basic utilities for an 85m² apartment average about ${utilities} in the reference basket (electricity, heating/cooling, water, garbage — before internet and mobile).`,
      `Seasonal heating or cooling can change monthly totals. Verified climate time series are not attached on this page, so weather-driven utility swings are not estimated here.`,
      `Add broadband and mobile plans separately when building a relocation spreadsheet for ${loc}.`,
    ];
    blocks.push({ id: 'utilities', title: 'Utilities Analysis', paragraphs: paras, words: blockWords(paras) });
  }

  if (milk || k.indices.groceries) {
    const paras = [
      joinAvailable([
        milk ? `A grocery sample SKU (1 litre milk) is about ${milk} in the published basket.` : null,
        `Groceries index for ${k.city}: ${fmtNum(k.indices.groceries)} (NYC=100 methodology).`,
      ]),
      `A single SKU never equals a full food budget. Households should build a personal basket (staples, protein, produce) and scale from the groceries index rather than extrapolating from milk alone.`,
      `Import-heavy diets and specialty brands can diverge from the local index; use ${fmtNum(k.indices.groceries)} as a relative signal when comparing cities.`,
    ];
    blocks.push({ id: 'groceries', title: 'Groceries Analysis', paragraphs: paras, words: blockWords(paras) });
  }

  if (meal || k.indices.restaurants) {
    const paras = [
      joinAvailable([
        meal ? `An inexpensive restaurant meal averages about ${meal} in the reference basket.` : null,
        `Restaurant price index: ${fmtNum(k.indices.restaurants)}.`,
      ]),
      `Dining frequency changes lifestyle cost more than the meal sample alone. Tourist strips and business districts often price above the inexpensive-meal reference used here.`,
      `For ${k.city}, pair the restaurant index with the groceries index to see whether cooking at home vs eating out is the larger lever in your plan.`,
    ];
    blocks.push({ id: 'restaurants', title: 'Restaurant Analysis', paragraphs: paras, words: blockWords(paras) });
  }

  if (salary || pp) {
    const paras = [
      joinAvailable([
        salary ? `Average monthly net salary (after tax) on record is about ${salary}.` : null,
        pp ? `Purchasing power index ${pp} describes how far a typical local salary stretches against local prices.` : null,
        rent && salary
          ? `Stress-test affordability by comparing the ${rent} 1BR centre reference against ${salary} net pay, then adjusting for your actual housing target.`
          : null,
      ]),
      `Offers denominated in foreign currency should be converted carefully; published figures on this page stay in ${k.currency}. Industry wage premiums are not asserted without verified payroll datasets.`,
      `Students and new graduates may earn below the average net salary figure — treat ${salary || 'the salary field'} as a market midpoint signal, not a personal guarantee.`,
    ];
    blocks.push({ id: 'salary', title: 'Salary Analysis', paragraphs: paras, words: blockWords(paras) });
  }

  {
    const paras = [
      pickVariant(seed + '|life', [
        `Lifestyle costs in ${k.city} track the local CPI, grocery, and restaurant indices more closely than tourist menus or hotel rates.`,
        `${k.city}'s day-to-day living mix depends on district density, dining habits, and transport mode — use the published indices as anchors rather than anecdote.`,
      ]),
      joinAvailable([
        cpi ? `With CPI at ${cpi}, everyday services and goods sit ${Number(cpi) < 100 ? 'below' : Number(cpi) > 100 ? 'above' : 'near'} the NYC baseline on this methodology.` : null,
        transport && utilities
          ? `Fixed monthly anchors on record include transport tickets (~${transport} one-way) and utilities (~${utilities} for the 85m² sample).`
          : null,
      ]),
      `Lifestyle fit also depends on education, healthcare, and safety — verified overviews for those domains are unavailable on this page and are therefore omitted.`,
    ];
    blocks.push({ id: 'lifestyle', title: 'Lifestyle Summary', paragraphs: paras, words: blockWords(paras) });
  }

  {
    const bullets = [
      salary && rent ? `Households whose net pay comfortably exceeds the ${rent} 1BR centre benchmark after taxes and essentials` : `Budget-conscious movers who will verify district-level rents before signing`,
      k.is_tourism_or_business ? `Professionals who specifically need a tourism or business hub flagged in our index signals` : `People comparing multiple cities with the same CityCost index methodology`,
      pp && Number(pp) >= 80 ? `Residents who benefit from relatively stronger purchasing power (index ${pp})` : `Remote workers who can validate visa rules and connectivity independently`,
      `Readers who will open nearby-city and comparison links to pressure-test alternatives inside ${k.country}`,
    ];
    blocks.push({
      id: 'who_should_move',
      title: 'Who Should Move Here',
      paragraphs: [
        `Based only on indexed cost signals for ${k.city} — not on unverified lifestyle rankings:`,
      ],
      bullets,
      words: blockWords([`Based on indexed cost signals for ${k.city}:`], bullets),
    });
  }

  {
    const bullets = [
      cpi && Number(cpi) > 70 ? `Households that need markets with a meaningfully lower CPI than ${cpi}` : `Anyone requiring verified industry or climate datasets (not published here)`,
      `Readers seeking airport, healthcare, education, or safety ratings — verified data for those domains is unavailable on this page`,
      rent ? `Movers who need sub-${rent} centre leases without considering outer districts or shared housing` : `Movers who will not validate neighbourhood micro-markets`,
      `Users looking for invented GDP, industry lists, or climate narratives — those are omitted by design`,
    ];
    blocks.push({
      id: 'who_may_not',
      title: 'Who May Not Prefer This City',
      paragraphs: [`Signals that ${k.city} may be a weaker fit for some readers:`],
      bullets,
      words: blockWords([`Signals that ${k.city} may be a weaker fit:`], bullets),
    });
  }

  if (k.nearby_cities.length) {
    const bullets = k.nearby_cities.map((n) => `${n.city}${n.state ? `, ${n.state}` : ''}`);
    blocks.push({
      id: 'nearby_alternatives',
      title: 'Nearby Alternatives',
      paragraphs: [`Indexed alternatives in ${k.country} for side-by-side checks:`],
      bullets,
      words: blockWords([`Indexed alternatives in ${k.country}:`], bullets),
    });
  }

  if (k.related_comparisons.length) {
    const bullets = k.related_comparisons.map((c) => c.label);
    blocks.push({
      id: 'related_cities',
      title: 'Related Cities & Comparisons',
      paragraphs: [`High-value comparison pages involving ${k.city}:`],
      bullets,
      words: blockWords([`Comparisons involving ${k.city}:`], bullets),
    });
  }

  const key_takeaways = [
    cpi ? `CPI ${cpi} (NYC=100)` : null,
    rent ? `1BR centre rent ~${rent}` : null,
    salary ? `Net salary ~${salary}` : null,
    pp ? `Purchasing power ${pp}` : null,
    `Source: ${k.data_source} · ${k.confidence_label}`,
  ].filter(Boolean) as string[];

  blocks.push({
    id: 'key_takeaways',
    title: 'Key Takeaways',
    paragraphs: [`Facts on record for ${loc}:`],
    bullets: key_takeaways,
    words: blockWords([`Facts on record for ${loc}:`], key_takeaways),
  });

  const links: InternalLink[] = [
    { label: k.country, href: `/country/${k.countrySlug}`, rel: 'country' },
    ...k.nearby_cities.slice(0, 6).map((n) => ({
      label: n.city,
      href: `/city/${n.slug}`,
      rel: 'nearby' as const,
    })),
    ...k.related_comparisons.slice(0, 6).map((c) => ({
      label: c.label,
      href: `/compare/${c.slug}`,
      rel: 'compare' as const,
    })),
  ];

  const summary = joinAvailable([
    `${loc}: CPI ${cpi ?? 'n/a'}, rent index ${rentIdx ?? 'n/a'}, purchasing power ${pp ?? 'n/a'}.`,
    rent ? `1BR centre rent ~${rent}.` : null,
    salary ? `Net salary ~${salary}.` : null,
    `Data: ${k.data_source}.`,
  ]);

  const seo_description = joinAvailable([
    `Cost of living in ${loc}.`,
    rent ? `Rent ${rent}.` : null,
    salary ? `Salary ${salary}.` : null,
    cpi ? `CPI ${cpi}.` : null,
    `Compare nearby cities and plan relocation with CityCost.`,
  ]);

  return { blocks, key_takeaways, links, summary, seo_description };
}

export function composeCountryBlocks(k: CountryKnowledge): {
  blocks: ContentBlock[];
  links: InternalLink[];
  summary: string;
  seo_description: string;
} {
  const blocks: ContentBlock[] = [];
  const hasCities = k.indexed_city_count > 0;

  blocks.push({
    id: 'country_overview',
    title: 'Country Overview',
    paragraphs: [
      `${k.name} is part of the CityCost country index. Published costs use ${k.currency} (${k.symbol.trim()}). This page aggregates eligible cities only — it is not a census of every settlement.`,
      hasCities
        ? `Current SEO-indexed coverage: ${k.indexed_city_count} cities that passed eligibility quality gates. Rankings below (cheapest / expensive / metros) are computed from that indexed set, not from unverified national statistics.`
        : `Indexed city coverage for ${k.name} is still expanding under eligibility gates. Currency, FAQs, and moving advice remain available while metros are added.`,
      `GDP, nationwide industry lists, and climate atlases are omitted unless a verified dataset is attached — anti-hallucination policy applies at country scope as well.`,
    ],
    words: 110,
  });

  blocks.push({
    id: 'economic_snapshot',
    title: 'Economic Snapshot',
    paragraphs: [
      joinAvailable([
        `Reference FX used in tooling versus USD: ${k.exchange_rate}.`,
        k.population_indexed != null
          ? `Sum of populations on indexed city records: ${k.population_indexed.toLocaleString()}. This is not a national census figure and must not be cited as one.`
          : `National population is not asserted here without a verified census source.`,
        `Macro claims (GDP growth, unemployment, sector shares) are intentionally absent when unverified.`,
      ]),
      `For household planning, city-level rent and salary pages are more actionable than a single national narrative.`,
    ],
    words: 85,
  });

  if (hasCities && k.avg_cpi != null) {
    blocks.push({
      id: 'living_cost_overview',
      title: 'Living Cost Overview',
      paragraphs: [
        `Across indexed cities in ${k.name}, average CPI is about ${fmtNum(k.avg_cpi)} (NYC=100).`,
        k.avg_groceries != null
          ? `Average groceries index in the same sample: ${fmtNum(k.avg_groceries)}. Intra-country spreads can exceed the gap between ${k.name} and neighbouring countries.`
          : `Groceries averages appear as more cities clear eligibility with grocery metrics.`,
        `Treat these averages as navigation aids — open individual city pages before making relocation decisions.`,
      ].filter(Boolean),
      words: 90,
    });
  }

  if (k.avg_salary != null) {
    blocks.push({
      id: 'salary_overview',
      title: 'Salary Overview',
      paragraphs: [
        `Average net salary across the metrics sample is about ${fmtMoney(k.symbol, k.avg_salary, k.currency)}.`,
        `City-level wages can diverge sharply from this blend. Capitals and coastal hubs often sit above inland averages; always open the target city page for the local figure.`,
        `Foreign-currency offers should be converted explicitly — this page keeps salary context in ${k.currency}.`,
      ],
      words: 85,
    });
  }

  if (k.avg_rent != null) {
    blocks.push({
      id: 'housing_overview',
      title: 'Housing Overview',
      paragraphs: [
        `Average 1BR city-centre rent in the metrics sample is about ${fmtMoney(k.symbol, k.avg_rent, k.currency)}.`,
        `Centre references understate suburban bargains and overstate tourist micro-markets. Use cheapest/expensive lists below to see the spread inside ${k.name}.`,
        `Lease norms, deposits, and furnishing conventions are not asserted without verified housing-law datasets.`,
      ],
      words: 80,
    });
  }

  if (k.cheapest.length) {
    const bullets = k.cheapest.map((c) => `${c.city} — rent ~${fmtMoney(k.symbol, c.rent, k.currency)} · CPI ${c.cpi}`);
    blocks.push({
      id: 'cheapest_cities',
      title: 'Cheapest Cities',
      paragraphs: [`Among currently indexed cities in ${k.name} (by 1BR centre rent):`],
      bullets,
      words: blockWords(['Cheapest indexed:'], bullets),
    });
  }

  if (k.expensive.length) {
    const bullets = k.expensive.map((c) => `${c.city} — rent ~${fmtMoney(k.symbol, c.rent, k.currency)} · CPI ${c.cpi}`);
    blocks.push({
      id: 'expensive_cities',
      title: 'Most Expensive Cities',
      paragraphs: [`Higher housing-cost indexed cities in ${k.name}:`],
      bullets,
      words: blockWords(['Expensive indexed:'], bullets),
    });
  }

  if (k.metros.length) {
    const bullets = k.metros.slice(0, 20).map((m) => `${m.city}${m.state ? `, ${m.state}` : ''}`);
    blocks.push({
      id: 'major_metros',
      title: 'Major Metro Cities',
      paragraphs: [`Indexed metros and cities linked from this country page:`],
      bullets,
      words: blockWords(['Metros:'], bullets),
    });
  }

  if (k.top_comparisons.length) {
    const bullets = k.top_comparisons.map((c) => c.label);
    blocks.push({
      id: 'popular_comparisons',
      title: 'Popular Comparisons',
      paragraphs: [`Comparison pages involving cities in ${k.name}:`],
      bullets,
      words: blockWords(['Comparisons:'], bullets),
    });
  }

  blocks.push({
    id: 'moving_advice',
    title: 'Moving Advice',
    paragraphs: [
      `Start with currency (${k.currency}), shortlist target cities from the indexed list, then run side-by-side rent, grocery, salary, and purchasing-power comparisons.`,
      `Do not rely on a single national average — intra-country spreads are often larger than cross-border gaps.`,
      `Validate visas, schooling, healthcare access, and neighbourhood safety independently; those domains are not invented on CityCost country pages.`,
      hasCities
        ? `Practical path: pick 2–3 metros from the lists above, open each city page, then open a compare URL for the final pair.`
        : `Practical path: watch for newly eligible cities, then compare as soon as rent and salary metrics appear.`,
    ],
    words: 120,
  });

  const links: InternalLink[] = [
    ...k.metros.slice(0, 8).map((m) => ({ label: m.city, href: `/city/${m.slug}`, rel: 'popular' as const })),
    ...k.top_comparisons.slice(0, 6).map((c) => ({ label: c.label, href: `/compare/${c.slug}`, rel: 'compare' as const })),
    ...k.related_countries.slice(0, 6).map((c) => ({ label: c.name, href: `/country/${c.slug}`, rel: 'related' as const })),
  ];

  const summary = hasCities
    ? `${k.name} cost-of-living overview: ${k.indexed_city_count} indexed cities, currency ${k.currency}${k.avg_cpi != null ? `, avg CPI ${fmtNum(k.avg_cpi)}` : ''}.`
    : `${k.name} country page: currency ${k.currency}. Indexed city coverage is expanding under eligibility quality gates.`;

  const seo_description = `Cost of living in ${k.name}: currency ${k.currency}, city rankings, salaries, housing, and comparisons on CityCost Global.`;

  return { blocks, links, summary, seo_description };
}
