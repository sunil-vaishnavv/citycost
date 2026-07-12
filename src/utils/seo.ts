/**
 * SEO Utility Module — CityCost.online
 * Centralises all metadata generation, schema builders, and DOM helpers.
 * Used by App.tsx (client-side head updates) and server.ts (SSR meta injection).
 */

export const SITE_NAME = 'CityCost Global';
export const SITE_URL  = 'https://citycost.online';
export const SITE_DESC = 'Compare the cost of living between any two cities worldwide. Analyze rent, groceries, purchasing power, salaries, utilities, and restaurant prices side by side.';
export const OG_IMAGE  = `${SITE_URL}/og-image.jpg`;
export const LOGO_URL  = `${SITE_URL}/logo.png`;

// ─── Title builders ──────────────────────────────────────────────────────────

export function buildHomeTitle(): string {
  return `Free Cost of Living Calculator - Compare Cities Worldwide | ${SITE_NAME}`;
}

export function buildCompareTitle(cityA: string, cityB: string): string {
  const a = cityA.split(',')[0].trim();
  const b = cityB.split(',')[0].trim();
  return `${a} vs ${b} Cost of Living Comparison (2026) | ${SITE_NAME}`;
}

// ─── Description builders ─────────────────────────────────────────────────────

export function buildHomeDescription(): string {
  return 'Compare the cost of living between any two cities worldwide. Get side-by-side rent, groceries, restaurant, transport, utilities, salary and purchasing power data — powered by AI.';
}

export function buildCompareDescription(cityA: string, cityB: string): string {
  const a = cityA.split(',')[0].trim();
  const b = cityB.split(',')[0].trim();
  return `Compare the cost of living in ${a} and ${b}. Side-by-side data on rent, groceries, restaurants, transportation, utilities, average salary, and purchasing power index (2026).`;
}

// ─── Canonical URL builders ───────────────────────────────────────────────────

export function buildHomeCanonical(): string {
  return SITE_URL;
}

export function buildCompareCanonical(cityA: string, cityB: string): string {
  const slugA = slugifySEO(cityA.split(',')[0]);
  const slugB = slugifySEO(cityB.split(',')[0]);
  return `${SITE_URL}/compare/${slugA}-vs-${slugB}`;
}

function slugifySEO(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ─── Keywords ────────────────────────────────────────────────────────────────

export function buildHomeKeywords(): string {
  return 'cost of living comparison, city cost calculator, compare cities, rent comparison, salary comparison, purchasing power, cost of living index, city price comparison, relocation calculator, expat cost of living';
}

export function buildCompareKeywords(cityA: string, cityB: string): string {
  const a = cityA.split(',')[0].trim();
  const b = cityB.split(',')[0].trim();
  return `${a} vs ${b} cost of living, ${a} ${b} comparison, cost of living ${a}, cost of living ${b}, rent ${a} ${b}, is ${a} cheaper than ${b}, moving from ${a} to ${b}`;
}

// ─── DOM meta tag helpers (client-side SPA updates) ──────────────────────────

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel: string, href: string, extra?: Record<string, string>) {
  if (typeof document === 'undefined') return;
  // Use hreflang or canonical as a discriminator
  const selector = extra?.hreflang
    ? `link[rel="${rel}"][hreflang="${extra.hreflang}"]`
    : `link[rel="${rel}"]`;
  let el = document.querySelector<HTMLLinkElement>(selector);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
  if (extra) {
    Object.entries(extra).forEach(([k, v]) => el!.setAttribute(k, v));
  }
}

function setJsonLd(id: string, data: object) {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLScriptElement>(`script[data-schema="${id}"]`);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.setAttribute('data-schema', id);
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data, null, 0);
}

// ─── Full head update for home page ──────────────────────────────────────────

export function applyHomeMeta() {
  if (typeof document === 'undefined') return;

  const title = buildHomeTitle();
  const desc  = buildHomeDescription();
  const canon = buildHomeCanonical();
  const kw    = buildHomeKeywords();

  document.title = title;

  setMeta('description', desc);
  setMeta('keywords', kw);
  setMeta('robots', 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');
  setMeta('language', 'en');

  // Canonical + hreflang
  setLink('canonical', canon);
  setLink('alternate', canon, { hreflang: 'en' });
  setLink('alternate', canon, { hreflang: 'x-default' });

  // Open Graph
  setMeta('og:type',        'website',   'property');
  setMeta('og:url',         canon,       'property');
  setMeta('og:site_name',   SITE_NAME,   'property');
  setMeta('og:title',       title,       'property');
  setMeta('og:description', desc,        'property');
  setMeta('og:image',       OG_IMAGE,    'property');
  setMeta('og:image:width', '1200',      'property');
  setMeta('og:image:height','630',       'property');
  setMeta('og:locale',      'en_US',     'property');

  // Twitter Card
  setMeta('twitter:card',        'summary_large_image');
  setMeta('twitter:site',        '@citycostglobal');
  setMeta('twitter:title',       title);
  setMeta('twitter:description', desc);
  setMeta('twitter:image',       OG_IMAGE);

  // Schema — Organization
  setJsonLd('organization', buildOrganizationSchema());

  // Schema — WebSite + SearchAction
  setJsonLd('website', buildWebSiteSchema());

  // Schema — WebPage (home)
  setJsonLd('webpage', buildWebPageSchema(title, desc, canon));

  // Remove stale compare schemas
  removeJsonLd('breadcrumb');
  removeJsonLd('faq');
}

// ─── Full head update for compare page ───────────────────────────────────────

export function applyCompareMeta(
  cityA: string,
  cityB: string,
  data?: { cpiA?: number; cpiB?: number; rentA?: number; rentB?: number; ppA?: number; ppB?: number }
) {
  if (typeof document === 'undefined') return;

  const a      = cityA.split(',')[0].trim();
  const b      = cityB.split(',')[0].trim();
  const title  = buildCompareTitle(cityA, cityB);
  const desc   = buildCompareDescription(cityA, cityB);
  const canon  = buildCompareCanonical(cityA, cityB);
  const kw     = buildCompareKeywords(cityA, cityB);

  document.title = title;

  setMeta('description', desc);
  setMeta('keywords', kw);
  setMeta('robots', 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');
  setMeta('language', 'en');

  // Canonical + hreflang
  setLink('canonical', canon);
  setLink('alternate', canon, { hreflang: 'en' });
  setLink('alternate', canon, { hreflang: 'x-default' });

  // Open Graph
  setMeta('og:type',        'article',  'property');
  setMeta('og:url',         canon,      'property');
  setMeta('og:site_name',   SITE_NAME,  'property');
  setMeta('og:title',       title,      'property');
  setMeta('og:description', desc,       'property');
  setMeta('og:image',       OG_IMAGE,   'property');
  setMeta('og:image:width', '1200',     'property');
  setMeta('og:image:height','630',      'property');
  setMeta('og:locale',      'en_US',    'property');

  // Twitter Card
  setMeta('twitter:card',        'summary_large_image');
  setMeta('twitter:site',        '@citycostglobal');
  setMeta('twitter:title',       title);
  setMeta('twitter:description', desc);
  setMeta('twitter:image',       OG_IMAGE);

  // Schema — Breadcrumb
  setJsonLd('breadcrumb', buildBreadcrumbSchema(a, b, canon));

  // Schema — FAQ
  setJsonLd('faq', buildFAQSchema(a, b, data));

  // Schema — WebPage (compare)
  setJsonLd('webpage', buildWebPageSchema(title, desc, canon, 'ComparisonPage'));

  // Keep org + website schemas
  setJsonLd('organization', buildOrganizationSchema());
  setJsonLd('website', buildWebSiteSchema());
}

function removeJsonLd(id: string) {
  if (typeof document === 'undefined') return;
  document.querySelector(`script[data-schema="${id}"]`)?.remove();
}

// ─── Schema builders ──────────────────────────────────────────────────────────

export function buildOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: LOGO_URL,
      width: 200,
      height: 60,
    },
    description:
      'CityCost Global publishes structured cost-of-living comparisons and knowledge pages with transparent methodology and data-quality labels.',
    sameAs: [
      'https://twitter.com/citycostglobal',
      'https://www.facebook.com/citycostglobal',
    ],
    publishingPrinciples: `${SITE_URL}/methodology`,
    knowsAbout: [
      'Cost of living',
      'City comparison',
      'Purchasing power',
      'Relocation planning',
    ],
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        url: `${SITE_URL}/contact`,
        email: 'support@citycost.online',
      },
      {
        '@type': 'ContactPoint',
        contactType: 'data correction',
        url: `${SITE_URL}/contact`,
        email: 'data@citycost.online',
      },
    ],
  };
}

export function buildWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESC,
    inLanguage: 'en-US',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/compare/{search_term_string}-vs-{search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function buildWebPageSchema(
  title: string,
  description: string,
  url: string,
  type: string = 'WebPage'
) {
  return {
    '@context': 'https://schema.org',
    '@type': type,
    name: title,
    description,
    url,
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite', url: SITE_URL, name: SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    dateModified: new Date().toISOString().split('T')[0],
  };
}

export function buildBreadcrumbSchema(cityA: string, cityB: string, url: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Compare Cities',
        item: `${SITE_URL}/compare`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: `${cityA} vs ${cityB}`,
        item: url,
      },
    ],
  };
}

export function buildFAQSchema(
  cityA: string,
  cityB: string,
  data?: { cpiA?: number; cpiB?: number; rentA?: number; rentB?: number; ppA?: number; ppB?: number }
) {
  const cpiA  = data?.cpiA  ?? 0;
  const cpiB  = data?.cpiB  ?? 0;
  const rentA = data?.rentA ?? 0;
  const rentB = data?.rentB ?? 0;
  const ppA   = data?.ppA   ?? 0;
  const ppB   = data?.ppB   ?? 0;

  const cheaperCity   = cpiA <= cpiB ? cityA : cityB;
  const pricierCity   = cpiA <= cpiB ? cityB : cityA;
  const cpiDiff       = cpiA > 0 ? Math.abs(((cpiB - cpiA) / cpiA) * 100).toFixed(0) : 'N/A';
  const rentCheaper   = rentA <= rentB ? cityA : cityB;
  const rentDiff      = rentA > 0 ? Math.abs(((rentB - rentA) / rentA) * 100).toFixed(0) : 'N/A';
  const betterPPCity  = ppA >= ppB ? cityA : cityB;
  const ppDiff        = Math.min(ppA, ppB) > 0
    ? Math.abs(((Math.max(ppA, ppB) - Math.min(ppA, ppB)) / Math.min(ppA, ppB)) * 100).toFixed(0)
    : 'N/A';

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `Is ${cityA} more expensive than ${cityB}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: cpiA > 0
            ? `${pricierCity} is more expensive than ${cheaperCity} by approximately ${cpiDiff}% based on the Consumer Price Index (excluding rent).`
            : `Use our comparison tool to get the latest cost of living data for ${cityA} and ${cityB}.`,
        },
      },
      {
        '@type': 'Question',
        name: `Which city has cheaper rent, ${cityA} or ${cityB}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: rentA > 0
            ? `${rentCheaper} has cheaper rent. The rent index difference between ${cityA} and ${cityB} is approximately ${rentDiff}%.`
            : `Compare ${cityA} and ${cityB} using our tool to see the latest rental price data.`,
        },
      },
      {
        '@type': 'Question',
        name: `Which city has better purchasing power, ${cityA} or ${cityB}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: ppA > 0
            ? `${betterPPCity} offers better local purchasing power, approximately ${ppDiff}% stronger than the other city.`
            : `Use our tool to compare purchasing power between ${cityA} and ${cityB}.`,
        },
      },
      {
        '@type': 'Question',
        name: `How do groceries compare between ${cityA} and ${cityB}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Our tool provides a full grocery price comparison between ${cityA} and ${cityB}, including milk, bread, rice, eggs, chicken, fruits, and vegetables. Use the Groceries category filter in the price list section.`,
        },
      },
      {
        '@type': 'Question',
        name: `Can I save money by moving from ${cityA} to ${cityB}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Whether you save money moving from ${cityA} to ${cityB} depends on your salary, lifestyle, and housing choice. Use the full comparison above — including rent, groceries, transport, and purchasing power — to estimate your budget impact.`,
        },
      },
      {
        '@type': 'Question',
        name: `Is transportation cheaper in ${cityA} or ${cityB}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Our price list includes one-way local transport tickets, monthly passes, and taxi costs for both ${cityA} and ${cityB}. Filter by Transportation in the detailed price list to compare.`,
        },
      },
    ],
  };
}

// ─── Country / City programmatic SEO meta ────────────────────────────────────

export function buildCountryTitle(country: string): string {
  return `Cost of Living in ${country} (2026) — Cities, Rent & Salaries | ${SITE_NAME}`;
}

export function buildCountryDescription(country: string): string {
  return `Explore the cost of living across ${country}. Compare average rent, salaries, groceries, and city rankings. Find the cheapest and most expensive cities with side-by-side tools.`;
}

export function buildCountryCanonical(slug: string): string {
  return `${SITE_URL}/country/${slug}`;
}

export function buildCountryKeywords(country: string): string {
  return `cost of living ${country}, ${country} rent, ${country} salary, cheapest cities ${country}, expensive cities ${country}, living costs ${country}`;
}

export function buildCityTitle(city: string, country: string): string {
  return `Cost of Living in ${city}, ${country} (2026) — Rent, Salary & Prices | ${SITE_NAME}`;
}

export function buildCityDescription(city: string, country: string): string {
  return `Cost of living in ${city}, ${country}: rent, groceries, restaurants, transport, utilities, and average salary. Compare ${city} with nearby cities and global destinations.`;
}

export function buildCityCanonical(slug: string): string {
  return `${SITE_URL}/city/${slug}`;
}

export function buildCityKeywords(city: string, country: string): string {
  return `cost of living ${city}, ${city} rent, ${city} salary, living in ${city}, ${city} ${country} prices, is ${city} expensive`;
}

export function applyCountryMeta(data: {
  name: string;
  slug: string;
  currency: string;
  summary: string;
  faqs: Array<{ q: string; a: string }>;
}) {
  if (typeof document === 'undefined') return;
  const title = buildCountryTitle(data.name);
  const desc = buildCountryDescription(data.name);
  const canon = buildCountryCanonical(data.slug);
  const kw = buildCountryKeywords(data.name);

  document.title = title;
  setMeta('description', desc);
  setMeta('keywords', kw);
  setMeta('robots', 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');
  setMeta('language', 'en');
  setLink('canonical', canon);
  setLink('alternate', canon, { hreflang: 'en' });
  setLink('alternate', canon, { hreflang: 'x-default' });

  setMeta('og:type', 'website', 'property');
  setMeta('og:url', canon, 'property');
  setMeta('og:site_name', SITE_NAME, 'property');
  setMeta('og:title', title, 'property');
  setMeta('og:description', desc, 'property');
  setMeta('og:image', OG_IMAGE, 'property');
  setMeta('og:locale', 'en_US', 'property');

  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', title);
  setMeta('twitter:description', desc);
  setMeta('twitter:image', OG_IMAGE);

  setJsonLd('organization', buildOrganizationSchema());
  setJsonLd('website', buildWebSiteSchema());
  setJsonLd('webpage', buildWebPageSchema(title, desc, canon));
  setJsonLd('place', {
    '@context': 'https://schema.org',
    '@type': 'Country',
    name: data.name,
    url: canon,
    currency: data.currency,
  });
  setJsonLd('breadcrumb', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Countries', item: `${SITE_URL}/country/${data.slug}` },
      { '@type': 'ListItem', position: 3, name: data.name, item: canon },
    ],
  });
  setJsonLd('faq', {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: data.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  });
}

export function applyCityMeta(data: {
  city: string;
  country: string;
  countrySlug: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  faqs: Array<{ q: string; a: string }>;
  seo_description?: string;
}) {
  if (typeof document === 'undefined') return;
  const title = buildCityTitle(data.city, data.country);
  const desc = data.seo_description || buildCityDescription(data.city, data.country);
  const canon = buildCityCanonical(data.slug);
  const kw = buildCityKeywords(data.city, data.country);

  document.title = title;
  setMeta('description', desc);
  setMeta('keywords', kw);
  setMeta('robots', 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');
  setMeta('language', 'en');
  setLink('canonical', canon);
  setLink('alternate', canon, { hreflang: 'en' });
  setLink('alternate', canon, { hreflang: 'x-default' });

  setMeta('og:type', 'article', 'property');
  setMeta('og:url', canon, 'property');
  setMeta('og:site_name', SITE_NAME, 'property');
  setMeta('og:title', title, 'property');
  setMeta('og:description', desc, 'property');
  setMeta('og:image', OG_IMAGE, 'property');
  setMeta('og:locale', 'en_US', 'property');

  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', title);
  setMeta('twitter:description', desc);
  setMeta('twitter:image', OG_IMAGE);

  setJsonLd('organization', buildOrganizationSchema());
  setJsonLd('website', buildWebSiteSchema());
  setJsonLd('webpage', buildWebPageSchema(title, desc, canon));
  setJsonLd('city', {
    '@context': 'https://schema.org',
    '@type': 'City',
    name: data.city,
    url: canon,
    containedInPlace: { '@type': 'Country', name: data.country },
    ...(data.latitude != null && data.longitude != null
      ? { geo: { '@type': 'GeoCoordinates', latitude: data.latitude, longitude: data.longitude } }
      : {}),
  });
  setJsonLd('breadcrumb', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: data.country, item: `${SITE_URL}/country/${data.countrySlug}` },
      { '@type': 'ListItem', position: 3, name: data.city, item: canon },
    ],
  });
  setJsonLd('faq', {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: data.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  });
}

/** Authority / EEAT static pages (methodology, about, legal, etc.). */
export function applyAuthorityMeta(doc: {
  title: string;
  meta_description: string;
  path: string;
  h1: string;
  schema_type: string;
  last_updated: string;
}) {
  if (typeof document === 'undefined') return;
  const title = doc.title.includes(SITE_NAME) ? doc.title : `${doc.title} | ${SITE_NAME}`;
  const desc = doc.meta_description;
  const canon = `${SITE_URL}${doc.path}`;

  document.title = title;
  setMeta('description', desc);
  setMeta('keywords', `${doc.h1}, CityCost, cost of living, methodology, EEAT`);
  setMeta('robots', 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');
  setMeta('language', 'en');
  setLink('canonical', canon);
  setLink('alternate', canon, { hreflang: 'en' });
  setLink('alternate', canon, { hreflang: 'x-default' });

  setMeta('og:type', 'website', 'property');
  setMeta('og:url', canon, 'property');
  setMeta('og:site_name', SITE_NAME, 'property');
  setMeta('og:title', title, 'property');
  setMeta('og:description', desc, 'property');
  setMeta('og:image', OG_IMAGE, 'property');
  setMeta('og:locale', 'en_US', 'property');

  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', title);
  setMeta('twitter:description', desc);
  setMeta('twitter:image', OG_IMAGE);

  setJsonLd('organization', buildOrganizationSchema());
  setJsonLd('website', buildWebSiteSchema());
  setJsonLd('webpage', {
    '@context': 'https://schema.org',
    '@type': doc.schema_type,
    name: title,
    headline: doc.h1,
    description: desc,
    url: canon,
    inLanguage: 'en-US',
    dateModified: doc.last_updated,
    isPartOf: { '@type': 'WebSite', url: SITE_URL, name: SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL, publishingPrinciples: `${SITE_URL}/methodology` },
  });
  setJsonLd('breadcrumb', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: doc.h1, item: canon },
    ],
  });
  removeJsonLd('faq');
  removeJsonLd('city');
  removeJsonLd('place');
}

/** Search-intent landing / category / country-guide pages. */
export function applyIntentMeta(doc: {
  title: string;
  description: string;
  path: string;
  h1: string;
  last_updated: string;
  faqs?: Array<{ q: string; a: string }>;
}) {
  if (typeof document === 'undefined') return;
  const title = doc.title;
  const desc = doc.description;
  const canon = `${SITE_URL}${doc.path}`;

  document.title = title;
  setMeta('description', desc);
  setMeta('keywords', `${doc.h1}, cost of living, CityCost`);
  setMeta('robots', 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');
  setMeta('language', 'en');
  setLink('canonical', canon);
  setLink('alternate', canon, { hreflang: 'en' });
  setLink('alternate', canon, { hreflang: 'x-default' });

  setMeta('og:type', 'article', 'property');
  setMeta('og:url', canon, 'property');
  setMeta('og:site_name', SITE_NAME, 'property');
  setMeta('og:title', title, 'property');
  setMeta('og:description', desc, 'property');
  setMeta('og:image', OG_IMAGE, 'property');
  setMeta('og:locale', 'en_US', 'property');

  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', title);
  setMeta('twitter:description', desc);
  setMeta('twitter:image', OG_IMAGE);

  setJsonLd('organization', buildOrganizationSchema());
  setJsonLd('website', buildWebSiteSchema());
  setJsonLd('webpage', buildWebPageSchema(title, desc, canon));
  setJsonLd('breadcrumb', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: doc.h1, item: canon },
    ],
  });
  if (doc.faqs && doc.faqs.length) {
    setJsonLd('faq', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: doc.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  } else {
    removeJsonLd('faq');
  }
  removeJsonLd('city');
  removeJsonLd('place');
}

export function buildServerJsonLdScript(id: string, data: object): string {
  return `<script type="application/ld+json" data-schema="${id}">${JSON.stringify(data)}</script>`;
}

function escAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Server-side HTML meta block for crawler-friendly injection into index.html */
export function buildServerMetaHtml(config: {
  title: string;
  description: string;
  keywords: string;
  canonical: string;
  ogType?: string;
}): string {
  const { title, description, keywords, canonical, ogType = 'website' } = config;
  return `
  <title>${escAttr(title)}</title>
  <meta name="description" content="${escAttr(description)}" />
  <meta name="keywords" content="${escAttr(keywords)}" />
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
  <meta name="language" content="en" />
  <link rel="canonical" href="${escAttr(canonical)}" />
  <link rel="alternate" hreflang="en" href="${escAttr(canonical)}" />
  <link rel="alternate" hreflang="x-default" href="${escAttr(canonical)}" />
  <meta property="og:type" content="${escAttr(ogType)}" />
  <meta property="og:url" content="${escAttr(canonical)}" />
  <meta property="og:site_name" content="${escAttr(SITE_NAME)}" />
  <meta property="og:title" content="${escAttr(title)}" />
  <meta property="og:description" content="${escAttr(description)}" />
  <meta property="og:image" content="${OG_IMAGE}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale" content="en_US" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@citycostglobal" />
  <meta name="twitter:title" content="${escAttr(title)}" />
  <meta name="twitter:description" content="${escAttr(description)}" />
  <meta name="twitter:image" content="${OG_IMAGE}" />`;
}
