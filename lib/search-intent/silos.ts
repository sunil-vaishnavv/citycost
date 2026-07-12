/**
 * Semantic Topic Silos — hierarchical topical authority structure.
 * Public silo links only (no priority scores).
 */

import type { CityLandingKind, CategoryHubId, CountryGuideKind, LinkNode, TopicSiloPublic } from './types.js';
import { cityLandingPath, categoryHubPath, countryGuidePath } from './intent.js';
import { KIND_LABEL } from './clusters.js';

/** Ordered silo layers under a city authority hub. */
export type SiloLayerId =
  | 'living'
  | 'housing'
  | 'rent'
  | 'salary'
  | 'students'
  | 'families'
  | 'healthcare'
  | 'education'
  | 'transport'
  | 'utilities'
  | 'comparisons'
  | 'country'
  | 'category';

export type { TopicSiloPublic };

/** Map city landing kinds → silo layer. */
export function cityKindToSiloLayer(kind: CityLandingKind): SiloLayerId {
  switch (kind) {
    case 'living-in':
      return 'living';
    case 'rent':
      return 'rent';
    case 'salary':
      return 'salary';
    case 'students':
      return 'students';
    case 'families':
      return 'families';
    case 'remote-work':
    case 'retirement':
    case 'digital-nomads':
    case 'moving-to':
      return 'living';
  }
}

/**
 * Hierarchical parent chain for city landings:
 * City → Living → Housing → Rent
 *              ↘ Salary / Students / Families / ...
 */
const SILO_PARENT_LAYER: Partial<Record<SiloLayerId, SiloLayerId>> = {
  housing: 'living',
  rent: 'housing',
  salary: 'living',
  students: 'living',
  families: 'living',
  healthcare: 'living',
  education: 'living',
  transport: 'living',
  utilities: 'living',
  comparisons: 'living',
  country: 'living',
  category: 'living',
};

/** Preferred child order under living (topical strength). */
const LIVING_CHILD_ORDER: CityLandingKind[] = [
  'rent',
  'salary',
  'students',
  'families',
  'remote-work',
  'retirement',
  'digital-nomads',
  'moving-to',
];

function layerHref(
  layer: SiloLayerId,
  ctx: { pageSlug: string; countrySlug: string; eligibleKinds: CityLandingKind[] }
): string | null {
  switch (layer) {
    case 'living':
      return ctx.eligibleKinds.includes('living-in')
        ? cityLandingPath('living-in', ctx.pageSlug)
        : `/city/${ctx.pageSlug}`;
    case 'housing':
    case 'rent':
      return ctx.eligibleKinds.includes('rent') ? cityLandingPath('rent', ctx.pageSlug) : null;
    case 'salary':
      return ctx.eligibleKinds.includes('salary') ? cityLandingPath('salary', ctx.pageSlug) : null;
    case 'students':
      return ctx.eligibleKinds.includes('students') ? cityLandingPath('students', ctx.pageSlug) : null;
    case 'families':
      return ctx.eligibleKinds.includes('families') ? cityLandingPath('families', ctx.pageSlug) : null;
    case 'comparisons':
      return null;
    case 'country':
      return `/country/${ctx.countrySlug}`;
    case 'category':
      return categoryHubPath('students');
    case 'healthcare':
    case 'education':
    case 'transport':
    case 'utilities':
      // No dedicated landing routes yet — omit rather than invent thin URLs.
      return null;
    default:
      return null;
  }
}

function layerLabel(layer: SiloLayerId, city: string): string {
  const map: Record<SiloLayerId, string> = {
    living: `Living in ${city}`,
    housing: `Housing in ${city}`,
    rent: `Rent in ${city}`,
    salary: `Salary in ${city}`,
    students: `${city} for Students`,
    families: `${city} for Families`,
    healthcare: `Healthcare in ${city}`,
    education: `Education in ${city}`,
    transport: `Transport in ${city}`,
    utilities: `Utilities in ${city}`,
    comparisons: `Comparisons for ${city}`,
    country: 'Country hub',
    category: 'Category hub',
  };
  return map[layer];
}

export function buildCityTopicSilo(input: {
  kind: CityLandingKind;
  pageSlug: string;
  city: string;
  country: string;
  countrySlug: string;
  eligibleKinds: CityLandingKind[];
}): TopicSiloPublic {
  const layer = cityKindToSiloLayer(input.kind);
  const ctx = {
    pageSlug: input.pageSlug,
    countrySlug: input.countrySlug,
    eligibleKinds: input.eligibleKinds,
  };

  const authority_hub: LinkNode = {
    label: `Cost of Living in ${input.city}`,
    href: `/city/${input.pageSlug}`,
    rel: 'parent',
  };

  const cluster_hub: LinkNode = {
    label: `Living in ${input.city}`,
    href: input.eligibleKinds.includes('living-in')
      ? cityLandingPath('living-in', input.pageSlug)
      : `/city/${input.pageSlug}`,
    rel: 'related_guide',
  };

  // Parent topic: silo parent layer if different from authority
  let parent_topic: LinkNode | null = null;
  if (input.kind === 'living-in') {
    parent_topic = authority_hub;
  } else if (input.kind === 'rent') {
    // Housing is conceptual; link living as parent when rent's housing layer has no URL
    const livingHref = layerHref('living', ctx);
    parent_topic = livingHref
      ? { label: layerLabel('living', input.city), href: livingHref, rel: 'parent' }
      : authority_hub;
  } else {
    const parentLayer = SILO_PARENT_LAYER[layer] || 'living';
    const href = layerHref(parentLayer, ctx);
    parent_topic = href
      ? { label: layerLabel(parentLayer, input.city), href, rel: 'parent' }
      : authority_hub;
  }

  // Children: for living-in, ordered silo children; for rent, none (leaf under housing)
  const child_topics: LinkNode[] = [];
  if (input.kind === 'living-in') {
    for (const k of LIVING_CHILD_ORDER) {
      if (!input.eligibleKinds.includes(k)) continue;
      child_topics.push({
        label: `${KIND_LABEL[k]} — ${input.city}`,
        href: cityLandingPath(k, input.pageSlug),
        rel: 'child',
      });
    }
    child_topics.push({
      label: input.country,
      href: `/country/${input.countrySlug}`,
      rel: 'child',
    });
    child_topics.push({
      label: 'Student cities hub',
      href: categoryHubPath('students'),
      rel: 'child',
    });
  } else if (input.kind === 'rent') {
    // Housing → Rent is a leaf; optional salary/utilities siblings handled below
  }

  // Siblings: same parent layer peers
  const sibling_topics: LinkNode[] = [];
  if (input.kind !== 'living-in') {
    for (const k of LIVING_CHILD_ORDER) {
      if (k === input.kind) continue;
      if (!input.eligibleKinds.includes(k)) continue;
      sibling_topics.push({
        label: `${KIND_LABEL[k]} — ${input.city}`,
        href: cityLandingPath(k, input.pageSlug),
        rel: 'sibling',
      });
    }
  } else {
    sibling_topics.push({
      label: `Living in ${input.country}`,
      href: countryGuidePath('living-in-country', input.countrySlug),
      rel: 'sibling',
    });
  }

  return {
    parent_topic,
    child_topics,
    sibling_topics,
    authority_hub,
    cluster_hub,
    layer,
  };
}

export function buildCategoryTopicSilo(id: CategoryHubId): TopicSiloPublic {
  return {
    parent_topic: { label: 'Home', href: '/', rel: 'parent' },
    child_topics: [],
    sibling_topics: (
      [
        'students',
        'families',
        'remote-workers',
        'retirement',
        'digital-nomads',
        'cheapest-cities',
        'most-expensive-cities',
      ] as CategoryHubId[]
    )
      .filter((x) => x !== id)
      .map((x) => ({
        label: x.replace(/-/g, ' '),
        href: categoryHubPath(x),
        rel: 'sibling' as const,
      })),
    authority_hub: { label: 'CityCost Global', href: '/', rel: 'parent' },
    cluster_hub: { label: id.replace(/-/g, ' '), href: categoryHubPath(id), rel: 'related_category' },
    layer: 'category',
  };
}

export function buildCountryGuideTopicSilo(input: {
  kind: CountryGuideKind;
  country: string;
  countrySlug: string;
}): TopicSiloPublic {
  const authority_hub: LinkNode = {
    label: input.country,
    href: `/country/${input.countrySlug}`,
    rel: 'parent',
  };
  const cluster_hub: LinkNode = {
    label: `Living in ${input.country}`,
    href: countryGuidePath('living-in-country', input.countrySlug),
    rel: 'related_guide',
  };
  const guides: CountryGuideKind[] = [
    'living-in-country',
    'best-cities',
    'student-cities',
    'family-cities',
    'retirement-cities',
    'remote-work-cities',
  ];
  return {
    parent_topic: authority_hub,
    child_topics: [],
    sibling_topics: guides
      .filter((g) => g !== input.kind)
      .map((g) => ({
        label: g.replace(/-/g, ' '),
        href: countryGuidePath(g, input.countrySlug),
        rel: 'sibling' as const,
      })),
    authority_hub,
    cluster_hub,
    layer: 'country',
  };
}

/** Apply silo structure onto topical graph slots (ordering / hubs) without UI changes. */
export function applySiloToGraph(
  graph: {
    parent?: LinkNode;
    children: LinkNode[];
    siblings: LinkNode[];
    related_guides: LinkNode[];
    related_cities: LinkNode[];
    related_comparisons: LinkNode[];
    related_categories: LinkNode[];
    related_countries: LinkNode[];
  },
  silo: TopicSiloPublic
): typeof graph {
  return {
    ...graph,
    parent: silo.parent_topic || graph.parent || silo.authority_hub,
    children: silo.child_topics.length ? silo.child_topics : graph.children,
    siblings: silo.sibling_topics.length ? silo.sibling_topics : graph.siblings,
    related_guides: prioritizeHub(graph.related_guides, silo.cluster_hub),
  };
}

function prioritizeHub(links: LinkNode[], hub: LinkNode): LinkNode[] {
  const rest = links.filter((l) => l.href !== hub.href);
  return [hub, ...rest];
}
