/**
 * Offline Strategy Engine validation — no Writer, no DB required for candidate build/score.
 * Usage: npx tsx scripts/strategy-validate-report.ts
 */
import { DEFAULT_STRATEGY_WEIGHTS } from '../lib/editorial-engine/constants.js';
import { buildTopicCandidates } from '../lib/editorial-engine/strategy/topic-candidates.js';
import { scoreTopicCandidate, setPublishedTopicIndex } from '../lib/editorial-engine/strategy/topic-scorer.js';

setPublishedTopicIndex([], []);

const candidates = buildTopicCandidates(500, 40);
const accepted: Array<{
  title: string;
  content_type: string;
  country: string;
  score: number;
  intent: string;
  keyword: string;
  tier?: string;
  why: string;
}> = [];
let rejected = 0;

for (const c of candidates) {
  const result = scoreTopicCandidate(c, DEFAULT_STRATEGY_WEIGHTS);
  if (result.rejected) {
    rejected += 1;
    continue;
  }
  const refs = c.source_refs;
  accepted.push({
    title: c.title,
    content_type: c.content_type,
    country: typeof refs.country === 'string' ? refs.country : 'global',
    score: result.priority_score,
    intent: typeof refs.intent === 'string' ? refs.intent : '',
    keyword: typeof refs.primary_keyword === 'string' ? refs.primary_keyword : '',
    tier: typeof refs.comparison_tier === 'string' ? refs.comparison_tier : undefined,
    why: result.rationale.slice(0, 2).join(' | '),
  });
}

accepted.sort((a, b) => b.score - a.score);

const byType: Record<string, number> = {};
const byCountry: Record<string, number> = {};
for (const t of accepted) {
  byType[t.content_type] = (byType[t.content_type] || 0) + 1;
  byCountry[t.country] = (byCountry[t.country] || 0) + 1;
}

const scores = accepted.map((t) => t.score);
const uniqueScores = new Set(scores.map((s) => s.toFixed(1)));
const junk = accepted.filter((t) =>
  /djibouti|doha|bamako|chennai vs berlin|berlin vs doha|berlin vs dubai/i.test(t.title)
);

console.log(JSON.stringify({
  candidates: candidates.length,
  accepted: accepted.length,
  rejected,
  unique_score_count: uniqueScores.size,
  score_min: scores.length ? Math.min(...scores) : null,
  score_max: scores.length ? Math.max(...scores) : null,
  junk_accepted: junk.map((t) => t.title),
  distribution_by_type: byType,
  distribution_by_country: Object.fromEntries(
    Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 25)
  ),
  top_30: accepted.slice(0, 30).map((t) => ({
    title: t.title,
    score: t.score,
    type: t.content_type,
    country: t.country,
    keyword: t.keyword,
  })),
  highest: accepted.slice(0, 10),
  lowest: [...accepted].sort((a, b) => a.score - b.score).slice(0, 10),
}, null, 2));
