/**
 * Real-World Data Sources subsystem for CityCost Editorial Engine.
 * Exports Tavily, SearXNG, mcp-civic-data orchestrator and helpers.
 */

export * from './types.js';
export * from './config.js';
export { searchTavily, TavilyError } from './tavily-client.js';
export { searchSearxng } from './searxng-client.js';
export { fetchCivicDataForCity, isUsLocation } from './civic-data-client.js';
export { extractFactsFromSources, extractFactsFromCivicMetrics } from './fact-extractor.js';
export {
  fetchRealWorldSources,
  buildSearchQuery,
  clearSourcesCache,
} from './orchestrator.js';
