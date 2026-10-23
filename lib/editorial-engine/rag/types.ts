/**
 * RAG Pipeline & Factual Grounding Types for CityCost Editorial Engine.
 */

export interface GroundingSource {
  id: number;
  title: string;
  url: string;
  domain: string;
  retrievedAt: string;
  snippet?: string;
}

export interface GroundedFact {
  category: 'rent' | 'transport' | 'groceries' | 'utilities' | 'salary' | 'tax' | 'lifestyle' | 'general';
  statement: string;
  city?: string;
  figure?: string;
  /** Primary supporting source (first of sourceIds). */
  sourceId: number;
  /** Every search result Gemini attributed this statement to. */
  sourceIds?: number[];
  citationRef: string; // e.g. "[^1]"
}

export interface ClaimAuditResult {
  claimId: string;
  claimText: string;
  category: 'rent' | 'transport' | 'groceries' | 'utilities' | 'salary' | 'tax' | 'general';
  status: 'verified' | 'disputed' | 'ungrounded';
  confidence: number; // 0.0 - 1.0
  matchedSourceId?: number;
  matchedSourceUrl?: string;
  matchedSourceTitle?: string;
  matchedEvidence?: string;
  discrepancyNote?: string;
}

/**
 * - `audited`: claims were checked against retrieved evidence.
 * - `no_evidence`: there was no grounded evidence to check against, so no score is given.
 */
export type RagAuditStatus = 'audited' | 'no_evidence';

export interface RagAuditReport {
  status: RagAuditStatus;
  /** 0 - 100; null when status is `no_evidence`. */
  accuracyScore: number | null;
  totalClaims: number;
  verifiedCount: number;
  disputedCount: number;
  ungroundedCount: number;
  passed: boolean;
  claims: ClaimAuditResult[];
  sources: GroundingSource[];
  summary: string;
  auditedAt: string;
}

/**
 * - `live`: Google Search grounding returned at least one source-backed fact.
 * - `no_evidence`: the call succeeded but no statement was attributed to a source
 *   (includes responses with no grounding metadata at all).
 * - `unavailable`: grounding is not configured (no real GEMINI_API_KEY).
 * - `blocked`: not attempted because policy forbids this use (see grounding-policy.ts).
 * - `error`: the call failed (auth, bad model, quota, rate limit, timeout, network).
 * Only `live` results carry facts/sources; nothing is ever synthesized.
 */
export type RagRetrievalStatus = 'live' | 'no_evidence' | 'unavailable' | 'blocked' | 'error';

export type RagErrorCategory =
  | 'missing_key'
  | 'policy'
  | 'auth'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'unsupported_model'
  | 'timeout'
  | 'network'
  | 'blocked_request'
  | 'metadata_missing'
  | 'no_supported_claims'
  | 'unknown';

/** Redacted runtime trace of one grounding call (no key, no prompt text). */
export interface GroundingTrace {
  request_id: string;
  provider: 'google-genai';
  model: string;
  tool: 'googleSearch';
  started_at: string;
  latency_ms: number;
  status: RagRetrievalStatus;
  error_category?: RagErrorCategory;
  finish_reason?: string;
  web_search_queries: number;
  grounding_chunks: number;
  grounding_supports: number;
  sources: number;
  facts: number;
  unsupported_dropped: number;
}

/**
 * Ephemeral display payload for the admin who submitted the lookup.
 * Terms: show unmodified with Search Suggestions; never persist or reuse.
 */
export interface GroundingDisplay {
  text: string;
  search_entry_point_html?: string;
  web_search_queries: string[];
}

export interface RagRetrievalResult {
  topicId?: number;
  status: RagRetrievalStatus;
  error_category?: RagErrorCategory;
  /** Human-readable reason when status is not `live`. */
  error?: string;
  trace?: GroundingTrace;
  /** Present only when explicitly requested for interactive display. Never persist. */
  display?: GroundingDisplay;
  query: string;
  targetCity: string;
  comparisonCity?: string;
  sources: GroundingSource[];
  facts: GroundedFact[];
  factLines: string[];
  /** Numbered statements dropped because Gemini attributed no source to them. */
  unsupportedDropped: number;
  retrievalTimestamp: string;
  model: string;
}
