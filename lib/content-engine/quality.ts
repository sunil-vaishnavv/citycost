/**
 * Internal content quality scoring — never expose in public payloads.
 */

import type { ContentBlock, ContentQualityInternal, FaqItem } from './types.js';

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}

export function scoreContentDocument(opts: {
  blocks: ContentBlock[];
  faqs: FaqItem[];
  word_count: number;
  fact_fields_present: number;
  fact_fields_possible: number;
  target_min_words: number;
  target_max_words: number;
  generated_at: string;
}): ContentQualityInternal {
  const text = [
    ...opts.blocks.flatMap((b) => [...b.paragraphs, ...(b.bullets || [])]),
    ...opts.faqs.map((f) => `${f.q} ${f.a}`),
  ].join(' ');

  const tokens = tokenize(text);
  const uniq = new Set(tokens);
  const uniqueness = clamp(tokens.length ? (uniq.size / tokens.length) * 100 * 0.7 + 25 : 40);

  const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
  const avgLen = tokens.length / sentences;
  let readability = 82;
  if (avgLen < 8) readability -= 8;
  if (avgLen > 28) readability -= 10;
  if (opts.word_count < opts.target_min_words * 0.5) readability -= 15;
  if (opts.word_count >= opts.target_min_words) readability += 5;
  readability = clamp(readability);

  const fact_coverage = clamp((opts.fact_fields_present / Math.max(1, opts.fact_fields_possible)) * 100);

  const content = clamp(
    40 +
      Math.min(35, opts.word_count / 40) +
      fact_coverage * 0.15 +
      (opts.blocks.length >= 6 ? 10 : 0) +
      (opts.faqs.length >= 5 ? 5 : 0)
  );

  const seo = clamp(content * 0.35 + uniqueness * 0.3 + fact_coverage * 0.2 + readability * 0.15);

  const duplicate_risk = clamp(100 - uniqueness + (opts.word_count < 200 ? 20 : 0));

  const ageDays = Math.max(0, (Date.now() - Date.parse(opts.generated_at)) / 86_400_000);
  const freshness = clamp(100 - ageDays * 2);

  return {
    content_score: content,
    seo_score: seo,
    readability_score: readability,
    uniqueness_score: uniqueness,
    duplicate_risk,
    fact_coverage,
    freshness_score: freshness,
  };
}

export function stripQuality<T extends object>(doc: T & { quality?: unknown }): T {
  const { quality: _q, ...rest } = doc as T & { quality?: unknown };
  return rest as T;
}
