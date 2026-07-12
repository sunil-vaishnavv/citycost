/**
 * Topic cluster architecture — parent/children for a city hub.
 */

import type { CityLandingKind, LinkNode } from './types.js';
import { CITY_LANDING_KINDS, cityLandingPath, categoryHubPath, countryGuidePath } from './intent.js';

const KIND_LABEL: Record<CityLandingKind, string> = {
  'living-in': 'Cost of Living',
  rent: 'Rent',
  salary: 'Salary',
  students: 'For Students',
  families: 'For Families',
  'remote-work': 'Remote Work',
  retirement: 'Retirement',
  'moving-to': 'Moving Guide',
  'digital-nomads': 'Digital Nomads',
};

export function cityClusterChildren(
  pageSlug: string,
  city: string,
  eligibleKinds: CityLandingKind[]
): LinkNode[] {
  return eligibleKinds.map((kind) => ({
    label: `${KIND_LABEL[kind]} in ${city}`,
    href: cityLandingPath(kind, pageSlug),
    rel: 'child' as const,
  }));
}

export function cityClusterSiblings(
  pageSlug: string,
  city: string,
  current: CityLandingKind,
  eligibleKinds: CityLandingKind[]
): LinkNode[] {
  return eligibleKinds
    .filter((k) => k !== current)
    .map((kind) => ({
      label: `${KIND_LABEL[kind]} — ${city}`,
      href: cityLandingPath(kind, pageSlug),
      rel: 'sibling' as const,
    }));
}

export function cityClusterParent(pageSlug: string, city: string): LinkNode {
  return {
    label: `Cost of Living in ${city}`,
    href: `/city/${pageSlug}`,
    rel: 'parent',
  };
}

export function defaultCategoryLinks(): LinkNode[] {
  return [
    { label: 'Students', href: categoryHubPath('students'), rel: 'related_category' },
    { label: 'Families', href: categoryHubPath('families'), rel: 'related_category' },
    { label: 'Remote Workers', href: categoryHubPath('remote-workers'), rel: 'related_category' },
    { label: 'Retirement', href: categoryHubPath('retirement'), rel: 'related_category' },
    { label: 'Digital Nomads', href: categoryHubPath('digital-nomads'), rel: 'related_category' },
  ];
}

export function countryClusterLinks(countrySlug: string, country: string): LinkNode[] {
  return [
    { label: `Living in ${country}`, href: countryGuidePath('living-in-country', countrySlug), rel: 'related_guide' },
    { label: `Best Cities in ${country}`, href: countryGuidePath('best-cities', countrySlug), rel: 'related_guide' },
    { label: `Student Cities — ${country}`, href: countryGuidePath('student-cities', countrySlug), rel: 'related_guide' },
    { label: `Family Cities — ${country}`, href: countryGuidePath('family-cities', countrySlug), rel: 'related_guide' },
    { label: `Retirement Cities — ${country}`, href: countryGuidePath('retirement-cities', countrySlug), rel: 'related_guide' },
    { label: `Remote Work Cities — ${country}`, href: countryGuidePath('remote-work-cities', countrySlug), rel: 'related_guide' },
  ];
}

export { CITY_LANDING_KINDS, KIND_LABEL };
