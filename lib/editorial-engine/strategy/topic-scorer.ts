import { SCORER_VERSION } from '../constants.js';
import type { StrategyWeights, TopicCandidate, TopicScoreResult } from '../types.js';
import { evergreenPolicyCheck } from './evergreen-policy.js';

const publishedHashes = new Set<string>();
const publishedTitleNorms = new Set<string>();

/** Inject published topic hashes/titles for duplicate penalties (from DB). */
export function setPublishedTopicIndex(hashes: string[], titles: string[]): void {
  publishedHashes.clear();
  publishedTitleNorms.clear();
  for (const h of hashes) publishedHashes.add(h);
  for (const t of titles) publishedTitleNorms.add(normalizeTitle(t));
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function num(refs: Record<string, unknown>, key: string, fallback = 0): number {
  const v = refs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(refs: Record<string, unknown>, key: string): string | null {
  const v = refs[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

function buildResult(
  priority_score: number,
  factors: Record<string, number>,
  rationale: string[],
  weights: StrategyWeights,
  rejected: boolean,
  reject_reason?: string
): TopicScoreResult {
  return {
    priority_score,
    factors,
    rationale,
    rejected,
    reject_reason,
    breakdown: {
      factors: { ...factors },
      rationale: [...rationale],
      weights_applied: { ...weights },
      rejected,
      reject_reason,
      computed_at: new Date().toISOString(),
      scorer_version: SCORER_VERSION,
    },
  };
}

/**
 * Multi-factor 0–100 scorer. Factors are topic-specific so scores diverge naturally
 * (no more flat ~68 for every comparison).
 */
export function scoreTopicCandidate(
  candidate: TopicCandidate,
  weights: StrategyWeights
): TopicScoreResult {
  const w = weights;
  const factors: Record<string, number> = {};
  const rationale: string[] = [];
  const refs = candidate.source_refs;

  const evergreen = evergreenPolicyCheck(candidate.title);
  if (!evergreen.allowed) {
    return buildResult(
      0,
      { evergreen_reject: 0 },
      [evergreen.reason || 'Evergreen policy rejected'],
      w,
      true,
      evergreen.reason
    );
  }

  const tier = str(refs, 'comparison_tier');
  if (tier === 'rejected') {
    return buildResult(
      12,
      { comparison_policy: 0 },
      ['Rejected by comparison policy'],
      w,
      true,
      'Unrealistic comparison'
    );
  }

  // ── Factor 0–100 signals (topic-specific) ───────────────────────────────
  const searchDemand = clamp(
    num(refs, 'estimated_search_value', 40) +
      (refs.seasonal_hint ? 4 : 0) +
      (tier === 'migration_corridor' ? 6 : 0) +
      (tier === 'same_country' ? 4 : 0)
  );

  const difficulty = clamp(num(refs, 'difficulty', 50));
  const competition = difficulty; // proxy: higher difficulty = more SERP competition
  const competitionOpportunity = clamp(100 - competition);

  const geo = clamp(num(refs, 'geo_priority', 40));
  const eligA = num(refs, 'eligibility_a', 0);
  const eligB = num(refs, 'eligibility_b', 0);
  const cityElig = num(refs, 'city_eligibility', 0);

  let authorityOpportunity = 45;
  if (candidate.content_type === 'country_guide') {
    authorityOpportunity = clamp(88 + geo * 0.1);
    rationale.push('Country pillar — high topical authority opportunity');
  } else if (candidate.content_type === 'city_guide') {
    authorityOpportunity = clamp(52 + cityElig * 0.32 + (refs.parent_topic ? 8 : 0));
    rationale.push('City spoke under country cluster');
  } else if (candidate.content_type === 'comparison_guide') {
    const avgElig = eligA && eligB ? (eligA + eligB) / 2 : searchDemand;
    authorityOpportunity = clamp(
      36 +
        avgElig * 0.32 +
        (tier === 'same_country' ? 14 : 0) +
        (tier === 'migration_corridor' ? 12 : 0) +
        (tier === 'major_international' ? 6 : 0)
    );
    rationale.push(`Comparison tier: ${tier || 'unknown'}`);
  } else if (
    [
      'salary_guide',
      'rent_guide',
      'tax_guide',
      'food_guide',
      'transportation_guide',
      'healthcare_guide',
      'visa_guide',
      'moving_guide',
      'budget_guide',
    ].includes(candidate.content_type)
  ) {
    authorityOpportunity = clamp(52 + geo * 0.25 + (refs.parent_topic ? 10 : 0));
    rationale.push(`Supporting ${str(refs, 'guide_kind') || 'guide'} spoke`);
  } else if (
    ['student_guide', 'remote_worker_guide', 'retirement_guide'].includes(candidate.content_type)
  ) {
    authorityOpportunity = clamp(58 + geo * 0.18);
    rationale.push('Persona guide — expands audience coverage');
  }

  const linkCount = Array.isArray(refs.internal_link_opportunities)
    ? refs.internal_link_opportunities.length
    : 0;
  const internalLinking = clamp(
    30 +
      linkCount * 10 +
      (refs.comparison_slug ? 12 : 0) +
      (refs.city_slug || refs.country_slug ? 8 : 0) +
      (refs.parent_topic ? 6 : 0)
  );

  const freshness = clamp(
    50 +
      (refs.seasonal_hint ? 22 : 0) +
      (candidate.content_type === 'budget_guide' || candidate.content_type === 'moving_guide'
        ? 10
        : 0)
  );

  const intent = str(refs, 'intent') || 'informational';
  let commercialIntent = 40;
  if (intent === 'commercial_investigation') commercialIntent = 82;
  else if (
    ['salary_guide', 'rent_guide', 'visa_guide', 'moving_guide', 'comparison_guide'].includes(
      candidate.content_type
    )
  ) {
    commercialIntent = 74;
  } else if (candidate.content_type === 'country_guide' || candidate.content_type === 'city_guide') {
    commercialIntent = 58;
  }

  // Coverage gap: higher when we have a parent cluster but missing spokes (heuristic)
  let coverageGap = 50;
  if (refs.parent_topic && !publishedHashes.has(candidate.topic_hash)) {
    coverageGap = clamp(62 + (candidate.content_type === 'country_guide' ? 8 : 12));
  }
  if (candidate.content_type === 'country_guide') coverageGap = clamp(70 + geo * 0.2);
  if (tier === 'same_country') coverageGap = clamp(coverageGap + 8);

  // Existing content: catalog page exists helps link graph; published article hurts
  let existingContent = 50;
  if (refs.href || refs.comparison_slug || refs.city_slug || refs.country_slug) {
    existingContent = 72;
    rationale.push('Catalog page exists for internal linking');
  }
  if (publishedHashes.has(candidate.topic_hash)) {
    existingContent = 8;
    rationale.push('Already published — deprioritize');
  }

  const geographicPriority = clamp(
    geo * 0.55 +
      (refs.country_slug ? 20 : 10) +
      (tier === 'same_country' ? 15 : 0) +
      (cityElig ? cityElig * 0.2 : 0) +
      ((eligA + eligB) / 2) * 0.15
  );

  factors.search_demand = Math.round(searchDemand * 10) / 10;
  factors.competition = Math.round(competition * 10) / 10;
  factors.competition_opportunity = Math.round(competitionOpportunity * 10) / 10;
  factors.authority_opportunity = Math.round(authorityOpportunity * 10) / 10;
  factors.internal_linking = Math.round(internalLinking * 10) / 10;
  factors.freshness = Math.round(freshness * 10) / 10;
  factors.commercial_intent = Math.round(commercialIntent * 10) / 10;
  factors.coverage_gap = Math.round(coverageGap * 10) / 10;
  factors.existing_content = Math.round(existingContent * 10) / 10;
  factors.geographic_priority = Math.round(geographicPriority * 10) / 10;

  rationale.push(`Search demand ${factors.search_demand}`);
  rationale.push(`Competition ${factors.competition} (opportunity ${factors.competition_opportunity})`);
  rationale.push(`Authority opportunity ${factors.authority_opportunity}`);
  rationale.push(`Internal linking ${factors.internal_linking}`);
  rationale.push(`Geographic priority ${factors.geographic_priority}`);

  // Weighted blend → 0–100 (weights are relative max points)
  const wSearch = w.search_demand ?? w.search_opportunity ?? 18;
  const wComp = w.competition ?? 12;
  const wAuth = w.authority_opportunity ?? w.topical_authority ?? 14;
  const wLink = w.internal_linking ?? 12;
  const wFresh = w.freshness ?? w.seasonal_opportunity ?? 6;
  const wComm = w.commercial_intent ?? 10;
  const wGap = w.coverage_gap ?? 10;
  const wExist = w.existing_content ?? 8;
  const wGeo = w.geographic_priority ?? 10;

  const weightSum =
    wSearch + wComp + wAuth + wLink + wFresh + wComm + wGap + wExist + wGeo || 1;

  let score =
    (searchDemand / 100) * wSearch +
    (competitionOpportunity / 100) * wComp +
    (authorityOpportunity / 100) * wAuth +
    (internalLinking / 100) * wLink +
    (freshness / 100) * wFresh +
    (commercialIntent / 100) * wComm +
    (coverageGap / 100) * wGap +
    (existingContent / 100) * wExist +
    (geographicPriority / 100) * wGeo;

  // Normalize to 0–100 using weight sum as full scale
  score = (score / weightSum) * 100;

  // Duplicate / near-duplicate hard penalties
  if (publishedHashes.has(candidate.topic_hash)) {
    factors.already_published = w.already_published ?? -40;
    score += factors.already_published * 0.35;
    rationale.push('Already published hash penalty');
  }

  let nearDup = 0;
  const norm = normalizeTitle(candidate.title);
  if (publishedTitleNorms.has(norm)) {
    nearDup = 1;
  } else {
    for (const t of publishedTitleNorms) {
      if (titleSimilarity(candidate.title, t) >= 0.85) {
        nearDup = 1;
        break;
      }
    }
  }
  if (nearDup) {
    factors.near_duplicate = w.near_duplicate ?? -35;
    score += factors.near_duplicate * 0.4;
    rationale.push('Near-duplicate of published topic');
  }

  // Tiny deterministic uniqueness salt from hash (0–2.9) so identical stacks still diverge slightly
  const salt =
    parseInt(candidate.topic_hash.slice(0, 4), 16) % 30;
  score = score + salt / 10;

  score = clamp(Math.round(score * 10) / 10);

  factors.final_score = score;

  // Reject weak / junk topics
  const minAccept = typeof w.min_accept_score === 'number' ? w.min_accept_score : 35;
  if (score < minAccept) {
    return buildResult(score, factors, rationale, w, true, `Score ${score} below minimum ${minAccept}`);
  }
  if (nearDup || publishedHashes.has(candidate.topic_hash)) {
    return buildResult(score, factors, rationale, w, true, 'Duplicate or already published');
  }
  if (candidate.content_type === 'comparison_guide' && !tier) {
    // Legacy comparison without tier — require strong demand signal
    if (searchDemand < 55) {
      return buildResult(
        score,
        factors,
        rationale,
        w,
        true,
        'Legacy comparison lacks demand / tier evidence'
      );
    }
  }

  const seoReason = str(refs, 'seo_reason');
  if (seoReason) rationale.push(seoReason);

  return buildResult(score, factors, rationale, w, false);
}
