/**
 * Server-side HTML meta + JSON-LD injection for programmatic SEO routes.
 * Keeps crawler-visible title/description/canonical without requiring client JS.
 */

import {
  buildCountryPageData,
  buildCityPageData,
  listIndexableComparisons,
  cityQueryLabel,
  findCityBySlug,
  seoSlug,
} from './seo-catalog.js';
import {
  SITE_NAME,
  SITE_URL,
  OG_IMAGE,
  buildHomeTitle,
  buildHomeDescription,
  buildHomeKeywords,
  buildHomeCanonical,
  buildCompareTitle,
  buildCompareDescription,
  buildCompareKeywords,
  buildCompareCanonical,
  buildCountryTitle,
  buildCountryDescription,
  buildCountryKeywords,
  buildCountryCanonical,
  buildCityTitle,
  buildCityDescription,
  buildCityKeywords,
  buildCityCanonical,
  buildOrganizationSchema,
  buildWebSiteSchema,
  buildWebPageSchema,
  buildBreadcrumbSchema,
  buildFAQSchema,
  buildServerMetaHtml,
  buildServerJsonLdScript,
} from '../src/utils/seo.js';
import {
  getAuthorityPage,
  buildAuthorityWebPageSchema,
  buildAuthorityBreadcrumb,
} from './eeat-engine/index.js';
import { buildIntentPageFromPath } from './search-intent/index.js';

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripDefaultHeadMeta(html: string): string {
  // Remove default title / primary metas so injected route meta is authoritative (avoid duplicates)
  return html
    .replace(/<title>[^<]*<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/gi, '')
    .replace(/<meta\s+name="keywords"[^>]*>/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:type"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:url"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:title"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:description"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:image"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:title"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:description"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:image"[^>]*>/gi, '');
}

function injectBeforeHeadClose(html: string, block: string): string {
  if (html.includes('</head>')) {
    return html.replace('</head>', `${block}\n</head>`);
  }
  return html + block;
}

export function injectSeoIntoHtml(html: string, pathname: string): string {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';

  if (path === '/' || path === '') {
    const title = buildHomeTitle();
    const desc = buildHomeDescription();
    const canon = buildHomeCanonical();
    const meta = buildServerMetaHtml({
      title,
      description: desc,
      keywords: buildHomeKeywords(),
      canonical: canon,
      ogType: 'website',
    });
    const ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('website', buildWebSiteSchema()) +
      buildServerJsonLdScript('webpage', buildWebPageSchema(title, desc, canon));
    return injectBeforeHeadClose(stripDefaultHeadMeta(html), meta + ld);
  }

  const countryMatch = path.match(/^\/country\/([a-z0-9-]+)$/i);
  if (countryMatch) {
    const data = buildCountryPageData(countryMatch[1]);
    if (!data) return html;
    const title = buildCountryTitle(data.name);
    const desc = buildCountryDescription(data.name);
    const canon = buildCountryCanonical(data.slug);
    const meta = buildServerMetaHtml({
      title,
      description: desc,
      keywords: buildCountryKeywords(data.name),
      canonical: canon,
      ogType: 'website',
    });
    const ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('website', buildWebSiteSchema()) +
      buildServerJsonLdScript('webpage', buildWebPageSchema(title, desc, canon)) +
      buildServerJsonLdScript('place', {
        '@context': 'https://schema.org',
        '@type': 'Country',
        name: data.name,
        url: canon,
        currency: data.currency,
      }) +
      buildServerJsonLdScript('breadcrumb', {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: data.name, item: canon },
        ],
      }) +
      buildServerJsonLdScript('faq', {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: data.faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      });
    return injectBeforeHeadClose(stripDefaultHeadMeta(html), meta + ld);
  }

  const cityMatch = path.match(/^\/city\/([a-z0-9-]+)$/i);
  if (cityMatch) {
    const data = buildCityPageData(cityMatch[1]);
    if (!data) return html;
    const title = buildCityTitle(data.city, data.country);
    const desc = data.seo_description || buildCityDescription(data.city, data.country);
    const canon = buildCityCanonical(data.slug);
    const meta = buildServerMetaHtml({
      title,
      description: desc,
      keywords: buildCityKeywords(data.city, data.country),
      canonical: canon,
      ogType: 'article',
    });
    const ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('website', buildWebSiteSchema()) +
      buildServerJsonLdScript('webpage', buildWebPageSchema(title, desc, canon)) +
      buildServerJsonLdScript('city', {
        '@context': 'https://schema.org',
        '@type': 'City',
        name: data.city,
        url: canon,
        containedInPlace: { '@type': 'Country', name: data.country },
        ...(data.latitude != null && data.longitude != null
          ? { geo: { '@type': 'GeoCoordinates', latitude: data.latitude, longitude: data.longitude } }
          : {}),
      }) +
      buildServerJsonLdScript('breadcrumb', {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: data.country, item: `${SITE_URL}/country/${data.countrySlug}` },
          { '@type': 'ListItem', position: 3, name: data.city, item: canon },
        ],
      }) +
      buildServerJsonLdScript('faq', {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: data.faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      });
    return injectBeforeHeadClose(stripDefaultHeadMeta(html), meta + ld);
  }

  const compareMatch = path.match(/^\/compare\/([a-z0-9-]+)-vs-([a-z0-9-]+)$/i);
  if (compareMatch) {
    const slugA = compareMatch[1];
    const slugB = compareMatch[2];
    // Prefer catalog full-city slug match; fall back to short city name from compare slug
    const comps = listIndexableComparisons();
    const hit = comps.find((p) => p.slug === `${seoSlug([slugA])}-vs-${seoSlug([slugB])}`) ||
      comps.find((p) => p.slug === `${slugA}-vs-${slugB}`);
    const cityA = hit?.queryA || slugA.replace(/-/g, ' ');
    const cityB = hit?.queryB || slugB.replace(/-/g, ' ');
    const aShort = cityA.split(',')[0].trim();
    const bShort = cityB.split(',')[0].trim();
    const title = buildCompareTitle(cityA, cityB);
    const desc = buildCompareDescription(cityA, cityB);
    const canon = buildCompareCanonical(cityA, cityB);
    const meta = buildServerMetaHtml({
      title,
      description: desc,
      keywords: buildCompareKeywords(cityA, cityB),
      canonical: canon,
      ogType: 'article',
    });
    const ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('website', buildWebSiteSchema()) +
      buildServerJsonLdScript('webpage', buildWebPageSchema(title, desc, canon, 'ComparisonPage')) +
      buildServerJsonLdScript('breadcrumb', buildBreadcrumbSchema(aShort, bShort, canon)) +
      buildServerJsonLdScript('faq', buildFAQSchema(aShort, bShort));
    return injectBeforeHeadClose(stripDefaultHeadMeta(html), meta + ld);
  }

  const authorityMatch = path.match(
    /^\/(methodology|data-sources|about|contact|privacy|terms|disclaimer)$/i
  );
  if (authorityMatch) {
    const doc = getAuthorityPage(authorityMatch[1]);
    if (!doc) return html;
    const title = doc.title.includes(SITE_NAME) ? doc.title : `${doc.title} | ${SITE_NAME}`;
    const canon = `${SITE_URL}${doc.path}`;
    const meta = buildServerMetaHtml({
      title,
      description: doc.meta_description,
      keywords: `${doc.h1}, CityCost, cost of living, methodology, EEAT`,
      canonical: canon,
      ogType: 'website',
    });
    const ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('website', buildWebSiteSchema()) +
      buildServerJsonLdScript('webpage', buildAuthorityWebPageSchema(doc)) +
      buildServerJsonLdScript('breadcrumb', buildAuthorityBreadcrumb(doc));
    return injectBeforeHeadClose(stripDefaultHeadMeta(html), meta + ld);
  }

  const intentPage = buildIntentPageFromPath(path);
  if (intentPage) {
    const title = intentPage.title;
    const canon = `${SITE_URL}${intentPage.path}`;
    const meta = buildServerMetaHtml({
      title,
      description: intentPage.description,
      keywords: `${intentPage.h1}, cost of living, CityCost`,
      canonical: canon,
      ogType: 'article',
    });
    let ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('website', buildWebSiteSchema()) +
      buildServerJsonLdScript('webpage', buildWebPageSchema(title, intentPage.description, canon)) +
      buildServerJsonLdScript('breadcrumb', {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: intentPage.h1, item: canon },
        ],
      });
    if (intentPage.faqs.length) {
      ld += buildServerJsonLdScript('faq', {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: intentPage.faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      });
    }
    return injectBeforeHeadClose(stripDefaultHeadMeta(html), meta + ld);
  }

  return html;
}

export function xmlUrlset(urls: string[]): string {
  const lastmod = new Date().toISOString().slice(0, 10);
  const body = urls
    .map(
      (loc) => `  <url>
    <loc>${esc(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${loc.endsWith('/') || loc === SITE_URL ? '1.0' : '0.8'}</priority>
  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

export function xmlSitemapIndex(sitemaps: string[]): string {
  const lastmod = new Date().toISOString().slice(0, 10);
  const body = sitemaps
    .map(
      (loc) => `  <sitemap>
    <loc>${esc(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`;
}

export { findCityBySlug, cityQueryLabel, SITE_NAME, OG_IMAGE };
