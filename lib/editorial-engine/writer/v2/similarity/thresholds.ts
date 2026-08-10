import type { SimilarityLayer } from '../types.js';

/** Per-layer breach thresholds (0–1). */
export const SIMILARITY_THRESHOLDS: Record<SimilarityLayer, number> = {
  sentence: 0.72,
  paragraph: 0.7,
  heading: 0.85,
  outline: 0.8,
  faq: 0.65,
  summary: 0.65,
  advice: 0.7,
  transition: 0.68,
  cta: 0.7,
  opening: 0.7,
  closing: 0.7,
  internal_link: 0.75,
  statistics: 0.75,
  entity: 0.78,
  rhythm: 0.75,
  fingerprint: 0.62,
};
