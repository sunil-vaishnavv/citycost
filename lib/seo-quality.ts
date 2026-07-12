/**
 * Internal SEO quality metrics — never expose in public page APIs/HTML.
 */

export interface PageQualityInternal {
  seo_score: number;
  content_score: number;
  uniqueness_score: number;
  readability_score: number;
  index_quality: number;
  thin_content_flag: boolean;
  duplicate_risk: number;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Estimate uniqueness from content blob (token diversity + length). */
export function scoreUniqueness(slug: string, parts: string[]): number {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  const tokens = text.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const unique = new Set(tokens);
  const diversity = tokens.length ? (unique.size / tokens.length) * 100 : 0;
  const lengthBonus = Math.min(25, text.length / 80);
  const slugSalt = (hashSeed(slug) % 11);
  return clamp(diversity * 0.55 + lengthBonus + 35 + slugSalt * 0.4);
}

export function scoreReadability(parts: string[]): number {
  const text = parts.filter(Boolean).join(' ');
  const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
  const words = Math.max(1, text.split(/\s+/).length);
  const avg = words / sentences;
  // Prefer ~12–22 words/sentence
  let score = 85;
  if (avg < 8) score -= 10;
  if (avg > 28) score -= 12;
  if (avg > 35) score -= 10;
  if (words < 80) score -= 15;
  if (words > 200) score += 5;
  return clamp(score);
}

export function buildPageQuality(opts: {
  slug: string;
  eligibility: number;
  contentParts: string[];
  hasStructuredSections: boolean;
  duplicateRiskHint?: number;
}): PageQualityInternal {
  const uniqueness = scoreUniqueness(opts.slug, opts.contentParts);
  const readability = scoreReadability(opts.contentParts);
  const contentLen = opts.contentParts.join(' ').length;
  const content = clamp(
    (opts.hasStructuredSections ? 55 : 35) +
      Math.min(30, contentLen / 100) +
      uniqueness * 0.15
  );
  const seo = clamp(opts.eligibility * 0.45 + content * 0.3 + uniqueness * 0.25);
  const thin = content < 50 || contentLen < 280 || uniqueness < 45;
  const duplicate_risk = clamp(opts.duplicateRiskHint ?? (100 - uniqueness));
  const index_quality = clamp(seo * 0.35 + content * 0.3 + uniqueness * 0.2 + readability * 0.15);

  return {
    seo_score: seo,
    content_score: content,
    uniqueness_score: uniqueness,
    readability_score: readability,
    index_quality,
    thin_content_flag: thin,
    duplicate_risk,
  };
}

/** Running aggregates for verification reports (server memory). */
const aggregates = {
  n: 0,
  seo: 0,
  content: 0,
  uniqueness: 0,
  readability: 0,
  index_quality: 0,
  thin: 0,
};

export function recordQuality(q: PageQualityInternal) {
  aggregates.n += 1;
  aggregates.seo += q.seo_score;
  aggregates.content += q.content_score;
  aggregates.uniqueness += q.uniqueness_score;
  aggregates.readability += q.readability_score;
  aggregates.index_quality += q.index_quality;
  if (q.thin_content_flag) aggregates.thin += 1;
}

export function resetQualityAggregates() {
  aggregates.n = 0;
  aggregates.seo = 0;
  aggregates.content = 0;
  aggregates.uniqueness = 0;
  aggregates.readability = 0;
  aggregates.index_quality = 0;
  aggregates.thin = 0;
}

export function getQualityAggregates() {
  const n = Math.max(1, aggregates.n);
  return {
    samples: aggregates.n,
    average_seo_score: Math.round((aggregates.seo / n) * 10) / 10,
    average_content_score: Math.round((aggregates.content / n) * 10) / 10,
    average_uniqueness: Math.round((aggregates.uniqueness / n) * 10) / 10,
    average_readability: Math.round((aggregates.readability / n) * 10) / 10,
    average_index_quality: Math.round((aggregates.index_quality / n) * 10) / 10,
    thin_content_rate: Math.round((aggregates.thin / n) * 1000) / 10,
  };
}
