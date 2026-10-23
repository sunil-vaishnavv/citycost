/**
 * Server-side HTML meta + JSON-LD injection for programmatic SEO routes.
 * Keeps crawler-visible title/description/canonical without requiring client JS.
 */

import {
  buildCountryPageData,
  buildCityPageData,
  buildComparePageData,
  listIndexableComparisons,
  listIndexableCountries,
  listIndexableCities,
  findCityBySlug,
  cityQueryLabel,
  canonicalCitySlug,
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
  buildFaqPageSchema,
  buildServerMetaHtml,
  buildServerJsonLdScript,
} from '../src/utils/seo.js';
import {
  getAuthorityPage,
  buildAuthorityWebPageSchema,
  buildAuthorityBreadcrumb,
  AUTHORITY_NAV,
  buildTrustBlockHtml,
  buildDatasetSchema,
} from './eeat-engine/index.js';
import {
  buildHomeHowItWorks,
  buildHomeCompleteGuide,
  buildHomeFaqs,
  buildHomeMethodologySection,
  buildHomeAboutSection,
  buildCityOverviewSection,
  buildCityHousingSection,
  buildCityFoodSection,
  buildCityTransportSection,
  buildCityBudgetSection,
  buildCityConclusion,
  expandCityFaqs,
  buildCountryOverviewSection,
  buildCountryRegionalSection,
  buildCountryLivingExpensesSection,
  buildCountryBudgetSection,
  buildCountryConclusion,
  expandCountryFaqs,
} from './public-content/index.js';
import { buildIntentPageFromPath } from './search-intent/index.js';
import { parseCityLandingPath } from './search-intent/intent.js';

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Text nodes (not attributes). */
function escText(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripDefaultHeadMeta(html: string): string {
  // Remove default title / primary metas so injected route meta is authoritative (avoid duplicates)
  return html
    .replace(/<title>[^<]*<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/gi, '')
    .replace(/<meta\s+name="keywords"[^>]*>/gi, '')
    .replace(/<meta\s+name="robots"[^>]*>/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>/gi, '')
    .replace(/<link\s+rel="alternate"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:type"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:url"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:title"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:description"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:image"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:title"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:description"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:image"[^>]*>/gi, '');
}

/** Custom 404 HTML: noindex, no canonical (never home). React replaces #root on load. */
function buildNotFoundHtml(html: string): string {
  const title = 'Page Not Found | CityCost Global';
  const desc =
    "We couldn't find the page you were searching for. It may have been relocated, or is not yet in our SEO catalog.";
  const head = `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="robots" content="noindex, follow" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />`;
  const body = `<main id="seo-prerender-main">
  <p>Error 404: Page Not Found</p>
  <h1>Lost in the Index Metrics?</h1>
  <p>${escText(desc)}</p>
</main>`;
  return finalizeSeoHtml(html, head, body);
}

export type SeoHtmlResult =
  | { status: 200; html: string }
  | { status: 301; location: string }
  | { status: 404; html: string };

function injectBeforeHeadClose(html: string, block: string): string {
  if (html.includes('</head>')) {
    return html.replace('</head>', `${block}\n</head>`);
  }
  return html + block;
}

/**
 * Inject crawlable main content as a sibling AFTER empty #root.
 * Keeps React's mount target empty (avoids FOUC / blank-screen opacity hacks).
 * #seo-prerender stays in HTML source for crawlers; visually clipped for JS clients.
 */
function injectSeoPrerender(html: string, inner: string): string {
  if (!inner) return html;
  const block = `<div id="root"></div>
    <div id="seo-prerender" class="seo-prerender" aria-hidden="true"><!--seo-prerender-->${inner}</div>`;
  if (/<div id="root"\s*><\/div>/i.test(html)) {
    return html.replace(/<div id="root"\s*><\/div>/i, block);
  }
  return html;
}

function finalizeSeoHtml(html: string, headBlock: string, bodyInner: string): string {
  return injectSeoPrerender(injectBeforeHeadClose(stripDefaultHeadMeta(html), headBlock), bodyInner);
}

function linkList(
  items: Array<{ href: string; label: string }>,
  heading: string
): string {
  if (!items.length) return '';
  const lis = items
    .map((i) => `<li><a href="${esc(i.href)}">${escText(i.label)}</a></li>`)
    .join('');
  return `<nav aria-label="${esc(heading)}"><h2>${escText(heading)}</h2><ul>${lis}</ul></nav>`;
}

function buildHomeBodyHtml(): string {
  const countries = listIndexableCountries()
    .slice(0, 24)
    .map((c) => ({ href: `/country/${c.slug}`, label: c.name }));
  const cities = listIndexableCities()
    .slice(0, 16)
    .map((c) => ({
      href: `/city/${c.pageSlug}`,
      label: [c.city, c.country].filter(Boolean).join(', '),
    }));
  const comps = listIndexableComparisons()
    .slice(0, 12)
    .map((c) => ({ href: `/compare/${c.slug}`, label: `${c.cityA} vs ${c.cityB}` }));
  const authority = AUTHORITY_NAV.map((l) => ({ href: l.href, label: l.label }));
  const howSec = buildHomeHowItWorks();
  const guideSec = buildHomeCompleteGuide();
  const methodSec = buildHomeMethodologySection();
  const aboutSec = buildHomeAboutSection();
  const faqs = buildHomeFaqs({
    indexable_cities: listIndexableCities().length,
    indexable_countries: listIndexableCountries().length,
    indexable_comparisons: listIndexableComparisons().length,
  });
  const how = `<section id="${howSec.id}"><h2>${escText(howSec.title)}</h2>${howSec.paragraphs.map((p) => `<p>${escText(p)}</p>`).join('')}</section>`;
  const guide = `<section id="${guideSec.id}"><h2>${escText(guideSec.title)}</h2>${guideSec.paragraphs.map((p) => `<p>${escText(p)}</p>`).join('')}${
    guideSec.bullets?.length
      ? `<ul>${guideSec.bullets.map((b) => `<li>${escText(b)}</li>`).join('')}</ul>`
      : ''
  }</section>
  <section id="${methodSec.id}"><h2>${escText(methodSec.title)}</h2>${methodSec.paragraphs.map((p) => `<p>${escText(p)}</p>`).join('')}</section>
  <section id="${aboutSec.id}"><h2>${escText(aboutSec.title)}</h2>${aboutSec.paragraphs.map((p) => `<p>${escText(p)}</p>`).join('')}</section>`;
  const faqsHtml = `<section id="homepage-faq"><h2>Frequently Asked Questions</h2>${faqs
    .map((f) => `<div><h3>${escText(f.q)}</h3><p>${escText(f.a)}</p></div>`)
    .join('')}</section>`;
  return `<main id="seo-prerender-main">
  <h1>Free Cost of Living Calculator — Compare Cities Worldwide</h1>
  <p>${escText(buildHomeDescription())}</p>
  ${how}
  ${guide}
  ${linkList(authority, 'About CityCost')}
  ${linkList(countries, 'Country Explorer')}
  ${linkList(cities, 'Popular cities')}
  ${linkList(comps, 'Popular city comparisons')}
  ${linkList([{ href: '/blog', label: 'Latest editorial guides' }], 'Editorial guides')}
  ${faqsHtml}
  ${buildTrustBlockHtml({ lastUpdated: null, pageSources: ['CityCost Index'], escText })}
</main>`;
}

function proseHtml(sec: { id: string; title: string; paragraphs: string[]; bullets?: string[] }): string {
  return `<section id="${esc(sec.id)}"><h2>${escText(sec.title)}</h2>${sec.paragraphs
    .map((p) => `<p>${escText(p)}</p>`)
    .join('')}${
    sec.bullets?.length ? `<ul>${sec.bullets.map((b) => `<li>${escText(b)}</li>`).join('')}</ul>` : ''
  }</section>`;
}

function buildCountryBodyHtml(data: NonNullable<ReturnType<typeof buildCountryPageData>>): string {
  const cityLinks = (data.cities || []).slice(0, 40).map((c) => ({
    href: `/city/${c.slug}`,
    label: c.state ? `${c.city}, ${c.state}` : c.city,
  }));
  const cheapestLinks = (data.cheapest || []).slice(0, 8).map((c) => ({
    href: `/city/${c.slug}`,
    label: c.city,
  }));
  const expensiveLinks = (data.expensive || []).slice(0, 8).map((c) => ({
    href: `/city/${c.slug}`,
    label: c.city,
  }));
  const mostComparedLinks = (data.most_compared_cities || []).slice(0, 10).map((c) => ({
    href: `/city/${c.slug}`,
    label: c.state ? `${c.city}, ${c.state}` : c.city,
  }));
  const compLinks = (data.top_comparisons || []).slice(0, 12).map((c) => ({
    href: `/compare/${c.slug}`,
    label: c.label,
  }));
  const related = (data.related_countries || []).slice(0, 8).map((c) => ({
    href: `/country/${c.slug}`,
    label: c.name,
  }));
  const input = {
    name: data.name,
    slug: data.slug,
    currency: data.currency,
    symbol: data.symbol,
    population: data.population,
    avg_salary: data.avg_salary,
    avg_rent: data.avg_rent,
    avg_cpi: data.avg_cpi,
    avg_groceries_index: data.avg_groceries_index,
    cheapest: data.cheapest,
    expensive: data.expensive,
    cities: data.cities,
    top_comparisons: data.top_comparisons,
    most_compared_cities: data.most_compared_cities,
    related_countries: data.related_countries,
    faqs: data.faqs,
    summary: data.summary,
  };
  const faqs = expandCountryFaqs(input);
  return `<main id="seo-prerender-main">
  <h1>Cost of Living in ${escText(data.name)}</h1>
  <p>${escText(data.summary || buildCountryDescription(data.name))}</p>
  <p><a href="/about">Author: CityCost Global</a> · <a href="/methodology">Methodology</a> · <a href="/data-sources">Data Sources</a>${
    data.last_updated ? ` · Last updated: ${escText(data.last_updated.slice(0, 10))}` : ''
  }</p>
  <section>
    <h2>Key figures</h2>
    <ul>
      <li>Currency: ${escText(data.currency)}</li>
      <li>Average CPI index: ${escText(String(data.avg_cpi))}</li>
      <li>Average rent index signal: ${escText(String(data.avg_rent))}</li>
    </ul>
  </section>
  ${proseHtml(buildCountryOverviewSection(input))}
  ${proseHtml(buildCountryRegionalSection(input))}
  ${proseHtml(buildCountryLivingExpensesSection(input))}
  ${proseHtml(buildCountryBudgetSection(input))}
  ${linkList(cheapestLinks, 'Cheapest cities')}
  ${linkList(expensiveLinks, 'Most expensive cities')}
  ${linkList(mostComparedLinks, 'Most compared cities')}
  ${linkList(cityLinks, `Cities in ${data.name}`)}
  ${linkList(compLinks, 'Popular comparisons')}
  ${linkList(related, 'Related countries')}
  <section id="country-faq"><h2>FAQ</h2>${faqs.map((f) => `<div><h3>${escText(f.q)}</h3><p>${escText(f.a)}</p></div>`).join('')}</section>
  ${proseHtml(buildCountryConclusion(input))}
  ${buildTrustBlockHtml({
    lastUpdated: data.last_updated,
    pageSources: ['CityCost Index (aggregated eligible cities)'],
    escText,
  })}
  ${linkList(
    [
      { href: '/methodology', label: 'Methodology' },
      { href: '/data-sources', label: 'Data sources' },
    ],
    'Trust & methods'
  )}
</main>`;
}

function buildCityBodyHtml(data: NonNullable<ReturnType<typeof buildCityPageData>>): string {
  const fmt = (n: number) =>
    n > 0 ? `${data.symbol}${Math.round(n).toLocaleString('en-US')}` : '—';
  const nearby = (data.nearby || []).slice(0, 10).map((n) => ({
    href: `/city/${n.slug}`,
    label: n.state ? `${n.city}, ${n.state}` : n.city,
  }));
  const similar = (data.similar_cost_cities || []).slice(0, 8).map((n) => ({
    href: `/city/${n.slug}`,
    label: n.state ? `${n.city}, ${n.state}` : n.city,
  }));
  const comps = (data.related_comparisons || []).slice(0, 12).map((c) => ({
    href: `/compare/${c.slug}`,
    label: c.label,
  }));
  const input = {
    city: data.city,
    state: data.state,
    country: data.country,
    countrySlug: data.countrySlug,
    slug: data.slug,
    currency: data.currency,
    symbol: data.symbol,
    population: data.population,
    indices: data.indices,
    rent_1br: data.rent_1br,
    salary: data.salary,
    groceries_sample: data.groceries_sample,
    transport_sample: data.transport_sample,
    utilities: data.utilities,
    restaurant_meal: data.restaurant_meal,
    summary: data.summary,
    data_source: data.data_source,
    confidence_label: data.confidence_label,
    nearby: data.nearby,
    similar_cost_cities: data.similar_cost_cities,
    related_comparisons: data.related_comparisons,
    faqs: data.faqs,
    sections: data.sections,
    pros: data.pros,
    cons: data.cons,
    estimation_note: data.estimation_note,
  };
  const faqs = expandCityFaqs(input);
  return `<main id="seo-prerender-main">
  <h1>Cost of Living in ${escText(data.city)}${data.state ? `, ${escText(data.state)}` : ''}</h1>
  <p>${escText(data.summary || buildCityDescription(data.city, data.country))}</p>
  <p><a href="/about">Author: CityCost Global</a> · <a href="/methodology">Methodology</a> · <a href="/data-sources">Data Sources</a>${
    data.last_updated ? ` · Last updated: ${escText(data.last_updated.slice(0, 10))}` : ''
  }</p>
  <section>
    <h2>Key metrics</h2>
    <ul>
      <li>Country: <a href="/country/${esc(data.countrySlug)}">${escText(data.country)}</a></li>
      <li>Currency: ${escText(data.currency)}</li>
      <li>Avg 1BR rent (centre): ${escText(fmt(data.rent_1br))}</li>
      <li>Avg net salary: ${escText(fmt(data.salary))}</li>
      <li>Cost of living index (CPI): ${escText(String(data.indices.cpi_index))}</li>
      <li>Rent index: ${escText(String(data.indices.rent_index))}</li>
      <li>Purchasing power index: ${escText(String(data.indices.local_purchasing_power_index))}</li>
      <li>Groceries sample (milk 1L): ${escText(fmt(data.groceries_sample))}</li>
      <li>Transport ticket: ${escText(fmt(data.transport_sample))}</li>
      <li>Utilities (85m²): ${escText(fmt(data.utilities))}</li>
      <li>Restaurant meal: ${escText(fmt(data.restaurant_meal))}</li>
    </ul>
  </section>
  ${proseHtml(buildCityOverviewSection(input))}
  ${proseHtml(buildCityHousingSection(input))}
  ${proseHtml(buildCityFoodSection(input))}
  ${proseHtml(buildCityTransportSection(input))}
  ${proseHtml(buildCityBudgetSection(input))}
  ${linkList(nearby, 'Nearby cities')}
  ${linkList(similar, 'Similar cost cities')}
  ${linkList(comps, 'Top comparisons')}
  <section id="city-faq"><h2>FAQ</h2>${faqs.map((f) => `<div><h3>${escText(f.q)}</h3><p>${escText(f.a)}</p></div>`).join('')}</section>
  ${proseHtml(buildCityConclusion(input))}
  ${buildTrustBlockHtml({
    lastUpdated: data.last_updated,
    pageSources: [data.data_source, data.confidence_label].filter(Boolean),
    escText,
  })}
  ${linkList(
    [
      { href: `/country/${data.countrySlug}`, label: `Cost of living in ${data.country}` },
      { href: '/methodology', label: 'Methodology' },
      { href: '/data-sources', label: 'Data sources' },
    ],
    'More on CityCost'
  )}
</main>`;
}

function buildCompareBodyHtml(
  data: NonNullable<ReturnType<typeof buildComparePageData>>
): string {
  const a = data.queryA.split(',')[0].trim();
  const b = data.queryB.split(',')[0].trim();
  const e = data.enrichment;
  const rows = (e.category_winners || [])
    .map(
      (w) =>
        `<tr><th scope="row">${escText(w.category)}</th><td>${escText(w.winner)}</td><td>${escText(w.note)}</td></tr>`
    )
    .join('');
  const related = (data.related || []).slice(0, 10).map((r) => ({
    href: `/compare/${r.slug}`,
    label: r.label,
  }));
  const nearby = (data.nearby || []).slice(0, 8).map((r) => ({
    href: `/compare/${r.slug}`,
    label: r.label,
  }));
  const cheaper = (data.cheaper_alternatives || []).slice(0, 8).map((r) => ({
    href: `/compare/${r.slug}`,
    label: r.label,
  }));
  const expensive = (data.expensive_alternatives || []).slice(0, 8).map((r) => ({
    href: `/compare/${r.slug}`,
    label: r.label,
  }));
  const cityPages = (data.city_pages || []).slice(0, 4).map((r) => ({
    href: r.href,
    label: r.label,
  }));
  const countryPages = (data.country_pages || []).slice(0, 4).map((r) => ({
    href: r.href,
    label: r.label,
  }));
  // Prefer structured city/country pages; fall back to enrichment hints if missing
  const hintLinks =
    cityPages.length || countryPages.length
      ? []
      : (e.internal_link_hints || []).slice(0, 10).map((h) => ({
          href: h.href.startsWith('/') ? h.href : `/${h.href}`,
          label: h.label,
        }));

  const ow = e.overall_winner;
  const monthly = e.monthly_difference;
  const biggest = e.biggest_difference;
  const bestFor = e.best_for || [];
  const takeaways = e.key_takeaways || [];

  const overallSection = ow
    ? `<section>
    <h2>Overall Cost Winner</h2>
    <p><strong>${escText(ow.city)}</strong></p>
    <p>${escText(ow.reason)}</p>
  </section>`
    : '';

  const monthlySection = monthly
    ? `<section>
    <h2>Monthly Cost Difference</h2>
    <p>${escText(monthly.summary)}</p>
    ${
      monthly.amountUsd != null
        ? `<p>Estimated monthly difference: $${escText(String(monthly.amountUsd.toLocaleString('en-US')))} (favoring ${escText(monthly.cheaperCity)}).</p>`
        : `<p>Estimated relative gap: ${escText(String(monthly.pct))}% (CPI), favoring ${escText(monthly.cheaperCity)}.</p>`
    }
  </section>`
    : `<section>
    <h2>Monthly Cost Difference</h2>
    <p>Estimated overall cost difference: ${escText(String(e.cost_difference_pct))}%.</p>
  </section>`;

  const biggestSection = biggest
    ? `<section>
    <h2>Biggest Difference</h2>
    <p><strong>${escText(biggest.category)}</strong>: ${escText(biggest.winner)} leads with a ${escText(String(biggest.gapPct))}% gap.</p>
    <p>${escText(biggest.note)}</p>
  </section>`
    : '';

  const bestForSection = bestFor.length
    ? `<section>
    <h2>Quick Decision</h2>
    <ul>
      ${bestFor.map((x) => `<li><strong>${escText(x.persona)}</strong>: ${escText(x.city)} — ${escText(x.reason)}</li>`).join('')}
    </ul>
  </section>`
    : '';

  const takeawaysSection = takeaways.length
    ? `<section>
    <h2>Key Takeaways</h2>
    <ul>
      ${takeaways.map((t) => `<li>${escText(t)}</li>`).join('')}
    </ul>
  </section>`
    : '';

  return `<main id="seo-prerender-main">
  <h1>${escText(a)} vs ${escText(b)} Cost of Living Comparison</h1>
  <p>${escText(e.executive_summary || buildCompareDescription(data.queryA, data.queryB))}</p>
  ${overallSection}
  ${monthlySection}
  <section>
    <h2>Category Winners</h2>
    <table>
      <thead><tr><th>Category</th><th>Winner</th><th>Note</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3">Comparison data for ${escText(a)} and ${escText(b)}.</td></tr>`}</tbody>
    </table>
  </section>
  ${biggestSection}
  ${bestForSection}
  ${takeawaysSection}
  ${e.detailed_analysis ? `<section><h2>Analysis</h2><p>${escText(e.detailed_analysis)}</p></section>` : ''}
  ${linkList(cityPages, 'City pages')}
  ${linkList(countryPages, 'Country pages')}
  ${linkList(related, 'Related comparisons')}
  ${linkList(nearby, 'Nearby city comparisons')}
  ${linkList(cheaper, 'Cheaper alternatives')}
  ${linkList(expensive, 'More expensive alternatives')}
  ${linkList(hintLinks, 'City & country pages')}
  ${buildTrustBlockHtml({
    lastUpdated: data.last_updated,
    pageSources: data.data_sources,
    escText,
  })}
  ${linkList(
    [
      { href: '/methodology', label: 'Methodology' },
      { href: '/data-sources', label: 'Data sources' },
      { href: '/', label: 'Cost of living calculator' },
    ],
    'Explore CityCost'
  )}
</main>`;
}

/**
 * Resolve SEO HTML for a path against the catalog (source of truth).
 * Unknown HTML routes → 404 (no soft-200, no home canonical).
 * Compare: exact catalog slug → 200; exact reverse pair → 301; else → 404.
 */
export function resolveSeoHtml(html: string, pathname: string): SeoHtmlResult {
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
    const homeFaqs = buildHomeFaqs({
      indexable_cities: listIndexableCities().length,
      indexable_countries: listIndexableCountries().length,
      indexable_comparisons: listIndexableComparisons().length,
    });
    const homeFaqSchema = buildFaqPageSchema(homeFaqs);
    const ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('website', buildWebSiteSchema()) +
      buildServerJsonLdScript('webpage', buildWebPageSchema(title, desc, canon)) +
      buildServerJsonLdScript('breadcrumb', {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL }],
      }) +
      (homeFaqSchema ? buildServerJsonLdScript('faq', homeFaqSchema) : '');
    return { status: 200, html: finalizeSeoHtml(html, meta + ld, buildHomeBodyHtml()) };
  }

  const countryMatch = path.match(/^\/country\/([a-z0-9-]+)$/i);
  if (countryMatch) {
    // One canonical casing: mixed-case URLs 301 rather than serving a second
    // copy that points its canonical elsewhere.
    if (countryMatch[1] !== countryMatch[1].toLowerCase()) {
      return { status: 301, location: `${SITE_URL}/country/${countryMatch[1].toLowerCase()}` };
    }
    const data = buildCountryPageData(countryMatch[1]);
    if (!data) return { status: 404, html: buildNotFoundHtml(html) };
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
      buildServerJsonLdScript(
        'webpage',
        buildWebPageSchema(title, desc, canon, 'WebPage', data.last_updated)
      ) +
      buildServerJsonLdScript(
        'dataset',
        buildDatasetSchema({
          name: `Cost of living dataset — ${data.name}`,
          description: desc,
          url: canon,
          dateModified: data.last_updated,
          variableMeasured: ['Cost of living index', 'Average rent', 'Average salary'],
        })
      ) +
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
      (buildFaqPageSchema(data.faqs)
        ? buildServerJsonLdScript('faq', buildFaqPageSchema(data.faqs)!)
        : '');
    return { status: 200, html: finalizeSeoHtml(html, meta + ld, buildCountryBodyHtml(data)) };
  }

  const cityMatch = path.match(/^\/city\/([a-z0-9-]+)$/i);
  if (cityMatch) {
    const requestedCity = cityMatch[1].toLowerCase();
    if (cityMatch[1] !== requestedCity) {
      return { status: 301, location: `${SITE_URL}/city/${requestedCity}` };
    }
    // Duplicate record for the same city under an alternate/former name.
    const canonicalCity = canonicalCitySlug(requestedCity);
    if (canonicalCity) {
      return { status: 301, location: `${SITE_URL}/city/${canonicalCity}` };
    }
    const data = buildCityPageData(requestedCity);
    if (!data) return { status: 404, html: buildNotFoundHtml(html) };
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
      buildServerJsonLdScript(
        'webpage',
        buildWebPageSchema(title, desc, canon, 'WebPage', data.last_updated)
      ) +
      buildServerJsonLdScript(
        'dataset',
        buildDatasetSchema({
          name: `Cost of living dataset — ${data.city}, ${data.country}`,
          description: desc,
          url: canon,
          dateModified: data.last_updated,
        })
      ) +
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
      (buildFaqPageSchema(data.faqs)
        ? buildServerJsonLdScript('faq', buildFaqPageSchema(data.faqs)!)
        : '');
    return { status: 200, html: finalizeSeoHtml(html, meta + ld, buildCityBodyHtml(data)) };
  }

  const compareMatch = path.match(/^\/compare\/([a-z0-9-]+)-vs-([a-z0-9-]+)$/i);
  if (compareMatch) {
    const slugA = compareMatch[1].toLowerCase();
    const slugB = compareMatch[2].toLowerCase();
    const requestSlug = `${slugA}-vs-${slugB}`;
    const comps = listIndexableComparisons();
    const hit = comps.find((p) => p.slug === requestSlug);
    if (!hit) {
      const reverse = comps.find((p) => p.slug === `${slugB}-vs-${slugA}`);
      if (reverse) {
        return { status: 301, location: `${SITE_URL}/compare/${reverse.slug}` };
      }
      return { status: 404, html: buildNotFoundHtml(html) };
    }
    const compareData = buildComparePageData(hit.slug);
    if (!compareData) {
      return { status: 404, html: buildNotFoundHtml(html) };
    }
    const cityA = compareData.queryA || hit.queryA;
    const cityB = compareData.queryB || hit.queryB;
    const aShort = cityA.split(',')[0].trim();
    const bShort = cityB.split(',')[0].trim();
    const title = buildCompareTitle(cityA, cityB);
    const desc = buildCompareDescription(cityA, cityB);
    // Catalog slug is the single source of truth (matches sitemap URL)
    const canon = `${SITE_URL}/compare/${hit.slug}`;
    const meta = buildServerMetaHtml({
      title,
      description: desc,
      keywords: buildCompareKeywords(cityA, cityB),
      canonical: canon,
      ogType: 'article',
    });
    const faqSchema = buildFaqPageSchema(compareData.enrichment?.faqs);
    const ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('website', buildWebSiteSchema()) +
      buildServerJsonLdScript(
        'webpage',
        buildWebPageSchema(title, desc, canon, 'ComparisonPage', compareData.last_updated)
      ) +
      buildServerJsonLdScript(
        'dataset',
        buildDatasetSchema({
          name: `Cost of living comparison — ${aShort} vs ${bShort}`,
          description: desc,
          url: canon,
          dateModified: compareData.last_updated,
        })
      ) +
      buildServerJsonLdScript('breadcrumb', buildBreadcrumbSchema(aShort, bShort, canon)) +
      (faqSchema ? buildServerJsonLdScript('faq', faqSchema) : '');
    return {
      status: 200,
      html: finalizeSeoHtml(html, meta + ld, buildCompareBodyHtml(compareData)),
    };
  }

  const authorityMatch = path.match(
    /^\/(methodology|data-sources|about|contact|privacy|terms|disclaimer)$/i
  );
  if (authorityMatch) {
    const doc = getAuthorityPage(authorityMatch[1]);
    if (!doc) return { status: 404, html: buildNotFoundHtml(html) };
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
    return { status: 200, html: injectBeforeHeadClose(stripDefaultHeadMeta(html), meta + ld) };
  }

  // City intent landings share the city page slug, so the same alias rules apply.
  const landing = parseCityLandingPath(path);
  if (landing) {
    const landingSlug = landing.slug.toLowerCase();
    const landingCanonical = canonicalCitySlug(landingSlug);
    if (landing.slug !== landingSlug || landingCanonical) {
      return {
        status: 301,
        location: `${SITE_URL}/${landing.kind}/${landingCanonical || landingSlug}`,
      };
    }
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
    return { status: 200, html: injectBeforeHeadClose(stripDefaultHeadMeta(html), meta + ld) };
  }

  // Legacy editorial URL → single final admin URL
  if (path === '/editorial-control' || path.startsWith('/editorial-control/')) {
    return { status: 301, location: '/admin' };
  }

  // Editorial Control UI (admin) — SPA shell only; noindex; never inject homepage SEO body
  if (path === '/admin' || path.startsWith('/admin/')) {
    const title = 'Editorial Control | CityCost';
    const desc = 'CityCost editorial control panel';
    const head = `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="robots" content="noindex, nofollow" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />`;
    return { status: 200, html: injectBeforeHeadClose(stripDefaultHeadMeta(html), head) };
  }

  // Blog paths require async DB — handled by resolveSeoHtmlAsync
  if (path === '/blog' || /^\/blog\//i.test(path)) {
    return { status: 404, html: buildNotFoundHtml(html) };
  }

  return { status: 404, html: buildNotFoundHtml(html) };
}

/**
 * Async SSR entry — blog uses PostgreSQL; all other routes stay on sync resolveSeoHtml.
 */
export async function resolveSeoHtmlAsync(
  html: string,
  pathname: string
): Promise<SeoHtmlResult> {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (path === '/blog' || /^\/blog\//i.test(path)) {
    const { resolveBlogSeoHtml } = await import('./editorial-engine/blog/blog-ssr.js');
    return resolveBlogSeoHtml(html, path, {
      stripDefaultHeadMeta,
      finalizeSeoHtml,
      buildNotFoundHtml,
    });
  }
  return resolveSeoHtml(html, pathname);
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

/** URL set with per-entry lastmod (blog sitemap). */
export function xmlUrlsetDated(entries: Array<{ loc: string; lastmod: string }>): string {
  const body = entries
    .map(
      (e) => `  <url>
    <loc>${esc(e.loc)}</loc>
    <lastmod>${esc(e.lastmod)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${e.loc.endsWith('/blog') ? '0.9' : '0.7'}</priority>
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
