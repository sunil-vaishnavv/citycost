/**
 * Prompt version + hash tracking for generation / review / revision / SEO logs.
 */

import crypto from 'crypto';
import {
  REVIEWER_ENGINE_VERSION,
  SEO_ENGINE_VERSION,
  WRITER_ENGINE_VERSION,
} from '../constants.js';
import { REVISION_PROMPT_VERSION, REVISION_ENGINE_VERSION } from '../revision/revision-types.js';

export interface PromptVersionMeta {
  writer_prompt_version?: number | string | null;
  research_prompt_version?: number | string | null;
  reviewer_prompt_version?: number | string | null;
  revision_prompt_version?: string | null;
  seo_prompt_version?: number | string | null;
  writer_prompt_hash?: string | null;
  research_prompt_hash?: string | null;
  reviewer_prompt_hash?: string | null;
  revision_prompt_hash?: string | null;
  seo_prompt_hash?: string | null;
  writer_engine?: string;
  reviewer_engine?: string;
  revision_engine?: string;
  seo_engine?: string;
}

export function hashPromptParts(...parts: Array<string | number | null | undefined>): string {
  const h = crypto.createHash('sha256');
  for (const p of parts) {
    h.update(String(p ?? ''));
    h.update('|');
  }
  return h.digest('hex');
}

export function buildReviewerPromptMeta(input: {
  version?: number | null;
  systemPrompt?: string | null;
}): PromptVersionMeta {
  const version = input.version ?? null;
  const body = input.systemPrompt || '';
  return {
    reviewer_prompt_version: version,
    reviewer_prompt_hash: hashPromptParts('reviewer_system', `v${version ?? 0}`, body),
    reviewer_engine: REVIEWER_ENGINE_VERSION,
  };
}

export function buildRevisionPromptMeta(): PromptVersionMeta {
  return {
    revision_prompt_version: REVISION_PROMPT_VERSION,
    revision_prompt_hash: hashPromptParts('revision', REVISION_PROMPT_VERSION, REVISION_ENGINE_VERSION),
    revision_engine: REVISION_ENGINE_VERSION,
  };
}

export function buildSeoPromptMeta(input: {
  version?: number | null;
  body?: string | null;
}): PromptVersionMeta {
  const version = input.version ?? null;
  return {
    seo_prompt_version: version,
    seo_prompt_hash: hashPromptParts('seo_system', `v${version ?? 0}`, input.body || ''),
    seo_engine: SEO_ENGINE_VERSION,
  };
}

export function buildWriterPromptMeta(input: {
  version?: number | null;
  hash?: string | null;
}): PromptVersionMeta {
  return {
    writer_prompt_version: input.version ?? null,
    writer_prompt_hash: input.hash ?? null,
    writer_engine: WRITER_ENGINE_VERSION,
  };
}

export function buildResearchPromptMeta(input: {
  version?: number | string | null;
  hash?: string | null;
}): PromptVersionMeta {
  return {
    research_prompt_version: input.version ?? 'research-pack-v1',
    research_prompt_hash: input.hash ?? hashPromptParts('research', input.version ?? 'v1'),
  };
}
