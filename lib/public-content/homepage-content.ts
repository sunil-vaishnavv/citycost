/**
 * Homepage long-form SEO content — site-specific, methodology-aware.
 * Word targets: How it works ~400–600; Complete guide ~700–1000.
 */

import type { FaqItem, ProseSection, TocItem } from './types.js';

export const HOME_TOC: TocItem[] = [
  { id: 'how-citycost-works', label: 'How CityCost Works' },
  { id: 'cost-of-living-guide', label: 'Complete Cost of Living Guide' },
  { id: 'popular-relocation-guides', label: 'Popular Relocation Guides' },
  { id: 'country-explorer', label: 'Country Explorer' },
  { id: 'popular-comparisons', label: 'Popular City Comparisons' },
  { id: 'latest-editorial', label: 'Latest Editorial Guides' },
  { id: 'homepage-faq', label: 'FAQ' },
  { id: 'methodology', label: 'Methodology' },
  { id: 'data-sources', label: 'Data Sources' },
  { id: 'about-citycost', label: 'About CityCost' },
  { id: 'related-resources', label: 'Related Resources' },
];

export function buildHomeHowItWorks(): ProseSection {
  return {
    id: 'how-citycost-works',
    title: 'How CityCost Works',
    paragraphs: [
      'CityCost Global is a free cost-of-living calculator and knowledge layer for comparing cities worldwide. You pick a base city and a comparison city in the tool above; the engine returns normalized indices (CPI excluding rent, rent, groceries, restaurants, and local purchasing power), sample basket prices where available, and a structured decision summary. Indices are modeled relative to New York City at 100 so you can compare markets that use different currencies without converting every line item by hand.',
      'Behind each public city and country page is an eligibility-driven catalog: only places that clear quality gates for geo identity, currency mapping, and cost coverage become indexable SEO pages. When you open a comparison, CityCost resolves live cost payloads for both sides, labels confidence (for example Verified, Curated, or Estimated), and surfaces category winners—housing versus everyday CPI versus purchasing power often diverge, which is why a single “cheaper city” headline is never enough.',
      'The calculator is intentionally paired with knowledge pages. Country hubs list indexed metros, cheapest and most expensive rent signals, and popular pairwise comparisons. City pages break out rent, salary, groceries, transport, utilities, and dining samples, then link to nearby and similar-cost peers. Programmatic compare routes add executive summaries, persona notes (students, families, remote workers), and FAQs grounded in the same indices you see in the charts.',
      'Editorial guides on the Blog extend the tool with longer relocation and budgeting narratives. Those articles are published through CityCost’s editorial pipeline and appear below when available. Authority pages—Methodology, Data Sources, About, and Disclaimer—document how figures are produced, which source tiers we use, and how you should interpret estimates. Use the tool for a fast side-by-side; use city, country, compare, and blog pages when you need crawlable context, internal links, and decision framing before a move.',
      'Nothing on CityCost is a visa, tax, or real-estate quote. Neighbourhood micro-markets, household size, and lifestyle can dominate outcomes. Treat every figure as a planning anchor, then validate with local listings and professional advice. When a page shows Estimated confidence, widen your error bands; when it shows Verified or Curated, you still should stress-test rent for your specific district.',
    ],
  };
}

export function buildHomeCompleteGuide(): ProseSection {
  return {
    id: 'cost-of-living-guide',
    title: 'Complete Cost of Living Guide',
    paragraphs: [
      'A useful cost-of-living comparison starts with the right questions: Will housing or everyday prices dominate your budget? Is your income local or foreign-denominated? Are you optimizing for students, a family, remote work, or retirement? CityCost organizes answers around indices and sample prices so you can compare apples to apples across borders.',
      'Housing is usually the largest monthly line item. Our city pages highlight a reference 1-bedroom city-centre rent alongside a rent index. CBD averages can sit well above suburban reality, so treat centre rent as a ceiling in hot markets and a floor only if you insist on a central address. Families should model 2–3 bedroom premiums and deposits separately; students should stress-test shared flats and campus-adjacent transit.',
      'Everyday costs show up in the CPI (excluding rent), groceries index, and restaurant price index. Groceries sample items (such as milk) and inexpensive restaurant meals give a tangible feel for supermarket and dining pressure. Utilities for a mid-size apartment and a one-way local transport ticket complete a practical monthly sketch: rent + utilities + transit + food + discretionary. CityCost does not invent healthcare premiums or private school fees when those are outside the core basket—instead we point you to salary and purchasing-power context so you can overlay your own quotes.',
      'Salaries and purchasing power close the loop. Average monthly net salary (after tax) is shown in local currency where available. Local purchasing power indexes how far a typical salary stretches against local prices. A high-salary city with crushing rent can leave less disposable income than a lower-CPI city with balanced wages. Remote workers often arbitrage by earning in a high-wage currency while living in a lower-CPI market—if visas, banking, and connectivity allow. Career professionals should weight industry clusters and after-tax offers over raw CPI alone.',
      'Country pages help when you have not shortlisted a metro yet. They aggregate indexed cities in that sovereign market, show average CPI/rent/salary signals across a sample, and surface cheapest versus expensive hubs. Cross-border movers should also open related country pages and popular comparisons that already exist in the index—those routes are pre-built for high-interest pairs and stay aligned with the same methodology as the calculator.',
      'How to use this site in practice: (1) Run two or three city pairs in the calculator and note CPI, rent, and purchasing-power gaps. (2) Open each city’s knowledge page for basket samples and nearby peers. (3) Read the country overview if regional spread matters. (4) Skim Blog guides for relocation narratives that match your persona. (5) Read Methodology and Data Sources so you know which labels mean Verified versus Estimated. (6) Build a personal three-line budget—housing, essentials, lifestyle—before deciding.',
      'Currency conversion uses published FX mapping for country currencies so dual-currency views stay consistent on a given day. Exchange rates move; freeze a planning scenario rather than chasing daily noise. Population and timezone metadata on city pages help with lifestyle context but do not change price indices. Latitude-aware climate notes, when present, remind you that heating or cooling can swing utilities beyond the annual average.',
      'Finally, treat CityCost as a decision support system, not a single score. Category winners often disagree: one city wins rent, another wins groceries, a third wins purchasing power. The Comparison Decision panel and compare-page enrichment are designed to make those trade-offs explicit. Combine them with local listing checks, healthcare quotes, and visa research, and you will have a relocation plan grounded in transparent data rather than marketing rankings.',
    ],
    bullets: [
      'Start with CPI + rent + purchasing power—not salary alone.',
      'Validate CBD rent against the neighbourhood you would actually rent.',
      'Use country hubs to map affordable vs premium metros before choosing.',
      'Read Methodology when confidence labels say Estimated.',
      'Overlay healthcare, schooling, and visa costs yourself—they vary by household.',
    ],
  };
}

export function buildHomeMethodologySection(): ProseSection {
  return {
    id: 'methodology',
    title: 'Methodology',
    paragraphs: [
      'CityCost publishes structured cost-of-living knowledge with transparent quality labels. Consumer price and rent indices are normalized to New York City = 100 for cross-city comparison. Sample basket prices (rent, groceries, transport, utilities, dining, salary) are resolved per city when coverage allows. Pages that pass eligibility gates receive dedicated city, country, or compare URLs; others remain available through the free calculator without a thin programmatic page.',
      'Confidence labels describe the underlying tier—surveyed, curated, or modeled estimates—so you can judge fitness for a high-stakes move. Estimation notes appear when nearby or regional models fill gaps. We do not invent fake precision: when climate series or healthcare fee schedules are unavailable, those sections say so rather than fabricating numbers. Full formulas, limitations, and interpretation guidance live on the Methodology page.',
    ],
  };
}

export function buildHomeDataSourcesSection(): ProseSection {
  return {
    id: 'data-sources',
    title: 'Data Sources',
    paragraphs: [
      'Public trust requires knowing where numbers come from. CityCost combines geo identity and city metadata, foreign-exchange rates for local-currency display, population context where available, and cost inputs from curated reference datasets plus modeled estimates when surveys are thin. Sensitive vendor contracts and API keys are never published; the Data Sources page lists active source categories, coverage notes, and confidence framing.',
      'On-page labels such as data source and confidence sit next to indices so each city or comparison can be audited at a glance. Corrections and feedback are welcome via Contact. Always cross-check high-stakes housing quotes against current local listings.',
    ],
  };
}

export function buildHomeAboutSection(): ProseSection {
  return {
    id: 'about-citycost',
    title: 'About CityCost',
    paragraphs: [
      'CityCost Global exists to make cross-city living costs comparable, explainable, and honest about uncertainty—turning a comparison tool into a trusted knowledge platform. Our audience includes students, families, remote workers, expats, digital nomads, and businesses that need high-level mobility context.',
      'We combine an eligibility-driven index, a cost engine, side-by-side comparisons, editorial guides, and an authority layer (methodology, sources, disclaimers) so every figure is traceable to a method and a dated update. Learn more on the About page, or jump straight into the calculator above.',
    ],
  };
}

export function buildHomeFaqs(stats?: {
  indexable_cities?: number;
  indexable_countries?: number;
  indexable_comparisons?: number;
}): FaqItem[] {
  const cities = stats?.indexable_cities ?? 0;
  const countries = stats?.indexable_countries ?? 0;
  const comps = stats?.indexable_comparisons ?? 0;
  const coverage =
    cities > 0
      ? `The public index currently includes about ${cities.toLocaleString()} city pages, ${countries.toLocaleString()} country hubs, and ${comps.toLocaleString()} comparison routes—plus the free calculator for any searchable pair.`
      : `The public index includes country hubs, eligible city pages, and comparison routes—plus the free calculator for any searchable pair.`;

  return [
    {
      q: 'What is CityCost Global?',
      a: 'CityCost Global is a free cost-of-living calculator and knowledge site. Compare rent, groceries, restaurants, transport, utilities, salary, and purchasing power between cities, then explore city, country, compare, and blog pages for deeper context.',
    },
    {
      q: 'How do I compare two cities?',
      a: 'Use the dual search fields at the top of this page: choose Base City A and Compare City B, then press Compare Cities. You will get indices, charts, a decision panel, sample prices, and FAQs. Popular pairs also have dedicated /compare/… URLs.',
    },
    {
      q: 'What does the CPI index mean?',
      a: 'CPI (excluding rent) is normalized to New York City = 100. A city at 60 has roughly 40% lower everyday consumer prices than NYC on this lens. Always pair CPI with rent and purchasing power before deciding.',
    },
    {
      q: 'Are the prices real quotes I can rent or buy at?',
      a: 'No. Figures are planning anchors from surveyed, curated, or estimated baskets. Neighbourhood, building type, and timing change outcomes. Validate housing and contracts with local listings and professionals.',
    },
    {
      q: 'How many cities and countries can I explore?',
      a: coverage,
    },
    {
      q: 'What is local purchasing power?',
      a: 'Local purchasing power indexes how far a typical net salary stretches against local prices. Higher is better for residents paid in local wages. Remote workers earning foreign currency should still model rent and visas carefully.',
    },
    {
      q: 'Where can I read the methodology?',
      a: 'Open Methodology for how indices, confidence labels, estimation, currency conversion, and eligibility work. Data Sources lists active source categories. Disclaimer explains limitations.',
    },
    {
      q: 'Do you publish relocation guides?',
      a: 'Yes. Published editorial guides appear on /blog and in the Latest Editorial Guides section below when articles are live. Guides complement—not replace—the calculator and city pages.',
    },
    {
      q: 'How should students or families use CityCost?',
      a: 'Students should prioritize rent index, shared housing, and transit samples. Families should stress-test larger rents, groceries, and utilities, then compare purchasing power. Persona notes on compare pages expand these lenses.',
    },
    {
      q: 'Why do some pages say Estimated?',
      a: 'Estimated means coverage relies more on models or nearby references than dense local surveys. Widen error bands, prefer multiple peer cities, and read the on-page confidence label and estimation note.',
    },
    {
      q: 'Can I use CityCost for salary negotiations?',
      a: 'It is useful high-level context for mobility and compensation discussions, not a payroll or tax engine. Combine indices with after-tax offers, benefits, and local housing quotes.',
    },
    {
      q: 'How do I report a data issue?',
      a: 'Use the Contact page with the city name, what looks wrong, and a source if you have one. Corrections help improve confidence labels over time.',
    },
  ];
}

export function buildHomeCountryIntro(countryCount: number): string {
  const n = countryCount > 0 ? `${countryCount.toLocaleString()} ` : '';
  return `Browse ${n}country hubs to see currency, average CPI and rent signals across indexed metros, cheapest and most expensive cities, and popular comparisons. Start with a country when you have not shortlisted a single city yet—then drill into city pages and the calculator.`;
}

export function buildHomeComparisonsIntro(): string {
  return "Jump into high-interest city pairs that already have programmatic comparison pages. Each route mirrors the calculator's indices with executive summaries, category winners, pros/cons, and FAQs—ideal when you want a shareable URL for a relocation shortlist.";
}

export function buildHomeRelocationIntro(): string {
  return `Relocation guides from the CityCost blog (when published) focus on practical budgeting and move planning. Pair any guide with the calculator above and the linked city or country pages so narrative advice stays anchored to current indices.`;
}

export const HOME_RELATED_RESOURCES: Array<{ label: string; href: string }> = [
  { label: 'Methodology', href: '/methodology' },
  { label: 'Data Sources', href: '/data-sources' },
  { label: 'About CityCost', href: '/about' },
  { label: 'Disclaimer', href: '/disclaimer' },
  { label: 'Blog & Guides', href: '/blog' },
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
];
