/**
 * CityCost Global — Express + Vite middleware server
 * Wires geo search + COL engine. Does not own UI/SEO business rules beyond routes.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import zlib from 'zlib';
import crypto from 'crypto';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import type { ViteDevServer } from 'vite';
import fs from 'fs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { testConnection } from './lib/db.js';
import { getOrGenerateCityData, getAllCitiesForList } from './lib/city-repository.js';
import { generateSummary } from './lib/groq.js';
import { logEvent } from './lib/logger.js';
import {
  searchGeoCities,
  findGeoCityBySlug,
  warmGeoCityIndex,
  getGeoCityCount,
} from './lib/geo-cities.js';
import { resolveCityCostByQuery } from './lib/city-cost-resolve.js';
import {
  buildCountryPageData,
  buildCityPageData,
  buildCompareSeoLinks,
  buildComparePageData,
  buildSitemapUrlEntries,
  listIndexableCountries,
  listIndexableComparisons,
  getEligibilityStats,
  getQualityAggregates,
  warmSeoQualitySample,
  expectedScaledIndex,
  contentCacheStats,
  invalidateContentCache,
  CONTENT_ENGINE_VERSION,
} from './lib/seo-catalog.js';
import { listEligibleCities } from './lib/seo-eligibility.js';
import { SEO_INDEX_CONFIG } from './lib/seo-config.js';
import {
  resolveSeoHtmlAsync,
  xmlUrlset,
  xmlUrlsetDated,
  xmlSitemapIndex,
} from './lib/seo-ssr.js';
import {
  buildBlogSitemapXml,
  onBlogCacheInvalidate,
} from './lib/editorial-engine/blog/blog-public.js';
import { SITE_URL } from './src/utils/seo.js';
import {
  listAuthorityPages,
  getAuthorityPage,
  EEAT_ENGINE_VERSION,
} from './lib/eeat-engine/index.js';
import {
  buildIntentPageFromPath,
  listIndexableCityLandingUrls,
  listIndexableCategoryUrls,
  listIndexableCountryGuideUrls,
  getIntentIndexStats,
  warmIntentCatalogAsync,
  SEARCH_INTENT_VERSION,
} from './lib/search-intent/index.js';
import { createEditorialRouter, initEditorialEngine } from './lib/editorial-engine/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let vite: ViteDevServer | null = null;

const app = express();
const isDev = process.env.NODE_ENV !== 'production';

/** Required behind Render / Cloudflare / reverse proxies for correct rate-limit IPs. */
app.set('trust proxy', 1);

app.use(
  compression({
    // Sitemap routes serve pre-gzipped or streamed bodies; don't let this
    // middleware buffer XML before the first byte leaves the socket.
    filter: (req, res) => {
      if (typeof req.path === 'string' && /^\/sitemap.*\.xml$/i.test(req.path)) return false;
      return compression.filter(req, res);
    },
  })
);

if (process.env.NODE_ENV === 'production') {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://www.googletagmanager.com", "https://pagead2.googlesyndication.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://pagead2.googlesyndication.com", "https://tpc.googlesyndication.com"],
        connectSrc: [
          "'self'",
          "https://www.google-analytics.com",
          "https://region1.google-analytics.com",
          // AdSense ad traffic quality / measurement (blocked without this)
          "https://ep1.adtrafficquality.google",
        ],
        frameSrc: [
          "'self'",
          "https://tpc.googlesyndication.com",
          // AdSense ad iframes served via DoubleClick
          "https://googleads.g.doubleclick.net",
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser / same-origin requests (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
      // Wildcard: reflect request origin in prod only when explicitly set to *
      return cb(null, true);
    }
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: allowedOrigins.length > 0 && !allowedOrigins.includes('*'),
}));

/** Default API JSON cap — keeps most routes tight. */
const JSON_BODY_LIMIT_DEFAULT = '1mb';
/**
 * Legacy base64 JSON uploads (featured-image fallback). Multipart is preferred.
 * 40 MB accommodates ~30 MB originals with base64 overhead.
 */
const JSON_BODY_LIMIT_IMAGE_UPLOAD = '40mb';
const IMAGE_UPLOAD_JSON_PATHS =
  /^\/api\/editorial\/(articles\/\d+\/featured-image|media\/upload)\/?$/i;

const jsonBodyDefault = express.json({ limit: JSON_BODY_LIMIT_DEFAULT });
const jsonBodyImageUpload = express.json({ limit: JSON_BODY_LIMIT_IMAGE_UPLOAD });

app.use((req, res, next) => {
  if (req.method === 'POST' && IMAGE_UPLOAD_JSON_PATHS.test(req.path)) {
    return jsonBodyImageUpload(req, res, next);
  }
  return jsonBodyDefault(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT_IMAGE_UPLOAD }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 5000 : 300,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDev && req.path.startsWith('/cities'),
});

app.use('/api/', apiLimiter);

// Final Editorial Control URL is /admin only — legacy path redirects
app.use('/editorial-control', (_req, res) => {
  res.redirect(301, '/admin');
});

// Editorial Engine (P0 foundation) — independent module; requires MySQL + admin bootstrap
app.use('/api/editorial', createEditorialRouter());

// Public blog API — published articles only (no drafts/review)
app.get('/api/blog', async (req, res) => {
  try {
    const { listPublishedBlogArticles } = await import(
      './lib/editorial-engine/db/public-blog-repo.js'
    );
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '12'), 10) || 12, 1), 50);
    const offset = (page - 1) * limit;
    const result = await listPublishedBlogArticles({ limit, offset });
    return res.json({
      articles: result.articles,
      total: result.total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(result.total / limit)),
    });
  } catch (err) {
    console.error('GET /api/blog error:', err);
    return res.status(500).json({ error: 'Failed to load blog' });
  }
});

app.get('/api/blog/:slug', async (req, res) => {
  try {
    const { getPublishedBlogArticleBySlug } = await import(
      './lib/editorial-engine/db/public-blog-repo.js'
    );
    const { listPublishedBlogArticles } = await import(
      './lib/editorial-engine/db/public-blog-repo.js'
    );
    let article = await getPublishedBlogArticleBySlug(req.params.slug);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    // Strip leftover QA cert-batch markers from public titles
    try {
      const { hasCertBatchNoise } = await import(
        './lib/editorial-engine/utils/clean-title.js'
      );
      if (hasCertBatchNoise(article.seo_title) || hasCertBatchNoise(article.meta_title)) {
        const { cleanArticlePublicIdentity } = await import(
          './lib/editorial-engine/utils/clean-article-identity.js'
        );
        await cleanArticlePublicIdentity(article.id);
        article = (await getPublishedBlogArticleBySlug(req.params.slug)) || article;
      }
    } catch (err) {
      console.warn('blog title cleanup:', (err as Error).message);
    }
    const peers = await listPublishedBlogArticles({ limit: 8, offset: 0 });
    const related = peers.articles
      .filter((a) => a.slug !== article.slug)
      .slice(0, 4)
      .map((a) => ({
        slug: a.slug,
        title: a.seo_title,
        excerpt: a.excerpt,
        reading_time_minutes: a.reading_time_minutes,
      }));
    const { extractFeaturedImage, bustFeaturedImageUrl } = await import(
      './lib/editorial-engine/manual/html-blocks.js'
    );
    const featured_image = extractFeaturedImage(article.draft);
    const imageVersion =
      article.last_public_update_at || article.published_at || article.updated_at;
    return res.json({
      article: {
        slug: article.slug,
        seo_title: article.seo_title,
        meta_title: article.meta_title,
        meta_description: article.meta_description,
        excerpt: article.excerpt,
        content_type: article.content_type,
        word_count: article.word_count,
        reading_time_minutes: article.reading_time_minutes,
        published_at: article.published_at,
        last_public_update_at: article.last_public_update_at,
        canonical_url: article.canonical_url,
        blocks: article.draft.blocks,
        internal_links: article.internal_links,
        entity_map: article.entity_map,
        featured_image: featured_image
          ? {
              url: bustFeaturedImageUrl(featured_image.url, imageVersion),
              alt: featured_image.alt,
            }
          : null,
        // Never expose raw_ai_response / prompts
      },
      related,
    });
  } catch (err) {
    console.error('GET /api/blog/:slug error:', err);
    return res.status(500).json({ error: 'Failed to load article' });
  }
});

const PORT = parseInt(process.env.PORT || '3001', 10);

/** Liveness / readiness for load balancers (Render, etc.). */
app.get(['/health', '/api/health'], (_req, res) => {
  res.status(200).json({
    ok: true,
    status: 'healthy',
    uptime_s: Math.round(process.uptime()),
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/cities', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
  const limit = Math.min(parseInt(String(req.query.limit || '25'), 10) || 25, 50);

  if (slug) {
    const found = findGeoCityBySlug(slug);
    return res.json({
      cities: found ? [found] : [],
      total_indexed: getGeoCityCount(),
    });
  }

  const cities = searchGeoCities(q, limit);
  return res.json({
    cities,
    total_indexed: getGeoCityCount(),
  });
});

app.get('/api/city_prices', async (req, res) => {
  const startTime = Date.now();
  const query = req.query.query as string;

  if (!query) {
    return res.status(400).json({ error: 'Missing required query parameter: query' });
  }

  try {
    const data = await getOrGenerateCityData(query);
    await logEvent({
      request_method: 'GET',
      request_path: '/api/city_prices',
      city_query: query,
      response_time_ms: Date.now() - startTime,
      cache_hit: false,
    }).catch(() => {});
    return res.json(data);
  } catch (err) {
    console.error('[/api/city_prices] engine failed, direct resolve:', err);
  }

  try {
    const estimated = await resolveCityCostByQuery(query, {
      numbeoKey: process.env.NUMBEO_API_KEY,
    });
    return res.json({
      city_id: estimated.city_id,
      name: estimated.name,
      currency: estimated.currency,
      prices: estimated.prices,
      indices: estimated.indices,
      symbol: estimated.symbol,
      exchange_rate: estimated.exchange_rate,
      data_source: estimated.data_source_label,
      confidence: estimated.confidence,
      confidence_label: estimated.confidence_label,
      estimation_note: estimated.estimation_note,
    });
  } catch (err2) {
    console.error('[/api/city_prices] fatal:', err2);
    return res.status(500).json({ error: 'Failed to resolve city prices' });
  }
});

app.post('/api/ai_summary', async (req, res) => {
  const { cityA, cityB, dataA, dataB } = req.body;
  if (!cityA || !cityB || !dataA || !dataB) {
    return res.status(400).json({ error: 'Missing required comparison data fields' });
  }
  try {
    const summary = await generateSummary(cityA, cityB, dataA, dataB);
    return res.json({ summary });
  } catch (err) {
    console.error('[/api/ai_summary]', err);
    return res.status(500).json({ error: 'Failed to generate summary' });
  }
});

app.get('/api/db_cities', async (_req, res) => {
  const cities = await getAllCitiesForList();
  res.json({ cities });
});

// ── Programmatic SEO APIs (catalog-backed; pages only when data exists) ───────

app.get('/api/seo/countries', (_req, res) => {
  res.json({ countries: listIndexableCountries() });
});

/** Homepage dynamic hub — catalog + published blog cards (read-only). */
app.get('/api/seo/home-hub', async (_req, res) => {
  try {
    const { buildHomeHubPayload } = await import('./lib/public-content/hub.js');
    const payload = await buildHomeHubPayload();
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.json(payload);
  } catch (err) {
    console.error('GET /api/seo/home-hub error:', err);
    return res.status(500).json({ error: 'Failed to build home hub' });
  }
});

app.get('/api/seo/country/:slug', (req, res) => {
  const data = buildCountryPageData(req.params.slug);
  if (!data) return res.status(404).json({ error: 'Country not found in SEO catalog' });
  return res.json(data);
});

app.get('/api/seo/city/:slug', (req, res) => {
  const data = buildCityPageData(req.params.slug);
  if (!data) return res.status(404).json({ error: 'City not found in SEO catalog' });
  return res.json(data);
});

app.get('/api/seo/compare-links', (req, res) => {
  const a = typeof req.query.a === 'string' ? req.query.a : '';
  const b = typeof req.query.b === 'string' ? req.query.b : '';
  if (!a || !b) return res.status(400).json({ error: 'Missing a and b city names' });
  // Full internal-link payload (additive fields; related/nearby remain for older clients)
  return res.json(buildCompareSeoLinks(a, b));
});

app.get('/api/seo/compare/:slug', (req, res) => {
  const data = buildComparePageData(req.params.slug);
  if (!data) return res.status(404).json({ error: 'Comparison not in SEO index' });
  return res.json(data);
});

app.get('/api/seo/comparisons', (_req, res) => {
  res.json({ comparisons: listIndexableComparisons() });
});

app.get('/api/eeat/pages', (_req, res) => {
  res.json({
    version: EEAT_ENGINE_VERSION,
    pages: listAuthorityPages().map((p) => ({
      id: p.id,
      path: p.path,
      title: p.title,
      last_updated: p.last_updated,
    })),
  });
});

app.get('/api/eeat/page/:id', (req, res) => {
  const doc = getAuthorityPage(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Authority page not found' });
  return res.json(doc);
});

app.get('/api/intent/page', (req, res) => {
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!path) return res.status(400).json({ error: 'Missing path query' });
  const data = buildIntentPageFromPath(path);
  if (!data) return res.status(404).json({ error: 'Intent page not indexable or not found' });
  return res.json(data);
});

app.get('/api/intent/stats', (_req, res) => {
  res.json({ version: SEARCH_INTENT_VERSION, ...getIntentIndexStats() });
});

/** Aggregate index stats only — no per-page quality scores. */
app.get('/api/seo/index-stats', (_req, res) => {
  const stats = getEligibilityStats();
  const quality = getQualityAggregates();
  res.json({
    indexable_cities: stats.indexable_cities,
    indexable_countries: listIndexableCountries().length,
    indexable_comparisons: listIndexableComparisons().length,
    by_priority_band: stats.by_priority_band,
    config: {
      ...stats.config,
      maxIndexableComparisons: SEO_INDEX_CONFIG.maxIndexableComparisons,
      minComparisonScore: SEO_INDEX_CONFIG.minComparisonScore,
    },
    quality_sample: quality.samples > 0 ? quality : null,
    content_engine: {
      version: CONTENT_ENGINE_VERSION,
      cache: contentCacheStats(),
    },
    eeat_engine: {
      version: EEAT_ENGINE_VERSION,
      authority_pages: listAuthorityPages().length,
    },
    search_intent: {
      version: SEARCH_INTENT_VERSION,
      ...getIntentIndexStats(),
    },
    expected_at_scale: {
      '10k_comps': expectedScaledIndex(SEO_INDEX_CONFIG.maxIndexableCities, 10_000),
      '50k_comps': expectedScaledIndex(Math.max(SEO_INDEX_CONFIG.maxIndexableCities, 1000), 50_000),
      '100k_comps': expectedScaledIndex(Math.max(SEO_INDEX_CONFIG.maxIndexableCities, 2000), 100_000),
    },
  });
});

/** Full content documents (cache-first). Quality scores never included. */
app.get('/api/content/city/:slug', (req, res) => {
  const data = buildCityPageData(req.params.slug);
  if (!data) return res.status(404).json({ error: 'City not found' });
  return res.json({
    slug: data.slug,
    summary: data.summary,
    faqs: data.faqs,
    sections: data.sections,
    pros: data.pros,
    cons: data.cons,
    links: {
      country: `/country/${data.countrySlug}`,
      nearby: data.nearby.map((n) => ({ label: n.city, href: `/city/${n.slug}` })),
      comparisons: data.related_comparisons.map((c) => ({ label: c.label, href: `/compare/${c.slug}` })),
    },
    meta: { content_engine: CONTENT_ENGINE_VERSION },
  });
});

app.get('/api/content/country/:slug', (req, res) => {
  const data = buildCountryPageData(req.params.slug);
  if (!data) return res.status(404).json({ error: 'Country not found' });
  return res.json({
    slug: data.slug,
    summary: data.summary,
    faqs: data.faqs,
    cheapest: data.cheapest,
    expensive: data.expensive,
    cities: data.cities,
    top_comparisons: data.top_comparisons,
    related_countries: data.related_countries,
    meta: { content_engine: CONTENT_ENGINE_VERSION },
  });
});

app.get('/api/content/compare/:slug', (req, res) => {
  const data = buildComparePageData(req.params.slug);
  if (!data) return res.status(404).json({ error: 'Comparison not found' });
  return res.json({
    ...data,
    meta: { content_engine: CONTENT_ENGINE_VERSION },
  });
});

app.post('/api/content/regenerate', (req, res) => {
  const token = process.env.CONTENT_ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: 'Content regeneration is disabled until CONTENT_ADMIN_TOKEN is configured.',
    });
  }
  const provided =
    (typeof req.headers['x-admin-token'] === 'string' && req.headers['x-admin-token']) ||
    (typeof req.body?.token === 'string' && req.body.token) ||
    '';
  if (provided !== token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const kind = req.body?.kind as 'city' | 'country' | 'compare' | undefined;
  const slug = typeof req.body?.slug === 'string' ? req.body.slug : undefined;
  const cleared = invalidateContentCache(kind, slug);
  return res.json({ ok: true, cleared, note: 'Cache invalidated; next request regenerates from facts.' });
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
  );
});

// ── Sitemaps ──────────────────────────────────────────────────────────────────
// Generated XML is cached in-memory so crawlers never wait on catalog
// generation (the intent catalog can take 60–90s to build on a cold process,
// which made Googlebot time out → GSC "Couldn't fetch / General HTTP error").
//
// Comparison sitemap specifics:
// - Prewarmed before listen (8426 URLs / ~1.5MB — under Google's 50k / 50MB caps)
// - Stale-while-revalidate so TTL refresh never blocks Googlebot
// - Intent catalog warm yields so comparisons stay serveable mid-warm

const SITEMAP_TTL_MS = 6 * 60 * 60 * 1000;
type SitemapCacheEntry = { xml: string; gzip: Buffer; at: number; etag: string };
const sitemapCache = new Map<string, SitemapCacheEntry>();
const sitemapRefreshing = new Set<string>();

/** Heavy builders that must not monopolize the event loop during warm. */
const SITEMAP_HEAVY_KEYS = new Set([
  'sitemap-intent-landings.xml',
  'sitemap-intent-country-guides.xml',
]);

const SITEMAP_BUILDERS: Record<string, () => string> = {
  'sitemap.xml': () =>
    xmlSitemapIndex([
      `${SITE_URL}/sitemap-static.xml`,
      `${SITE_URL}/sitemap-countries.xml`,
      `${SITE_URL}/sitemap-cities.xml`,
      `${SITE_URL}/sitemap-comparisons.xml`,
      `${SITE_URL}/sitemap-intent-landings.xml`,
      `${SITE_URL}/sitemap-intent-categories.xml`,
      `${SITE_URL}/sitemap-intent-country-guides.xml`,
      `${SITE_URL}/sitemap-blog.xml`,
    ]),
  'sitemap-static.xml': () => xmlUrlset(buildSitemapUrlEntries().home),
  'sitemap-countries.xml': () => xmlUrlset(buildSitemapUrlEntries().countries),
  'sitemap-cities.xml': () => xmlUrlset(buildSitemapUrlEntries().cities),
  'sitemap-comparisons.xml': () => {
    // Deduplicate — compareSlug collisions previously produced 600+ duplicate <loc>s.
    const urls = [
      ...new Set(listIndexableComparisons().map((p) => `${SITE_URL}/compare/${p.slug}`)),
    ];
    return xmlUrlset(urls);
  },
  'sitemap-intent-landings.xml': () => xmlUrlset(listIndexableCityLandingUrls(SITE_URL)),
  'sitemap-intent-categories.xml': () => xmlUrlset(listIndexableCategoryUrls(SITE_URL)),
  'sitemap-intent-country-guides.xml': () => xmlUrlset(listIndexableCountryGuideUrls(SITE_URL)),
  // Sync stub — real blog sitemap is built async in getSitemapEntry / buildBlogSitemap
  'sitemap-blog.xml': () =>
    xmlUrlsetDated([{ loc: `${SITE_URL}/blog`, lastmod: new Date().toISOString().slice(0, 10) }]),
};

async function buildBlogSitemapEntry(): Promise<{ xml: string; gzip: Buffer; at: number; etag: string }> {
  const xml = await buildBlogSitemapXml(xmlUrlsetDated);
  const gzip = zlib.gzipSync(Buffer.from(xml, 'utf8'), { level: 6 });
  const etag = `W/"${gzip.length.toString(16)}-${crypto.createHash('sha1').update(gzip).digest('hex').slice(0, 12)}"`;
  const entry = { xml, gzip, at: Date.now(), etag };
  sitemapCache.set('sitemap-blog.xml', entry);
  // Also refresh index so it picks up lastmod freshness
  sitemapCache.delete('sitemap.xml');
  return entry;
}

onBlogCacheInvalidate(() => {
  sitemapCache.delete('sitemap-blog.xml');
  sitemapCache.delete('sitemap.xml');
});

function buildAndCacheSitemap(key: string): SitemapCacheEntry {
  const xml = SITEMAP_BUILDERS[key]();
  // Pre-gzip so Googlebot can be served ~44KB without CPU-gzipping 1.5MB on-request
  // while the intent catalog is still warming on the event loop.
  const gzip = zlib.gzipSync(Buffer.from(xml, 'utf8'), { level: 6 });
  const etag = `W/"${gzip.length.toString(16)}-${crypto.createHash('sha1').update(gzip).digest('hex').slice(0, 12)}"`;
  const entry: SitemapCacheEntry = { xml, gzip, at: Date.now(), etag };
  sitemapCache.set(key, entry);
  return entry;
}

function scheduleSitemapRefresh(key: string): void {
  if (sitemapRefreshing.has(key)) return;
  sitemapRefreshing.add(key);
  setImmediate(() => {
    void (async () => {
      try {
        if (key === 'sitemap-intent-landings.xml' || key === 'sitemap-intent-country-guides.xml') {
          await warmIntentCatalogAsync();
          await new Promise<void>((r) => setImmediate(r));
        }
        if (key === 'sitemap-blog.xml') {
          await buildBlogSitemapEntry();
        } else {
          buildAndCacheSitemap(key);
        }
      } catch (err) {
        console.warn(`Sitemap refresh failed (${key}):`, err);
      } finally {
        sitemapRefreshing.delete(key);
      }
    })();
  });
}

function getSitemapEntry(key: string): SitemapCacheEntry | null {
  const hit = sitemapCache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < SITEMAP_TTL_MS) return hit;
  // Stale-while-revalidate: never block crawlers on refresh when we have bytes.
  if (hit) {
    scheduleSitemapRefresh(key);
    return hit;
  }
  // Cold miss on heavy catalogs MUST NOT run synchronously — that blocked the
  // event loop for 30–90s and made Googlebot time out on sitemap-comparisons.xml
  // (GSC: Couldn't fetch / General HTTP error) even when comparisons XML was cached.
  if (SITEMAP_HEAVY_KEYS.has(key)) {
    scheduleSitemapRefresh(key);
    return null;
  }
  return buildAndCacheSitemap(key);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/**
 * Prewarm comparison sitemap before accepting traffic.
 * Generation is ~15ms once the comparison list is ready; keeping it out of the
 * post-listen warm race is what stops GSC "Couldn't fetch" on this URL.
 */
function prewarmComparisonSitemap(): void {
  const t0 = Date.now();
  const entry = buildAndCacheSitemap('sitemap-comparisons.xml');
  const urls = (entry.xml.match(/<loc>/g) || []).length;
  console.log(
    `🗺️  Comparison sitemap ready: ${urls.toLocaleString()} URLs · ${(entry.xml.length / 1024).toFixed(0)} KB (${(entry.gzip.length / 1024).toFixed(0)} KB gzip) · ${Date.now() - t0}ms`
  );
}

async function warmSitemaps(): Promise<void> {
  // Comparisons first (usually already cached from prewarmComparisonSitemap).
  const keys = [
    'sitemap-comparisons.xml',
    ...Object.keys(SITEMAP_BUILDERS).filter((k) => k !== 'sitemap-comparisons.xml'),
  ];

  for (const key of keys) {
    try {
      if (SITEMAP_HEAVY_KEYS.has(key)) {
        await warmIntentCatalogAsync();
        await yieldEventLoop();
      }
      buildAndCacheSitemap(key);
    } catch (err) {
      console.warn(`Sitemap warm failed (${key}):`, err);
    }
    // Let pending HTTP (Googlebot / health) run between sitemaps.
    await yieldEventLoop();
  }
}

function acceptsGzip(req: express.Request): boolean {
  const raw = req.headers['accept-encoding'];
  if (!raw) return false;
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  return /\bgzip\b/i.test(value);
}

function* bufferChunks(buf: Buffer, size: number): Generator<Buffer> {
  for (let i = 0; i < buf.length; i += size) {
    yield buf.subarray(i, Math.min(i + size, buf.length));
  }
}

/** Peek cache only — never sync-build. */
function peekSitemapEntry(key: string): SitemapCacheEntry | null {
  const hit = sitemapCache.get(key);
  if (!hit) return null;
  const age = Date.now() - hit.at;
  if (age >= SITEMAP_TTL_MS) scheduleSitemapRefresh(key);
  return hit;
}

/**
 * Comparisons sitemap: cache-first, buffered send.
 *
 * Root cause of multi-second repeats: the previous cold path
 * (streamGenerateComparisons) collected/deduped URLs before sending headers and
 * forced setImmediate between every 200 URLs while streaming gzip — so a cache
 * miss (or empty warm) made every slow request look like "cache never works".
 * HIT path now returns prebuilt gzip/xml with Content-Length in one shot.
 */
function handleComparisonsSitemap(req: express.Request, res: express.Response): void {
  const t0 = performance.now();
  const mark = (label: string) => {
    const ms = performance.now() - t0;
    console.log(`[sitemap-comparisons] ${label}: ${ms.toFixed(0)}ms`);
    return ms;
  };

  console.log('[sitemap-comparisons] Request received');
  mark('Cache lookup start');
  let entry = peekSitemapEntry('sitemap-comparisons.xml');
  const lookupMs = mark('Cache lookup');
  const hit = !!entry;
  console.log(`[sitemap-comparisons] Cache hit: ${hit}`);

  let generateMs = 0;
  let gzipMs = 0;
  if (!entry) {
    const g0 = performance.now();
    console.log('[sitemap-comparisons] Cache miss — buildAndCacheSitemap');
    // Single sync build (URL collect + dedupe + xml + gzip) then cache.
    entry = buildAndCacheSitemap('sitemap-comparisons.xml');
    generateMs = performance.now() - g0;
    gzipMs = generateMs; // gzip is inside buildAndCacheSitemap
    console.log(`[sitemap-comparisons] Generate XML+gzip: ${generateMs.toFixed(0)}ms`);
  } else {
    console.log('[sitemap-comparisons] Using cached XML+gzip (no generation)');
  }

  const wantGzip = acceptsGzip(req);
  const body = wantGzip ? entry.gzip : Buffer.from(entry.xml, 'utf8');
  console.log(
    `[sitemap-comparisons] Prepare body: gzip=${wantGzip} bytes=${body.length}`
  );

  const streamAt = mark('Stream start');
  res.status(200);
  res.set({
    'Content-Type': 'application/xml; charset=UTF-8',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    Vary: 'Accept-Encoding',
    ETag: entry.etag,
    'Content-Length': String(body.length),
    'X-Sitemap-Cache': hit ? 'HIT' : 'MISS',
    'Server-Timing': [
      `cache;desc="${hit ? 'HIT' : 'MISS'}"`,
      `lookup;dur=${lookupMs.toFixed(1)}`,
      `generate;dur=${generateMs.toFixed(1)}`,
      `total;dur=${(performance.now() - t0).toFixed(1)}`,
    ].join(', '),
  });
  if (wantGzip) res.set('Content-Encoding', 'gzip');

  // One-shot send — first byte ≈ header flush; no chunked Readable overhead on HIT.
  res.end(body, () => {
    mark('Response completed');
    console.log(
      `[sitemap-comparisons] done hit=${hit} lookup=${lookupMs.toFixed(0)}ms generate=${generateMs.toFixed(0)}ms stream=${streamAt.toFixed(0)}ms total=${(performance.now() - t0).toFixed(0)}ms`
    );
  });
}

app.get('/sitemap-comparisons.xml', (req, res) => {
  try {
    handleComparisonsSitemap(req, res);
  } catch (err) {
    console.error('[sitemap:sitemap-comparisons.xml]', err);
    if (!res.headersSent) {
      res
        .status(503)
        .set({ 'Content-Type': 'text/plain; charset=UTF-8', 'Retry-After': '120' })
        .send('Sitemap temporarily unavailable');
    }
  }
});

for (const key of Object.keys(SITEMAP_BUILDERS)) {
  if (key === 'sitemap-comparisons.xml') continue;
  app.get(`/${key}`, async (req, res) => {
    try {
      let entry: SitemapCacheEntry | null;
      if (key === 'sitemap-blog.xml') {
        const hit = sitemapCache.get(key);
        if (hit && Date.now() - hit.at < SITEMAP_TTL_MS) {
          entry = hit;
        } else {
          entry = await buildBlogSitemapEntry();
        }
      } else {
        entry = getSitemapEntry(key);
      }
      if (!entry) {
        res
          .status(503)
          .set({
            'Content-Type': 'text/plain; charset=UTF-8',
            'Retry-After': '120',
            'Cache-Control': 'no-store',
          })
          .send('Sitemap temporarily unavailable');
        return;
      }
      res.status(200);
      res.set({
        'Content-Type': 'application/xml; charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        Vary: 'Accept-Encoding',
        ETag: entry.etag,
      });
      if (acceptsGzip(req)) {
        // Precompressed body — compression middleware skipped for /sitemap*.xml.
        res.set('Content-Encoding', 'gzip');
        res.flushHeaders();
        Readable.from(bufferChunks(entry.gzip, 16 * 1024)).pipe(res);
      } else {
        res.flushHeaders();
        Readable.from(bufferChunks(Buffer.from(entry.xml, 'utf8'), 16 * 1024)).pipe(res);
      }
    } catch (err) {
      // Never fall through to the HTML catch-all on failure.
      console.error(`[sitemap:${key}]`, err);
      res
        .status(503)
        .set({ 'Content-Type': 'text/plain; charset=UTF-8', 'Retry-After': '120' })
        .send('Sitemap temporarily unavailable');
    }
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const e = err as { type?: string; status?: number; limit?: number };
  if (e?.type === 'entity.too.large' || e?.status === 413) {
    console.error('[body-parser] request entity too large', { limit: e.limit });
    return res.status(413).json({
      error: 'The upload is too large for the server to accept. Try a smaller file or contact support.',
      code: 'file_too_large',
    });
  }
  return next(err);
});

async function start() {
  await testConnection();
  // Editorial P0: schema ensure + seeds + admin bootstrap (no-op if MySQL down)
  await initEditorialEngine();

  const server = http.createServer(app);

  if (isDev) {
    const uploadsDirDev = path.resolve(__dirname, 'public', 'uploads');
    if (fs.existsSync(uploadsDirDev)) {
      app.use('/uploads', express.static(uploadsDirDev, { maxAge: '0', etag: true }));
    }
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite!.transformIndexHtml(url, template);
        const seo = await resolveSeoHtmlAsync(template, url.split('?')[0]);
        if (seo.status === 301) {
          res.redirect(301, seo.location);
          return;
        }
        res.status(seo.status).set({ 'Content-Type': 'text/html' }).end(seo.html);
      } catch (e) {
        vite?.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const dist = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      console.error('Production build missing: run `npm run build` before start (dist/index.html not found).');
      process.exit(1);
    }
    app.use(express.static(dist, { index: false, maxAge: '7d', etag: true }));
    const uploadsDir = path.resolve(__dirname, 'public', 'uploads');
    if (fs.existsSync(uploadsDir)) {
      app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', etag: true }));
    }
    app.get('*', async (req, res) => {
      try {
        const htmlPath = path.join(dist, 'index.html');
        const template = fs.readFileSync(htmlPath, 'utf-8');
        const seo = await resolveSeoHtmlAsync(template, req.path);
        if (seo.status === 301) {
          res.redirect(301, seo.location);
          return;
        }
        res.status(seo.status).set({ 'Content-Type': 'text/html' }).send(seo.html);
      } catch (err) {
        console.error('HTML SSR error:', err);
        res.status(500).send('Internal Server Error');
      }
    });
  }

  // Listen BEFORE geo/SEO/sitemap warm. Blocking work before listen made Cloudflare
  // and Googlebot wait with 0 bytes → GSC "Couldn't fetch / General HTTP error".
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CityCost server listening at http://localhost:${PORT} [ENV: ${process.env.NODE_ENV || 'development'}]`);
    console.log(`   Also reachable at http://127.0.0.1:${PORT}`);

    void (async () => {
      try {
        await yieldEventLoop();
        const n = warmGeoCityIndex();
        console.log(`🌍 Global city database indexed (${n.toLocaleString()} locations)`);
        await yieldEventLoop();

        const eligible = listEligibleCities();
        await yieldEventLoop();
        const countries = listIndexableCountries();
        const comps = listIndexableComparisons();
        console.log(
          `🔎 SEO index ready: ${eligible.length} cities · ${countries.length} countries · ${comps.length} comparisons`
        );
        await yieldEventLoop();

        try {
          prewarmComparisonSitemap();
        } catch (err) {
          console.warn('Comparison sitemap prewarm failed:', err);
        }
        await yieldEventLoop();

        const t0 = Date.now();
        await warmSitemaps();
        console.log(`🗺️  Sitemaps warmed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

        try {
          const q = warmSeoQualitySample(20, 15, 15);
          console.log(
            `📊 SEO quality sample — SEO ${q.average_seo_score} · content ${q.average_content_score} · uniqueness ${q.average_uniqueness} (n=${q.samples})`
          );
        } catch (err) {
          console.warn('SEO quality sample skipped:', err);
        }
      } catch (err) {
        console.error('Background SEO/sitemap warm failed:', err);
      }
    })();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
