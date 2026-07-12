/**
 * Related content + topical graph assembly.
 * Applies semantic silos + priority-ordered related links.
 */

import type { TopicalGraph, LinkNode, CityLandingKind, CategoryHubId, CountryGuideKind } from './types.js';
import {
  cityClusterParent,
  cityClusterChildren,
  cityClusterSiblings,
  defaultCategoryLinks,
  countryClusterLinks,
} from './clusters.js';
import { categoryHubPath, cityLandingPath } from './intent.js';
import {
  buildCityTopicSilo,
  buildCategoryTopicSilo,
  buildCountryGuideTopicSilo,
  applySiloToGraph,
  type TopicSiloPublic as SiloPublic,
} from './silos.js';
import { sortByPriorityDesc } from './priority.js';

export function buildCityLandingGraph(input: {
  kind: CityLandingKind;
  pageSlug: string;
  city: string;
  country: string;
  countrySlug: string;
  eligibleKinds: CityLandingKind[];
  nearby: Array<{ city: string; slug: string }>;
  comparisons: Array<{ label: string; slug: string }>;
  linkPriority?: Map<string, number>;
}): { graph: TopicalGraph; topic_silo: SiloPublic } {
  const silo = buildCityTopicSilo({
    kind: input.kind,
    pageSlug: input.pageSlug,
    city: input.city,
    country: input.country,
    countrySlug: input.countrySlug,
    eligibleKinds: input.eligibleKinds,
  });

  const base: TopicalGraph = {
    parent: cityClusterParent(input.pageSlug, input.city),
    children: cityClusterChildren(input.pageSlug, input.city, input.eligibleKinds),
    siblings: cityClusterSiblings(input.pageSlug, input.city, input.kind, input.eligibleKinds),
    related_guides: countryClusterLinks(input.countrySlug, input.country).slice(0, 4),
    related_cities: input.nearby.slice(0, 8).map(
      (n): LinkNode => ({
        label: n.city,
        href: `/city/${n.slug}`,
        rel: 'related_city',
      })
    ),
    related_comparisons: input.comparisons.slice(0, 8).map(
      (c): LinkNode => ({
        label: c.label,
        href: `/compare/${c.slug}`,
        rel: 'related_comparison',
      })
    ),
    related_categories: defaultCategoryLinks(),
    related_countries: [
      {
        label: input.country,
        href: `/country/${input.countrySlug}`,
        rel: 'related_country',
      },
    ],
  };

  const graph = applySiloToGraph(base, silo);
  if (input.linkPriority) {
    const ord = (links: LinkNode[]) =>
      sortByPriorityDesc(links, (l) => input.linkPriority!.get(l.href) ?? 50);
    graph.related_cities = ord(graph.related_cities);
    graph.related_comparisons = ord(graph.related_comparisons);
    graph.siblings = ord(graph.siblings);
    graph.children = ord(graph.children);
  }

  return { graph, topic_silo: silo };
}

export function buildCategoryHubGraph(
  id: CategoryHubId,
  cityLinks: LinkNode[]
): { graph: TopicalGraph; topic_silo: SiloPublic } {
  const silo = buildCategoryTopicSilo(id);
  const base: TopicalGraph = {
    parent: { label: 'Home', href: '/', rel: 'parent' },
    children: cityLinks.slice(0, 24),
    siblings: defaultCategoryLinks().filter((l) => l.href !== categoryHubPath(id)),
    related_guides: [
      { label: 'Methodology', href: '/methodology', rel: 'related_guide' },
      { label: 'Cheapest Cities', href: categoryHubPath('cheapest-cities'), rel: 'related_guide' },
      { label: 'Most Expensive Cities', href: categoryHubPath('most-expensive-cities'), rel: 'related_guide' },
    ],
    related_cities: cityLinks.slice(0, 12),
    related_comparisons: [],
    related_categories: defaultCategoryLinks(),
    related_countries: [],
  };
  return { graph: applySiloToGraph(base, silo), topic_silo: silo };
}

export function buildCountryGuideGraph(input: {
  kind: CountryGuideKind;
  country: string;
  countrySlug: string;
  cities: Array<{ city: string; slug: string }>;
  comparisons: Array<{ label: string; slug: string }>;
}): { graph: TopicalGraph; topic_silo: SiloPublic } {
  const silo = buildCountryGuideTopicSilo({
    kind: input.kind,
    country: input.country,
    countrySlug: input.countrySlug,
  });
  const guides = countryClusterLinks(input.countrySlug, input.country);
  const base: TopicalGraph = {
    parent: {
      label: input.country,
      href: `/country/${input.countrySlug}`,
      rel: 'parent',
    },
    children: input.cities.slice(0, 20).map((c) => ({
      label: c.city,
      href: cityLandingPath('living-in', c.slug),
      rel: 'child' as const,
    })),
    siblings: guides.filter((g) => !g.href.includes(`/${input.kind}/`)),
    related_guides: guides,
    related_cities: input.cities.slice(0, 12).map((c) => ({
      label: c.city,
      href: `/city/${c.slug}`,
      rel: 'related_city' as const,
    })),
    related_comparisons: input.comparisons.slice(0, 8).map((c) => ({
      label: c.label,
      href: `/compare/${c.slug}`,
      rel: 'related_comparison' as const,
    })),
    related_categories: defaultCategoryLinks(),
    related_countries: [
      { label: input.country, href: `/country/${input.countrySlug}`, rel: 'related_country' },
    ],
  };
  return { graph: applySiloToGraph(base, silo), topic_silo: silo };
}
