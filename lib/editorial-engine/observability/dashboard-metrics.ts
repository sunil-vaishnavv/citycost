/**
 * Aggregated observability metrics for the Editorial Dashboard.
 * Heavy aggregates are parallelized and cached briefly so the main
 * dashboard never blocks on a cold/slow metrics pass.
 */

import type { RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import { getRevisionStats } from '../revision/revision-history.js';
import { getAiUsageSummary } from '../db/ai-settings-repo.js';

export interface ObservabilityDashboardMetrics {
  avg_confidence: number;
  avg_ai_cost_usd: number;
  revision_success_rate: number;
  manual_review_rate: number;
  avg_quality_score: number;
  avg_publish_time_hours: number | null;
  daily_quality: Array<{ day: string; avg_score: number; count: number }>;
  daily_cost: Array<{ day: string; cost_usd: number; requests: number }>;
  daily_confidence: Array<{ day: string; avg_confidence: number; count: number }>;
  provider_usage: Array<{
    provider: string;
    requests: number;
    cost_usd: number;
    avg_latency_ms: number;
    success_rate: number;
  }>;
}

const CACHE_TTL_MS = 45_000;

type CacheEntry = { at: number; days: number; value: ObservabilityDashboardMetrics };

let metricsCache: CacheEntry | null = null;
let inflight: Promise<ObservabilityDashboardMetrics> | null = null;

export function emptyObservabilityMetrics(): ObservabilityDashboardMetrics {
  return {
    avg_confidence: 0,
    avg_ai_cost_usd: 0,
    revision_success_rate: 0,
    manual_review_rate: 0,
    avg_quality_score: 0,
    avg_publish_time_hours: null,
    daily_quality: [],
    daily_cost: [],
    daily_confidence: [],
    provider_usage: [],
  };
}

export function peekObservabilityMetricsCache(
  days = 30
): ObservabilityDashboardMetrics | null {
  const since = Math.min(Math.max(days, 1), 90);
  if (!metricsCache || metricsCache.days !== since) return null;
  if (Date.now() - metricsCache.at > CACHE_TTL_MS) return null;
  return metricsCache.value;
}

async function computeObservabilityDashboardMetrics(
  days: number
): Promise<ObservabilityDashboardMetrics> {
  const empty = emptyObservabilityMetrics();
  if (!pool) return empty;

  const since = Math.min(Math.max(days, 1), 90);

  // Parallelize all independent aggregates. Avoid jsonb_exists (can be slow /
  // unavailable on some PG builds); key presence via ->> IS NOT NULL is enough.
  const [revision, usage, qualityRows, confRows, publishRows, dailyQuality, dailyConf, dailyCost] =
    await Promise.all([
      getRevisionStats(since),
      getAiUsageSummary(since),
      pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(AVG(score), 0) AS avg_score
         FROM editorial_quality_reports
         WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
        [since]
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(AVG( (findings_json->>'overall_confidence')::numeric ), 0) AS avg_conf
         FROM editorial_quality_reports
         WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
           AND findings_json->>'overall_confidence' IS NOT NULL`,
        [since]
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(
           AVG(EXTRACT(EPOCH FROM (published_at - created_at)) / 3600.0),
           NULL
         ) AS avg_hours
         FROM editorial_articles
         WHERE published_at IS NOT NULL
           AND published_at >= NOW() - ($1::int * INTERVAL '1 day')`,
        [since]
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                ROUND(AVG(score)::numeric, 1) AS avg_score,
                COUNT(*)::int AS count
         FROM editorial_quality_reports
         WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
         GROUP BY 1
         ORDER BY 1 ASC`,
        [since]
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                ROUND(AVG( (findings_json->>'overall_confidence')::numeric )::numeric, 1) AS avg_confidence,
                COUNT(*)::int AS count
         FROM editorial_quality_reports
         WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
           AND findings_json->>'overall_confidence' IS NOT NULL
         GROUP BY 1
         ORDER BY 1 ASC`,
        [since]
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
                COUNT(*)::int AS requests
         FROM editorial_ai_usage_logs
         WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
         GROUP BY 1
         ORDER BY 1 ASC`,
        [since]
      ),
    ]);

  const quality = qualityRows[0];
  const conf = confRows[0];
  const publish = publishRows[0];

  const revisionSuccess =
    revision.failure_rate != null
      ? Math.max(0, Math.round((100 - revision.failure_rate) * 10) / 10)
      : 0;

  return {
    avg_confidence: Math.round(Number(conf[0]?.avg_conf || 0) * 10) / 10,
    avg_ai_cost_usd: Math.round(Number(usage.avg_cost_usd || 0) * 1e6) / 1e6,
    revision_success_rate: revisionSuccess,
    manual_review_rate: revision.manual_review_rate,
    avg_quality_score: Math.round(Number(quality[0]?.avg_score || 0) * 10) / 10,
    avg_publish_time_hours:
      publish[0]?.avg_hours != null ? Math.round(Number(publish[0].avg_hours) * 10) / 10 : null,
    daily_quality: dailyQuality[0].map((r) => ({
      day: String(r.day),
      avg_score: Number(r.avg_score || 0),
      count: Number(r.count || 0),
    })),
    daily_cost: dailyCost[0].map((r) => ({
      day: String(r.day),
      cost_usd: Math.round(Number(r.cost_usd || 0) * 1e6) / 1e6,
      requests: Number(r.requests || 0),
    })),
    daily_confidence: dailyConf[0].map((r) => ({
      day: String(r.day),
      avg_confidence: Number(r.avg_confidence || 0),
      count: Number(r.count || 0),
    })),
    provider_usage: usage.by_provider.map((p) => ({
      provider: p.provider,
      requests: p.requests,
      cost_usd: Math.round(Number(p.cost_usd || 0) * 1e6) / 1e6,
      avg_latency_ms: Math.round(Number(p.avg_latency_ms || 0)),
      success_rate: p.requests > 0 ? Math.round((p.successes / p.requests) * 1000) / 10 : 0,
    })),
  };
}

/** Full compute + cache write (deduped when already in flight). */
export async function getObservabilityDashboardMetrics(
  days = 30
): Promise<ObservabilityDashboardMetrics> {
  const since = Math.min(Math.max(days, 1), 90);
  const hit = peekObservabilityMetricsCache(since);
  if (hit) return hit;

  if (!inflight) {
    inflight = computeObservabilityDashboardMetrics(since)
      .then((value) => {
        metricsCache = { at: Date.now(), days: since, value };
        return value;
      })
      .catch((err) => {
        console.warn('[editorial] observability metrics failed:', (err as Error)?.message || err);
        return emptyObservabilityMetrics();
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

/**
 * For the main dashboard: never start heavy aggregates here.
 * Return warm cache only so core count cards are not competing with heavy aggregates
 * observability queries. UI loads `/dashboard/observability` progressively.
 */
export async function getObservabilityDashboardMetricsFast(
  days = 30
): Promise<ObservabilityDashboardMetrics | undefined> {
  return peekObservabilityMetricsCache(days) ?? undefined;
}
