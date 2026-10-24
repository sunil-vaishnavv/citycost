/**
 * Real Sources Orchestrator — Tavily + mcp-civic-data + SearXNG fallback.
 * Implements TTL caching, timeout resilience, deduplication, and anti-hallucination fail-safe.
 */

import { DEFAULT_CACHE_TTL_MS, isRealSourcesEnabled } from './config.js';
import { fetchCivicDataForCity, isUsLocation } from './civic-data-client.js';
import { extractFactsFromCivicMetrics, extractFactsFromSources } from './fact-extractor.js';
import { searchSearxng } from './searxng-client.js';
import { searchTavily, TavilyError } from './tavily-client.js';
import type { RealDataSource, RealSourcesResult } from './types.js';

interface CacheEntry {
  result: RealSourcesResult;
  timestamp: number;
}

const sourcesCache = new Map<string, CacheEntry>();

export function clearSourcesCache(): void {
  sourcesCache.clear();
}

export function buildSearchQuery(params: {
  targetCity: string;
  comparisonCity?: string;
  topicTitle?: string;
  year?: number;
}): string {
  const currentYear = params.year || new Date().getFullYear();
  if (params.comparisonCity) {
    return `${params.targetCity} vs ${params.comparisonCity} cost of living ${currentYear} rent utilities groceries transit salary`;
  }
  if (params.topicTitle && params.topicTitle.length > 5) {
    const cleanTitle = params.topicTitle.split(':')[0].trim();
    return `${cleanTitle} cost of living ${currentYear} rent utilities groceries transit`;
  }
  return `${params.targetCity} cost of living ${currentYear} rent groceries transit`;
}

export async function fetchRealWorldSources(params: {
  targetCity: string;
  comparisonCity?: string;
  topicTitle?: string;
  country?: string;
  signal?: AbortSignal;
  skipCache?: boolean;
}): Promise<RealSourcesResult> {
  const { targetCity, comparisonCity, topicTitle, country } = params;
  const currentYear = new Date().getFullYear();
  const query = buildSearchQuery({ targetCity, comparisonCity, topicTitle, year: currentYear });
  const cacheKey = `${query.toLowerCase()}::${country || ''}`;

  if (!params.skipCache) {
    const cached = sourcesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < DEFAULT_CACHE_TTL_MS) {
      console.log(`[sources] Returning cached real-world sources for "${query}"`);
      return cached.result;
    }
  }

  const retrievedAt = new Date().toISOString().split('T')[0];
  let usedSearxngFallback = false;
  let usedCivicData = false;
  const collectedSources: RealDataSource[] = [];
  const providersUsed: string[] = [];

  // 1. Fetch civic data if location is in the US
  if (isUsLocation(targetCity, country) || (comparisonCity && isUsLocation(comparisonCity, country))) {
    try {
      const civicA = await fetchCivicDataForCity(targetCity, {
        country,
        signal: params.signal,
      });
      if (civicA.sources.length) {
        collectedSources.push(...civicA.sources);
        usedCivicData = true;
        providersUsed.push('mcp-civic-data');
      }

      if (comparisonCity && isUsLocation(comparisonCity, country)) {
        const civicB = await fetchCivicDataForCity(comparisonCity, {
          country,
          signal: params.signal,
        });
        if (civicB.sources.length) {
          collectedSources.push(...civicB.sources);
        }
      }
    } catch (civicErr) {
      console.warn(`[sources] Civic data query had issues: ${(civicErr as Error).message}`);
    }
  }

  // 2. Fetch web search results (Tavily with SearXNG fallback)
  let webSources: RealDataSource[] = [];
  let tavilyErrorDetail: string | undefined;

  try {
    const tavily = await searchTavily(query, { signal: params.signal });
    webSources = tavily.sources;
    if (webSources.length > 0) {
      providersUsed.push('tavily');
    } else {
      throw new Error('Tavily returned 0 search results');
    }
  } catch (err: unknown) {
    tavilyErrorDetail = err instanceof Error ? err.message : String(err);
    console.warn(`[sources] Tavily search failed (${tavilyErrorDetail}) — attempting SearXNG fallback…`);

    try {
      const searxng = await searchSearxng(query, { signal: params.signal });
      webSources = searxng.sources;
      if (webSources.length > 0) {
        usedSearxngFallback = true;
        providersUsed.push('searxng');
        console.log(`[sources] SearXNG fallback succeeded with ${webSources.length} sources`);
      }
    } catch (searxngErr: unknown) {
      console.warn(`[sources] SearXNG fallback also failed: ${(searxngErr as Error).message}`);
    }
  }

  // 3. Deduplicate and merge sources
  collectedSources.push(...webSources);

  const seenUrls = new Set<string>();
  const seenDomains = new Set<string>();
  const finalSources: RealDataSource[] = [];

  for (const s of collectedSources) {
    const normUrl = s.url.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(normUrl)) continue;
    seenUrls.add(normUrl);

    // Prefer diverse domains (max 2 per domain)
    const domainCount = finalSources.filter((x) => x.domain === s.domain).length;
    if (domainCount >= 2 && !s.isOfficialGov) continue;

    finalSources.push(s);
    seenDomains.add(s.domain);
    if (finalSources.length >= 8) break;
  }

  // Re-index sources with clean sequential IDs 1..N
  const indexedSources = finalSources.map((s, idx) => ({
    ...s,
    id: idx + 1,
  }));

  // 4. Extract verified facts from snippets
  const facts = extractFactsFromSources(indexedSources, { targetCity, comparisonCity });
  const factLines = facts.map((f) => `[${f.sourceTitle}](${f.sourceUrl}): ${f.statement}`);

  const providerSummary = providersUsed.length ? providersUsed.join(', ') : 'none';

  // 5. If zero sources are available, return insufficient_data
  if (indexedSources.length === 0) {
    const emptyResult: RealSourcesResult = {
      status: 'insufficient_data',
      query,
      targetCity,
      comparisonCity,
      sources: [],
      facts: [],
      factLines: [],
      providerSummary,
      usedSearxngFallback,
      usedCivicData,
      error: tavilyErrorDetail
        ? `All sources failed (Tavily: ${tavilyErrorDetail})`
        : 'No verifiable real-world sources found for topic',
      retrievedAt,
    };
    return emptyResult;
  }

  const result: RealSourcesResult = {
    status: 'live',
    query,
    targetCity,
    comparisonCity,
    sources: indexedSources,
    facts,
    factLines,
    providerSummary,
    usedSearxngFallback,
    usedCivicData,
    retrievedAt,
  };

  sourcesCache.set(cacheKey, { result, timestamp: Date.now() });
  return result;
}
