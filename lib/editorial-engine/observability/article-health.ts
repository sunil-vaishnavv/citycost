/**
 * Article Health — derived label from decision + confidence + status.
 * Does not change workflow; display / messaging only.
 */

import type { PipelineDecision } from '../validation/decision-engine.js';
import type { ConfidenceLevel } from './confidence-engine.js';

export type ArticleHealth =
  | 'Excellent'
  | 'Good'
  | 'Needs Revision'
  | 'Manual Review'
  | 'Published';

export function computeArticleHealth(input: {
  status?: string | null;
  decision?: PipelineDecision | string | null;
  overall_confidence?: number | null;
  confidence_level?: ConfidenceLevel | null;
}): ArticleHealth {
  const status = (input.status || '').toLowerCase();
  if (status === 'published') return 'Published';

  const decision = (input.decision || '').toLowerCase();
  if (decision === 'manual_review' || status === 'needs_manual_review') {
    return 'Manual Review';
  }
  if (decision === 'revision' || status === 'draft') {
    return 'Needs Revision';
  }
  if (decision === 'approved' || status === 'review') {
    const conf =
      input.overall_confidence ??
      (input.confidence_level === 'Excellent'
        ? 96
        : input.confidence_level === 'High'
          ? 92
          : input.confidence_level === 'Medium'
            ? 85
            : input.confidence_level === 'Low'
              ? 70
              : null);
    if (conf != null && conf > 95) return 'Excellent';
    return 'Good';
  }

  if (status === 'failed' || status === 'archived') return 'Manual Review';
  return 'Needs Revision';
}

export function articleHealthTone(
  health: ArticleHealth
): 'emerald' | 'teal' | 'amber' | 'rose' | 'slate' {
  switch (health) {
    case 'Excellent':
      return 'emerald';
    case 'Good':
      return 'teal';
    case 'Needs Revision':
      return 'amber';
    case 'Manual Review':
      return 'rose';
    case 'Published':
      return 'slate';
  }
}
