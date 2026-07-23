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
import { resolveCityCostOfLiving } from './lib/col-engine/index.js';
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
import { injectSeoIntoHtml, xmlUrlset, xmlSitemapIndex } from './lib/seo-ssr.js';
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
        connectSrc: ["'self'", "https://www.google-analytics.com", "https://region1.google-analytics.com"],
        frameSrc: ["'self'", "https://tpc.googlesyndication.com"],
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

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 5000 : 300,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDev && req.path.startsWith('/cities'),
});

app.use('/api/', apiLimiter);

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
    const estimated = await resolveCityCostOfLiving(query, {
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
  const { related, nearby, enrichment } = buildCompareSeoLinks(a, b);
  // Enrichment is SEO content (safe to expose); quality scores never included
  return res.json({ related, nearby, enrichment });
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
};

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
        buildAndCacheSitemap(key);
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function* bufferChunks(buf: Buffer, size: number): Generator<Buffer> {
  for (let i = 0; i < buf.length; i += size) {
    yield buf.subarray(i, Math.min(i + size, buf.length));
  }
}

/** Peek cache only — never sync-build (used by streaming comparisons handler). */
function peekSitemapEntry(key: string): SitemapCacheEntry | null {
  const hit = sitemapCache.get(key);
  if (!hit) return null;
  const age = Date.now() - hit.at;
  if (age >= SITEMAP_TTL_MS) scheduleSitemapRefresh(key);
  return hit;
}

/**
 * Stream a cached sitemap so headers + first bytes leave before the full body
 * is drained (chunked transfer). Avoids res.send() holding the complete payload.
 */
function streamCachedSitemap(req: express.Request, res: express.Response, entry: SitemapCacheEntry): void {
  const gzip = acceptsGzip(req);
  res.status(200);
  res.set({
    'Content-Type': 'application/xml; charset=UTF-8',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    Vary: 'Accept-Encoding',
    ETag: entry.etag,
  });
  if (gzip) res.set('Content-Encoding', 'gzip');
  // No Content-Length → chunked encoding; flush headers before body.
  res.flushHeaders();

  const body = gzip ? entry.gzip : Buffer.from(entry.xml, 'utf8');
  Readable.from(bufferChunks(body, 16 * 1024)).pipe(res);
}

/**
 * Cold path: write XML (and optional gzip) in chunks so Googlebot's TTFB is the
 * first <?xml / gzip frame, not the full 1.5MB generation.
 */
function streamGenerateComparisons(req: express.Request, res: express.Response): void {
  const urls = [
    ...new Set(listIndexableComparisons().map((p) => `${SITE_URL}/compare/${p.slug}`)),
  ];
  const lastmod = new Date().toISOString().slice(0, 10);
  const wantGzip = acceptsGzip(req);

  res.status(200);
  res.set({
    'Content-Type': 'application/xml; charset=UTF-8',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    Vary: 'Accept-Encoding',
  });
  if (wantGzip) res.set('Content-Encoding', 'gzip');
  res.flushHeaders();

  const xmlParts: string[] = [];
  const gzipChunks: Buffer[] = [];
  const gzip = wantGzip ? zlib.createGzip({ level: 6 }) : null;

  const sink: NodeJS.WritableStream = gzip ?? res;
  if (gzip) {
    gzip.on('data', (c: Buffer) => {
      gzipChunks.push(c);
      if (!res.write(c)) gzip.pause();
    });
    res.on('drain', () => gzip.resume());
    gzip.on('end', () => {
      const xml = xmlParts.join('');
      const gzipBuf = Buffer.concat(gzipChunks);
      const etag = `W/"${gzipBuf.length.toString(16)}-${crypto.createHash('sha1').update(gzipBuf).digest('hex').slice(0, 12)}"`;
      sitemapCache.set('sitemap-comparisons.xml', {
        xml,
        gzip: gzipBuf,
        at: Date.now(),
        etag,
      });
      res.end();
    });
    gzip.on('error', (err) => {
      console.error('[sitemap:sitemap-comparisons.xml] gzip', err);
      if (!res.headersSent) {
        res.status(503).set({ 'Retry-After': '120' }).end('Sitemap temporarily unavailable');
      } else {
        res.destroy(err);
      }
    });
  }

  const header = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  xmlParts.push(header);
  sink.write(header);

  const BATCH = 200;
  let i = 0;

  const writeBatch = () => {
    try {
      while (i < urls.length) {
        let chunk = '';
        const end = Math.min(i + BATCH, urls.length);
        for (; i < end; i++) {
          const loc = escapeXml(urls[i]);
          chunk += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
        }
        xmlParts.push(chunk);
        if (!sink.write(chunk)) {
          sink.once('drain', writeBatch);
          return;
        }
        // Yield so other requests (and socket flush) can run mid-stream.
        if (i < urls.length) {
          setImmediate(writeBatch);
          return;
        }
      }
      const footer = `</urlset>`;
      xmlParts.push(footer);
      if (gzip) {
        gzip.end(footer);
      } else {
        const xml = xmlParts.join('');
        const gz = zlib.gzipSync(Buffer.from(xml, 'utf8'), { level: 6 });
        const etag = `W/"${gz.length.toString(16)}-${crypto.createHash('sha1').update(gz).digest('hex').slice(0, 12)}"`;
        sitemapCache.set('sitemap-comparisons.xml', { xml, gzip: gz, at: Date.now(), etag });
        res.end(footer);
      }
    } catch (err) {
      console.error('[sitemap:sitemap-comparisons.xml]', err);
      if (!res.headersSent) {
        res
          .status(503)
          .set({ 'Content-Type': 'text/plain; charset=UTF-8', 'Retry-After': '120' })
          .send('Sitemap temporarily unavailable');
      } else {
        res.destroy(err as Error);
      }
    }
  };

  writeBatch();
}

function handleComparisonsSitemap(req: express.Request, res: express.Response): void {
  const cached = peekSitemapEntry('sitemap-comparisons.xml');
  if (cached) {
    streamCachedSitemap(req, res, cached);
    return;
  }
  streamGenerateComparisons(req, res);
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
  app.get(`/${key}`, (req, res) => {
    try {
      const entry = getSitemapEntry(key);
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

async function start() {
  await testConnection();

  const server = http.createServer(app);

  if (isDev) {
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
        template = injectSeoIntoHtml(template, url.split('?')[0]);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
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
    app.get('*', (req, res) => {
      const htmlPath = path.join(dist, 'index.html');
      let html = fs.readFileSync(htmlPath, 'utf-8');
      html = injectSeoIntoHtml(html, req.path);
      res.status(200).set({ 'Content-Type': 'text/html' }).send(html);
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
