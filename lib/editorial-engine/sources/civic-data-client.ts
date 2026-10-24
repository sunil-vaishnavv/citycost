/**
 * Interface to mcp-civic-data (GitHub: EricGrill/mcp-civic-data)
 * Authoritative US municipal data from free government sources (BLS, BEA, FRED, Census, weather).
 */

import { DEFAULT_CIVIC_TIMEOUT_MS, getCivicDataUrl } from './config.js';
import type { CivicDataMetric, RealDataSource } from './types.js';

const US_STATE_REGEX =
  /,\s*(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|usa?|united states)\b/i;

export function isUsLocation(cityName?: string | null, countryName?: string | null): boolean {
  if (countryName) {
    const c = countryName.trim().toLowerCase();
    if (c === 'us' || c === 'usa' || c === 'united states' || c === 'united states of america') {
      return true;
    }
  }
  if (!cityName) return false;
  return US_STATE_REGEX.test(cityName.toLowerCase());
}

export interface CivicDataToolCallResult {
  tool: string;
  success: boolean;
  data?: Record<string, unknown> | Array<Record<string, unknown>>;
  error?: string;
}

/**
 * Invokes an MCP tool on the self-hosted civic-data server.
 * Supports standard JSON-RPC or REST style FastMCP endpoints.
 */
async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  options: { baseUrl: string; signal?: AbortSignal; timeoutMs?: number }
): Promise<CivicDataToolCallResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_CIVIC_TIMEOUT_MS);

  const onParentAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) throw options.signal.reason || new Error('Aborted');
    options.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  try {
    // Attempt standard FastMCP / tool endpoint
    const url = `${options.baseUrl}/call_tool`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name: toolName,
        arguments: args,
      }),
      signal: controller.signal,
    }).catch(async (fetchErr) => {
      // If /call_tool fails, try JSON-RPC 2.0 /tools/call endpoint
      return await fetch(`${options.baseUrl}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `civic_${Date.now()}`,
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        }),
        signal: controller.signal,
      }).catch(() => {
        throw fetchErr;
      });
    });

    if (!res.ok) {
      return {
        tool: toolName,
        success: false,
        error: `HTTP ${res.status}: ${await res.text().catch(() => '')}`,
      };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const content = (json.result || json.data || json) as Record<string, unknown>;
    return {
      tool: toolName,
      success: true,
      data: content,
    };
  } catch (err: unknown) {
    return {
      tool: toolName,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
    if (options.signal) {
      options.signal.removeEventListener('abort', onParentAbort);
    }
  }
}

/**
 * Fetch civic data for a US city from self-hosted mcp-civic-data server.
 * Returns official sources and metrics. Never throws — degrades gracefully.
 */
export async function fetchCivicDataForCity(
  city: string,
  options: {
    country?: string;
    baseUrl?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<{ sources: RealDataSource[]; metrics: CivicDataMetric[] }> {
  if (!city || typeof city !== 'string' || !isUsLocation(city, options.country)) {
    // Non-US or invalid location: civic data does not apply
    return { sources: [], metrics: [] };
  }

  const baseUrl = options.baseUrl || getCivicDataUrl();
  const timeoutMs = options.timeoutMs ?? DEFAULT_CIVIC_TIMEOUT_MS;
  const retrievedAt = new Date().toISOString().split('T')[0];
  const cityNameOnly = city.split(',')[0].trim();

  const metrics: CivicDataMetric[] = [];
  const sources: RealDataSource[] = [];

  try {
    // 1. Try Census Bureau tool (population, median income, housing count)
    const censusCall = await callMcpTool(
      'census_quickfacts',
      { city: cityNameOnly, state: city.split(',')[1]?.trim() || '' },
      { baseUrl, signal: options.signal, timeoutMs }
    );

    if (censusCall.success && censusCall.data) {
      const d = censusCall.data as Record<string, unknown>;
      sources.push({
        id: 101,
        title: `U.S. Census Bureau QuickFacts (${cityNameOnly})`,
        url: 'https://www.census.gov/quickfacts',
        domain: 'census.gov',
        retrievedAt,
        snippet: `Authoritative demographics and housing statistics for ${city} from the U.S. Census Bureau.`,
        provider: 'civic_data',
        isOfficialGov: true,
      });

      if (d.median_household_income) {
        metrics.push({
          name: 'Median Household Income',
          value: String(d.median_household_income),
          sourceAgency: 'U.S. Census Bureau',
          sourceUrl: 'https://www.census.gov',
          category: 'salary',
        });
      }
      if (d.population) {
        metrics.push({
          name: 'Population',
          value: String(d.population),
          sourceAgency: 'U.S. Census Bureau',
          sourceUrl: 'https://www.census.gov',
          category: 'demographics',
        });
      }
    }

    // 2. Try BLS / FRED tool (wages, regional CPI)
    const econCall = await callMcpTool(
      'bls_get_wages',
      { area: cityNameOnly },
      { baseUrl, signal: options.signal, timeoutMs }
    );

    if (econCall.success && econCall.data) {
      const d = econCall.data as Record<string, unknown>;
      sources.push({
        id: 102,
        title: `U.S. Bureau of Labor Statistics (BLS) Wage & Inflation Data (${cityNameOnly})`,
        url: 'https://www.bls.gov',
        domain: 'bls.gov',
        retrievedAt,
        snippet: `Official wage levels and Consumer Price Index (CPI) benchmarks from the Bureau of Labor Statistics for ${city}.`,
        provider: 'civic_data',
        isOfficialGov: true,
      });

      if (d.mean_annual_wage || d.median_annual_wage) {
        metrics.push({
          name: 'Annual Wage',
          value: String(d.median_annual_wage || d.mean_annual_wage),
          sourceAgency: 'U.S. Bureau of Labor Statistics',
          sourceUrl: 'https://www.bls.gov',
          category: 'salary',
        });
      }
    }
  } catch (err) {
    console.warn(`[civic-data] Civic data query skipped for ${city} (${(err as Error).message})`);
  }

  return { sources, metrics };
}
