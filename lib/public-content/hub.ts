/**
 * Homepage hub payload — catalog + published blog (read-only).
 */

import {
  listIndexableCities,
  listIndexableComparisons,
  listIndexableCountries,
} from '../seo-catalog.js';
import type { HubArticleCard, HomeHubPayload } from './types.js';

const SEASONAL_RE =
  /\b(summer|winter|spring|autumn|fall|holiday|christmas|new\s*year|seasonal|monsoon|heatwave)\b/i;

const RELOCATION_RE =
  /\b(relocati|moving to|move to|expat|digital nomad|remote work|cost of living guide|budget)\b/i;

function toCard(a: {
  slug: string;
  seo_title: string;
  excerpt: string | null;
  content_type: string;
  reading_time_minutes: number | null;
  published_at: Date | string;
  last_public_update_at: Date | string | null;
}): HubArticleCard {
  const pub =
    typeof a.published_at === 'string'
      ? a.published_at
      : a.published_at?.toISOString?.() || String(a.published_at);
  const upd = a.last_public_update_at
    ? typeof a.last_public_update_at === 'string'
      ? a.last_public_update_at
      : a.last_public_update_at.toISOString?.() || String(a.last_public_update_at)
    : null;
  return {
    slug: a.slug,
    title: a.seo_title,
    excerpt: a.excerpt,
    content_type: a.content_type,
    reading_time_minutes: a.reading_time_minutes,
    published_at: pub,
    last_public_update_at: upd,
  };
}

async function loadPublishedArticles(): Promise<HubArticleCard[]> {
  try {
    const { getCachedPublishedList } = await import('../editorial-engine/blog/blog-cache.js');
    const list = await getCachedPublishedList();
    return (list || []).map(toCard);
  } catch {
    try {
      const { listPublishedBlogArticles } = await import(
        '../editorial-engine/db/public-blog-repo.js'
      );
      const { articles } = await listPublishedBlogArticles({ limit: 40, offset: 0 });
      return (articles || []).map(toCard);
    } catch {
      return [];
    }
  }
}

/** Popular comparisons: prefer well-known pairs present in the index, then fill from catalog. */
const POPULAR_COMPARE_SLUGS = [
  'new-york-vs-london',
  'london-vs-tokyo',
  'paris-vs-berlin',
  'sydney-vs-singapore',
  'mumbai-vs-delhi',
  'toronto-vs-vancouver',
  'san-francisco-vs-dubai',
  'zurich-vs-dublin',
];

export async function buildHomeHubPayload(): Promise<HomeHubPayload> {
  const countries = listIndexableCountries().map((c) => ({ slug: c.slug, name: c.name }));
  const cities = listIndexableCities();
  const comparisons = listIndexableComparisons();
  const articles = await loadPublishedArticles();

  const bySlug = new Map(comparisons.map((p) => [p.slug, p]));
  const popular_comparisons: Array<{ slug: string; label: string }> = [];
  const used = new Set<string>();
  for (const slug of POPULAR_COMPARE_SLUGS) {
    const hit = bySlug.get(slug);
    if (hit) {
      popular_comparisons.push({ slug: hit.slug, label: `${hit.cityA} vs ${hit.cityB}` });
      used.add(hit.slug);
    }
  }
  for (const p of comparisons) {
    if (popular_comparisons.length >= 12) break;
    if (used.has(p.slug)) continue;
    popular_comparisons.push({ slug: p.slug, label: `${p.cityA} vs ${p.cityB}` });
    used.add(p.slug);
  }

  const popular_cities = cities.slice(0, 16).map((c) => ({
    slug: c.pageSlug,
    city: c.city,
    country: c.country,
    label: c.state ? `${c.city}, ${c.state}` : `${c.city}, ${c.country}`,
  }));

  const latest_articles = articles.slice(0, 8);
  const recently_updated = [...articles]
    .sort((a, b) => {
      const da = Date.parse(a.last_public_update_at || a.published_at) || 0;
      const db = Date.parse(b.last_public_update_at || b.published_at) || 0;
      return db - da;
    })
    .slice(0, 6);

  const relocation_guides = articles
    .filter(
      (a) =>
        RELOCATION_RE.test(a.title) ||
        RELOCATION_RE.test(a.excerpt || '') ||
        /reloc|guide|expat|nomad/i.test(a.content_type)
    )
    .slice(0, 8);

  const seasonal_guides = articles
    .filter((a) => SEASONAL_RE.test(a.title) || SEASONAL_RE.test(a.excerpt || ''))
    .slice(0, 6);

  // Editorial picks: prefer longer guides / non-generic types, else latest
  const editorial_picks = [...articles]
    .sort((a, b) => {
      const score = (x: HubArticleCard) =>
        (x.reading_time_minutes || 0) * 2 + (/guide|comparison|analysis/i.test(x.content_type) ? 5 : 0);
      return score(b) - score(a);
    })
    .slice(0, 6);

  return {
    countries: countries.slice(0, 40),
    popular_cities,
    popular_comparisons,
    latest_articles,
    recently_updated,
    editorial_picks,
    relocation_guides: relocation_guides.length ? relocation_guides : latest_articles.slice(0, 6),
    seasonal_guides,
    stats: {
      indexable_cities: cities.length,
      indexable_countries: countries.length,
      indexable_comparisons: comparisons.length,
      published_articles: articles.length,
    },
  };
}
