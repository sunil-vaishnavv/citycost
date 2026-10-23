/**
 * Google Search Grounding — usage policy for the editorial pipeline.
 *
 * Gemini API Additional Terms ("Grounding with Google Search") require that
 * Grounded Results are displayed, unmodified and with their Search Suggestions,
 * only to the end user who submitted the prompt, and prohibit caching,
 * analysing or learning from them. Feeding grounded output to a separate writer
 * model, rewriting it into a public article, or persisting it in research packs
 * does not fit that use model. The terms allow exceptions only when "permitted
 * by Google in writing".
 *
 * Therefore article-pipeline use is BLOCKED by default. An operator who holds
 * written permission from Google can enable it with
 *   GROUNDING_ARTICLE_USE=google_written_permission
 * Interactive admin lookups (display-only to the admin who asked) stay allowed.
 */

import { normalizeProviderApiKey } from '../secrets/provider-env.js';

/** Exact opt-in value — an attestation, not a boolean, so it cannot be flipped by accident. */
export const GROUNDING_PERMISSION_ATTESTATION = 'google_written_permission';

export interface GroundingArticlePolicy {
  /** Grounded results may feed research packs, writer prompts, persistence and audits. */
  permitted: boolean;
  reason: string;
}

export function groundingArticlePolicy(): GroundingArticlePolicy {
  const raw = (process.env.GROUNDING_ARTICLE_USE || '').trim().toLowerCase();
  if (raw === GROUNDING_PERMISSION_ATTESTATION) {
    return {
      permitted: true,
      reason: 'GROUNDING_ARTICLE_USE attests written permission from Google for article use.',
    };
  }
  return {
    permitted: false,
    reason:
      'Google Search Grounding terms only allow display to the requesting user (unmodified, with Search Suggestions) and prohibit caching/analysing results; article use needs written permission from Google (set GROUNDING_ARTICLE_USE=google_written_permission only if you hold it).',
  };
}

/**
 * When true, research-dependent articles fail closed unless grounding is verified.
 * Default false: articles use CityCost's internal dataset, labelled as such.
 */
export function groundingRequiredForArticles(): boolean {
  const raw = (process.env.EDITORIAL_REQUIRE_GROUNDING || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on', 'required'].includes(raw);
}

/** Real Gemini key or null (placeholders such as "your_gemini_api_key" count as missing). */
export function resolveGeminiApiKey(explicit?: string | null): string | null {
  return normalizeProviderApiKey(explicit) || normalizeProviderApiKey(process.env.GEMINI_API_KEY);
}

/**
 * Research readiness statuses recorded on the research pack.
 * - grounding_verified: live grounding returned source-backed evidence (article use permitted)
 * - grounding_blocked: grounding not used for articles (policy) — internal data only
 * - grounding_unavailable: grounding attempted/configured but failed (key, quota, model, network)
 * - evidence_insufficient: grounding ran but returned no source-backed figures
 */
export type ResearchGroundingStatus =
  | 'grounding_verified'
  | 'grounding_blocked'
  | 'grounding_unavailable'
  | 'evidence_insufficient';

export class GroundingRequiredError extends Error {
  readonly status: ResearchGroundingStatus;
  constructor(status: ResearchGroundingStatus, detail: string) {
    super(
      `Research blocked (${status}): EDITORIAL_REQUIRE_GROUNDING is on but verified grounding is not available — ${detail}`
    );
    this.name = 'GroundingRequiredError';
    this.status = status;
  }
}
