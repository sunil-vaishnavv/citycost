/**
 * Internal-link relevance + route existence.
 *
 * A link is allowed only when its destination is a real CityCost route
 * (resolved against the catalog) and is geographically relevant to the
 * article (same city, or a city/country/comparison in the article's countries).
 * Prevents links such as /country/afghanistan in a Sydney–Melbourne comparison.
 */

import {
  findCityBySlug,
  listIndexableCities,
  listIndexableComparisons,
  listIndexableCountries,
} from '../../../seo-catalog.js';
import { STATIC_PATH_LABELS } from '../../blog/linkify-paths.js';

/** Methodology / transparency pages are relevant to every cost article. */
export const AUTHORITY_HREFS = ['/methodology', '/data-sources'] as const;

export interface LinkGeoScope {
  /** ISO-2 country codes the article is about. */
  country_codes: string[];
  /** CityCost city page slugs the article is about. */
  city_page_slugs: string[];
}

export type ResolvedRoute =
  | { kind: 'static'; href: string }
  | { kind: 'city'; href: string; pageSlug: string; countryCode: string }
  | { kind: 'country'; href: string; slug: string; countryCode: string }
  | { kind: 'compare'; href: string; slug: string; pageSlugs: [string, string]; countryCodes: string[] }
  | { kind: 'blog'; href: string };

let countryBySlug: Map<string, string> | null = null;
function countryCodeForSlug(slug: string): string | null {
  if (!countryBySlug) {
    countryBySlug = new Map(listIndexableCountries().map((c) => [c.slug, c.code]));
  }
  return countryBySlug.get(slug) || null;
}

let compareBySlug: Map<string, { a: string; b: string }> | null = null;
function compareForSlug(slug: string): { a: string; b: string } | null {
  if (!compareBySlug) {
    compareBySlug = new Map(listIndexableComparisons().map((c) => [c.slug, { a: c.pageSlugA, b: c.pageSlugB }]));
  }
  return compareBySlug.get(slug) || null;
}

export function normalizeSiteHref(href: string): string {
  let h = String(href || '').trim();
  h = h.replace(/^https?:\/\/(?:www\.)?citycost\.online/i, '');
  h = h.split(/[?#]/)[0] || '';
  if (h.length > 1) h = h.replace(/\/+$/, '');
  return h;
}

/** Resolve a site href to a real catalog route, or null when it does not exist. */
export function resolveSiteRoute(rawHref: string): ResolvedRoute | null {
  const href = normalizeSiteHref(rawHref);
  if (!href.startsWith('/')) return null;
  if (STATIC_PATH_LABELS[href]) return { kind: 'static', href };
  const m = href.match(/^\/(city|country|compare|blog)\/([a-z0-9][a-z0-9-]*)$/i);
  if (!m) return null;
  const kind = m[1]!.toLowerCase();
  const slug = m[2]!.toLowerCase();
  if (kind === 'blog') return { kind: 'blog', href };
  if (kind === 'city') {
    const c = findCityBySlug(slug);
    return c ? { kind: 'city', href, pageSlug: c.pageSlug, countryCode: c.countryCode } : null;
  }
  if (kind === 'country') {
    const code = countryCodeForSlug(slug);
    return code ? { kind: 'country', href, slug, countryCode: code } : null;
  }
  const pair = compareForSlug(slug);
  if (!pair) return null;
  const codes = [findCityBySlug(pair.a)?.countryCode, findCityBySlug(pair.b)?.countryCode].filter(
    (c): c is string => Boolean(c)
  );
  return { kind: 'compare', href, slug, pageSlugs: [pair.a, pair.b], countryCodes: codes };
}

export type LinkVerdict = 'relevant' | 'irrelevant' | 'unknown_route';

export function judgeLink(rawHref: string, scope: LinkGeoScope): LinkVerdict {
  const route = resolveSiteRoute(rawHref);
  if (!route) return 'unknown_route';
  if (route.kind === 'static') {
    return (AUTHORITY_HREFS as readonly string[]).includes(route.href) || route.href === '/' ? 'relevant' : 'irrelevant';
  }
  if (route.kind === 'blog') return 'irrelevant'; // not verifiable as topical here
  const countries = new Set(scope.country_codes.map((c) => c.toUpperCase()));
  const cities = new Set(scope.city_page_slugs);
  if (route.kind === 'city') {
    return cities.has(route.pageSlug) || countries.has(route.countryCode) ? 'relevant' : 'irrelevant';
  }
  if (route.kind === 'country') return countries.has(route.countryCode) ? 'relevant' : 'irrelevant';
  // compare: every side is in the article's countries (e.g. Melbourne vs Brisbane for an
  // Australian comparison), or — for a single-city article — one side is that city.
  const allSidesInCountries =
    route.countryCodes.length === 2 && route.countryCodes.every((c) => countries.has(c));
  const singleCityMatch = cities.size === 1 && route.pageSlugs.some((p) => cities.has(p));
  return allSidesInCountries || singleCityMatch ? 'relevant' : 'irrelevant';
}

export function filterRelevantHrefs(hrefs: string[], scope: LinkGeoScope): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hrefs) {
    const h = normalizeSiteHref(raw);
    if (!h || seen.has(h)) continue;
    if (judgeLink(h, scope) !== 'relevant') continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/** Internal-link floor: never demand more links than relevant destinations exist (max 3). */
export function internalLinkFloor(relevantCandidateCount: number, max = 3): number {
  return Math.max(1, Math.min(max, relevantCandidateCount));
}

/* ── Geo scope inference ─────────────────────────────────────────────── */

let cityIndex: Array<{ name: string; re: RegExp; pageSlug: string; countryCode: string; population: number }> | null =
  null;

function buildCityIndex() {
  if (cityIndex) return cityIndex;
  cityIndex = listIndexableCities()
    .filter((c) => (c.city || '').length >= 4)
    .map((c) => ({
      name: c.city,
      re: new RegExp(`(?:^|[^\\p{L}])${c.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}])`, 'iu'),
      pageSlug: c.pageSlug,
      countryCode: c.countryCode,
      population: c.population || 0,
    }));
  return cityIndex;
}

/**
 * Find catalog cities and countries named in free text (topic title). Picks the
 * most populous city per name so "Sydney" resolves to Sydney, Australia.
 */
export function inferGeoFromText(text: string, maxCities = 2): {
  cities: Array<{ name: string; pageSlug: string; countryCode: string }>;
  country_codes: string[];
} {
  const t = String(text || '');
  const byName = new Map<string, { name: string; pageSlug: string; countryCode: string; population: number; at: number }>();
  for (const c of buildCityIndex()) {
    const m = c.re.exec(t);
    if (!m) continue;
    const key = c.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || c.population > prev.population) {
      byName.set(key, { name: c.name, pageSlug: c.pageSlug, countryCode: c.countryCode, population: c.population, at: m.index });
    }
  }
  // Drop names contained in a longer matched name ("York" inside "New York").
  const names = [...byName.values()];
  const cities = names
    .filter((c) => !names.some((o) => o !== c && o.name.length > c.name.length && o.name.toLowerCase().includes(c.name.toLowerCase())))
    .sort((a, b) => a.at - b.at)
    .slice(0, maxCities)
    .map(({ name, pageSlug, countryCode }) => ({ name, pageSlug, countryCode }));
  const country_codes = new Set(cities.map((c) => c.countryCode));
  for (const c of listIndexableCountries()) {
    if (c.name.length < 4) continue;
    const re = new RegExp(`(?:^|[^\\p{L}])${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}])`, 'iu');
    if (re.test(t)) country_codes.add(c.code);
  }
  return { cities, country_codes: [...country_codes] };
}

/** Minimal research shape needed to compute the relevant link pool. */
export interface LinkResearchLike {
  geo_scope?: LinkGeoScope;
  related_cities?: Array<{ href: string }>;
  related_countries?: Array<{ href: string }>;
  related_comparison_pages?: Array<{ href: string }>;
  internal_link_candidates?: Array<{ href: string }>;
}

/** Relevant, existing destinations for an article (authority pages always included). */
export function relevantLinkPool(research: LinkResearchLike | null | undefined): string[] {
  const scope = research?.geo_scope || { country_codes: [], city_page_slugs: [] };
  const hrefs = [
    ...(research?.related_comparison_pages || []),
    ...(research?.related_cities || []),
    ...(research?.related_countries || []),
    ...(research?.internal_link_candidates || []),
  ].map((l) => l.href);
  return filterRelevantHrefs([...hrefs, ...AUTHORITY_HREFS], scope);
}

/** Link floor for an article, or undefined when no geo scope is recorded (legacy packs keep the default). */
export function linkFloorForResearch(research: LinkResearchLike | null | undefined): number | undefined {
  if (!research?.geo_scope) return undefined;
  return internalLinkFloor(relevantLinkPool(research).length);
}
