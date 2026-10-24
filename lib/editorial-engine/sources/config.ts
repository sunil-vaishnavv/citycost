/**
 * Configuration and feature flag for Real-World Data Sources.
 */

export function isRealSourcesEnabled(): boolean {
  const raw = (process.env.USE_REAL_SOURCES || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(raw);
}

export function getTavilyApiKey(): string | null {
  const key = (process.env.TAVILY_API_KEY || '').trim();
  if (!key || key.startsWith('your_') || key.startsWith('YOUR_')) return null;
  return key;
}

export function getSearxngUrl(): string {
  const url = (process.env.SEARXNG_URL || 'http://localhost:8080').trim();
  return url.replace(/\/+$/, '');
}

export function getCivicDataUrl(): string {
  const url = (process.env.MCP_CIVIC_DATA_URL || 'http://localhost:8000').trim();
  return url.replace(/\/+$/, '');
}

export const DEFAULT_SEARCH_TIMEOUT_MS = 12_000;
export const DEFAULT_CIVIC_TIMEOUT_MS = 8_000;
export const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1 hour in ms
