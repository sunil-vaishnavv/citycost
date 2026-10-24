/**
 * Types for Real-World Data Sources (Tavily, SearXNG, mcp-civic-data).
 */

export interface RealDataSource {
  id: number;
  title: string;
  url: string;
  domain: string;
  retrievedAt: string;
  snippet?: string;
  provider: 'tavily' | 'searxng' | 'civic_data';
  isOfficialGov?: boolean;
}

export interface ExtractedSourceFact {
  category: 'rent' | 'salary' | 'transport' | 'groceries' | 'utilities' | 'tax' | 'demographics' | 'weather' | 'general';
  statement: string;
  figure?: string;
  city?: string;
  sourceId: number;
  sourceTitle: string;
  sourceUrl: string;
}

export type RealSourcesStatus = 'live' | 'insufficient_data' | 'fallback_used' | 'error';

export interface RealSourcesResult {
  status: RealSourcesStatus;
  query: string;
  targetCity: string;
  comparisonCity?: string;
  sources: RealDataSource[];
  facts: ExtractedSourceFact[];
  factLines: string[];
  providerSummary: string;
  usedSearxngFallback?: boolean;
  usedCivicData?: boolean;
  error?: string;
  retrievedAt: string;
}

export interface CivicDataMetric {
  name: string;
  value: string | number;
  unit?: string;
  period?: string;
  sourceAgency: string; // e.g. "U.S. Bureau of Labor Statistics", "U.S. Census Bureau", "FRED"
  sourceUrl: string;
  category: ExtractedSourceFact['category'];
}
