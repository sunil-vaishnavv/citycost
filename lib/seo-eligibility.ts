/**
 * SEO Index Eligibility Engine
 * Scores every geo city; only qualifying cities enter the programmatic SEO index.
 * Scores are INTERNAL — never expose in public page HTML/API payloads.
 */

import { Country } from 'country-state-city';
import { SURVEYED_CITIES } from './col-engine/surveyed-data.js';
import { resolveCityTier } from './col-engine/tiers.js';
import type { GeoCity } from './geo-cities.js';
import { getAllGeoCities, warmGeoCityIndex } from './geo-cities.js';
import { SEO_INDEX_CONFIG } from './seo-config.js';

export interface SeoQualityScores {
  eligibility: number;
  content: number;
  confidence: number;
  seo: number;
  indexable: boolean;
  reasons: string[];
  priority_band: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export interface EligibleCity {
  city: string;
  state: string;
  country: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
  timezone: string | null;
  currency: string | null;
  label: string;
  /** Full SEO path slug: city-state-country */
  pageSlug: string;
  /** Short city slug for /compare/{a}-vs-{b} */
  compareSlug: string;
  hasSurveyed: boolean;
  hasCuratedBasket: boolean;
  isCapital: boolean;
  isMajor: boolean;
  isTourismOrBusiness: boolean;
  isFrequentlyCompared: boolean;
  tier: number;
  scores: SeoQualityScores;
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function seoSlug(parts: Array<string | null | undefined>): string {
  return parts
    .filter((p) => p && String(p).trim())
    .map((p) =>
      String(p)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
    )
    .filter(Boolean)
    .join('-');
}

function shortCountrySlug(code: string): string {
  if (code === 'AE') return 'uae';
  if (code === 'GB') return 'uk';
  if (code === 'US') return 'united-states';
  if (code === 'KR') return 'south-korea';
  if (code === 'CZ') return 'czech-republic';
  const c = Country.getCountryByCode(code);
  return seoSlug([c?.name || code]);
}

/** National / territorial capitals (ISO country → capital city name). */
const CAPITALS: Record<string, string> = {
  AF: 'Kabul', AL: 'Tirana', DZ: 'Algiers', AD: 'Andorra la Vella', AO: 'Luanda',
  AR: 'Buenos Aires', AM: 'Yerevan', AU: 'Canberra', AT: 'Vienna', AZ: 'Baku',
  BH: 'Manama', BD: 'Dhaka', BY: 'Minsk', BE: 'Brussels', BZ: 'Belmopan',
  BJ: 'Porto-Novo', BT: 'Thimphu', BO: 'Sucre', BA: 'Sarajevo', BW: 'Gaborone',
  BR: 'Brasília', BG: 'Sofia', BF: 'Ouagadougou', BI: 'Gitega', KH: 'Phnom Penh',
  CM: 'Yaoundé', CA: 'Ottawa', CV: 'Praia', CF: 'Bangui', TD: 'N\'Djamena',
  CL: 'Santiago', CN: 'Beijing', CO: 'Bogotá', CR: 'San José', HR: 'Zagreb',
  CU: 'Havana', CY: 'Nicosia', CZ: 'Prague', DK: 'Copenhagen', DJ: 'Djibouti',
  DO: 'Santo Domingo', EC: 'Quito', EG: 'Cairo', SV: 'San Salvador', EE: 'Tallinn',
  ET: 'Addis Ababa', FI: 'Helsinki', FR: 'Paris', GA: 'Libreville', GE: 'Tbilisi',
  DE: 'Berlin', GH: 'Accra', GR: 'Athens', GT: 'Guatemala City', GN: 'Conakry',
  HN: 'Tegucigalpa', HU: 'Budapest', IS: 'Reykjavik', IN: 'New Delhi', ID: 'Jakarta',
  IR: 'Tehran', IQ: 'Baghdad', IE: 'Dublin', IL: 'Jerusalem', IT: 'Rome',
  JM: 'Kingston', JP: 'Tokyo', JO: 'Amman', KZ: 'Astana', KE: 'Nairobi',
  KW: 'Kuwait City', KG: 'Bishkek', LA: 'Vientiane', LV: 'Riga', LB: 'Beirut',
  LY: 'Tripoli', LT: 'Vilnius', LU: 'Luxembourg', MG: 'Antananarivo', MY: 'Kuala Lumpur',
  MV: 'Malé', ML: 'Bamako', MT: 'Valletta', MX: 'Mexico City', MD: 'Chișinău',
  MN: 'Ulaanbaatar', ME: 'Podgorica', MA: 'Rabat', MZ: 'Maputo', MM: 'Naypyidaw',
  NA: 'Windhoek', NP: 'Kathmandu', NL: 'Amsterdam', NZ: 'Wellington', NI: 'Managua',
  NE: 'Niamey', NG: 'Abuja', KP: 'Pyongyang', MK: 'Skopje', NO: 'Oslo',
  OM: 'Muscat', PK: 'Islamabad', PA: 'Panama City', PY: 'Asunción', PE: 'Lima',
  PH: 'Manila', PL: 'Warsaw', PT: 'Lisbon', QA: 'Doha', RO: 'Bucharest',
  RU: 'Moscow', RW: 'Kigali', SA: 'Riyadh', SN: 'Dakar', RS: 'Belgrade',
  SG: 'Singapore', SK: 'Bratislava', SI: 'Ljubljana', ZA: 'Pretoria', KR: 'Seoul',
  ES: 'Madrid', LK: 'Sri Jayawardenepura Kotte', SD: 'Khartoum', SE: 'Stockholm',
  CH: 'Bern', SY: 'Damascus', TW: 'Taipei', TJ: 'Dushanbe', TZ: 'Dodoma',
  TH: 'Bangkok', TN: 'Tunis', TR: 'Ankara', TM: 'Ashgabat', UG: 'Kampala',
  UA: 'Kyiv', AE: 'Abu Dhabi', GB: 'London', US: 'Washington', UY: 'Montevideo',
  UZ: 'Tashkent', VE: 'Caracas', VN: 'Hanoi', YE: 'Sanaa', ZM: 'Lusaka', ZW: 'Harare',
};

function cleanStateForSlug(state: string, country: string): string {
  if (!state) return '';
  const ns = norm(state);
  if (ns === norm(country)) return '';
  if (ns.includes('community development')) return '';
  if (state.length > 48) return '';
  return state;
}

/** Tourism / business hubs beyond capitals (lowercased city names). */
const TOURISM_BUSINESS = new Set([
  'dubai', 'abu dhabi', 'sharjah', 'las vegas', 'orlando', 'miami', 'los angeles',
  'san francisco', 'new york', 'new york city', 'chicago', 'boston', 'seattle',
  'barcelona', 'milan', 'venice', 'florence', 'nice', 'cannes', 'monaco',
  'zurich', 'geneva', 'frankfurt', 'munich', 'hamburg', 'amsterdam', 'rotterdam',
  'prague', 'budapest', 'vienna', 'istanbul', 'antalya', 'doha',
  'singapore', 'hong kong', 'macau', 'bangkok', 'phuket', 'bali', 'denpasar',
  'tokyo', 'osaka', 'kyoto', 'seoul', 'busan', 'shanghai', 'beijing', 'shenzhen',
  'sydney', 'melbourne', 'gold coast', 'auckland', 'queenstown',
  'mumbai', 'goa', 'jaipur', 'udaipur', 'varanasi', 'agra', 'kochi',
  'cape town', 'johannesburg', 'marrakesh', 'casablanca', 'cairo',
  'cancún', 'cancun', 'mexico city', 'rio de janeiro', 'são paulo', 'buenos aires',
  'lima', 'cusco', 'bogotá', 'medellín', 'santiago',
  'tel aviv', 'jerusalem', 'manama', 'muscat',
]);

/** Frequently compared destinations (SEO demand signals). */
const FREQUENT_COMPARE = new Set([
  'new york', 'new york city', 'london', 'tokyo', 'paris', 'dubai', 'singapore',
  'sydney', 'melbourne', 'toronto', 'vancouver', 'berlin', 'munich', 'amsterdam',
  'mumbai', 'delhi', 'new delhi', 'bengaluru', 'bangalore', 'hyderabad', 'chennai',
  'kolkata', 'pune', 'jaipur', 'ahmedabad', 'san francisco', 'los angeles',
  'chicago', 'boston', 'seattle', 'hong kong', 'seoul', 'bangkok', 'istanbul',
  'madrid', 'barcelona', 'rome', 'milan', 'zurich', 'dublin', 'lisbon',
]);

/** Expanded major / metro names (quality gate when population is unknown in geo DB). */
const MAJOR_METROS = new Set([
  ...TOURISM_BUSINESS,
  ...FREQUENT_COMPARE,
  'houston', 'phoenix', 'philadelphia', 'san antonio', 'san diego', 'dallas', 'san jose',
  'austin', 'jacksonville', 'fort worth', 'columbus', 'charlotte', 'indianapolis',
  'seattle', 'denver', 'washington', 'boston', 'el paso', 'nashville', 'detroit', 'oklahoma city',
  'portland', 'las vegas', 'memphis', 'louisville', 'baltimore', 'milwaukee', 'albuquerque',
  'tucson', 'fresno', 'sacramento', 'mesa', 'kansas city', 'atlanta', 'omaha', 'colorado springs',
  'raleigh', 'miami', 'virginia beach', 'oakland', 'minneapolis', 'tulsa', 'tampa', 'arlington',
  'new orleans', 'wichita', 'cleveland', 'bakersfield', 'aurora', 'anaheim', 'honolulu', 'santa ana',
  'riverside', 'corpus christi', 'lexington', 'stockton', 'henderson', 'st. louis', 'st louis',
  'pittsburgh', 'cincinnati', 'anchorage', 'greensboro', 'plano', 'newark', 'lincoln', 'orlando',
  'irvine', 'durham', 'chula vista', 'toledo', 'fort wayne', 'st. petersburg', 'laredo', 'jersey city',
  'chandler', 'madison', 'lubbock', 'scottsdale', 'reno', 'buffalo', 'gilbert', 'glendale',
  'north las vegas', 'winston-salem', 'chesapeake', 'norfolk', 'fremont', 'garland', 'irving',
  'hialeah', 'richmond', 'boise', 'spokane', 'baton rouge',
  'birmingham', 'manchester', 'glasgow', 'liverpool', 'leeds', 'edinburgh', 'bristol', 'sheffield',
  'leicester', 'coventry', 'bradford', 'cardiff', 'belfast', 'nottingham', 'newcastle',
  'lyon', 'marseille', 'toulouse', 'nice', 'nantes', 'strasbourg', 'montpellier', 'bordeaux', 'lille',
  'hamburg', 'munich', 'cologne', 'frankfurt', 'stuttgart', 'düsseldorf', 'dortmund', 'essen', 'leipzig',
  'osaka', 'yokohama', 'nagoya', 'sapporo', 'fukuoka', 'kobe', 'kyoto', 'kawasaki',
  'brisbane', 'perth', 'adelaide', 'canberra', 'gold coast', 'hobart', 'darwin',
  'montreal', 'calgary', 'ottawa', 'edmonton', 'winnipeg', 'quebec city', 'hamilton', 'kitchener',
  'surat', 'lucknow', 'kanpur', 'nagpur', 'indore', 'thane', 'bhopal', 'visakhapatnam', 'patna',
  'vadodara', 'ghaziabad', 'ludhiana', 'agra', 'nashik', 'faridabad', 'meerut', 'rajkot', 'varanasi',
  'srinagar', 'amritsar', 'chandigarh', 'coimbatore', 'kochi', 'mysore', 'jodhpur', 'udaipur',
  'ajmer', 'bikaner', 'kota', 'guwahati', 'noida', 'gurugram', 'gurgaon',
  'busan', 'incheon', 'daegu', 'daejeon',
  'jakarta', 'surabaya', 'bandung', 'medan', 'manila', 'cebu', 'quezon city',
  'ho chi minh city', 'hanoi', 'ha noi', 'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'chengdu',
  'hangzhou', 'wuhan', "xi'an", 'chongqing', 'tianjin', 'nanjing', 'suzhou',
  'sao paulo', 'são paulo', 'rio de janeiro', 'brasilia', 'brasília', 'salvador', 'fortaleza',
  'belo horizonte', 'manaus', 'curitiba', 'recife', 'porto alegre',
  'guadalajara', 'monterrey', 'puebla', 'tijuana', 'leon', 'juarez',
  'buenos aires', 'cordoba', 'rosario', 'santiago', 'valparaiso', 'lima', 'arequipa',
  'bogota', 'bogotá', 'medellin', 'medellín', 'cali', 'barranquilla',
  'lagos', 'abuja', 'ibadan', 'kano', 'nairobi', 'mombasa', 'accra', 'kumasi',
  'johannesburg', 'cape town', 'durban', 'pretoria', 'casablanca', 'rabat', 'marrakesh',
  'cairo', 'alexandria', 'giza', 'tunis', 'algiers',
  'istanbul', 'ankara', 'izmir', 'bursa', 'antalya',
  'moscow', 'saint petersburg', 'novosibirsk', 'yekaterinburg',
  'warsaw', 'krakow', 'kraków', 'gdansk', 'wroclaw', 'poznań',
  'prague', 'brno', 'budapest', 'debrecen', 'bucharest', 'cluj-napoca',
  'athens', 'thessaloniki', 'lisbon', 'porto', 'vienna', 'graz', 'salzburg',
  'stockholm', 'gothenburg', 'malmo', 'oslo', 'bergen', 'copenhagen', 'aarhus',
  'helsinki', 'tampere', 'dublin', 'cork', 'zurich', 'geneva', 'basel', 'lausanne',
  'brussels', 'antwerp', 'rotterdam', 'the hague', 'utrecht', 'luxembourg',
  'tel aviv', 'jerusalem', 'haifa', 'riyadh', 'jeddah', 'dammam', 'mecca', 'medina',
  'doha', 'kuwait city', 'manama', 'muscat', 'amman', 'beirut',
  'auckland', 'wellington', 'christchurch', 'queenstown',
  'colombo', 'kandy', 'dhaka', 'chittagong', 'karachi', 'lahore', 'islamabad', 'rawalpindi',
  'tehran', 'mashhad', 'isfahan', 'baghdad', 'basra', 'erbil',
]);

/** Preferred disambiguation (city|cc → state code). */
const PREFERRED: Record<string, string> = {
  'pali|in': 'RJ',
  'london|gb': 'ENG',
  'birmingham|gb': 'ENG',
  'manchester|gb': 'ENG',
  'springfield|us': 'IL',
  'portland|us': 'OR',
  'cambridge|us': 'MA',
  'vancouver|ca': 'BC',
  'washington|us': 'DC',
};

const PRIMARY_COUNTRY: Record<string, string> = {
  london: 'GB', paris: 'FR', berlin: 'DE', munich: 'DE', rome: 'IT', milan: 'IT',
  madrid: 'ES', barcelona: 'ES', sydney: 'AU', melbourne: 'AU', brisbane: 'AU',
  perth: 'AU', toronto: 'CA', vancouver: 'CA', montreal: 'CA', dubai: 'AE',
  tokyo: 'JP', osaka: 'JP', seoul: 'KR', bangkok: 'TH', singapore: 'SG',
  mumbai: 'IN', delhi: 'IN', 'new delhi': 'IN', bengaluru: 'IN', bangalore: 'IN',
  dublin: 'IE', amsterdam: 'NL', zurich: 'CH', geneva: 'CH',
};

interface SurveyedMeta {
  population?: number;
  hasBasket: boolean;
  latitude?: number;
  longitude?: number;
  tier: number;
}

function buildSurveyedIndex(): Map<string, SurveyedMeta & { state?: string }> {
  const map = new Map<string, SurveyedMeta & { state?: string }>();
  for (const rec of SURVEYED_CITIES) {
    const hasBasket = !!(rec.localBasket && Object.keys(rec.localBasket).length > 0);
    const meta: SurveyedMeta & { state?: string } = {
      population: rec.population,
      hasBasket,
      latitude: rec.latitude,
      longitude: rec.longitude,
      tier: rec.tier,
      state: rec.state,
    };
    const keys = [`${norm(rec.city)}|${rec.countryCode}`];
    if (rec.state) keys.unshift(`${norm(rec.city)}|${rec.countryCode}|${norm(rec.state)}`);
    for (const key of keys) {
      const existing = map.get(key);
      if (!existing || (hasBasket && !existing.hasBasket)) map.set(key, meta);
    }
  }
  return map;
}

function lookupSurveyed(
  surveyed: Map<string, SurveyedMeta & { state?: string }>,
  city: string,
  countryCode: string,
  state: string
): (SurveyedMeta & { state?: string }) | undefined {
  if (state) {
    const exact = surveyed.get(`${norm(city)}|${countryCode}|${norm(state)}`);
    if (exact) return exact;
  }
  const loose = surveyed.get(`${norm(city)}|${countryCode}`);
  if (!loose) return undefined;
  // Do not attach surveyed basket to a different state when surveyed state is known
  if (loose.state && state && norm(loose.state) !== norm(state)) return undefined;
  return loose;
}

function isLikelyThinName(city: string): boolean {
  const n = city.trim();
  if (n.length < SEO_INDEX_CONFIG.minCityNameLength) return true;
  if (/^\d+$/.test(n)) return true;
  if (/^[a-z]$/i.test(n)) return true;
  return false;
}

function scoreCandidate(geo: GeoCity, surveyed: Map<string, SurveyedMeta & { state?: string }>): EligibleCity | null {
  if (isLikelyThinName(geo.city)) return null;
  if (!geo.countryCode || !geo.country) return null;

  const key = `${norm(geo.city)}|${geo.countryCode}`;
  const surveyedHit = lookupSurveyed(surveyed, geo.city, geo.countryCode, geo.state || '');
  const capitalName = CAPITALS[geo.countryCode];
  const isCapital = !!(capitalName && norm(capitalName) === norm(geo.city));
  const primary = PRIMARY_COUNTRY[norm(geo.city)];
  const inMajorMetro = MAJOR_METROS.has(norm(geo.city));
  const stateEqualsCity = !!(geo.state && norm(geo.state) === norm(geo.city));
  const isMajorName = inMajorMetro || FREQUENT_COMPARE.has(norm(geo.city)) || TOURISM_BUSINESS.has(norm(geo.city)) || isCapital || stateEqualsCity;
  if (primary && primary !== geo.countryCode && !surveyedHit && !isCapital) {
    // Avoid indexing "Paris, TX" style thin duplicates of global brands
    if (!geo.state || geo.population == null) {
      // still allow if preferred state match later; soft skip weak dupes
    }
  }

  // Preferred-state disambiguation: drop non-preferred clones of ambiguous names
  const pref = PREFERRED[`${norm(geo.city)}|${geo.countryCode.toLowerCase()}`];
  if (pref && geo.stateCode && geo.stateCode !== pref && !surveyedHit && !isCapital) {
    return null;
  }

  // Primary-country gate for globally famous names (prevents thousands of thin clones)
  if (primary && primary !== geo.countryCode && !surveyedHit && !isCapital) {
    return null;
  }

  const population = surveyedHit?.population ?? geo.population;
  const hasCoords = (geo.latitude != null && geo.longitude != null) ||
    (surveyedHit?.latitude != null && surveyedHit?.longitude != null);
  const hasSurveyed = !!surveyedHit;
  const hasCuratedBasket = !!surveyedHit?.hasBasket;
  const isTourismOrBusiness = TOURISM_BUSINESS.has(norm(geo.city));
  const isFrequentlyCompared = FREQUENT_COMPARE.has(norm(geo.city));
  const isMajor = isMajorName || (population != null && population >= 500_000);

  if (SEO_INDEX_CONFIG.requireCoordsOrSurveyed && !hasCoords && !hasSurveyed) {
    return null;
  }

  // Hard reject: tiny / unknown with no importance signals
  const importance =
    hasSurveyed || hasCuratedBasket || isCapital || isMajor || isTourismOrBusiness || isFrequentlyCompared;
  if (!importance) {
    if (population == null || population < SEO_INDEX_CONFIG.minPopulation) return null;
  }
  if (population != null && population < 15_000 && !hasSurveyed && !isCapital) {
    return null; // villages
  }

  const reasons: string[] = [];
  let eligibility = 0;
  let priority_band: SeoQualityScores['priority_band'] = 9;

  // Priority 1 — verified COL / surveyed
  if (hasSurveyed) {
    eligibility += 28;
    reasons.push('verified_or_surveyed_col');
    priority_band = 1;
  }
  // Priority 2 — curated baskets
  if (hasCuratedBasket) {
    eligibility += 18;
    reasons.push('curated_basket');
    priority_band = Math.min(priority_band, 2) as SeoQualityScores['priority_band'];
  }
  // Priority 3 — high-confidence estimation path (surveyed nearby country/state presence)
  if (!hasSurveyed && hasCoords && (isMajor || isCapital || (population != null && population >= 300_000))) {
    eligibility += 14;
    reasons.push('high_confidence_estimation_candidate');
    priority_band = Math.min(priority_band, 3) as SeoQualityScores['priority_band'];
  }
  // Priority 4 — capitals
  if (isCapital) {
    eligibility += 16;
    reasons.push('capital_city');
    priority_band = Math.min(priority_band, 4) as SeoQualityScores['priority_band'];
  }
  // Priority 5 — large / major cities
  if (isMajor || inMajorMetro) {
    eligibility += 18;
    reasons.push('large_or_major_city');
    priority_band = Math.min(priority_band, 5) as SeoQualityScores['priority_band'];
  }
  // Priority 6 — population threshold
  if (population != null) {
    if (population >= 5_000_000) eligibility += 14;
    else if (population >= 1_000_000) eligibility += 11;
    else if (population >= 300_000) eligibility += 8;
    else if (population >= SEO_INDEX_CONFIG.minPopulation) eligibility += 5;
    reasons.push('population_signal');
    priority_band = Math.min(priority_band, 6) as SeoQualityScores['priority_band'];
  }
  // Priority 7 — tourism / business
  if (isTourismOrBusiness) {
    eligibility += 10;
    reasons.push('tourism_or_business_hub');
    priority_band = Math.min(priority_band, 7) as SeoQualityScores['priority_band'];
  }
  // Priority 8 — frequently compared
  if (isFrequentlyCompared) {
    eligibility += 8;
    reasons.push('frequently_compared');
    priority_band = Math.min(priority_band, 8) as SeoQualityScores['priority_band'];
  }
  // State-named cities (often regional hubs) — content richness signal
  if (stateEqualsCity) {
    eligibility += 8;
    reasons.push('state_named_urban_hub');
  }
  // Priority 9 — metadata richness (state + country + coords)
  let contentMeta = 0;
  if (geo.state) contentMeta += 6;
  if (geo.country) contentMeta += 4;
  if (hasCoords) contentMeta += 6;
  if (geo.timezone || geo.currency) contentMeta += 3;
  if (population != null) contentMeta += 4;
  eligibility += Math.min(contentMeta, 12);
  if (contentMeta >= 10) {
    reasons.push('sufficient_metadata_for_unique_page');
    priority_band = Math.min(priority_band, 9) as SeoQualityScores['priority_band'];
  }

  // Soft bonus for having a state (disambiguation / unique titles)
  if (geo.state) eligibility += 3;

  eligibility = Math.min(100, Math.round(eligibility));

  // Confidence score (internal): surveyed/basket highest
  let confidence = 35;
  if (hasCuratedBasket) confidence = 92;
  else if (hasSurveyed) confidence = 82;
  else if (isCapital || (population != null && population >= 1_000_000)) confidence = 68;
  else if (isMajor || isTourismOrBusiness) confidence = 60;
  else confidence = 48;

  // Content score: can we build a non-thin unique page?
  let content = 40;
  if (geo.state) content += 12;
  if (hasCoords) content += 10;
  if (population != null) content += 10;
  if (hasSurveyed) content += 15;
  if (hasCuratedBasket) content += 8;
  if (isCapital || isMajor) content += 8;
  content = Math.min(100, content);

  const seo = Math.round(eligibility * 0.45 + content * 0.35 + confidence * 0.2);

  const indexable =
    eligibility >= SEO_INDEX_CONFIG.minEligibilityScore &&
    content >= SEO_INDEX_CONFIG.minContentScore &&
    seo >= 50;

  if (!indexable) return null;

  const tier = surveyedHit?.tier ?? resolveCityTier(geo.city, population);
  const stateForSlug = cleanStateForSlug(geo.state || '', geo.country);
  const pageSlug = seoSlug([geo.city, stateForSlug, shortCountrySlug(geo.countryCode)]);
  const compareSlug = seoSlug([geo.city]);

  return {
    city: geo.city,
    state: geo.state || '',
    country: geo.country,
    countryCode: geo.countryCode,
    latitude: surveyedHit?.latitude ?? geo.latitude,
    longitude: surveyedHit?.longitude ?? geo.longitude,
    population: population ?? null,
    timezone: geo.timezone,
    currency: geo.currency,
    label: geo.label,
    pageSlug,
    compareSlug,
    hasSurveyed,
    hasCuratedBasket,
    isCapital,
    isMajor,
    isTourismOrBusiness,
    isFrequentlyCompared,
    tier,
    scores: {
      eligibility,
      content,
      confidence,
      seo,
      indexable: true,
      reasons,
      priority_band,
    },
  };
}

let cache: EligibleCity[] | null = null;
let cacheKey = '';

function configKey(): string {
  return [
    SEO_INDEX_CONFIG.maxIndexableCities,
    SEO_INDEX_CONFIG.minEligibilityScore,
    SEO_INDEX_CONFIG.minContentScore,
    SEO_INDEX_CONFIG.minPopulation,
  ].join(':');
}

/**
 * Build / return the eligible SEO city index (cached).
 * Dedupes by pageSlug; prefers higher eligibility, then surveyed, then population.
 */
export function listEligibleCities(force = false): EligibleCity[] {
  warmGeoCityIndex();
  const key = configKey();
  if (!force && cache && cacheKey === key) return cache;

  const surveyed = buildSurveyedIndex();
  const all = getAllGeoCities();
  const bySlug = new Map<string, EligibleCity>();

  for (const geo of all) {
    const scored = scoreCandidate(geo, surveyed);
    if (!scored) continue;

    const existing = bySlug.get(scored.pageSlug);
    if (!existing) {
      bySlug.set(scored.pageSlug, scored);
      continue;
    }
    // Prefer richer record; for Dubai-style duplicates prefer longer (state-qualified) slug when scores tie
    const better =
      scored.scores.eligibility > existing.scores.eligibility ||
      (scored.scores.eligibility === existing.scores.eligibility && scored.hasCuratedBasket && !existing.hasCuratedBasket) ||
      (scored.scores.eligibility === existing.scores.eligibility &&
        (scored.population || 0) > (existing.population || 0)) ||
      (scored.scores.eligibility === existing.scores.eligibility &&
        scored.state.length > existing.state.length);
    if (better) bySlug.set(scored.pageSlug, scored);
  }

  // Also ensure every surveyed city is present even if geo match is odd
  for (const rec of SURVEYED_CITIES) {
    const stateForSlug = cleanStateForSlug(rec.state || '', rec.country);
    const pageSlug = seoSlug([rec.city, stateForSlug, shortCountrySlug(rec.countryCode)]);
    if (bySlug.has(pageSlug)) continue;
    const label = [rec.city, rec.state, rec.country].filter(Boolean).join(', ');
    bySlug.set(pageSlug, {
      city: rec.city,
      state: rec.state || '',
      country: rec.country,
      countryCode: rec.countryCode,
      latitude: rec.latitude ?? null,
      longitude: rec.longitude ?? null,
      population: rec.population ?? null,
      timezone: null,
      currency: null,
      label,
      pageSlug,
      compareSlug: seoSlug([rec.city]),
      hasSurveyed: true,
      hasCuratedBasket: !!(rec.localBasket && Object.keys(rec.localBasket).length > 0),
      isCapital: CAPITALS[rec.countryCode] ? norm(CAPITALS[rec.countryCode]) === norm(rec.city) : false,
      isMajor: true,
      isTourismOrBusiness: TOURISM_BUSINESS.has(norm(rec.city)),
      isFrequentlyCompared: FREQUENT_COMPARE.has(norm(rec.city)),
      tier: rec.tier,
      scores: {
        eligibility: 95,
        content: 90,
        confidence: rec.localBasket ? 92 : 82,
        seo: 92,
        indexable: true,
        reasons: ['verified_or_surveyed_col', 'catalog_seed'],
        priority_band: rec.localBasket ? 2 : 1,
      },
    });
  }

  const ranked = [...bySlug.values()].sort((a, b) => {
    if (b.scores.eligibility !== a.scores.eligibility) return b.scores.eligibility - a.scores.eligibility;
    if (b.scores.seo !== a.scores.seo) return b.scores.seo - a.scores.seo;
    return (b.population || 0) - (a.population || 0);
  });

  // Collapse same city+country duplicates (e.g. dubai-uae vs dubai-dubai-uae)
  const byCityCountry = new Map<string, EligibleCity>();
  for (const c of ranked) {
    const k = `${norm(c.city)}|${c.countryCode}`;
    const prev = byCityCountry.get(k);
    if (!prev) {
      byCityCountry.set(k, c);
      continue;
    }
    const prefer =
      c.scores.eligibility > prev.scores.eligibility ||
      (c.state.length > prev.state.length && c.scores.eligibility >= prev.scores.eligibility - 2) ||
      ((c.population || 0) > (prev.population || 0) && c.scores.eligibility >= prev.scores.eligibility);
    if (prefer) byCityCountry.set(k, c);
  }

  const collapsed = [...byCityCountry.values()];
  const guaranteed = collapsed.filter((c) => c.hasSurveyed || c.hasCuratedBasket || c.isCapital);
  const guaranteedSet = new Set(guaranteed);
  const rest = collapsed
    .filter((c) => !guaranteedSet.has(c))
    .sort((a, b) => {
      if (b.scores.eligibility !== a.scores.eligibility) return b.scores.eligibility - a.scores.eligibility;
      return (b.population || 0) - (a.population || 0);
    });

  const seats = Math.max(0, SEO_INDEX_CONFIG.maxIndexableCities - guaranteed.length);
  cache = [...guaranteed, ...rest.slice(0, seats)].sort((a, b) => {
    if (b.scores.eligibility !== a.scores.eligibility) return b.scores.eligibility - a.scores.eligibility;
    return (b.population || 0) - (a.population || 0);
  });
  // If guaranteed alone exceeds cap, keep highest-eligibility guaranteed set
  if (cache.length > SEO_INDEX_CONFIG.maxIndexableCities) {
    cache = cache.slice(0, SEO_INDEX_CONFIG.maxIndexableCities);
  }
  cacheKey = key;
  return cache;
}

export function findEligibleByPageSlug(slug: string): EligibleCity | null {
  const s = seoSlug([slug]);
  return listEligibleCities().find((c) => c.pageSlug === s) || null;
}

export function getEligibilityStats() {
  const cities = listEligibleCities();
  const byBand: Record<number, number> = {};
  for (const c of cities) {
    byBand[c.scores.priority_band] = (byBand[c.scores.priority_band] || 0) + 1;
  }
  return {
    indexable_cities: cities.length,
    by_priority_band: byBand,
    config: {
      maxIndexableCities: SEO_INDEX_CONFIG.maxIndexableCities,
      minEligibilityScore: SEO_INDEX_CONFIG.minEligibilityScore,
      minContentScore: SEO_INDEX_CONFIG.minContentScore,
      minPopulation: SEO_INDEX_CONFIG.minPopulation,
      maxIndexableComparisons: SEO_INDEX_CONFIG.maxIndexableComparisons,
    },
  };
}

export { seoSlug, shortCountrySlug, CAPITALS };
