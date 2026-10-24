/**
 * Tavily Search Client with retry, timeout, and failure classification.
 */

import { DEFAULT_SEARCH_TIMEOUT_MS, getTavilyApiKey } from './config.js';
import type { RealDataSource } from './types.js';

export interface TavilyRawResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilySearchResponse {
  query?: string;
  answer?: string;
  results?: TavilyRawResult[];
}

export class TavilyError extends Error {
  readonly status?: number;
  readonly isQuotaOrAuth: boolean;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TavilyError';
    this.status = status;
    this.isQuotaOrAuth = status === 401 || status === 403 || status === 429;
  }
}

function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'source.web';
  }
}

export async function searchTavily(
  query: string,
  options: {
    apiKey?: string | null;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxResults?: number;
    retries?: number;
  } = {}
): Promise<{ sources: RealDataSource[]; answer?: string }> {
  const apiKey = options.apiKey || getTavilyApiKey();
  if (!apiKey) {
    throw new TavilyError('TAVILY_API_KEY is not configured or is a placeholder', 401);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const maxResults = options.maxResults ?? 6;
  const retries = options.retries ?? 1;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const onParentAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) throw options.signal.reason || new Error('Aborted');
      options.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'advanced',
          include_answer: true,
          include_raw_content: false,
          max_results: maxResults,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new TavilyError(
          `Tavily API responded with HTTP ${res.status}: ${text.slice(0, 200)}`,
          res.status
        );
        // Don't retry client errors (401, 403, 429)
        if (err.isQuotaOrAuth || res.status < 500) {
          throw err;
        }
        lastError = err;
      } else {
        const data = (await res.json()) as TavilySearchResponse;
        const retrievedAt = new Date().toISOString().split('T')[0];
        const rawResults = Array.isArray(data.results) ? data.results : [];

        const sources: RealDataSource[] = rawResults
          .filter((r) => r.url && r.url.startsWith('http'))
          .map((r, i) => {
            const domain = extractDomain(r.url);
            return {
              id: i + 1,
              title: r.title ? r.title.trim() : domain,
              url: r.url.trim(),
              domain,
              retrievedAt,
              snippet: (r.content || '').trim().replace(/\s+/g, ' '),
              provider: 'tavily',
              isOfficialGov: /\.(?:gov|mil|edu)$/i.test(domain),
            };
          });

        return { sources, answer: data.answer };
      }
    } catch (err: unknown) {
      if (err instanceof TavilyError && err.isQuotaOrAuth) throw err;
      if (options.signal?.aborted) throw err;
      lastError = err as Error;
    } finally {
      clearTimeout(timeout);
      if (options.signal) {
        options.signal.removeEventListener('abort', onParentAbort);
      }
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }

  throw lastError || new TavilyError('Tavily search failed after retries');
}
