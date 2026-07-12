/**
 * Search intent definitions & URL maps.
 */

import type { CityLandingKind, CategoryHubId, CountryGuideKind, SearchIntentId } from './types.js';

export const CITY_LANDING_KINDS: CityLandingKind[] = [
  'living-in',
  'rent',
  'salary',
  'students',
  'families',
  'remote-work',
  'retirement',
  'moving-to',
  'digital-nomads',
];

export const CATEGORY_HUBS: CategoryHubId[] = [
  'students',
  'families',
  'remote-workers',
  'retirement',
  'digital-nomads',
  'cheapest-cities',
  'most-expensive-cities',
];

export const COUNTRY_GUIDE_KINDS: CountryGuideKind[] = [
  'living-in-country',
  'best-cities',
  'student-cities',
  'family-cities',
  'retirement-cities',
  'remote-work-cities',
];

export const INTENT_META: Record<
  SearchIntentId,
  { label: string; description: string }
> = {
  cost_comparison: { label: 'Cost Comparison', description: 'Side-by-side living cost comparisons' },
  living_cost: { label: 'Living Cost', description: 'Overall cost of living guides' },
  moving: { label: 'Moving', description: 'Relocation and moving guides' },
  salary: { label: 'Salary', description: 'Salary and purchasing power' },
  rent: { label: 'Rent', description: 'Housing rent and housing costs' },
  students: { label: 'Students', description: 'Student budget and city fit' },
  families: { label: 'Families', description: 'Family living costs' },
  remote_workers: { label: 'Remote Workers', description: 'Remote-work friendly living costs' },
  retirement: { label: 'Retirement', description: 'Retirement living costs' },
  digital_nomads: { label: 'Digital Nomads', description: 'Nomad-oriented city costs' },
  cheapest_cities: { label: 'Cheapest Cities', description: 'Lower-cost city hubs' },
  most_expensive_cities: { label: 'Most Expensive Cities', description: 'Higher-cost city hubs' },
  country_comparison: { label: 'Country Comparison', description: 'Cross-country cost themes' },
  city_comparison: { label: 'City Comparison', description: 'City vs city comparisons' },
  budget_planning: { label: 'Budget Planning', description: 'Monthly budget framing' },
  housing: { label: 'Housing', description: 'Housing cost themes' },
  transportation: { label: 'Transportation', description: 'Transport cost themes' },
  healthcare: { label: 'Healthcare', description: 'Healthcare cost context (when verified)' },
  education: { label: 'Education', description: 'Education cost context (when verified)' },
  safety: { label: 'Safety', description: 'Safety context (when verified)' },
  taxes: { label: 'Taxes', description: 'Tax context (when verified)' },
  utilities: { label: 'Utilities', description: 'Utilities cost themes' },
  lifestyle: { label: 'Lifestyle', description: 'Lifestyle cost themes' },
};

export function landingKindToIntent(kind: CityLandingKind): SearchIntentId {
  switch (kind) {
    case 'living-in':
      return 'living_cost';
    case 'rent':
      return 'rent';
    case 'salary':
      return 'salary';
    case 'students':
      return 'students';
    case 'families':
      return 'families';
    case 'remote-work':
      return 'remote_workers';
    case 'retirement':
      return 'retirement';
    case 'moving-to':
      return 'moving';
    case 'digital-nomads':
      return 'digital_nomads';
  }
}

export function categoryToIntent(id: CategoryHubId): SearchIntentId {
  switch (id) {
    case 'students':
      return 'students';
    case 'families':
      return 'families';
    case 'remote-workers':
      return 'remote_workers';
    case 'retirement':
      return 'retirement';
    case 'digital-nomads':
      return 'digital_nomads';
    case 'cheapest-cities':
      return 'cheapest_cities';
    case 'most-expensive-cities':
      return 'most_expensive_cities';
  }
}

export function cityLandingPath(kind: CityLandingKind, pageSlug: string): string {
  return `/${kind}/${pageSlug}`;
}

export function categoryHubPath(id: CategoryHubId): string {
  return `/${id}`;
}

export function countryGuidePath(kind: CountryGuideKind, countrySlug: string): string {
  return `/${kind}/${countrySlug}`;
}

/** Parse /living-in/:slug etc. Returns null if not an intent city landing. */
export function parseCityLandingPath(pathname: string): { kind: CityLandingKind; slug: string } | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const kind of CITY_LANDING_KINDS) {
    const re = new RegExp(`^\\/${kind}\\/([a-z0-9-]+)$`, 'i');
    const m = path.match(re);
    if (m) return { kind, slug: m[1] };
  }
  return null;
}

export function parseCategoryHubPath(pathname: string): CategoryHubId | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const id of CATEGORY_HUBS) {
    if (path === `/${id}`) return id;
  }
  return null;
}

export function parseCountryGuidePath(pathname: string): { kind: CountryGuideKind; slug: string } | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const kind of COUNTRY_GUIDE_KINDS) {
    const re = new RegExp(`^\\/${kind}\\/([a-z0-9-]+)$`, 'i');
    const m = path.match(re);
    if (m) return { kind, slug: m[1] };
  }
  return null;
}
