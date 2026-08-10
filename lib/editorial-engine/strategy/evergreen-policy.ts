/**
 * Evergreen Content Policy — reject news/politics/clickbait topics.
 */

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bbreaking\s+news\b/i,
  /\bjust\s+in\b/i,
  /\blive\s+updates?\b/i,
  /\bpolitics?\b/i,
  /\belection\b/i,
  /\bcelebrity\b/i,
  /\bgossip\b/i,
  /\bentertainment\b/i,
  /\btrending\s+now\b/i,
  /\bcurrent\s+events?\b/i,
  /\bclickbait\b/i,
  /\byou\s+won'?t\s+believe\b/i,
  /\bshocking\b/i,
  /\bviral\b/i,
  /\btoday'?s\s+news\b/i,
  /\bwar\s+update\b/i,
  /\bstock\s+market\s+today\b/i,
];

const ALLOWED_THEME_HINTS: RegExp[] = [
  /cost of living/i,
  /relocation|moving to|expat/i,
  /student/i,
  /family|families/i,
  /digital nomad|remote work/i,
  /retirement/i,
  /country guide|city guide/i,
  /comparison|vs\b/i,
  /\bvisa\b|healthcare|transport|grocer|rent|tax|salary|budget|residence/i,
  /cheapest|most expensive/i,
];

export function evergreenPolicyCheck(title: string): {
  allowed: boolean;
  reason?: string;
} {
  const t = title.trim();
  if (!t) return { allowed: false, reason: 'Empty title' };

  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(t)) {
      return { allowed: false, reason: `Forbidden evergreen policy match: ${re.source}` };
    }
  }

  const hasTheme = ALLOWED_THEME_HINTS.some((re) => re.test(t));
  if (!hasTheme) {
    return {
      allowed: false,
      reason: 'Topic does not match allowed evergreen themes',
    };
  }

  return { allowed: true };
}
