/**
 * SEO country index — sovereign countries from the geographic dataset.
 * Independent of city eligibility (city rules must not gate country pages).
 */

import { Country } from 'country-state-city';
import { seoSlug, shortCountrySlug } from './seo-eligibility.js';

/**
 * Non-sovereign / dependency / special territory ISO codes to exclude.
 * Sovereign UN members + widely recognized states remain.
 */
const EXCLUDED_TERRITORY_CODES = new Set([
  // Antarctica & uninhabited
  'AQ', 'BV', 'HM', 'GS', 'TF', 'UM',
  // UK overseas / crown dependencies
  'AI', 'BM', 'IO', 'VG', 'KY', 'FK', 'GI', 'MS', 'PN', 'SH', 'TC', 'GG', 'IM', 'JE',
  // US territories
  'AS', 'GU', 'MP', 'PR', 'VI',
  // NL / FR / DK / NO / NZ / AU territories & collectivities
  'AW', 'CW', 'SX', 'BQ', 'GF', 'GP', 'MQ', 'YT', 'RE', 'PM', 'BL', 'MF', 'NC', 'PF', 'WF',
  'FO', 'GL', 'SJ', 'AX', 'CK', 'NU', 'TK', 'CC', 'CX', 'NF', 'HM',
  // Other dependencies / disputed thin entries
  'EH', 'PS', 'XK',
  // SARs (not separate sovereigns for this index)
  'HK', 'MO',
]);

/** Alternate slug aliases → ISO */
const SLUG_ALIASES: Record<string, string> = {
  india: 'IN', bharat: 'IN',
  'united-states': 'US', usa: 'US', america: 'US',
  'united-kingdom': 'GB', uk: 'GB', britain: 'GB',
  'united-arab-emirates': 'AE', uae: 'AE', emirates: 'AE',
  'south-korea': 'KR', korea: 'KR',
  'czech-republic': 'CZ', czechia: 'CZ',
  russia: 'RU', 'russian-federation': 'RU',
  'viet-nam': 'VN', vietnam: 'VN',
  'cote-divoire': 'CI', 'ivory-coast': 'CI',
  myanmar: 'MM', burma: 'MM',
  swaziland: 'SZ', eswatini: 'SZ',
  macedonia: 'MK', 'north-macedonia': 'MK',
  turkey: 'TR', turkiye: 'TR',
  'east-timor': 'TL', 'timor-leste': 'TL',
  brunei: 'BN', 'brunei-darussalam': 'BN',
  laos: 'LA', 'lao-peoples-democratic-republic': 'LA',
  moldova: 'MD', 'republic-of-moldova': 'MD',
  bolivia: 'BO', 'bolivia-plurinational-state-of': 'BO',
  venezuela: 'VE', 'venezuela-bolivarian-republic-of': 'VE',
  iran: 'IR', 'iran-islamic-republic-of': 'IR',
  syria: 'SY', 'syrian-arab-republic': 'SY',
  tanzania: 'TZ', 'tanzania-united-republic-of': 'TZ',
  'holy-see': 'VA', vatican: 'VA', 'vatican-city': 'VA',
};

export interface SovereignCountry {
  code: string;
  slug: string;
  name: string;
  currency: string | null;
  phonecode: string | null;
  flag: string | null;
  latitude: string | null;
  longitude: string | null;
}

let cache: SovereignCountry[] | null = null;

export function listSovereignCountries(): SovereignCountry[] {
  if (cache) return cache;

  const seenSlugs = new Set<string>();
  const out: SovereignCountry[] = [];

  for (const c of Country.getAllCountries()) {
    if (!c.isoCode || c.isoCode.length !== 2) continue;
    if (EXCLUDED_TERRITORY_CODES.has(c.isoCode)) continue;
    if (!c.name || c.name.trim().length < 2) continue;

    const slug = shortCountrySlug(c.isoCode);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    out.push({
      code: c.isoCode,
      slug,
      name: c.name,
      currency: c.currency || null,
      phonecode: c.phonecode || null,
      flag: c.flag || null,
      latitude: c.latitude || null,
      longitude: c.longitude || null,
    });
  }

  cache = out.sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function findSovereignBySlug(slug: string): SovereignCountry | null {
  const s = seoSlug([slug]);
  if (SLUG_ALIASES[s]) {
    const code = SLUG_ALIASES[s];
    return listSovereignCountries().find((c) => c.code === code) || null;
  }
  return listSovereignCountries().find((c) => c.slug === s || seoSlug([c.name]) === s) || null;
}

export function findSovereignByCode(code: string): SovereignCountry | null {
  return listSovereignCountries().find((c) => c.code === code.toUpperCase()) || null;
}

export function isExcludedTerritory(code: string): boolean {
  return EXCLUDED_TERRITORY_CODES.has(code.toUpperCase());
}
