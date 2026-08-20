/**
 * SEO indexing regression check.
 *
 * Guards the signals behind the Search Console "Alternate page with proper
 * canonical tag" report:
 *   1. city/country pages return 200, are indexable and self-canonical
 *   2. exactly one canonical tag per page, matching the sitemap URL format
 *   3. URL normalisation (trailing slash, casing) resolves to one canonical URL
 *   4. same-entity duplicate slugs 301 instead of serving a second page
 *   5. pages are genuinely distinct — the cost data must not collapse onto a
 *      single shared profile, which is what made Google treat them as duplicates
 *
 * Run: npx tsx scripts/verify-seo-canonical.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveSeoHtml } from '../lib/seo-ssr.js';
import { warmGeoCityIndex } from '../lib/geo-cities.js';
import {
  listIndexableCities,
  listIndexableCountries,
  buildSitemapUrlEntries,
  CITY_SLUG_ALIASES,
} from '../lib/seo-catalog.js';
import { resolveCityCost, resolveCityCostByQuery, cityLabelFor } from '../lib/city-cost-resolve.js';
import { resolveCityCostOfLivingSync } from '../lib/col-engine/index.js';
import { COUNTRY_BASELINES } from '../lib/col-engine/regional.js';
import { SITE_URL } from '../src/utils/seo.js';

const template = fs.readFileSync(path.resolve('index.html'), 'utf-8');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function render(p: string) {
  const r = resolveSeoHtml(template, p);
  if (r.status !== 200) return { status: r.status, location: 'location' in r ? r.location : '' };
  return {
    status: 200 as const,
    canonicals: r.html.match(/<link rel="canonical" href="([^"]+)"/gi) || [],
    canonical: r.html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] || '',
    robots: r.html.match(/<meta name="robots" content="([^"]*)"/i)?.[1] || '',
    title: r.html.match(/<title>([^<]*)<\/title>/i)?.[1] || '',
    h1: r.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, '').trim() || '',
  };
}

/** Representative sample: the URLs Search Console flagged, plus a surveyed city. */
const SAMPLE_CITIES = [
  'sydney-new-south-wales-australia',
  'bangkok-bangkok-thailand',
  'zug-zug-switzerland',
  'warsaw-masovian-voivodeship-poland',
  'setif-setif-algeria',
  'bechar-bechar-algeria',
  'bafata-bafata-guinea-bissau',
  'queenstown-otago-region-new-zealand',
  'san-jose-alajuela-province-costa-rica',
];
const SAMPLE_COUNTRIES = ['uganda', 'switzerland', 'thailand'];

warmGeoCityIndex();

console.log('\n1. City pages — 200, indexable, self-canonical, correct entity');
for (const slug of SAMPLE_CITIES) {
  const r = render(`/city/${slug}`);
  const expected = `${SITE_URL}/city/${slug}`;
  if (r.status !== 200) {
    check(`/city/${slug}`, false, `status ${r.status}`);
    continue;
  }
  check(`/city/${slug} self-canonical`, r.canonical === expected, `got ${r.canonical}`);
  check(`/city/${slug} single canonical`, r.canonicals.length === 1, `${r.canonicals.length} tags`);
  check(`/city/${slug} indexable`, /^index,\s*follow/.test(r.robots), r.robots);
  const cityName = listIndexableCities().find((c) => c.pageSlug === slug)?.city || '';
  check(
    `/city/${slug} title+h1 entity`,
    Boolean(cityName) && r.title.includes(cityName) && r.h1.includes(cityName),
    `title="${r.title}" h1="${r.h1}"`
  );
}

console.log('\n2. Country pages — 200, indexable, self-canonical');
for (const slug of SAMPLE_COUNTRIES) {
  const r = render(`/country/${slug}`);
  const expected = `${SITE_URL}/country/${slug}`;
  if (r.status !== 200) {
    check(`/country/${slug}`, false, `status ${r.status}`);
    continue;
  }
  check(`/country/${slug} self-canonical`, r.canonical === expected, `got ${r.canonical}`);
  check(`/country/${slug} single canonical`, r.canonicals.length === 1, `${r.canonicals.length} tags`);
  check(`/country/${slug} indexable`, /^index,\s*follow/.test(r.robots), r.robots);
}

console.log('\n3. URL normalisation — one canonical form');
{
  const slug = SAMPLE_CITIES[0];
  const withSlash = render(`/city/${slug}/`);
  check(
    'trailing slash keeps the canonical URL',
    withSlash.status === 200 && withSlash.canonical === `${SITE_URL}/city/${slug}`,
    `status ${withSlash.status} canonical ${'canonical' in withSlash ? withSlash.canonical : ''}`
  );
  const upper = render(`/city/${slug.toUpperCase()}`);
  check(
    'mixed-case city URL 301s to lowercase',
    upper.status === 301 && upper.location === `${SITE_URL}/city/${slug}`,
    `status ${upper.status} -> ${upper.location}`
  );
  const upperCountry = render('/country/Uganda');
  check(
    'mixed-case country URL 301s to lowercase',
    upperCountry.status === 301 && upperCountry.location === `${SITE_URL}/country/uganda`,
    `status ${upperCountry.status} -> ${upperCountry.location}`
  );
  check('canonical host is https + non-www', SITE_URL === 'https://citycost.online', SITE_URL);
}

console.log('\n4. Same-entity duplicates 301 and stay out of the sitemap');
{
  const citySlugs = new Set(listIndexableCities().map((c) => c.pageSlug));
  for (const [alias, canonical] of Object.entries(CITY_SLUG_ALIASES)) {
    const r = render(`/city/${alias}`);
    check(
      `/city/${alias} 301s to canonical`,
      r.status === 301 && r.location === `${SITE_URL}/city/${canonical}`,
      `status ${r.status} -> ${r.location}`
    );
    check(`alias ${alias} absent from index`, !citySlugs.has(alias));
    check(`canonical ${canonical} present in index`, citySlugs.has(canonical));
    const landing = render(`/rent/${alias}`);
    check(
      `/rent/${alias} 301s to canonical`,
      landing.status === 301 && landing.location === `${SITE_URL}/rent/${canonical}`,
      `status ${landing.status} -> ${landing.location}`
    );
  }
}

console.log('\n5. Sitemap agrees with canonical URLs');
{
  const entries = buildSitemapUrlEntries();
  const all = [...entries.cities, ...entries.countries];
  check('no trailing slashes in sitemap city/country URLs', all.every((u) => !u.endsWith('/')));
  check('all sitemap URLs are absolute https', all.every((u) => u.startsWith(`${SITE_URL}/`)));
  check('no aliased duplicate URLs in sitemap', all.every((u) => !Object.keys(CITY_SLUG_ALIASES).some((a) => u.endsWith(`/city/${a}`))));

  const sample = entries.cities.slice(0, 25);
  const mismatched = sample.filter((u) => {
    const r = render(u.replace(SITE_URL, ''));
    return r.status !== 200 || r.canonical !== u;
  });
  check('sampled sitemap URLs are 200 + self-canonical', mismatched.length === 0, mismatched.join(', '));
}

console.log('\n6. Pages are genuinely distinct (duplicate-content guard)');
{
  const cities = listIndexableCities();
  const profiles = new Map<string, number>();
  for (const c of cities) {
    const r = resolveCityCost(c);
    const k = `${r.indices.cpi_index}|${r.indices.rent_index}|${r.indices.local_purchasing_power_index}`;
    profiles.set(k, (profiles.get(k) || 0) + 1);
  }
  const largest = Math.max(...profiles.values());
  const distinct = profiles.size;
  console.log(`     ${distinct} distinct cost profiles across ${cities.length} cities; largest shared group ${largest}`);
  // Regression floor: before the COUNTRY_BASELINES / hint fix this was 65 distinct
  // profiles with 399 cities sharing one. Anything near that means the engine has
  // collapsed onto its DEFAULT baseline again.
  check('most cities have a distinct cost profile', distinct >= cities.length * 0.7, `${distinct}/${cities.length}`);
  check('no oversized identical-data cluster', largest <= 15, `largest group ${largest}`);
}

console.log('\n7. Country page count unchanged (no valid pages dropped)');
check('all sovereign countries still indexable', listIndexableCountries().length >= 190, String(listIndexableCountries().length));

console.log('\n8. City page and /api/city_prices agree for the same city');
{
  // Both surfaces must run the same cost-engine logic. Before the unification the
  // async path ignored caller hints, so Bangkok read cpi 32.8 on its page and
  // cpi 21.6 in the calculator.
  const SAMPLE = [
    'bangkok-bangkok-thailand',
    'warsaw-masovian-voivodeship-poland',
    'zug-zug-switzerland',
    'sydney-new-south-wales-australia',
    'setif-setif-algeria',
    'san-jose-alajuela-province-costa-rica',
  ];
  for (const slug of SAMPLE) {
    const rec = listIndexableCities().find((c) => c.pageSlug === slug);
    if (!rec) {
      check(`${slug} present`, false);
      continue;
    }
    const page = resolveCityCost(rec);
    // Exactly what /api/city_prices resolves for the label the UI sends.
    const api = await resolveCityCostByQuery(cityLabelFor(rec));
    check(
      `${slug} indices match`,
      JSON.stringify(page.indices) === JSON.stringify(api.indices),
      `page ${JSON.stringify(page.indices)} vs api ${JSON.stringify(api.indices)}`
    );
    check(`${slug} currency match`, page.currency === api.currency, `${page.currency} vs ${api.currency}`);
    check(`${slug} tier match`, page.tier === api.tier, `${page.tier} vs ${api.tier}`);
    const pPrices = JSON.stringify(page.prices.map((p) => [p.item_name, p.average_price]));
    const aPrices = JSON.stringify(api.prices.map((p) => [p.item_name, p.average_price]));
    check(`${slug} price basket match`, pPrices === aPrices);
  }
}

console.log('\n9. Country / currency integrity — no silent US fallback');
{
  const cities = listIndexableCities();
  const mismatched = cities.filter((c) => {
    const r = resolveCityCost(c);
    return Boolean(r.countryCode) && r.countryCode !== c.countryCode;
  });
  check(
    'engine country always equals catalog country',
    mismatched.length === 0,
    mismatched.map((c) => c.pageSlug).join(', ')
  );

  // The two cities that previously resolved as United States / USD.
  for (const [slug, cc, cur] of [
    ['sant-julia-de-loria-sant-julia-de-loria-andorra', 'AD', 'EUR'],
    ['san-pedro-de-macoris-san-pedro-de-macoris-dominican-republic', 'DO', 'DOP'],
  ] as Array<[string, string, string]>) {
    const rec = cities.find((c) => c.pageSlug === slug);
    if (!rec) {
      check(`${slug} present`, false);
      continue;
    }
    const r = resolveCityCost(rec);
    check(`${slug} country is ${cc}`, r.countryCode === cc, r.countryCode);
    check(`${slug} currency is ${cur}`, r.currency === cur, r.currency);
    check(`${slug} does not use US pricing`, r.countryCode !== 'US' && r.currency !== 'USD', `${r.countryCode}/${r.currency}`);
  }

  // An unresolvable country must stay unknown rather than becoming the US.
  const unknown = resolveCityCostOfLivingSync('Zzzxqq, Zzzxqq, Republic of Nowhere');
  check('unknown country does not become US', unknown.countryCode !== 'US', unknown.countryCode);

  // No indexed city may fall back to the generic DEFAULT baseline.
  const noBaseline = cities.filter((c) => !COUNTRY_BASELINES[c.countryCode]);
  check('no indexed city falls back to DEFAULT', noBaseline.length === 0, `${noBaseline.length} cities`);
}

console.log('\n10. Modelled data is never labelled as verified');
{
  const bad = listIndexableCities().filter((c) => {
    const r = resolveCityCost(c);
    const modelled = r.data_source_label === 'Regional' || r.data_source_label === 'Country' || r.data_source_label === 'Estimated';
    return modelled && (r.is_verified === true || /surveyed|numbeo/i.test(r.confidence_label || ''));
  });
  check('no modelled result claims surveyed/Numbeo/verified', bad.length === 0, bad.map((c) => c.pageSlug).join(', '));
}

console.log('\n11. Ambiguous "City, Region" queries resolve to the right country');
{
  // 18 subdivision names collide with a country name (Georgia/US, Niger/Nigeria,
  // Luxembourg/Belgium, Taiwan/China...). Resolving the country name first would
  // price Atlanta as Tbilisi. A two-part query must agree with its three-part form.
  const CASES: Array<[string, string, string]> = [
    ['Atlanta, Georgia', 'Atlanta, Georgia, United States', 'US'],
    ['Savannah, Georgia', 'Savannah, Georgia, United States', 'US'],
    ['Minna, Niger', 'Minna, Niger, Nigeria', 'NG'],
  ];
  for (const [two, three, expected] of CASES) {
    const a = resolveCityCostOfLivingSync(two);
    const b = resolveCityCostOfLivingSync(three);
    check(`"${two}" resolves to ${expected}`, a.countryCode === expected, a.countryCode);
    check(
      `"${two}" matches its three-part form`,
      a.countryCode === b.countryCode &&
        JSON.stringify(a.indices) === JSON.stringify(b.indices),
      `${JSON.stringify(a.indices)} vs ${JSON.stringify(b.indices)}`
    );
  }
  // Genuine "City, Country" queries must still read as a country.
  for (const [q, expected] of [
    ['Bangkok, Thailand', 'TH'],
    ['Taipei, Taiwan', 'TW'],
    ['Luxembourg, Luxembourg', 'LU'],
  ] as Array<[string, string]>) {
    const r = resolveCityCostOfLivingSync(q);
    check(`"${q}" still reads as country ${expected}`, r.countryCode === expected, r.countryCode);
  }
}

console.log(failures === 0 ? '\nAll SEO canonical checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
