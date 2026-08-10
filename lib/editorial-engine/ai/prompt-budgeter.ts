/**
 * Prompt Budgeter — estimate tokens and split oversized prompts
 * before any provider request.
 */

import type { AiGenerateInput } from './types.js';

/** ~4 chars/token heuristic (safe overestimate for budgeting). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface BudgetPlan {
  ok: boolean;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotal: number;
  chunks: AiGenerateInput[];
  trimmed: boolean;
  reason?: string;
}

export function planRequest(
  input: AiGenerateInput,
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    contextWindow: number;
    tpmLimit?: number | null;
  }
): BudgetPlan {
  const systemTok = estimateTokens(input.system);
  const userTok = estimateTokens(input.user);
  const estimatedInputTokens = systemTok + userTok + 24;
  const estimatedOutputTokens = Math.min(input.maxTokens, limits.maxOutputTokens);
  const contextCap = Math.max(1024, limits.contextWindow - estimatedOutputTokens - 256);
  const inputCap = Math.min(limits.maxInputTokens, contextCap);
  const tpmCap = limits.tpmLimit && limits.tpmLimit > 0 ? limits.tpmLimit : Infinity;
  const estimatedTotal = estimatedInputTokens + estimatedOutputTokens;

  if (estimatedTotal > tpmCap) {
    // Split user into chunks that fit under TPM with headroom
    return splitUser(input, {
      maxUserTokens: Math.max(512, Math.floor(tpmCap * 0.55) - systemTok),
      maxOutput: Math.min(estimatedOutputTokens, Math.floor(tpmCap * 0.35)),
      systemTok,
    });
  }

  if (estimatedInputTokens <= inputCap) {
    return {
      ok: true,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedTotal,
      chunks: [
        {
          ...input,
          maxTokens: estimatedOutputTokens,
        },
      ],
      trimmed: false,
    };
  }

  return splitUser(input, {
    maxUserTokens: Math.max(512, inputCap - systemTok - 64),
    maxOutput: estimatedOutputTokens,
    systemTok,
  });
}

function splitUser(
  input: AiGenerateInput,
  opts: { maxUserTokens: number; maxOutput: number; systemTok: number }
): BudgetPlan {
  const maxChars = Math.max(800, opts.maxUserTokens * 4);
  const parts: string[] = [];
  let rest = input.user;
  while (rest.length > 0) {
    if (rest.length <= maxChars) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }

  const chunks = parts.map((user, i) => ({
    ...input,
    user:
      parts.length > 1
        ? `[Part ${i + 1}/${parts.length}]\n${user}\n\nContinue JSON/output consistently.`
        : user,
    maxTokens: opts.maxOutput,
  }));

  const estimatedInputTokens =
    opts.systemTok * chunks.length + parts.reduce((s, p) => s + estimateTokens(p), 0);
  return {
    ok: true,
    estimatedInputTokens,
    estimatedOutputTokens: opts.maxOutput * chunks.length,
    estimatedTotal: estimatedInputTokens + opts.maxOutput * chunks.length,
    chunks,
    trimmed: parts.length > 1,
    reason: parts.length > 1 ? 'split_for_budget' : undefined,
  };
}

export function mergeChunkTexts(texts: string[]): string {
  if (texts.length === 1) return texts[0] || '';
  // Prefer last non-empty JSON-looking chunk; else concatenate
  const jsonish = [...texts].reverse().find((t) => /^\s*\{/.test(t));
  if (jsonish) return jsonish;
  return texts.filter(Boolean).join('\n\n');
}
