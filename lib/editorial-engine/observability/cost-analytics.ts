/**
 * Per-article AI cost + provider analytics from usage logs + generation logs.
 */

import type { ResultSetHeader, RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';

export interface StageCostBucket {
  stage: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  estimated_cost_usd: number;
  avg_latency_ms: number;
  failures: number;
}

export interface ProviderArticleStats {
  provider: string;
  calls: number;
  failures: number;
  fallbacks: number;
  avg_latency_ms: number;
  success_rate: number;
  estimated_cost_usd: number;
}

export interface ArticleCostAnalytics {
  article_id: number;
  total_cost_usd: number;
  total_calls: number;
  total_failures: number;
  total_tokens_in: number;
  total_tokens_out: number;
  by_stage: StageCostBucket[];
  by_provider: ProviderArticleStats[];
}

function normalizeStage(stage: string | null | undefined): string {
  const s = (stage || 'other').toLowerCase();
  if (s.startsWith('writer')) return 'generation';
  if (s.startsWith('reviewer')) return 'review';
  if (s.startsWith('seo')) return 'seo';
  if (s.startsWith('revision')) return 'revision';
  return s;
}

export async function getArticleCostAnalytics(articleId: number): Promise<ArticleCostAnalytics> {
  const empty: ArticleCostAnalytics = {
    article_id: articleId,
    total_cost_usd: 0,
    total_calls: 0,
    total_failures: 0,
    total_tokens_in: 0,
    total_tokens_out: 0,
    by_stage: [],
    by_provider: [],
  };
  if (!pool) return empty;

  // Prefer article_id column when present; also match meta_json.article_id
  const [usageRows] = await pool.execute<RowDataPacket[]>(
    `SELECT provider_name, stage, success, latency_ms, tokens_in, tokens_out,
            estimated_cost_usd, retry_count, meta_json
     FROM editorial_ai_usage_logs
     WHERE article_id = $1
        OR (meta_json->>'article_id') = $2
     ORDER BY id ASC`,
    [articleId, String(articleId)]
  ).catch(async () => {
    // Column may not exist yet — meta_json only
    return pool!.execute<RowDataPacket[]>(
      `SELECT provider_name, stage, success, latency_ms, tokens_in, tokens_out,
              estimated_cost_usd, retry_count, meta_json
       FROM editorial_ai_usage_logs
       WHERE (meta_json->>'article_id') = $1
       ORDER BY id ASC`,
      [String(articleId)]
    );
  });

  const [genRows] = await pool.execute<RowDataPacket[]>(
    `SELECT stage, tokens_in, tokens_out, latency_ms, success, meta_json, model_used
     FROM editorial_generation_logs
     WHERE article_id = $1
     ORDER BY id ASC`,
    [articleId]
  );

  const stageMap = new Map<string, StageCostBucket>();
  const providerMap = new Map<string, ProviderArticleStats & { successes: number }>();

  let total_cost = 0;
  let total_calls = 0;
  let total_failures = 0;
  let tokens_in = 0;
  let tokens_out = 0;

  for (const row of usageRows) {
    const stage = normalizeStage(row.stage != null ? String(row.stage) : null);
    const cost = Number(row.estimated_cost_usd || 0);
    const ok = Boolean(row.success);
    const tin = Number(row.tokens_in || 0);
    const tout = Number(row.tokens_out || 0);
    const lat = Number(row.latency_ms || 0);
    const provider = String(row.provider_name || 'unknown');
    const retries = Number(row.retry_count || 0);

    total_calls += 1;
    if (!ok) total_failures += 1;
    total_cost += cost;
    tokens_in += tin;
    tokens_out += tout;

    const sb = stageMap.get(stage) || {
      stage,
      calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      estimated_cost_usd: 0,
      avg_latency_ms: 0,
      failures: 0,
    };
    sb.calls += 1;
    sb.tokens_in += tin;
    sb.tokens_out += tout;
    sb.estimated_cost_usd += cost;
    sb.avg_latency_ms += lat;
    if (!ok) sb.failures += 1;
    stageMap.set(stage, sb);

    const pb = providerMap.get(provider) || {
      provider,
      calls: 0,
      failures: 0,
      fallbacks: 0,
      avg_latency_ms: 0,
      success_rate: 0,
      estimated_cost_usd: 0,
      successes: 0,
    };
    pb.calls += 1;
    pb.estimated_cost_usd += cost;
    pb.avg_latency_ms += lat;
    if (ok) pb.successes += 1;
    else pb.failures += 1;
    if (retries > 0) pb.fallbacks += 1;
    providerMap.set(provider, pb);
  }

  // Supplement stage totals from generation logs when usage logs lack article linkage
  if (!usageRows.length) {
    for (const row of genRows) {
      const stage = normalizeStage(row.stage != null ? String(row.stage) : null);
      const tin = Number(row.tokens_in || 0);
      const tout = Number(row.tokens_out || 0);
      const lat = Number(row.latency_ms || 0);
      const ok = row.success !== false;
      const meta =
        row.meta_json && typeof row.meta_json === 'object'
          ? (row.meta_json as Record<string, unknown>)
          : {};
      const cost = Number(meta.estimated_cost_usd || 0);
      total_calls += 1;
      if (!ok) total_failures += 1;
      total_cost += cost;
      tokens_in += tin;
      tokens_out += tout;
      const sb = stageMap.get(stage) || {
        stage,
        calls: 0,
        tokens_in: 0,
        tokens_out: 0,
        estimated_cost_usd: 0,
        avg_latency_ms: 0,
        failures: 0,
      };
      sb.calls += 1;
      sb.tokens_in += tin;
      sb.tokens_out += tout;
      sb.estimated_cost_usd += cost;
      sb.avg_latency_ms += lat;
      if (!ok) sb.failures += 1;
      stageMap.set(stage, sb);
    }
  }

  const by_stage = [...stageMap.values()].map((s) => ({
    ...s,
    avg_latency_ms: s.calls ? Math.round(s.avg_latency_ms / s.calls) : 0,
    estimated_cost_usd: Math.round(s.estimated_cost_usd * 1e6) / 1e6,
  }));

  const by_provider = [...providerMap.values()].map((p) => ({
    provider: p.provider,
    calls: p.calls,
    failures: p.failures,
    fallbacks: p.fallbacks,
    avg_latency_ms: p.calls ? Math.round(p.avg_latency_ms / p.calls) : 0,
    success_rate: p.calls ? Math.round((p.successes / p.calls) * 1000) / 10 : 0,
    estimated_cost_usd: Math.round(p.estimated_cost_usd * 1e6) / 1e6,
  }));

  return {
    article_id: articleId,
    total_cost_usd: Math.round(total_cost * 1e6) / 1e6,
    total_calls,
    total_failures,
    total_tokens_in: tokens_in,
    total_tokens_out: tokens_out,
    by_stage,
    by_provider,
  };
}

/** List recent AI usage rows for debug export */
export async function listArticleAiUsageLogs(articleId: number, limit = 100) {
  if (!pool) return [];
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, provider_name, model, stage, success, latency_ms, tokens_in, tokens_out,
              estimated_cost_usd, error_message, retry_count, meta_json, created_at
       FROM editorial_ai_usage_logs
       WHERE article_id = $1 OR (meta_json->>'article_id') = $2
       ORDER BY id DESC
       LIMIT $3`,
      [articleId, String(articleId), limit]
    );
    return rows;
  } catch {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, provider_name, model, stage, success, latency_ms, tokens_in, tokens_out,
              estimated_cost_usd, error_message, retry_count, meta_json, created_at
       FROM editorial_ai_usage_logs
       WHERE (meta_json->>'article_id') = $1
       ORDER BY id DESC
       LIMIT $2`,
      [String(articleId), limit]
    );
    return rows;
  }
}

export async function ensureAiUsageArticleIdColumn(): Promise<void> {
  if (!pool) return;
  try {
    await pool.execute<ResultSetHeader>(
      `ALTER TABLE editorial_ai_usage_logs
       ADD COLUMN IF NOT EXISTS article_id BIGINT NULL`
    );
    await pool.execute(
      `CREATE INDEX IF NOT EXISTS idx_ai_usage_article
       ON editorial_ai_usage_logs (article_id, created_at DESC)`
    );
  } catch {
    /* best-effort additive */
  }
}
