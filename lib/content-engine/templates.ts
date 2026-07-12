/**
 * Deterministic template helpers — compose prose from facts only.
 */

export function fmtMoney(symbol: string, n: number | null | undefined, currency: string): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${symbol}${Math.round(n).toLocaleString()} ${currency}`;
}

export function fmtNum(n: number | null | undefined, digits = 1): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Number(n).toFixed(digits);
}

export function locLabel(city: string, state: string | null, country: string): string {
  return [city, state, country].filter(Boolean).join(', ');
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function blockWords(paragraphs: string[], bullets?: string[]): number {
  return wordCount([...paragraphs, ...(bullets || [])].join(' '));
}

/** Pick a variant using a stable seed so pages stay unique without randomness. */
export function pickVariant(seed: string, variants: string[]): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return variants[(h >>> 0) % variants.length];
}

export function joinAvailable(parts: Array<string | null | undefined>, sep = ' '): string {
  return parts.filter((p) => p && String(p).trim()).join(sep);
}
