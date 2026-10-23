/**
 * Safe writer failure messages for API/UI — full stack stays server-side only.
 */

import type { DraftJobStage } from '../jobs/draft-job-types.js';
import type { WriterV2Result } from './v2/types.js';

const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /password/i,
  /postgresql:\/\//i,
  /postgres:\/\//i,
];

/** Strip secrets and trim overly long messages for client exposure. */
export function sanitizeWriterErrorMessage(message: string, maxLen = 480): string {
  let out = String(message || 'Unknown writer error').replace(/\s+/g, ' ').trim();
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[redacted]');
  }
  // Drop filesystem stack paths — keep the trailing reason when present.
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(out)) {
    const mod = out.match(/Cannot find module '([^']+)'/i)?.[1];
    if (mod) {
      const leaf = mod.split(/[/\\]/).slice(-3).join('/');
      out = `Module load failed: ${leaf}`;
    } else {
      out = 'Module load failed during draft generation';
    }
  }
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1)}…`;
  return out;
}

export type WriterErrorCategory =
  | 'cancelled'
  | 'module_error'
  | 'word_count'
  | 'quality_gate'
  | 'ai_limit'
  | 'config'
  | 'writer_error';

export function categorizeWriterError(message: string): WriterErrorCategory {
  const m = message.toLowerCase();
  if (/cancelled by user|aborterror/.test(m)) return 'cancelled';
  if (/cannot find module|err_module_not_found|module load failed/.test(m)) return 'module_error';
  if (/word_count|below minimum|below target/.test(m)) return 'word_count';
  if (/quality gate|content_quality:|helpfulness:|quality_gates:/.test(m)) return 'quality_gate';
  if (/rate_limit|tokens per day|tpd|tpm|too large|request too large/.test(m)) return 'ai_limit';
  if (/api_key|not configured|missing.*key/.test(m)) return 'config';
  return 'writer_error';
}

export function resolveWriterV2Failure(v2: Pick<WriterV2Result, 'message' | 'errors'>): {
  message: string;
  errors: string[];
  error_category: WriterErrorCategory;
} {
  const raw = (v2.errors?.[0] || v2.message || 'Writer v2 failed').trim();
  const message = sanitizeWriterErrorMessage(raw);
  const errors = v2.errors?.length
    ? v2.errors.map((e) => sanitizeWriterErrorMessage(e))
    : [message];
  return {
    message,
    errors,
    error_category: categorizeWriterError(message),
  };
}

export function formatGenerateFailureMessage(
  baseMessage: string,
  opts?: { failed_stage?: DraftJobStage | string; error_category?: WriterErrorCategory }
): string {
  const msg = sanitizeWriterErrorMessage(baseMessage);
  if (/^Writer (v2|failed|engine)/i.test(msg)) return msg;
  const stage = opts?.failed_stage ? String(opts.failed_stage).replace(/_/g, ' ') : '';
  if (stage && opts?.error_category && opts.error_category !== 'writer_error') {
    return `Writer failed at ${stage}: ${msg}`;
  }
  if (stage) return `Writer failed at ${stage}: ${msg}`;
  return `Writer failed: ${msg}`;
}
