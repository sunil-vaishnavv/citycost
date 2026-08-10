import { listIndexableCities } from '../../seo-catalog.js';
import {
  insertTopicScore,
  listPublishedTopicSignals,
  listTopics,
  setTopicStatus,
  upsertScoredTopic,
} from '../db/topics-repo.js';
import { getStrategySettings } from '../db/strategy-settings-repo.js';
import { detectContentGaps } from './content-gaps.js';
import {
  ensureClusterRegistry,
  getClusterBySlug,
} from './cluster-registry.js';
import { buildTopicCandidates, isWeakComparisonRefs } from './topic-candidates.js';
import { scoreTopicCandidate, setPublishedTopicIndex } from './topic-scorer.js';

/** Hard cap so a misconfigured setting cannot flood the queue again. */
const MAX_TOPICS_PER_RUN = 2;
const CANDIDATE_POOL_MULTIPLIER = 80;
const CANDIDATE_POOL_MIN = 120;

export interface StrategyRunResult {
  ok: boolean;
  candidates_considered: number;
  topics_upserted: number;
  topics_rejected: number;
  topics_skipped: number;
  topics_pruned: number;
  content_gaps?: { scanned: number; gaps_upserted: number };
  clusters: { countries: number; clusters: number };
  distribution_by_type: Record<string, number>;
  distribution_by_country: Record<string, number>;
  top: Array<{ id: number; title: string; priority_score: number; content_type: string }>;
  bottom: Array<{ id: number; title: string; priority_score: number; content_type: string; why: string }>;
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function pruneWeakLegacyComparisons(): Promise<number> {
  const cities = listIndexableCities();
  let pruned = 0;
  let offset = 0;
  const limit = 100;
  for (;;) {
    const { topics, total } = await listTopics({
      status: 'candidate',
      content_type: 'comparison_guide',
      limit,
      offset,
    });
    if (!topics.length) break;
    for (const topic of topics) {
      const refs = topic.source_refs_json || {};
      if (isWeakComparisonRefs(refs, cities)) {
        await setTopicStatus(topic.id, 'rejected');
        pruned += 1;
      }
    }
    offset += topics.length;
    if (offset >= total) break;
  }
  return pruned;
}

/**
 * Editorial Strategy Engine:
 * country clusters → gated comparisons → multi-factor score → persist novel topics only.
 * Each run inserts at most 2 unique, previously-unresearched topics.
 * No AI generation for titles — blog-style templates vary by topic seed.
 */
export async function runEditorialStrategy(opts?: {
  maxCandidates?: number;
  maxCountries?: number;
  detect_gaps?: boolean;
}): Promise<StrategyRunResult> {
  const strategy = await getStrategySettings();
  const requested =
    opts?.maxCandidates ?? strategy.options.max_candidates ?? MAX_TOPICS_PER_RUN;
  const maxNewTopics = Math.min(
    Math.max(Number.isFinite(requested) ? Math.floor(requested) : MAX_TOPICS_PER_RUN, 1),
    MAX_TOPICS_PER_RUN
  );
  const maxCountries = opts?.maxCountries ?? 40;

  const clusters = await ensureClusterRegistry(maxCountries);
  const researched = await listPublishedTopicSignals();
  setPublishedTopicIndex(researched.hashes, researched.titles);

  const knownHashes = new Set(researched.hashes);
  const knownTitles = new Set(researched.titles.map(normalizeTitleKey).filter(Boolean));

  const poolSize = Math.max(maxNewTopics * CANDIDATE_POOL_MULTIPLIER, CANDIDATE_POOL_MIN);
  const candidates = buildTopicCandidates(poolSize, maxCountries);

  let upserted = 0;
  let rejected = 0;
  let skipped = 0;
  const scored: Array<{
    id: number;
    title: string;
    priority_score: number;
    content_type: string;
    why: string;
    country: string;
  }> = [];
  const distribution_by_type: Record<string, number> = {};
  const distribution_by_country: Record<string, number> = {};
  const clusterCache = new Map<string, Awaited<ReturnType<typeof getClusterBySlug>>>();

  for (const candidate of candidates) {
    if (upserted >= maxNewTopics) break;

    const titleKey = normalizeTitleKey(candidate.title);
    if (knownHashes.has(candidate.topic_hash) || (titleKey && knownTitles.has(titleKey))) {
      skipped += 1;
      continue;
    }

    const result = scoreTopicCandidate(candidate, strategy.weights);
    let cluster = clusterCache.get(candidate.cluster_slug);
    if (cluster === undefined) {
      cluster = await getClusterBySlug(candidate.cluster_slug);
      clusterCache.set(candidate.cluster_slug, cluster);
    }
    const country =
      typeof candidate.source_refs.country === 'string'
        ? candidate.source_refs.country
        : typeof candidate.source_refs.country_slug === 'string'
          ? candidate.source_refs.country_slug
          : 'global';

    const enrichedRefs = {
      ...candidate.source_refs,
      unique_score: result.priority_score,
      score_factors: result.factors,
      rejected: result.rejected,
      reject_reason: result.reject_reason || null,
    };

    if (result.rejected) {
      rejected += 1;
      // Do not persist mass rejects — keeps the queue clean and avoids formulaic junk.
      continue;
    }

    const topicId = await upsertScoredTopic({
      title: candidate.title,
      cluster_id: cluster?.id ?? null,
      content_type: candidate.content_type,
      source_refs: enrichedRefs,
      priority_score: result.priority_score,
      topic_hash: candidate.topic_hash,
      rationale: result.rationale,
      status: 'candidate',
    });

    knownHashes.add(candidate.topic_hash);
    if (titleKey) knownTitles.add(titleKey);

    await insertTopicScore(topicId, result.factors, result.priority_score, result.breakdown);
    upserted += 1;
    distribution_by_type[candidate.content_type] =
      (distribution_by_type[candidate.content_type] || 0) + 1;
    distribution_by_country[country] = (distribution_by_country[country] || 0) + 1;
    scored.push({
      id: topicId,
      title: candidate.title,
      priority_score: result.priority_score,
      content_type: candidate.content_type,
      why: result.rationale[0] || '',
      country,
    });
  }

  const topics_pruned = await pruneWeakLegacyComparisons();

  scored.sort((a, b) => b.priority_score - a.priority_score);

  let content_gaps: { scanned: number; gaps_upserted: number } | undefined;
  // Gap scan is heavy; skip on the small 2-topic research runs unless explicitly requested.
  if (opts?.detect_gaps === true) {
    content_gaps = await detectContentGaps({ maxCountries });
  }

  const bottom = [...scored]
    .sort((a, b) => a.priority_score - b.priority_score)
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority_score: t.priority_score,
      content_type: t.content_type,
      why: t.why,
    }));

  return {
    ok: true,
    candidates_considered: candidates.length,
    topics_upserted: upserted,
    topics_rejected: rejected,
    topics_skipped: skipped,
    topics_pruned,
    content_gaps,
    clusters,
    distribution_by_type,
    distribution_by_country,
    top: scored.slice(0, 20).map(({ id, title, priority_score, content_type }) => ({
      id,
      title,
      priority_score,
      content_type,
    })),
    bottom,
  };
}
