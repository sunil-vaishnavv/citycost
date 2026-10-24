/**
 * SearXNG Search Client — fallback engine when Tavily is unavailable or exhausted.
 */

import { DEFAULT_SEARCH_TIMEOUT_MS, getSearxngUrl } from './config.js';
import type { RealDataSource } from './types.js';

export interface SearxngRawResult {
  title?: string;
  url?: string;
  content?: string;
  snippet?: string;
}

export interface SearxngSearchResponse {
  query?: string;
  number_of_results?: number;
  results?: SearxngRawResult[];
}

function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'source.web';
  }
}

export async function searchSearxng(
  query: string,
  options: {
    baseUrl?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxResults?: number;
  } = {}
): Promise<{ sources: RealDataSource[] }> {
  const baseUrl = options.baseUrl || getSearxngUrl();
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const maxResults = options.maxResults ?? 6;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onParentAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) throw options.signal.reason || new Error('Aborted');
    options.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  try {
    const url = new URL(`${baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');
    url.searchParams.set('categories', 'general');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CityCost-Editorial/1.0',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SearXNG responded with HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as SearxngSearchResponse;
    const retrievedAt = new Date().toISOString().split('T')[0];
    const rawResults = Array.isArray(data.results) ? data.results : [];

    const sources: RealDataSource[] = rawResults
      .filter((r) => r.url && r.url.startsWith('http'))
      .slice(0, maxResults)
      .map((r, i) => {
        const domain = extractDomain(r.url!);
        const snippet = (r.content || r.snippet || '').trim().replace(/\s+/g, ' ');
        return {
          id: i + 1,
          title: r.title ? r.title.trim() : domain,
          url: r.url!.trim(),
          domain,
          retrievedAt,
          snippet,
          provider: 'searxng',
          isOfficialGov: /\.(?:gov|mil|edu)$/i.test(domain),
        };
      });

    return { sources };
  } finally {
    clearTimeout(timeout);
    if (options.signal) {
      options.signal.removeEventListener('abort', onParentAbort);
    }
  }
}
