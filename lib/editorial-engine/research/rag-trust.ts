/**
 * Trust boundary for RAG grounding stored on research packs.
 * Type-only imports so reviewer / routes can use it without import cycles.
 */
import type { ResearchPack } from './schema.js';

/**
 * Grounding evidence is trusted only when written by the current retriever
 * (`rag_status === 'live'`). Packs from before that field existed may carry
 * synthesized fallback figures or round-robin citations, so they yield nothing.
 */
export function trustedRagEvidence(pack: unknown): {
  facts: NonNullable<ResearchPack['grounded_facts']>;
  sources: NonNullable<ResearchPack['grounding_sources']>;
} {
  const p = (pack && typeof pack === 'object' ? pack : {}) as Partial<ResearchPack>;
  if (p.rag_status !== 'live') return { facts: [], sources: [] };
  return {
    facts: Array.isArray(p.grounded_facts) ? p.grounded_facts : [],
    sources: Array.isArray(p.grounding_sources) ? p.grounding_sources : [],
  };
}

/**
 * Remove untrusted (pre-fix) grounding from a cached pack before reuse:
 * drops grounding fields and the `[^n]`-cited supporting facts they injected.
 */
export function stripUntrustedGrounding(pack: ResearchPack): ResearchPack {
  if (pack.rag_status === 'live' || (!pack.grounded_facts && !pack.grounding_sources)) return pack;
  return {
    ...pack,
    grounding_sources: undefined,
    grounded_facts: undefined,
    rag_accuracy_score: undefined,
    rag_status: 'unavailable',
    rag_error: 'Cached pack predates source-verified grounding; its web facts were removed.',
    supporting_facts: (pack.supporting_facts || []).filter((f) => !/^\[\^\d+\]\s/.test(f)),
  };
}
