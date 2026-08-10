/**
 * Rough Groq on-demand cost estimates for admin debugging only.
 * Rates are approximate USD per 1M tokens — not billing-accurate.
 */

const RATE_TABLE: Array<{ match: RegExp; inPerM: number; outPerM: number }> = [
  { match: /llama-3\.3-70b|llama-3\.1-70b/i, inPerM: 0.59, outPerM: 0.79 },
  { match: /llama-3\.1-8b|instant/i, inPerM: 0.05, outPerM: 0.08 },
  { match: /gemma2/i, inPerM: 0.2, outPerM: 0.2 },
];

const DEFAULT = { inPerM: 0.5, outPerM: 0.8 };

export function estimateGroqCostUsd(input: {
  model?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
}): number | null {
  const tin = Number(input.tokens_in) || 0;
  const tout = Number(input.tokens_out) || 0;
  if (tin <= 0 && tout <= 0) return null;
  const rates =
    RATE_TABLE.find((r) => r.match.test(input.model || '')) || DEFAULT;
  return Math.round(((tin / 1e6) * rates.inPerM + (tout / 1e6) * rates.outPerM) * 1e6) / 1e6;
}

export function formatUsd(amount: number | null): string {
  if (amount == null) return '—';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(3)}`;
}
