/**
 * Confidence-aware publishing messaging — does not replace publish architecture.
 */

import type { ConfidenceLevel } from './confidence-engine.js';

export type ConfidencePublishAction = 'auto_publish' | 'ready' | 'review' | 'manual';

export interface ConfidencePublishSettings {
  /** When true and confidence Excellent, messaging allows auto-publish path */
  confidence_auto_publish_excellent: boolean;
  confidence_action_excellent: ConfidencePublishAction;
  confidence_action_high: ConfidencePublishAction;
  confidence_action_medium: ConfidencePublishAction;
  confidence_action_low: ConfidencePublishAction;
}

export const DEFAULT_CONFIDENCE_PUBLISH_SETTINGS: ConfidencePublishSettings = {
  confidence_auto_publish_excellent: false,
  confidence_action_excellent: 'auto_publish',
  confidence_action_high: 'ready',
  confidence_action_medium: 'review',
  confidence_action_low: 'manual',
};

export function resolveConfidencePublishAction(
  level: ConfidenceLevel | null | undefined,
  settings: Partial<ConfidencePublishSettings> | null | undefined
): ConfidencePublishAction {
  const s = { ...DEFAULT_CONFIDENCE_PUBLISH_SETTINGS, ...(settings || {}) };
  switch (level) {
    case 'Excellent':
      return s.confidence_auto_publish_excellent
        ? 'auto_publish'
        : s.confidence_action_excellent === 'auto_publish'
          ? 'ready'
          : s.confidence_action_excellent;
    case 'High':
      return s.confidence_action_high;
    case 'Medium':
      return s.confidence_action_medium;
    case 'Low':
      return s.confidence_action_low;
    default:
      return 'review';
  }
}

export function confidencePublishMessage(
  level: ConfidenceLevel | null | undefined,
  action: ConfidencePublishAction
): string {
  const lvl = level || 'Medium';
  switch (action) {
    case 'auto_publish':
      return `Confidence ${lvl}: eligible for auto-publish (setting enabled).`;
    case 'ready':
      return `Confidence ${lvl}: publish-ready from a confidence standpoint.`;
    case 'review':
      return `Confidence ${lvl}: recommend editorial review before publish.`;
    case 'manual':
      return `Confidence ${lvl}: requires manual review — do not publish yet.`;
  }
}

/** Soft readiness: Low/manual mapping blocks confidence check; others pass with messaging. */
export function confidenceReadinessPassed(action: ConfidencePublishAction): boolean {
  return action === 'auto_publish' || action === 'ready' || action === 'review';
}
