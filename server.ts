/**
 * CityCost Global — Express + Vite middleware server
 * Wires geo search + COL engine. Does not own UI/SEO business rules beyond routes.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
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

app.use(compression());

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

app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').send(
    xmlSitemapIndex([
      `${SITE_URL}/sitemap-static.xml`,
      `${SITE_URL}/sitemap-countries.xml`,
      `${SITE_URL}/sitemap-cities.xml`,
      `${SITE_URL}/sitemap-comparisons.xml`,
      `${SITE_URL}/sitemap-intent-landings.xml`,
      `${SITE_URL}/sitemap-intent-categories.xml`,
      `${SITE_URL}/sitemap-intent-country-guides.xml`,
    ])
  );
});

app.get('/sitemap-static.xml', (_req, res) => {
  const entries = buildSitemapUrlEntries();
  res.type('application/xml').send(xmlUrlset(entries.home));
});

app.get('/sitemap-countries.xml', (_req, res) => {
  const entries = buildSitemapUrlEntries();
  res.type('application/xml').send(xmlUrlset(entries.countries));
});

app.get('/sitemap-cities.xml', (_req, res) => {
  const entries = buildSitemapUrlEntries();
  res.type('application/xml').send(xmlUrlset(entries.cities));
});

app.get('/sitemap-comparisons.xml', (_req, res) => {
  const entries = buildSitemapUrlEntries();
  res.type('application/xml').send(xmlUrlset(entries.comparisons));
});

app.get('/sitemap-intent-landings.xml', (_req, res) => {
  res.type('application/xml').send(xmlUrlset(listIndexableCityLandingUrls(SITE_URL)));
});

app.get('/sitemap-intent-categories.xml', (_req, res) => {
  res.type('application/xml').send(xmlUrlset(listIndexableCategoryUrls(SITE_URL)));
});

app.get('/sitemap-intent-country-guides.xml', (_req, res) => {
  res.type('application/xml').send(xmlUrlset(listIndexableCountryGuideUrls(SITE_URL)));
});

async function start() {
  await testConnection();
  const n = warmGeoCityIndex();
  console.log(`🌍 Global city database indexed (${n.toLocaleString()} locations)`);

  // Warm SEO eligibility catalog (config-capped; not full 148k)
  const eligible = listEligibleCities();
  const countries = listIndexableCountries();
  const comps = listIndexableComparisons();
  console.log(
    `🔎 SEO index ready: ${eligible.length} cities · ${countries.length} countries · ${comps.length} comparisons`
  );
  try {
    const q = warmSeoQualitySample(20, 15, 15);
    console.log(
      `📊 SEO quality sample — SEO ${q.average_seo_score} · content ${q.average_content_score} · uniqueness ${q.average_uniqueness} (n=${q.samples})`
    );
  } catch (err) {
    console.warn('SEO quality sample skipped:', err);
  }

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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CityCost server listening at http://localhost:${PORT} [ENV: ${process.env.NODE_ENV || 'development'}]`);
    console.log(`   Also reachable at http://127.0.0.1:${PORT}`);
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
