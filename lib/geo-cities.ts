/**
 * Global geographic city index built from `country-state-city`.
 * ~148k cities with state/province + country hierarchy.
 * Search is server-side (prefix + state/country indexes) for speed.
 */

import { City, Country, State } from 'country-state-city';

export interface GeoCity {
  city_id: number;
  city: string;
  state: string;
  stateCode: string;
  country: string;
  countryCode: string;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
  timezone: string | null;
  currency: string | null;
  flag: string;
  /** Display label: "Pali, Rajasthan, India" */
  label: string;
  slug: string;
}

const COUNTRY_ALIASES: Record<string, string[]> = {
  us: ['usa', 'america', 'u.s.', 'u.s.a.', 'united states', 'states'],
  gb: ['uk', 'britain', 'england', 'great britain', 'united kingdom'],
  ae: ['uae', 'emirates', 'united arab emirates'],
  kr: ['korea', 'south korea', 'rok'],
  cz: ['czechia', 'czech', 'czech republic'],
  ru: ['russia', 'russian federation'],
  nl: ['holland', 'netherlands'],
  ie: ['eire', 'ireland'],
  za: ['rsa', 'south africa'],
  sa: ['ksa', 'saudi', 'saudi arabia'],
  nz: ['new zealand'],
  cd: ['drc', 'congo-kinshasa', 'democratic republic of the congo'],
  cg: ['congo-brazzaville', 'republic of the congo'],
  ci: ['ivory coast', 'cote divoire', "cote d'ivoire"],
  in: ['india', 'bharat'],
  au: ['australia'],
  ca: ['canada'],
  de: ['germany', 'deutschland'],
  fr: ['france'],
  jp: ['japan'],
  cn: ['china'],
  br: ['brazil', 'brasil'],
  mx: ['mexico'],
  it: ['italy', 'italia'],
  es: ['spain', 'espana'],
};

/** Well-known cities shown when the search box is empty */
const POPULAR_LABELS = [
  'New York City, New York, United States',
  'Los Angeles, California, United States',
  'Chicago, Illinois, United States',
  'London, England, United Kingdom',
  'Paris, Île-de-France, France',
  'Tokyo, Tokyo, Japan',
  'Sydney, New South Wales, Australia',
  'Melbourne, Victoria, Australia',
  'Toronto, Ontario, Canada',
  'Dubai, Dubai, United Arab Emirates',
  'Singapore, , Singapore',
  'Mumbai, Maharashtra, India',
  'Delhi, Delhi, India',
  'Bengaluru, Karnataka, India',
  'Bangalore, Karnataka, India',
  'Jaipur, Rajasthan, India',
  'Hyderabad, Telangana, India',
  'Pune, Maharashtra, India',
  'Ahmedabad, Gujarat, India',
  'Chennai, Tamil Nadu, India',
  'Kolkata, West Bengal, India',
  'Berlin, Berlin, Germany',
  'Amsterdam, North Holland, Netherlands',
  'Madrid, Madrid, Spain',
  'Rome, Lazio, Italy',
  'São Paulo, São Paulo, Brazil',
  'Mexico City, Mexico City, Mexico',
  'Hong Kong, , Hong Kong',
  'Seoul, Seoul, South Korea',
  'Bangkok, Bangkok, Thailand',
];

let cities: GeoCity[] = [];
let ready = false;
const prefixIndex = new Map<string, number[]>();
const stateIndex = new Map<string, number[]>();
const countryIndex = new Map<string, number[]>();
const exactStateIndex = new Map<string, number[]>();
const exactCountryIndex = new Map<string, number[]>();
const slugIndex = new Map<string, number[]>();
let popularCache: GeoCity[] = [];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function parseCoord(value?: string | null): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pushIndex(map: Map<string, number[]>, key: string, id: number) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
}

function addPrefixes(map: Map<string, number[]>, text: string, id: number) {
  const t = text.toLowerCase().trim();
  if (!t) return;
  pushIndex(map, t, id);
  const max = Math.min(t.length, 8);
  for (let i = 1; i <= max; i++) {
    pushIndex(map, t.slice(0, i), id);
  }
}

function buildLabel(city: string, state: string, country: string): string {
  return [city, state, country].filter((p) => p && p.trim().length > 0).join(', ');
}

function ensureIndex() {
  if (ready) return;

  const countries = Country.getAllCountries();
  const countryByCode = new Map(countries.map((c) => [c.isoCode, c]));
  const stateNameByKey = new Map<string, string>();

  for (const country of countries) {
    for (const state of State.getStatesOfCountry(country.isoCode)) {
      stateNameByKey.set(`${country.isoCode}:${state.isoCode}`, state.name);
    }
  }

  const raw = City.getAllCities();
  cities = new Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const country = countryByCode.get(row.countryCode);
    const stateName = stateNameByKey.get(`${row.countryCode}:${row.stateCode}`) || '';
    const countryName = country?.name || row.countryCode;
    const tz = country?.timezones?.[0]?.zoneName || null;
    const label = buildLabel(row.name, stateName, countryName);
    const id = i + 1;

    const geo: GeoCity = {
      city_id: id,
      city: row.name,
      state: stateName,
      stateCode: row.stateCode || '',
      country: countryName,
      countryCode: row.countryCode,
      district: null,
      latitude: parseCoord(row.latitude),
      longitude: parseCoord(row.longitude),
      population: null,
      timezone: tz,
      currency: country?.currency || null,
      flag: country?.flag || '🌐',
      label,
      slug: slugify(row.name),
    };

    cities[i] = geo;

    addPrefixes(prefixIndex, row.name, id);
    if (stateName) {
      addPrefixes(stateIndex, stateName, id);
      pushIndex(exactStateIndex, stateName.toLowerCase(), id);
    }
    addPrefixes(countryIndex, countryName, id);
    pushIndex(exactCountryIndex, countryName.toLowerCase(), id);
    pushIndex(exactCountryIndex, row.countryCode.toLowerCase(), id);

    const aliases = COUNTRY_ALIASES[row.countryCode.toLowerCase()];
    if (aliases) {
      for (const alias of aliases) {
        pushIndex(countryIndex, alias, id);
        pushIndex(exactCountryIndex, alias, id);
      }
    }

    pushIndex(slugIndex, geo.slug, id);
  }

  // Popular suggestions (best-effort match against labels / city+country)
  const found: GeoCity[] = [];
  const seen = new Set<number>();
  for (const wanted of POPULAR_LABELS) {
    const parts = wanted.split(',').map((p) => p.trim()).filter(Boolean);
    const cityName = parts[0]?.toLowerCase();
    if (!cityName) continue;
    const candidates = (prefixIndex.get(cityName) || [])
      .map((id) => cities[id - 1])
      .filter(Boolean);
    const match =
      candidates.find((c) => c.label.toLowerCase() === wanted.toLowerCase()) ||
      candidates.find((c) => {
        const countryOk = !parts[parts.length - 1] || c.country.toLowerCase().includes(parts[parts.length - 1].toLowerCase());
        const stateOk = parts.length < 3 || !parts[1] || c.state.toLowerCase().includes(parts[1].toLowerCase());
        return c.city.toLowerCase() === cityName && countryOk && stateOk;
      }) ||
      candidates[0];
    if (match && !seen.has(match.city_id)) {
      seen.add(match.city_id);
      found.push(match);
    }
  }
  popularCache = found;

  ready = true;
  console.log(`✅ Geo city index ready: ${cities.length.toLocaleString()} cities`);
}

function uniqueIds(lists: number[][]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const list of lists) {
    for (const id of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Prefer well-known disambiguation when many cities share a name */
const PREFERRED_CITY_STATE: Record<string, string> = {
  'pali|in': 'RJ',
  'springfield|us': 'IL',
  'portland|us': 'OR',
  'cambridge|us': 'MA',
  'birmingham|us': 'AL',
  'rochester|us': 'NY',
  'columbus|us': 'OH',
  'kansas city|us': 'MO',
  'vancouver|ca': 'BC',
  'london|gb': 'ENG',
  'birmingham|gb': 'ENG',
};

/** Major cities boosted when browsing a state/country */
const MAJOR_CITY_NAMES = new Set([
  'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio',
  'san diego', 'dallas', 'san jose', 'austin', 'jacksonville', 'san francisco', 'seattle',
  'denver', 'washington', 'boston', 'nashville', 'detroit', 'oklahoma city', 'portland',
  'las vegas', 'memphis', 'louisville', 'baltimore', 'milwaukee', 'albuquerque', 'tucson',
  'fresno', 'sacramento', 'mesa', 'kansas city', 'atlanta', 'miami', 'raleigh', 'omaha',
  'minneapolis', 'tampa', 'new orleans', 'cleveland', 'honolulu', 'orlando', 'pittsburgh',
  'cincinnati', 'st. louis', 'salt lake city', 'london', 'birmingham', 'manchester',
  'glasgow', 'liverpool', 'leeds', 'edinburgh', 'bristol', 'paris', 'lyon', 'marseille',
  'berlin', 'munich', 'hamburg', 'frankfurt', 'tokyo', 'osaka', 'yokohama', 'nagoya',
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'canberra', 'toronto', 'montreal',
  'vancouver', 'calgary', 'ottawa', 'mumbai', 'delhi', 'new delhi', 'bengaluru', 'bangalore',
  'new york city', 'new york',
  'hyderabad', 'ahmedabad', 'chennai', 'kolkata', 'pune', 'jaipur', 'surat', 'lucknow',
  'kanpur', 'nagpur', 'indore', 'thane', 'bhopal', 'visakhapatnam', 'patna', 'vadodara',
  'ghaziabad', 'ludhiana', 'agra', 'nashik', 'faridabad', 'meerut', 'rajkot', 'varanasi',
  'srinagar', 'amritsar', 'chandigarh', 'coimbatore', 'kochi', 'mysore', 'jodhpur',
  'udaipur', 'ajmer', 'bikaner', 'sikar', 'alwar', 'kota', 'dubai', 'abu dhabi', 'sharjah',
  'singapore', 'hong kong', 'seoul', 'busan', 'bangkok', 'jakarta', 'manila', 'kuala lumpur',
  'ho chi minh city', 'hanoi', 'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'mexico city',
  'guadalajara', 'monterrey', 'sao paulo', 'rio de janeiro', 'brasilia', 'buenos aires',
  'santiago', 'lima', 'bogota', 'cairo', 'lagos', 'johannesburg', 'cape town', 'nairobi',
  'amsterdam', 'rotterdam', 'madrid', 'barcelona', 'rome', 'milan', 'lisbon', 'porto',
  'vienna', 'zurich', 'geneva', 'stockholm', 'oslo', 'copenhagen', 'helsinki', 'dublin',
  'prague', 'budapest', 'warsaw', 'krakow', 'athens', 'istanbul', 'ankara', 'riyadh', 'jeddah',
  'doha', 'kuwait city', 'manama', 'muscat', 'tel aviv', 'jerusalem',
]);

function preferredStateBoost(city: GeoCity): number {
  const key = `${city.city.toLowerCase()}|${city.countryCode.toLowerCase()}`;
  const preferred = PREFERRED_CITY_STATE[key];
  if (preferred && city.stateCode === preferred) return 80;
  if (preferred) return 0;
  return 0;
}

function isMajorCity(city: GeoCity): boolean {
  const name = city.city.toLowerCase();
  if (!MAJOR_CITY_NAMES.has(name)) return false;
  // Shared global names: only treat as "major" in their primary country
  const primaryCountry: Record<string, string> = {
    brisbane: 'AU',
    melbourne: 'AU',
    sydney: 'AU',
    perth: 'AU',
    london: 'GB',
    manchester: 'GB',
    birmingham: 'GB',
    glasgow: 'GB',
    edinburgh: 'GB',
    paris: 'FR',
    lyon: 'FR',
    berlin: 'DE',
    munich: 'DE',
    rome: 'IT',
    milan: 'IT',
    madrid: 'ES',
    barcelona: 'ES',
    dublin: 'IE',
    delhi: 'IN',
    mumbai: 'IN',
    toronto: 'CA',
    vancouver: 'CA',
    montreal: 'CA',
    cairo: 'EG',
    athens: 'GR',
    amsterdam: 'NL',
  };
  const preferred = primaryCountry[name];
  if (preferred && city.countryCode !== preferred) return false;
  return true;
}

/** Extra priority so top metros float above alphabetical noise (city|state|country) */
const METRO_PRIORITY: Record<string, number> = {
  'new york city|ny|us': 130, 'los angeles|ca|us': 128, 'chicago|il|us': 126,
  'houston|tx|us': 124, 'san francisco|ca|us': 122, 'seattle|wa|us': 120,
  'boston|ma|us': 118, 'miami|fl|us': 116, 'washington|dc|us': 114,
  'dallas|tx|us': 112, 'atlanta|ga|us': 110, 'san diego|ca|us': 108,
  'san jose|ca|us': 106, 'austin|tx|us': 104, 'denver|co|us': 102,
  'philadelphia|pa|us': 100, 'phoenix|az|us': 98,
  'mumbai|mh|in': 130, 'delhi|dl|in': 128, 'new delhi|dl|in': 127,
  'bengaluru|ka|in': 126, 'bangalore|ka|in': 125, 'hyderabad|tg|in': 124,
  'chennai|tn|in': 122, 'kolkata|wb|in': 120, 'pune|mh|in': 118,
  'ahmedabad|gj|in': 116, 'jaipur|rj|in': 114, 'surat|gj|in': 112,
  'london|eng|gb': 130, 'manchester|eng|gb': 120, 'birmingham|eng|gb': 118,
  'paris|idf|fr': 130, 'tokyo|13|jp': 130, 'sydney|nsw|au': 130, 'melbourne|vic|au': 128,
  'toronto|on|ca': 130, 'vancouver|bc|ca': 125, 'dubai|du|ae': 130,
};

function metroBoost(city: GeoCity): number {
  const specific = `${city.city.toLowerCase()}|${city.stateCode.toLowerCase()}|${city.countryCode.toLowerCase()}`;
  return METRO_PRIORITY[specific] || 0;
}

function scoreCity(city: GeoCity, q: string, tokens: string[], mode: 'default' | 'state' | 'country'): number {
  const cityL = city.city.toLowerCase();
  const stateL = city.state.toLowerCase();
  const countryL = city.country.toLowerCase();
  const codeL = city.countryCode.toLowerCase();
  const labelL = city.label.toLowerCase();

  let score = 0;

  if (mode === 'state') {
    if (isMajorCity(city) || metroBoost(city) > 0) score += 900 + metroBoost(city);
    else if (cityL.startsWith(q)) score += 200;
    else score += 400;
    score += preferredStateBoost(city);
    return score;
  }

  if (mode === 'country') {
    if (isMajorCity(city) || metroBoost(city) > 0) score += 900 + metroBoost(city);
    else score += 300;
    score += preferredStateBoost(city);
    return score;
  }

  if (cityL === q) score += 1000;
  else if (cityL.startsWith(q)) score += 750;
  else if (q.length >= 3 && cityL.includes(q)) score += 420;

  if (stateL === q) score += 650;
  else if (stateL.startsWith(q)) score += 480;
  else if (q.length >= 4 && stateL.includes(q)) score += 300;

  if (countryL === q || codeL === q) score += 360;
  else if (countryL.startsWith(q)) score += 240;

  const aliases = COUNTRY_ALIASES[codeL] || [];
  if (aliases.includes(q)) score += 380;

  if (tokens.length > 1) {
    let tokenHits = 0;
    for (const t of tokens) {
      if (
        cityL === t || cityL.startsWith(t) ||
        stateL === t || stateL.startsWith(t) ||
        countryL === t || countryL.startsWith(t) || codeL === t ||
        (COUNTRY_ALIASES[codeL] || []).includes(t)
      ) {
        tokenHits += 1;
      }
    }
    score += tokenHits * 220;
    if (tokenHits === tokens.length) score += 320;
  }

  if (labelL.startsWith(q)) score += 40;
  if (isMajorCity(city)) score += 25;
  score += preferredStateBoost(city);
  score += Math.min(metroBoost(city), 40);

  if (['US', 'IN', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'AE', 'SG'].includes(city.countryCode)) {
    score += 5;
  }

  return score;
}

function dedupeCities(list: GeoCity[]): GeoCity[] {
  const seen = new Set<string>();
  const out: GeoCity[] = [];
  for (const city of list) {
    const key = city.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(city);
  }
  return out;
}

export function searchGeoCities(rawQuery: string, limit = 25): GeoCity[] {
  ensureIndex();
  const q = rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) {
    return popularCache.slice(0, limit);
  }

  const tokens = q.split(/[,\s]+/).map((t) => t.trim()).filter((t) => t.length > 0);
  const primary = tokens[0] || q;

  // Exact state browse only (avoids india → Indiana prefix collisions)
  const exactStateIds = exactStateIndex.get(q);
  if (tokens.length === 1 && exactStateIds && exactStateIds.length >= 10) {
    const pool = dedupeCities(exactStateIds.map((id) => cities[id - 1]).filter(Boolean));
    return pool
      .map((city) => ({ city, score: scoreCity(city, q, tokens, 'state') }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.city.city.localeCompare(b.city.city, undefined, { sensitivity: 'base' });
      })
      .slice(0, limit)
      .map((row) => row.city);
  }

  // Exact country / alias browse: "india", "usa"
  const exactCountryIds = exactCountryIndex.get(q);
  if (tokens.length === 1 && exactCountryIds && exactCountryIds.length >= 40) {
    const mapped = exactCountryIds.map((id) => cities[id - 1]).filter(Boolean);
    const majors = dedupeCities(mapped.filter((c) => isMajorCity(c) || metroBoost(c) > 0));
    const pool = majors.length >= 8 ? majors : dedupeCities(mapped.slice(0, 3000));
    return pool
      .map((city) => ({ city, score: scoreCity(city, q, tokens, 'country') }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.city.city.localeCompare(b.city.city, undefined, { sensitivity: 'base' });
      })
      .slice(0, limit)
      .map((row) => row.city);
  }

  const candidateIds = uniqueIds([
    prefixIndex.get(primary) || [],
    stateIndex.get(primary) || [],
    countryIndex.get(primary) || [],
    exactStateIndex.get(primary) || [],
    exactCountryIndex.get(primary) || [],
    ...tokens.slice(1).map((t) => exactStateIndex.get(t) || []),
    ...tokens.slice(1).map((t) => exactCountryIndex.get(t) || []),
    ...tokens.slice(1).map((t) => prefixIndex.get(t) || []),
  ]);

  let pool = dedupeCities(candidateIds.map((id) => cities[id - 1]).filter(Boolean));

  if (pool.length === 0 && primary.length >= 2) {
    const extra: number[] = [];
    for (const [key, ids] of exactCountryIndex) {
      if (key.startsWith(primary)) {
        for (const id of ids) extra.push(id);
        if (extra.length > 5000) break;
      }
    }
    for (const [key, ids] of exactStateIndex) {
      if (key.startsWith(primary)) {
        for (const id of ids) extra.push(id);
        if (extra.length > 8000) break;
      }
    }
    pool = dedupeCities(uniqueIds([extra]).map((id) => cities[id - 1]).filter(Boolean));
  }

  const scored = pool
    .map((city) => ({ city, score: scoreCity(city, q, tokens, 'default') }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const byCity = a.city.city.localeCompare(b.city.city, undefined, { sensitivity: 'base' });
      if (byCity !== 0) return byCity;
      const byState = a.city.state.localeCompare(b.city.state, undefined, { sensitivity: 'base' });
      if (byState !== 0) return byState;
      return a.city.country.localeCompare(b.city.country, undefined, { sensitivity: 'base' });
    });

  return scored.slice(0, limit).map((row) => row.city);
}

export function findGeoCityBySlug(slug: string): GeoCity | null {
  ensureIndex();
  const key = slugify(slug);
  const ids = slugIndex.get(key) || [];
  if (ids.length === 0) return null;

  const candidates = ids.map((id) => cities[id - 1]).filter(Boolean);
  candidates.sort((a, b) => {
    const scoreDiff = scoreCity(b, key.replace(/-/g, ' '), [key.replace(/-/g, ' ')], 'default')
      - scoreCity(a, key.replace(/-/g, ' '), [key.replace(/-/g, ' ')], 'default');
    if (scoreDiff !== 0) return scoreDiff;
    // Fall back: preferred state, then label
    const pref = preferredStateBoost(b) - preferredStateBoost(a);
    if (pref !== 0) return pref;
    return a.label.localeCompare(b.label);
  });
  return candidates[0] || null;
}

export function getGeoCityCount(): number {
  ensureIndex();
  return cities.length;
}

export function getPopularGeoCities(limit = 30): GeoCity[] {
  ensureIndex();
  return popularCache.slice(0, limit);
}

/** Full geo list for SEO eligibility (read-only; do not mutate). */
export function getAllGeoCities(): readonly GeoCity[] {
  ensureIndex();
  return cities;
}

/** Warm the index at server boot (non-blocking caller can await). */
export function warmGeoCityIndex(): number {
  ensureIndex();
  return cities.length;
}
