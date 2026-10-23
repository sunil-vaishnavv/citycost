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
 * - `no_evidence`: the call succeeded but no statement was attributed to a source.
 * - `unavailable`: grounding is not configured (no GEMINI_API_KEY).
 * - `error`: the call failed (bad model, quota, timeout, network).
 * Only `live` results carry facts/sources; nothing is ever synthesized.
 */
export type RagRetrievalStatus = 'live' | 'no_evidence' | 'unavailable' | 'error';

export interface RagRetrievalResult {
  topicId?: number;
  status: RagRetrievalStatus;
  /** Human-readable reason when status is not `live`. */
  error?: string;
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
