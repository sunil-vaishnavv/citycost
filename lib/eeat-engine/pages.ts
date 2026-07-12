/**
 * Authority page content — factual, non-sensitive descriptions of how CityCost works.
 * Never expose API keys, scoring formulas with weights, or proprietary thresholds.
 */

import type { AuthorityPageDoc, DataSourceEntry } from './types.js';

const UPDATED = '2026-07-12';

export const DATA_SOURCES: DataSourceEntry[] = [
  {
    id: 'geo',
    name: 'Geographic Place Database',
    purpose: 'City, state/region, and country names, coordinates, and place hierarchy for search and SEO pages.',
    coverage: 'Global place registry used for city discovery and page slugs.',
    last_update: 'Synced with library releases; index rebuilt on deploy.',
    confidence: 'High for place identity; population fields vary by availability.',
    license: 'Upstream package license (third-party geo dataset).',
    category: 'Geo Database',
  },
  {
    id: 'fx',
    name: 'Exchange Rate References',
    purpose: 'Convert and display prices in local currency contexts where FX is required by the product.',
    coverage: 'Major world currencies mapped to country codes.',
    last_update: 'Reference rates refreshed with application configuration cycles.',
    confidence: 'Medium–High for display; rates fluctuate continuously.',
    license: 'Internal reference tables / public FX conventions.',
    category: 'Exchange Rates',
  },
  {
    id: 'population',
    name: 'Population Estimates',
    purpose: 'Optional population figures on city records when present in the eligible-city registry.',
    coverage: 'Partial — only cities with a recorded estimate.',
    last_update: 'As provided by the place/eligibility registry.',
    confidence: 'Variable; omitted when unavailable.',
    license: 'Upstream / curated registry fields.',
    category: 'Population',
  },
  {
    id: 'gov',
    name: 'Government & Public Statistics (where referenced)',
    purpose: 'Contextual country-level framing when public statistical concepts are cited at a high level.',
    coverage: 'Not a live feed of all national statistical offices.',
    last_update: 'Cited only when a verified public source is attached to a document.',
    confidence: 'Depends on the specific publication.',
    license: 'Public-domain or government open-data terms where applicable.',
    category: 'Government Statistics',
  },
  {
    id: 'curated',
    name: 'Internal Curated Reference Dataset',
    purpose: 'Surveyed and curated cost baskets used as high-confidence anchors for selected cities.',
    coverage: 'Priority metros and surveyed cities in the CityCost index.',
    last_update: 'Updated when curated baskets are revised.',
    confidence: 'High relative to modeled cities.',
    license: 'CityCost proprietary curated dataset.',
    category: 'Internal Curated Data',
  },
  {
    id: 'estimated',
    name: 'Modeled / Estimated Cost Data',
    purpose: 'Fill coverage gaps using transparent estimation from regional or country-level signals.',
    coverage: 'Eligible cities without a full surveyed basket.',
    last_update: 'Regenerated when underlying regional inputs or engine version change.',
    confidence: 'Lower than verified/curated; labeled on page.',
    license: 'CityCost modeled outputs.',
    category: 'Estimated Data',
  },
  {
    id: 'future',
    name: 'Future Providers (planned)',
    purpose: 'Additional open statistical bureaus, housing boards, and licensed price feeds.',
    coverage: 'Not active until onboarding and licensing are complete.',
    last_update: 'N/A — roadmap.',
    confidence: 'N/A',
    license: 'To be disclosed per provider when integrated.',
    category: 'Future Providers',
  },
];

export const AUTHORITY_PAGES: Record<string, AuthorityPageDoc> = {
  methodology: {
    id: 'methodology',
    path: '/methodology',
    title: 'Methodology — How CityCost Calculates Cost of Living',
    meta_description:
      'Learn how CityCost Global calculates cost of living, confidence labels, estimation, nearby cities, currency conversion, and data quality tiers.',
    h1: 'Methodology',
    intro:
      'CityCost Global publishes structured cost-of-living knowledge for cities and countries. This page explains how figures are produced, labeled, and limited — so you can interpret every page with appropriate caution.',
    schema_type: 'WebPage',
    last_updated: UPDATED,
    sections: [
      {
        id: 'how-calculated',
        title: 'How cost of living is calculated',
        paragraphs: [
          'Each indexed city is associated with a reference basket of common living costs (for example rent, groceries samples, transport tickets, utilities, restaurant meals, and net salary where available). From those items, the platform derives relative indices such as CPI, rent, groceries, restaurants, and local purchasing power, using New York City = 100 as the familiar baseline convention for relative comparison.',
          'City and comparison pages surface both absolute price samples (in local currency) and relative indices. Absolute prices help with budgeting; indices help compare cities on a common scale.',
        ],
      },
      {
        id: 'confidence',
        title: 'How confidence scores work',
        paragraphs: [
          'Every city payload includes a human-readable confidence label (for example Verified, Curated, or Estimated). Confidence summarizes how directly the published basket is supported by surveyed or curated inputs versus modeled fill-ins.',
          'Confidence is a transparency signal, not a guarantee of street-level accuracy for every neighbourhood. Always validate leases and offers locally.',
        ],
      },
      {
        id: 'estimation',
        title: 'How estimation works',
        paragraphs: [
          'When a full surveyed basket is unavailable for an eligible city, the engine may estimate values using regional or country-level reference patterns. Estimated pages state that clearly — typically as “Estimated from regional averages” or an equivalent confidence label.',
          'Estimation expands geographic coverage for planning and comparison. It is not a substitute for a local market survey.',
        ],
      },
      {
        id: 'nearby',
        title: 'How nearby cities are used',
        paragraphs: [
          'Nearby and related city links help you pressure-test alternatives inside the same country or region. They are selected from the SEO-eligible city index — not from invented place names.',
          'A nearby city may have a different confidence tier. Always open each city page to read its source and confidence strip.',
        ],
      },
      {
        id: 'currency',
        title: 'How currency conversion works',
        paragraphs: [
          'Prices on city pages are shown in the country’s local currency where the currency map is known. Exchange-rate references support tooling and cross-border context; FX markets move continuously, so converted totals can drift between visits.',
          'For relocation decisions, convert offers and leases with the rate your bank or payroll provider will actually use.',
        ],
      },
      {
        id: 'quality',
        title: 'How data quality is evaluated',
        paragraphs: [
          'Quality is communicated through source labels, confidence labels, and quality tiers (Verified, Curated, Estimated, Regional, Country-level). Thin or low-eligibility places are excluded from the public SEO index by separate eligibility gates.',
          'We do not publish proprietary scoring weights or internal thresholds on public pages.',
        ],
      },
      {
        id: 'updates',
        title: 'How frequently data updates',
        paragraphs: [
          'Curated baskets and modeled outputs refresh when underlying inputs or engine versions change. Page “Last updated” stamps and content caches reflect the latest generated knowledge document for that city, country, or comparison.',
          'FX and local micro-markets can change faster than index refresh cycles — treat figures as planning anchors.',
        ],
      },
      {
        id: 'tiers',
        title: 'Verified, Curated, Estimated, Regional, and Country-level',
        paragraphs: ['Quality tiers mean:'],
        bullets: [
          'Verified — Supported by surveyed or directly validated basket inputs for that city.',
          'Curated — Drawn from CityCost’s internal curated reference dataset for priority places.',
          'Estimated — Modeled from regional averages or related signals when a full local survey is unavailable.',
          'Regional — Anchored primarily to regional (multi-city) patterns rather than a city-specific survey.',
          'Country-level — Anchored primarily to country-wide patterns; city micro-markets may differ substantially.',
        ],
      },
    ],
  },

  'data-sources': {
    id: 'data-sources',
    path: '/data-sources',
    title: 'Data Sources — CityCost Global',
    meta_description:
      'Transparent overview of CityCost Global data providers: geo database, exchange rates, population, curated and estimated cost data.',
    h1: 'Data Sources',
    intro:
      'Trust requires knowing where numbers come from. Below is a high-level inventory of source categories used by CityCost Global. Sensitive implementation details (API keys, proprietary weights, vendor contracts) are never published.',
    schema_type: 'WebPage',
    last_updated: UPDATED,
    sections: DATA_SOURCES.map((s) => ({
      id: s.id,
      title: s.name,
      paragraphs: [
        `Purpose: ${s.purpose}`,
        `Coverage: ${s.coverage}`,
        `Last update: ${s.last_update}`,
        `Confidence: ${s.confidence}`,
        `License: ${s.license}`,
        `Category: ${s.category}`,
      ],
    })),
  },

  about: {
    id: 'about',
    path: '/about',
    title: 'About CityCost Global',
    meta_description:
      'Mission and vision of CityCost Global — a cost-of-living knowledge platform for students, families, remote workers, expats, and businesses.',
    h1: 'About CityCost Global',
    intro:
      'CityCost Global exists to make cross-city living costs comparable, explainable, and honest about uncertainty — turning a comparison tool into a trusted knowledge platform.',
    schema_type: 'AboutPage',
    last_updated: UPDATED,
    sections: [
      {
        id: 'mission',
        title: 'Mission',
        paragraphs: [
          'Help people make clearer relocation and budgeting decisions with structured cost-of-living data, transparent quality labels, and side-by-side comparisons.',
        ],
      },
      {
        id: 'vision',
        title: 'Vision',
        paragraphs: [
          'Become a dependable public knowledge layer for global living costs — where every figure is traceable to a method, a source tier, and a dated update.',
        ],
      },
      {
        id: 'purpose',
        title: 'Purpose of the project',
        paragraphs: [
          'Scattered blogs and informal rankings rarely show methodology or confidence. CityCost combines an eligibility-driven index, a cost engine, and an authority layer (methodology, sources, disclaimers) so readers can judge fitness for their decision.',
        ],
      },
      {
        id: 'interpret',
        title: 'How users should interpret estimates',
        paragraphs: [
          'Treat indices and sample prices as planning anchors, not quotes. Neighbourhood, housing type, lifestyle, taxes, and visas can dominate outcomes. When a page says Estimated, expect wider error bands than Verified or Curated cities.',
        ],
      },
      {
        id: 'who',
        title: 'Who benefits',
        paragraphs: ['CityCost is built for:'],
        bullets: [
          'Students — housing and daily-cost framing near campuses and metros.',
          'Families — multi-category baskets (rent, groceries, utilities) for household planning.',
          'Remote workers — comparing lower-CPI cities while validating visas independently.',
          'Businesses — high-level market cost context for mobility and compensation discussions.',
          'Expats — local-currency prices and purchasing-power context before a move.',
          'Digital nomads — rapid city-to-city comparisons with transparent confidence labels.',
        ],
      },
    ],
  },

  contact: {
    id: 'contact',
    path: '/contact',
    title: 'Contact CityCost Global',
    meta_description:
      'Contact CityCost Global for feedback, data corrections, business inquiries, and support. Forms will be available in a future release.',
    h1: 'Contact',
    intro:
      'We welcome feedback that improves accuracy and clarity. Use the channels below. Interactive forms will be integrated in a future release; until then, use the mailto links with a clear subject line.',
    schema_type: 'ContactPage',
    last_updated: UPDATED,
    sections: [
      {
        id: 'feedback',
        title: 'Product feedback',
        paragraphs: [
          'Share UX or feature suggestions: mailto:hello@citycost.online?subject=Product%20Feedback',
        ],
      },
      {
        id: 'data-issue',
        title: 'Report incorrect prices',
        paragraphs: [
          'If a rent, salary, or index looks wrong, include the city page URL, the field, and a reputable source if you have one: mailto:data@citycost.online?subject=Data%20Issue',
        ],
      },
      {
        id: 'corrections',
        title: 'Suggest corrections',
        paragraphs: [
          'Place-name, slug, or metadata corrections: mailto:data@citycost.online?subject=Correction%20Suggestion',
        ],
      },
      {
        id: 'business',
        title: 'Business inquiries',
        paragraphs: [
          'Partnerships, licensing, and enterprise questions: mailto:business@citycost.online?subject=Business%20Inquiry',
        ],
      },
      {
        id: 'support',
        title: 'General support',
        paragraphs: [
          'Other questions: mailto:support@citycost.online?subject=Support',
        ],
      },
      {
        id: 'future-form',
        title: 'Future form integration',
        paragraphs: [
          'This page is structured for a future on-site form (topic, city URL, message, optional attachment). Until launch, email remains the supported channel.',
        ],
      },
    ],
  },

  privacy: {
    id: 'privacy',
    path: '/privacy',
    title: 'Privacy Policy — CityCost Global',
    meta_description: 'Privacy Policy for CityCost Global: what we collect, cookies, analytics, and your choices.',
    h1: 'Privacy Policy',
    intro: 'This Privacy Policy describes how CityCost Global (“we”, “us”) handles information when you use citycost.online.',
    schema_type: 'PrivacyPolicy',
    last_updated: UPDATED,
    sections: [
      {
        id: 'collect',
        title: 'Information we collect',
        paragraphs: [
          'We may collect technical logs (IP address, user agent, timestamps) needed to operate and secure the service, and optional analytics events that help us understand aggregate usage.',
          'If you email us, we process the content of your message to respond.',
        ],
      },
      {
        id: 'cookies',
        title: 'Cookies and similar technologies',
        paragraphs: [
          'We may use essential cookies for site function (for example preference or consent state) and, where consented, measurement or advertising cookies via third-party partners.',
          'You can manage consent through the on-site banner where provided and through your browser settings.',
        ],
      },
      {
        id: 'use',
        title: 'How we use information',
        paragraphs: [
          'To provide and improve the service, prevent abuse, respond to inquiries, and comply with legal obligations.',
        ],
      },
      {
        id: 'share',
        title: 'Sharing',
        paragraphs: [
          'We do not sell personal information. We may use infrastructure and analytics providers who process data under their own terms as subprocessors.',
        ],
      },
      {
        id: 'retention',
        title: 'Retention',
        paragraphs: [
          'Logs and messages are retained only as long as needed for operations, security, and legal requirements.',
        ],
      },
      {
        id: 'contact-privacy',
        title: 'Contact',
        paragraphs: [
          'Privacy questions: mailto:privacy@citycost.online?subject=Privacy',
        ],
      },
    ],
  },

  terms: {
    id: 'terms',
    path: '/terms',
    title: 'Terms of Service — CityCost Global',
    meta_description: 'Terms of Service for using CityCost Global cost-of-living tools and knowledge pages.',
    h1: 'Terms of Service',
    intro: 'By accessing citycost.online you agree to these Terms of Service.',
    schema_type: 'TermsOfService',
    last_updated: UPDATED,
    sections: [
      {
        id: 'service',
        title: 'The service',
        paragraphs: [
          'CityCost Global provides informational cost-of-living comparisons, indices, and related knowledge pages. Figures are planning aids, not professional financial, legal, or immigration advice.',
        ],
      },
      {
        id: 'acceptable',
        title: 'Acceptable use',
        paragraphs: [
          'You may not abuse the service (including scraping that degrades availability, attempting unauthorized access, or misrepresenting our data as a live quote for contracts).',
        ],
      },
      {
        id: 'ip',
        title: 'Intellectual property',
        paragraphs: [
          'Site design, curated datasets, and original text are owned by CityCost Global or its licensors. You may link to public pages with attribution; wholesale republication requires permission.',
        ],
      },
      {
        id: 'disclaimer-link',
        title: 'Disclaimers',
        paragraphs: [
          'Data may be estimated or incomplete. See /disclaimer for details on accuracy limitations.',
        ],
      },
      {
        id: 'liability',
        title: 'Limitation of liability',
        paragraphs: [
          'To the fullest extent permitted by law, CityCost Global is not liable for decisions made solely on the basis of site content, including relocation, hiring, or investment decisions.',
        ],
      },
      {
        id: 'changes',
        title: 'Changes',
        paragraphs: [
          'We may update these Terms; the “Last updated” date on this page will change when we do. Continued use after updates constitutes acceptance.',
        ],
      },
    ],
  },

  disclaimer: {
    id: 'disclaimer',
    path: '/disclaimer',
    title: 'Disclaimer — CityCost Global',
    meta_description:
      'Important disclaimer: estimated values, possible inaccuracies, regional differences, and currency fluctuations on CityCost Global.',
    h1: 'Disclaimer',
    intro:
      'Please read this disclaimer before relying on any figure published on CityCost Global.',
    schema_type: 'WebPage',
    last_updated: UPDATED,
    sections: [
      {
        id: 'estimated',
        title: 'Estimated values',
        paragraphs: [
          'Many cities use estimated or regional models when a full local survey is unavailable. Estimated values can differ from what you pay in a specific neighbourhood.',
        ],
      },
      {
        id: 'inaccuracies',
        title: 'Possible inaccuracies',
        paragraphs: [
          'Baskets, FX references, and place metadata can contain errors or lag. Report issues via /contact so we can investigate.',
        ],
      },
      {
        id: 'regional',
        title: 'Regional differences',
        paragraphs: [
          'National or regional averages hide large intra-city and intra-country spreads. Centre rents often diverge from suburban markets.',
        ],
      },
      {
        id: 'fx',
        title: 'Currency fluctuations',
        paragraphs: [
          'Exchange rates move continuously. Converted totals and cross-border comparisons can change between visits even if local prices are unchanged.',
        ],
      },
      {
        id: 'not-advice',
        title: 'Not professional advice',
        paragraphs: [
          'Nothing on this site is financial, tax, legal, real-estate, or immigration advice. Verify critical decisions with qualified professionals and primary local sources.',
        ],
      },
    ],
  },
};

export function getAuthorityPage(id: string): AuthorityPageDoc | null {
  return AUTHORITY_PAGES[id] || null;
}

export function listAuthorityPages(): AuthorityPageDoc[] {
  return Object.values(AUTHORITY_PAGES);
}
