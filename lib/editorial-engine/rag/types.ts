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
  sourceId: number;
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

export interface RagAuditReport {
  accuracyScore: number; // 0 - 100
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

export interface RagRetrievalResult {
  topicId?: number;
  query: string;
  targetCity: string;
  comparisonCity?: string;
  sources: GroundingSource[];
  facts: GroundedFact[];
  factLines: string[];
  retrievalTimestamp: string;
  model: string;
}
