import crypto from 'crypto';
import {
  countrySlugFromCode,
  listIndexableCities,
  listIndexableCountries,
} from '../../seo-catalog.js';
import type { EligibleCity } from '../../seo-eligibility.js';
import { CATEGORY_HUBS } from '../../search-intent/intent.js';
import type { TopicCandidate } from '../types.js';
import { resolveClusterSlugForTopic } from './cluster-registry.js';
import {
  EDITORIAL_MIGRATION_CORRIDORS,
  evaluateComparisonPair,
  findCityByNameCode,
  type ComparisonTier,
} from './comparison-policy.js';
import {
  cityBlogTitle,
  comparisonBlogTitle,
  countryBlogTitle,
  hubBlogTitle,
  supportingGuideBlogTitle,
} from './topic-titles.js';

function hashTopic(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|').toLowerCase()).digest('hex');
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 96);
}

function normCity(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Collapse geo aliases so we never emit Bengaluru vs Bangalore / NYC vs New York. */
function cityCanonicalKey(city: EligibleCity): string {
  const n = normCity(city.city);
  if (n === 'bangalore' || n === 'bengaluru') return `${city.countryCode}:bengaluru`;
  if (n === 'delhi' || n === 'new delhi') return `${city.countryCode}:delhi`;
  if (n === 'mumbai' || n === 'bombay') return `${city.countryCode}:mumbai`;
  if (n === 'new york' || n === 'new york city' || n === 'nyc') return `${city.countryCode}:new-york`;
  if (n === 'ho chi minh city' || n === 'saigon') return `${city.countryCode}:ho-chi-minh`;
  if (n === 'washington' || n === 'washington dc' || n === 'washington d.c.') {
    return `${city.countryCode}:washington-dc`;
  }
  return `${city.countryCode}:${city.compareSlug || slugify(city.city)}`;
}

const PRIORITY_COUNTRY_CODES = new Set([
  'US',
  'GB',
  'DE',
  'FR',
  'IN',
  'AU',
  'CA',
  'JP',
  'SG',
  'AE',
  'NL',
  'ES',
  'IT',
  'BR',
  'MX',
  'KR',
  'PT',
  'IE',
  'CH',
  'AT',
  'SE',
  'NO',
  'DK',
  'NZ',
  'PL',
  'TR',
  'TH',
  'MY',
  'ID',
  'PH',
  'VN',
  'ZA',
  'EG',
  'NG',
  'AR',
  'CL',
  'CO',
  'CZ',
  'GR',
  'BE',
  'FI',
  'HU',
  'RO',
  'CN',
  'HK',
  'TW',
  'IL',
  'SA',
  'QA',
]);

function monthSeasonalBoost(): string | null {
  const m = new Date().getUTCMonth() + 1;
  if (m === 7 || m === 8) return 'students';
  if (m === 1 || m === 2) return 'budget';
  if (m === 11 || m === 12) return 'relocation';
  return null;
}

const HUB_LABELS: Record<string, string> = {
  students: 'Student Cities',
  families: 'Family Cities',
  'remote-workers': 'Remote Worker Cities',
  retirement: 'Retirement Cities',
  'digital-nomads': 'Digital Nomad Cities',
  'cheapest-cities': 'Cheapest Cities',
  'most-expensive-cities': 'Most Expensive Cities',
};

/** Country-level supporting guides (topical authority spokes). */
const COUNTRY_SUPPORTING: Array<{
  content_type: string;
  title: (country: string) => string;
  keyword: (country: string) => string;
  secondary: (country: string) => string[];
  persona: string;
  intent: string;
  guide_kind: string;
}> = [
  {
    content_type: 'salary_guide',
    title: (c) => `${c} Salary Guide: Average Wages and Buying Power`,
    keyword: (c) => `${c} average salary`,
    secondary: (c) => [`${c} wages`, `${c} cost of living vs salary`, `living on salary in ${c}`],
    persona: 'professionals evaluating relocation offers',
    intent: 'commercial_investigation',
    guide_kind: 'salary',
  },
  {
    content_type: 'tax_guide',
    title: (c) => `${c} Tax Guide for Expats and Relocators`,
    keyword: (c) => `${c} tax guide expats`,
    secondary: (c) => [`${c} income tax`, `${c} tax for foreigners`, `cost of taxes in ${c}`],
    persona: 'expats planning a move',
    intent: 'informational',
    guide_kind: 'taxes',
  },
  {
    content_type: 'rent_guide',
    title: (c) => `${c} Rent Guide: Housing Costs by City`,
    keyword: (c) => `${c} rent prices`,
    secondary: (c) => [`average rent in ${c}`, `${c} apartment costs`, `housing costs ${c}`],
    persona: 'people budgeting housing before moving',
    intent: 'commercial_investigation',
    guide_kind: 'rent',
  },
  {
    content_type: 'food_guide',
    title: (c) => `${c} Food Prices Guide: Groceries and Dining Costs`,
    keyword: (c) => `${c} food prices`,
    secondary: (c) => [`grocery costs in ${c}`, `restaurant prices ${c}`, `${c} food budget`],
    persona: 'budget-conscious relocators',
    intent: 'informational',
    guide_kind: 'food',
  },
  {
    content_type: 'transportation_guide',
    title: (c) => `${c} Transportation Costs Guide`,
    keyword: (c) => `${c} transportation costs`,
    secondary: (c) => [`public transport ${c}`, `commute costs ${c}`, `car costs in ${c}`],
    persona: 'commuters and relocators',
    intent: 'informational',
    guide_kind: 'transportation',
  },
  {
    content_type: 'healthcare_guide',
    title: (c) => `${c} Healthcare Costs Guide`,
    keyword: (c) => `${c} healthcare costs`,
    secondary: (c) => [`health insurance ${c}`, `medical costs ${c}`, `doctor visit cost ${c}`],
    persona: 'families and long-term movers',
    intent: 'informational',
    guide_kind: 'healthcare',
  },
  {
    content_type: 'student_guide',
    title: (c) => `${c} Student Cost of Living Guide`,
    keyword: (c) => `${c} student cost of living`,
    secondary: (c) => [`study in ${c} budget`, `student housing ${c}`, `cheap student cities ${c}`],
    persona: 'international students',
    intent: 'informational',
    guide_kind: 'student',
  },
  {
    content_type: 'remote_worker_guide',
    title: (c) => `${c} Digital Nomad Guide: Cost of Living and Visas`,
    keyword: (c) => `${c} digital nomad cost of living`,
    secondary: (c) => [`remote work in ${c}`, `nomad visa ${c}`, `coworking costs ${c}`],
    persona: 'digital nomads and remote workers',
    intent: 'commercial_investigation',
    guide_kind: 'digital_nomad',
  },
  {
    content_type: 'retirement_guide',
    title: (c) => `${c} Retirement Cost of Living Guide`,
    keyword: (c) => `${c} retirement cost of living`,
    secondary: (c) => [`retire in ${c}`, `${c} retirement budget`, `healthcare for retirees ${c}`],
    persona: 'retirees considering relocation',
    intent: 'informational',
    guide_kind: 'retirement',
  },
  {
    content_type: 'moving_guide',
    title: (c) => `Moving to ${c}: Cost Checklist and Budget Planner`,
    keyword: (c) => `moving to ${c} cost`,
    secondary: (c) => [`relocate to ${c}`, `${c} moving checklist`, `first month costs ${c}`],
    persona: 'people planning an international move',
    intent: 'commercial_investigation',
    guide_kind: 'moving',
  },
  {
    content_type: 'budget_guide',
    title: (c) => `${c} Monthly Budget Guide: Realistic Living Costs`,
    keyword: (c) => `${c} monthly budget`,
    secondary: (c) => [`cost of living budget ${c}`, `how much to live in ${c}`, `${c} expenses breakdown`],
    persona: 'people comparing affordability',
    intent: 'informational',
    guide_kind: 'budget',
  },
  {
    content_type: 'visa_guide',
    title: (c) => `${c} Visa and Residence Cost Guide`,
    keyword: (c) => `${c} visa costs`,
    secondary: (c) => [`residence permit ${c}`, `work visa ${c} cost`, `immigration costs ${c}`],
    persona: 'relocators researching legal entry costs',
    intent: 'commercial_investigation',
    guide_kind: 'visa',
  },
];

function compareSlug(a: EligibleCity, b: EligibleCity): string {
  const left = a.compareSlug || slugify(a.city);
  const right = b.compareSlug || slugify(b.city);
  return [left, right].sort().join('-vs-');
}

function countryGeoPriority(code: string, cities: EligibleCity[]): number {
  if (!cities.length) return 0;
  const top = [...cities].sort((x, y) => y.scores.eligibility - x.scores.eligibility).slice(0, 5);
  const avg = top.reduce((s, c) => s + c.scores.eligibility, 0) / top.length;
  const surveyed = cities.filter((c) => c.hasSurveyed || c.hasCuratedBasket).length;
  const majors = cities.filter((c) => c.isCapital || c.isMajor || c.isFrequentlyCompared).length;
  const priorityBoost = PRIORITY_COUNTRY_CODES.has(code) ? 45 : 0;
  return Math.round(
    avg * 0.55 +
      Math.min(18, majors * 4) +
      Math.min(12, surveyed * 3) +
      Math.min(10, cities.length) +
      priorityBoost
  );
}

function dedupeCities(cities: EligibleCity[]): EligibleCity[] {
  const best = new Map<string, EligibleCity>();
  for (const city of cities) {
    const key = cityCanonicalKey(city);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, city);
      continue;
    }
    const score = (c: EligibleCity) =>
      c.scores.eligibility +
      (c.isCapital ? 12 : 0) +
      (c.isMajor ? 8 : 0) +
      (c.hasSurveyed ? 6 : 0) +
      (c.isFrequentlyCompared ? 5 : 0);
    if (score(city) > score(prev)) best.set(key, city);
  }
  return [...best.values()];
}

interface RichRefs extends Record<string, unknown> {
  title: string;
  slug: string;
  intent: string;
  content_type: string;
  primary_keyword: string;
  secondary_keywords: string[];
  persona: string;
  cluster: string;
  parent_topic: string | null;
  country: string | null;
  country_code: string | null;
  country_slug: string | null;
  cities: string[];
  estimated_search_value: number;
  difficulty: number;
  priority?: 'high' | 'medium' | 'low';
  seo_reason: string;
  internal_link_opportunities: string[];
  guide_kind?: string;
  comparison_tier?: ComparisonTier;
  seasonal_hint: string | null;
  geo_priority: number;
  eligibility_a?: number;
  eligibility_b?: number;
  city_eligibility?: number;
}

function baseRefs(partial: RichRefs): RichRefs {
  const search = Number(partial.estimated_search_value) || 0;
  const difficulty = Number(partial.difficulty) || 0;
  let priority: RichRefs['priority'] = partial.priority || 'medium';
  if (!partial.priority) {
    if (search >= 72 && difficulty <= 55) priority = 'high';
    else if (search < 45 || difficulty >= 75) priority = 'low';
  }
  return { ...partial, priority };
}

/**
 * Build topic candidates as country topical clusters (pillar → cities → comps → supporting).
 * Comparisons are gated by editorial policy — no random worldwide pairs.
 */
export function buildTopicCandidates(max: number, maxCountries = 40): TopicCandidate[] {
  const out: TopicCandidate[] = [];
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const seasonal = monthSeasonalBoost();
  const cities = listIndexableCities();
  const countries = listIndexableCountries();
  const byCountry = new Map<string, EligibleCity[]>();

  for (const c of cities) {
    const list = byCountry.get(c.countryCode) || [];
    list.push(c);
    byCountry.set(c.countryCode, list);
  }

  const rankedCountries = countries
    .map((country) => {
      const list = dedupeCities(byCountry.get(country.code) || []);
      return { country, cities: list, geo: countryGeoPriority(country.code, list) };
    })
    .filter((row) => {
      if (row.cities.length < 1) return false;
      return row.cities.some(
        (c) =>
          c.isCapital ||
          c.isMajor ||
          c.isFrequentlyCompared ||
          c.scores.eligibility >= 62 ||
          PRIORITY_COUNTRY_CODES.has(row.country.code)
      );
    })
    .sort((a, b) => b.geo - a.geo || b.cities.length - a.cities.length)
    .slice(0, Math.max(8, maxCountries));

  const push = (c: TopicCandidate) => {
    if (out.length >= max) return;
    if (seen.has(c.topic_hash)) return;
    const titleKey = c.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (seenTitles.has(titleKey)) return;
    seen.add(c.topic_hash);
    seenTitles.add(titleKey);
    out.push(c);
  };

  const pushComparison = (
    a: EligibleCity,
    b: EligibleCity,
    countryName: string | null,
    parentTopic: string | null,
    geo: number
  ) => {
    const policy = evaluateComparisonPair(a, b);
    if (!policy.allowed) return;
    const slug = compareSlug(a, b);
    const title = comparisonBlogTitle(a.city, b.city, slug);
    const countrySlug =
      a.countryCode === b.countryCode ? countrySlugFromCode(a.countryCode) : null;
    const clusterSlug = resolveClusterSlugForTopic({
      countrySlug,
      kind: 'comparison',
    });
    const elig = (a.scores.eligibility + b.scores.eligibility) / 2;
    const searchValue = Math.min(
      98,
      Math.round(elig * 0.55 + policy.demandBoost + (policy.tier === 'same_country' ? 8 : 0))
    );
    const difficulty = Math.min(
      95,
      Math.round(
        35 +
          (policy.tier === 'major_international' ? 18 : 8) +
          Math.abs(a.scores.eligibility - b.scores.eligibility) * 0.15
      )
    );
    const links = [
      `/city/${a.pageSlug}`,
      `/city/${b.pageSlug}`,
      `/compare/${slug}`,
      countrySlug ? `/country/${countrySlug}` : null,
    ].filter(Boolean) as string[];

    push({
      title,
      content_type: 'comparison_guide',
      cluster_slug: clusterSlug,
      source_refs: baseRefs({
        title,
        slug: slugify(title),
        intent: 'commercial_investigation',
        content_type: 'comparison_guide',
        primary_keyword: `${a.city} vs ${b.city} cost of living`,
        secondary_keywords: [
          `${a.city} vs ${b.city}`,
          `cost of living ${a.city} ${b.city}`,
          `${a.city} or ${b.city}`,
        ],
        persona: 'people comparing two cities before moving',
        cluster: clusterSlug,
        parent_topic: parentTopic,
        country: a.countryCode === b.countryCode ? countryName || a.country : null,
        country_code: a.countryCode === b.countryCode ? a.countryCode : null,
        country_slug: countrySlug,
        cities: [a.city, b.city],
        estimated_search_value: searchValue,
        difficulty,
        seo_reason: policy.reason,
        internal_link_opportunities: links,
        comparison_tier: policy.tier,
        comparison_slug: slug,
        page_slug_a: a.pageSlug,
        page_slug_b: b.pageSlug,
        query_a: a.label,
        query_b: b.label,
        href: `/compare/${slug}`,
        seasonal_hint: seasonal,
        geo_priority: geo,
        eligibility_a: a.scores.eligibility,
        eligibility_b: b.scores.eligibility,
      }),
      topic_hash: hashTopic(['comparison_guide', slug]),
    });
  };

  for (const { country, cities: countryCities, geo } of rankedCountries) {
    if (out.length >= max) break;

    const countrySlug = country.slug;
    const pillarParent = `Cost of Living in ${country.name}`;
    const pillarTitle = countryBlogTitle(country.name, countrySlug);
    const countryCluster = resolveClusterSlugForTopic({
      countrySlug,
      kind: 'country',
    });
    let topCities = [...countryCities]
      .filter(
        (c) =>
          c.isCapital ||
          c.isMajor ||
          c.isFrequentlyCompared ||
          c.hasSurveyed ||
          c.hasCuratedBasket ||
          c.scores.eligibility >= 68 ||
          (c.population != null && c.population >= 250_000)
      )
      .sort((a, b) => {
        const score = (c: EligibleCity) =>
          c.scores.eligibility +
          (c.isCapital ? 12 : 0) +
          (c.isMajor ? 8 : 0) +
          (c.hasSurveyed ? 6 : 0) +
          (c.isFrequentlyCompared ? 5 : 0) +
          Math.min(10, (c.population || 0) / 500_000);
        return score(b) - score(a);
      })
      .slice(0, 6);
    if (!topCities.length) {
      topCities = [...countryCities]
        .sort((a, b) => b.scores.eligibility - a.scores.eligibility)
        .slice(0, 3);
    }

    // Pillar — country guide
    push({
      title: pillarTitle,
      content_type: 'country_guide',
      cluster_slug: countryCluster,
      source_refs: baseRefs({
        title: pillarTitle,
        slug: slugify(pillarTitle),
        intent: 'informational',
        content_type: 'country_guide',
        primary_keyword: `cost of living in ${country.name}`,
        secondary_keywords: [
          `${country.name} living costs`,
          `${country.name} expenses`,
          `is ${country.name} expensive`,
        ],
        persona: 'people researching a country before choosing a city',
        cluster: countryCluster,
        parent_topic: null,
        country: country.name,
        country_code: country.code,
        country_slug: countrySlug,
        cities: [],
        estimated_search_value: Math.min(99, Math.round(78 + geo * 0.18)),
        difficulty: Math.min(88, Math.round(38 + Math.min(28, countryCities.length))),
        seo_reason: 'Country pillar page — anchors topical authority for the cluster',
        internal_link_opportunities: [
          `/country/${countrySlug}`,
          ...topCities.slice(0, 4).map((c) => `/city/${c.pageSlug}`),
        ],
        seasonal_hint: seasonal,
        geo_priority: geo,
      }),
      topic_hash: hashTopic(['country_guide', countrySlug]),
    });

    // Supporting city guides
    for (const city of topCities) {
      if (out.length >= max) break;
      const cityCluster = resolveClusterSlugForTopic({ countrySlug, kind: 'city' });
      const title = cityBlogTitle(city.city, city.country, city.pageSlug);
      push({
        title,
        content_type: 'city_guide',
        cluster_slug: cityCluster,
        source_refs: baseRefs({
          title,
          slug: slugify(title),
          intent: 'informational',
          content_type: 'city_guide',
          primary_keyword: `cost of living in ${city.city}`,
          secondary_keywords: [
            `${city.city} living costs`,
            `${city.city} rent`,
            `${city.city} vs other cities`,
          ],
          persona: 'people evaluating a specific city move',
          cluster: cityCluster,
          parent_topic: pillarParent,
          country: country.name,
          country_code: country.code,
          country_slug: countrySlug,
          cities: [city.city],
          city_slug: city.pageSlug,
          city: city.city,
          href: `/city/${city.pageSlug}`,
          estimated_search_value: Math.min(
            97,
            Math.round(
              city.scores.eligibility * 0.7 +
                (city.isCapital ? 10 : 0) +
                (city.isFrequentlyCompared ? 8 : 0)
            )
          ),
          difficulty: Math.min(
            92,
            Math.round(32 + city.scores.eligibility * 0.35 + (city.isCapital ? 8 : 0))
          ),
          seo_reason: 'City spoke under country pillar — builds local authority and internal links',
          internal_link_opportunities: [
            `/city/${city.pageSlug}`,
            `/country/${countrySlug}`,
            pillarParent,
          ],
          seasonal_hint: seasonal,
          geo_priority: geo,
          city_eligibility: city.scores.eligibility,
        }),
        topic_hash: hashTopic(['city_guide', city.pageSlug]),
      });
    }

    // Same-country comparisons among strongest cities only (capped for healthy type mix)
    let compareSlice = topCities
      .filter(
        (c) =>
          c.isCapital ||
          c.isMajor ||
          c.isFrequentlyCompared ||
          c.hasSurveyed ||
          c.scores.eligibility >= 72
      )
      .slice(0, 4);
    if (compareSlice.length < 2) {
      compareSlice = topCities.slice(0, 3);
    }
    for (let i = 0; i < compareSlice.length; i++) {
      for (let j = i + 1; j < compareSlice.length; j++) {
        if (out.length >= max) break;
        if (cityCanonicalKey(compareSlice[i]) === cityCanonicalKey(compareSlice[j])) continue;
        pushComparison(compareSlice[i], compareSlice[j], country.name, pillarParent, geo);
      }
    }

    // Supporting guides (salary, rent, tax, …)
    for (const guide of COUNTRY_SUPPORTING) {
      if (out.length >= max) break;
      const title = supportingGuideBlogTitle(country.name, guide.guide_kind, countrySlug);
      const clusterSlug = resolveClusterSlugForTopic({
        countrySlug,
        kind: 'country',
        persona:
          guide.guide_kind === 'student'
            ? 'students'
            : guide.guide_kind === 'digital_nomad'
              ? 'digital-nomads'
              : guide.guide_kind === 'retirement'
                ? 'retirement'
                : null,
      });
      push({
        title,
        content_type: guide.content_type,
        cluster_slug: clusterSlug,
        source_refs: baseRefs({
          title,
          slug: slugify(title),
          intent: guide.intent,
          content_type: guide.content_type,
          primary_keyword: guide.keyword(country.name),
          secondary_keywords: guide.secondary(country.name),
          persona: guide.persona,
          cluster: clusterSlug,
          parent_topic: pillarParent,
          country: country.name,
          country_code: country.code,
          country_slug: countrySlug,
          cities: [],
          guide_kind: guide.guide_kind,
          href: `/country/${countrySlug}`,
          estimated_search_value: Math.min(
            94,
            Math.round(
              48 +
                geo * 0.28 +
                (guide.guide_kind === 'salary' || guide.guide_kind === 'rent' ? 10 : 0) +
                (guide.guide_kind === 'visa' || guide.guide_kind === 'moving' ? 6 : 0)
            )
          ),
          difficulty: Math.min(
            88,
            Math.round(
              38 +
                (guide.guide_kind === 'tax' || guide.guide_kind === 'visa' ? 16 : 8) +
                Math.min(20, countryCities.length)
            )
          ),
          seo_reason: `Supporting ${guide.guide_kind} spoke under ${country.name} pillar — expands topical coverage`,
          internal_link_opportunities: [
            `/country/${countrySlug}`,
            pillarParent,
            ...topCities.slice(0, 3).map((c) => `/city/${c.pageSlug}`),
          ],
          seasonal_hint: seasonal,
          geo_priority: geo,
        }),
        topic_hash: hashTopic([guide.content_type, countrySlug, guide.guide_kind]),
      });
    }
  }

  // Major international / migration corridor comparisons (not random worldwide)
  if (out.length < max) {
    const cityIndex = cities;
    for (const [ca, cb, cityA, cityB] of EDITORIAL_MIGRATION_CORRIDORS) {
      if (out.length >= max) break;
      const A =
        findCityByNameCode(cityIndex, cityA, ca) ||
        cityIndex.find((c) => c.countryCode === ca && c.isCapital);
      const B =
        findCityByNameCode(cityIndex, cityB, cb) ||
        cityIndex.find((c) => c.countryCode === cb && c.isCapital);
      if (!A || !B) continue;
      if (cityCanonicalKey(A) === cityCanonicalKey(B)) continue;
      const geo = Math.round(
        (countryGeoPriority(A.countryCode, byCountry.get(A.countryCode) || []) +
          countryGeoPriority(B.countryCode, byCountry.get(B.countryCode) || [])) /
          2
      );
      pushComparison(A, B, null, null, geo);
    }

    // Additional major hub pairs among top global cities (policy-gated)
    const hubs = dedupeCities(
      cities.filter(
        (c) => c.scores.eligibility >= 70 && (c.isCapital || c.isMajor || c.isFrequentlyCompared)
      )
    )
      .sort((a, b) => b.scores.eligibility - a.scores.eligibility)
      .slice(0, 20);
    for (let i = 0; i < hubs.length; i++) {
      for (let j = i + 1; j < hubs.length; j++) {
        if (out.length >= max) break;
        if (hubs[i].countryCode === hubs[j].countryCode) continue;
        const geo = Math.round(
          (hubs[i].scores.eligibility + hubs[j].scores.eligibility) / 2
        );
        pushComparison(hubs[i], hubs[j], null, null, geo);
      }
    }
  }

  // Global persona hubs (small set)
  for (const hub of CATEGORY_HUBS) {
    if (out.length >= max) break;
    const label = HUB_LABELS[hub] || hub.replace(/-/g, ' ');
    const persona =
      hub === 'students' || hub === 'families' || hub === 'retirement'
        ? hub
        : hub === 'remote-workers'
          ? 'remote-workers'
          : hub === 'digital-nomads'
            ? 'digital-nomads'
            : null;
    const contentType =
      hub === 'students'
        ? 'student_guide'
        : hub === 'remote-workers' || hub === 'digital-nomads'
          ? 'remote_worker_guide'
          : hub === 'retirement'
            ? 'retirement_guide'
            : 'guide';
    const clusterSlug = resolveClusterSlugForTopic({ persona, kind: 'hub' });
    const title = hubBlogTitle(label, hub);
    push({
      title,
      content_type: contentType,
      cluster_slug: clusterSlug,
      source_refs: baseRefs({
        title,
        slug: slugify(title),
        intent: 'informational',
        content_type: contentType,
        primary_keyword: `${label.toLowerCase()} cost of living`,
        secondary_keywords: [`best ${label.toLowerCase()}`, `${hub} living costs`],
        persona: persona || 'general relocators',
        cluster: clusterSlug,
        parent_topic: null,
        country: null,
        country_code: null,
        country_slug: null,
        cities: [],
        hub_id: hub,
        href: `/${hub}`,
        estimated_search_value: 70,
        difficulty: 55,
        seo_reason: 'Persona/category hub — captures broad intent and links into country clusters',
        internal_link_opportunities: [`/${hub}`],
        seasonal_hint: seasonal,
        geo_priority: 50,
      }),
      topic_hash: hashTopic(['hub', hub]),
    });
  }

  return out.slice(0, max);
}

/** Validate an existing comparison topic's source_refs against editorial policy. */
export function isWeakComparisonRefs(refs: Record<string, unknown>, cities: EligibleCity[]): boolean {
  const slugA = typeof refs.page_slug_a === 'string' ? refs.page_slug_a : null;
  const slugB = typeof refs.page_slug_b === 'string' ? refs.page_slug_b : null;
  if (!slugA || !slugB) return false;
  const a = cities.find((c) => c.pageSlug === slugA);
  const b = cities.find((c) => c.pageSlug === slugB);
  if (!a || !b) return true;
  return !evaluateComparisonPair(a, b).allowed;
}
