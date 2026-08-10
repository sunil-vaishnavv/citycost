/**
 * Structured context pack for a topic — read-only CityCost catalog data.
 */

import {
  buildCityPageData,
  buildComparePageData,
  buildCountryPageData,
  listIndexableCities,
  listIndexableComparisons,
  listIndexableCountries,
} from '../../seo-catalog.js';
import type { EditorialTopic } from '../types.js';

export interface StructuredContextPack {
  topic: {
    id: number;
    title: string;
    content_type: string;
    priority_score: number;
    source_refs: Record<string, unknown>;
  };
  city?: Record<string, unknown> | null;
  country?: Record<string, unknown> | null;
  comparison?: Record<string, unknown> | null;
  related_cities: Array<{ slug: string; label: string; href: string }>;
  related_countries: Array<{ slug: string; label: string; href: string }>;
  related_comparisons: Array<{ slug: string; label: string; href: string }>;
  authority_links: Array<{ href: string; label: string }>;
  tool_links: Array<{ href: string; label: string }>;
  known_facts: string[];
  data_gaps: string[];
}

function asRefs(topic: EditorialTopic): Record<string, unknown> {
  return topic.source_refs_json || {};
}

export function buildStructuredContext(topic: EditorialTopic): StructuredContextPack {
  const refs = asRefs(topic);
  const known_facts: string[] = [];
  const data_gaps: string[] = [];
  let city: Record<string, unknown> | null = null;
  let country: Record<string, unknown> | null = null;
  let comparison: Record<string, unknown> | null = null;

  const related_cities: StructuredContextPack['related_cities'] = [];
  const related_countries: StructuredContextPack['related_countries'] = [];
  const related_comparisons: StructuredContextPack['related_comparisons'] = [];

  if (typeof refs.city_slug === 'string') {
    const data = buildCityPageData(refs.city_slug);
    if (data) {
      city = {
        slug: data.slug,
        city: data.city,
        country: data.country,
        countrySlug: data.countrySlug,
        summary: data.summary,
        cpi: data.indices?.cpi_index,
        rent: data.indices?.rent_index,
        groceries: data.indices?.groceries_index,
        restaurants: data.indices?.restaurant_price_index,
        purchasing_power: data.indices?.local_purchasing_power_index,
        last_updated: data.last_updated,
      };
      known_facts.push(
        `Average Cost Index for ${data.city} = ${data.indices?.cpi_index ?? 'n/a'}. Average Rent Index = ${data.indices?.rent_index ?? 'n/a'}.`
      );
      for (const c of (data.similar_cost_cities || []).slice(0, 6)) {
        related_cities.push({
          slug: c.slug,
          label: c.city,
          href: `/city/${c.slug}`,
        });
      }
      for (const c of (data.related_comparisons || []).slice(0, 8)) {
        related_comparisons.push({
          slug: c.slug,
          label: c.label,
          href: `/compare/${c.slug}`,
        });
      }
      if (data.countrySlug) {
        related_countries.push({
          slug: data.countrySlug,
          label: data.country,
          href: `/country/${data.countrySlug}`,
        });
      }
    } else {
      data_gaps.push(`City page data unavailable for slug ${refs.city_slug}`);
    }
  }

  if (typeof refs.country_slug === 'string') {
    const data = buildCountryPageData(refs.country_slug);
    if (data) {
      country = {
        slug: data.slug,
        name: data.name,
        currency: data.currency,
        avg_cpi: data.avg_cpi,
        avg_rent: data.avg_rent,
        summary: data.summary,
        last_updated: data.last_updated,
      };
      known_facts.push(
        `Average Cost Index for ${data.name} = ${data.avg_cpi ?? 'n/a'}. Average Rent Index = ${data.avg_rent ?? 'n/a'}.`
      );
      for (const c of (data.cities || []).slice(0, 8)) {
        related_cities.push({
          slug: c.slug,
          label: c.state ? `${c.city}, ${c.state}` : c.city,
          href: `/city/${c.slug}`,
        });
      }
      for (const c of (data.top_comparisons || []).slice(0, 8)) {
        related_comparisons.push({
          slug: c.slug,
          label: c.label,
          href: `/compare/${c.slug}`,
        });
      }
    } else {
      data_gaps.push(`Country page data unavailable for slug ${refs.country_slug}`);
    }
  }

  if (typeof refs.comparison_slug === 'string' || Array.isArray(refs.cities)) {
    const slugCandidates = [
      typeof refs.comparison_slug === 'string' ? refs.comparison_slug : '',
      // Prefer short editorial slugs when pageSlug-vs-pageSlug is not in the index
      Array.isArray(refs.cities) && refs.cities.length >= 2
        ? `${String(refs.cities[0]).toLowerCase().replace(/\s+/g, '-')}-vs-${String(refs.cities[1]).toLowerCase().replace(/\s+/g, '-')}`
        : '',
      typeof refs.page_slug_a === 'string' && typeof refs.page_slug_b === 'string'
        ? [refs.page_slug_a, refs.page_slug_b].sort().join('-vs-')
        : '',
    ].filter(Boolean);

    let data: ReturnType<typeof buildComparePageData> = null;
    for (const slug of slugCandidates) {
      data = buildComparePageData(slug);
      if (data) break;
    }

    if (data) {
      comparison = {
        slug: data.slug,
        queryA: data.queryA,
        queryB: data.queryB,
        cityA: data.cityA,
        cityB: data.cityB,
        enrichment: {
          overall_winner: data.enrichment?.overall_winner,
          monthly_difference: data.enrichment?.monthly_difference,
          biggest_difference: data.enrichment?.biggest_difference,
          key_takeaways: data.enrichment?.key_takeaways,
          executive_summary: data.enrichment?.executive_summary,
        },
        last_updated: data.last_updated,
      };
      known_facts.push(
        `Comparison ${data.queryA} vs ${data.queryB} is in the CityCost index.`
      );
      if (data.enrichment?.overall_winner) {
        known_facts.push(`Decision signal overall winner: ${data.enrichment.overall_winner}.`);
      }
      related_comparisons.push({
        slug: data.slug,
        label: `${data.cityA} vs ${data.cityB}`,
        href: `/compare/${data.slug}`,
      });
      for (const r of (data.related || []).slice(0, 6)) {
        related_comparisons.push({ slug: r.slug, label: r.label, href: `/compare/${r.slug}` });
      }
    } else if (Array.isArray(refs.cities) && refs.cities.length >= 2) {
      // Topic refs name the pair even when the compare page slug is missing from the index.
      const cityA = String(refs.cities[0]);
      const cityB = String(refs.cities[1]);
      comparison = {
        slug: typeof refs.comparison_slug === 'string' ? refs.comparison_slug : `${cityA}-vs-${cityB}`,
        queryA: typeof refs.query_a === 'string' ? refs.query_a : cityA,
        queryB: typeof refs.query_b === 'string' ? refs.query_b : cityB,
        cityA,
        cityB,
      };
      known_facts.push(`Comparison topic pairs ${cityA} vs ${cityB} (verify both city pages on CityCost).`);
      related_cities.unshift(
        ...(typeof refs.page_slug_a === 'string'
          ? [{ slug: String(refs.page_slug_a), label: cityA, href: `/city/${refs.page_slug_a}` }]
          : []),
        ...(typeof refs.page_slug_b === 'string'
          ? [{ slug: String(refs.page_slug_b), label: cityB, href: `/city/${refs.page_slug_b}` }]
          : [])
      );
    } else if (typeof refs.comparison_slug === 'string') {
      data_gaps.push(`Comparison data unavailable for slug ${refs.comparison_slug}`);
    }
  }

  if (typeof refs.hub_id === 'string') {
    known_facts.push(`Topic is tied to category hub /${refs.hub_id}.`);
    const sampleCities = listIndexableCities().slice(0, 8);
    for (const c of sampleCities) {
      related_cities.push({
        slug: c.pageSlug,
        label: `${c.city}, ${c.country}`,
        href: `/city/${c.pageSlug}`,
      });
    }
  }

  // Deduplicate related lists
  const uniq = <T extends { href: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((i) => {
      if (seen.has(i.href)) return false;
      seen.add(i.href);
      return true;
    });
  };

  if (!city && !country && !comparison && !refs.hub_id) {
    data_gaps.push('No city/country/comparison/hub refs on topic — write carefully with general COL framing only.');
    for (const c of listIndexableCountries().slice(0, 5)) {
      related_countries.push({ slug: c.slug, label: c.name, href: `/country/${c.slug}` });
    }
    for (const p of listIndexableComparisons().slice(0, 5)) {
      related_comparisons.push({
        slug: p.slug,
        label: `${p.cityA} vs ${p.cityB}`,
        href: `/compare/${p.slug}`,
      });
    }
  }

  return {
    topic: {
      id: topic.id,
      title: topic.title,
      content_type: topic.content_type,
      priority_score: topic.priority_score,
      source_refs: refs,
    },
    city,
    country,
    comparison,
    related_cities: uniq(related_cities).slice(0, 12),
    related_countries: uniq(related_countries).slice(0, 8),
    related_comparisons: uniq(related_comparisons).slice(0, 12),
    authority_links: [
      { href: '/methodology', label: 'Methodology' },
      { href: '/data-sources', label: 'Data Sources' },
      { href: '/about', label: 'About CityCost' },
    ],
    tool_links: [
      { href: '/', label: 'Cost of Living Calculator' },
    ],
    known_facts,
    data_gaps,
  };
}
