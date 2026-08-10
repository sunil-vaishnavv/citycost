/**
 * In-memory public blog cache for SSR + sitemap.
 * Invalidated on publish / unpublish.
 */

import {
  getPublishedBlogArticleBySlug,
  listPublishedBlogArticles,
  listPublishedBlogSitemapEntries,
  type PublicBlogArticle,
  type PublicBlogListItem,
} from '../db/public-blog-repo.js';

type CacheState = {
  at: number;
  list: PublicBlogListItem[];
  bySlug: Map<string, PublicBlogArticle>;
  sitemap: Array<{ loc: string; lastmod: string }>;
};

let cache: CacheState | null = null;
const TTL_MS = 60_000;
let listeners: Array<() => void> = [];

export function onBlogCacheInvalidate(fn: () => void): void {
  listeners.push(fn);
}

export function invalidateBlogPublicCache(): void {
  cache = null;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

async function ensureCache(): Promise<CacheState> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const [{ articles }, sitemap] = await Promise.all([
    listPublishedBlogArticles({ limit: 50, offset: 0 }),
    listPublishedBlogSitemapEntries(),
  ]);
  const bySlug = new Map<string, PublicBlogArticle>();
  // Warm first page of articles fully for SSR hits
  await Promise.all(
    articles.slice(0, 30).map(async (a) => {
      const full = await getPublishedBlogArticleBySlug(a.slug);
      if (full) bySlug.set(full.slug, full);
    })
  );
  cache = { at: Date.now(), list: articles, bySlug, sitemap };
  return cache;
}

export async function getCachedPublishedList(): Promise<PublicBlogListItem[]> {
  const c = await ensureCache();
  return c.list;
}

export async function getCachedPublishedArticle(
  slug: string
): Promise<PublicBlogArticle | null> {
  const clean = slug.trim().toLowerCase();
  const c = await ensureCache();
  const hit = c.bySlug.get(clean);
  if (hit) return hit;
  const full = await getPublishedBlogArticleBySlug(clean);
  if (full) {
    c.bySlug.set(full.slug, full);
    return full;
  }
  return null;
}

export async function getCachedBlogSitemapEntries(): Promise<
  Array<{ loc: string; lastmod: string }>
> {
  const c = await ensureCache();
  return c.sitemap;
}

/** Force refresh (e.g. after publish). */
export async function warmBlogPublicCache(): Promise<void> {
  cache = null;
  await ensureCache();
}
