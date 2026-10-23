import type { ResultSetHeader, RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import { decryptApiKey, encryptApiKey, maskApiKey } from '../ai/crypto-keys.js';
import { PROVIDER_DEFAULTS, getProviderDefaults } from '../ai/provider-config.js';
import type { AiProviderName, ProviderRuntimeConfig } from '../ai/types.js';
import type { ProviderModelMeta } from '../ai/model-catalog.js';
import {
  ensureProviderEnvSlots,
  isPlaceholderApiKey,
  normalizeProviderApiKey,
  syncProviderKeysFromEnvFile,
  writeProviderKeyToEnv,
} from '../secrets/provider-env.js';

function mapRow(row: RowDataPacket): ProviderRuntimeConfig & { id: number } {
  const name = String(row.provider_name) as AiProviderName;
  const encrypted = row.api_key_encrypted != null ? String(row.api_key_encrypted) : null;
  const decrypted = decryptApiKey(encrypted);
  return {
    id: Number(row.id),
    provider_name: name,
    enabled: Boolean(row.enabled),
    priority: Number(row.priority || 100),
    api_key: decrypted,
    api_key_masked: row.api_key_masked != null ? String(row.api_key_masked) : maskApiKey(decrypted),
    default_model: row.default_model != null ? String(row.default_model) : null,
    temperature: Number(row.temperature ?? 0.45),
    top_p: Number(row.top_p ?? 0.9),
    max_output_tokens: Number(row.max_output_tokens || 8192),
    max_input_tokens: Number(row.max_input_tokens || 32000),
    context_window: Number(row.context_window || 128000),
    rpm_limit: row.rpm_limit != null ? Number(row.rpm_limit) : null,
    tpm_limit: row.tpm_limit != null ? Number(row.tpm_limit) : null,
    daily_limit: row.daily_limit != null ? Number(row.daily_limit) : null,
    monthly_limit: row.monthly_limit != null ? Number(row.monthly_limit) : null,
    fallback_provider: row.fallback_provider
      ? (String(row.fallback_provider) as AiProviderName)
      : null,
    status: String(row.status || 'unknown'),
    last_tested_at: row.last_tested_at ? new Date(row.last_tested_at).toISOString() : null,
    last_used_at: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    last_error: row.last_error != null ? String(row.last_error) : null,
    avg_latency_ms: row.avg_latency_ms != null ? Number(row.avg_latency_ms) : null,
    avg_cost_usd: row.avg_cost_usd != null ? Number(row.avg_cost_usd) : null,
    meta: readModelMeta(row.meta_json),
  };
}

function readModelMeta(raw: unknown): ProviderModelMeta {
  let obj: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') obj = raw as Record<string, unknown>;
  else if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  const fallback = Array.isArray(obj.fallback_models)
    ? obj.fallback_models.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim())
    : [];
  const auto = obj.auto_model as ProviderModelMeta['auto_model'];
  return {
    fallback_models: fallback,
    auto_model_fallback: obj.auto_model_fallback !== false,
    auto_model: auto && typeof auto === 'object' && typeof auto.model === 'string' ? auto : null,
  };
}

/** Merge keys into meta_json (JSONB) without touching other meta. */
async function mergeProviderMeta(name: AiProviderName, patch: Record<string, unknown>): Promise<void> {
  if (!pool) return;
  await pool.execute(
    `UPDATE editorial_ai_settings
       SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
           updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE provider_name = $2`,
    [JSON.stringify(patch), name]
  );
}

/** Remember the model the router switched to after the configured one failed. */
export async function recordAutoModelSwitch(
  name: AiProviderName,
  info: { model: string; from: string | null; reason: string }
): Promise<void> {
  await mergeProviderMeta(name, {
    auto_model: { ...info, reason: info.reason.slice(0, 300), at: new Date().toISOString() },
  });
}

/**
 * Seed provider rows + two-way sync:
 *   `.env` (file) → process.env → editorial_ai_settings
 * Placeholders never count as real keys.
 */
export async function ensureAiProviderSettings(): Promise<void> {
  if (!pool) return;

  try {
    ensureProviderEnvSlots();
  } catch {
    /* .env may be read-only in some hosts */
  }
  const envKeys = syncProviderKeysFromEnvFile();

  for (const def of PROVIDER_DEFAULTS) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM editorial_ai_settings WHERE provider_name = $1 LIMIT 1`,
      [def.name]
    );
    const envKey = envKeys[def.name];
    const hasKey = Boolean(envKey);

    if (!rows[0]) {
      // Any provider with a real .env key is enabled for failover
      const enabled = hasKey;
      await pool.execute(
        `INSERT INTO editorial_ai_settings
          (provider_name, enabled, priority, api_key_encrypted, api_key_masked, default_model,
           temperature, top_p, max_output_tokens, max_input_tokens, context_window,
           rpm_limit, tpm_limit, daily_limit, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          def.name,
          enabled,
          def.priority,
          hasKey ? encryptApiKey(envKey!) : null,
          hasKey ? maskApiKey(envKey!) : null,
          def.default_model,
          def.temperature,
          def.top_p,
          def.max_output_tokens,
          def.max_input_tokens,
          def.context_window,
          def.rpm_limit,
          def.tpm_limit,
          def.daily_limit,
          hasKey ? 'ready' : 'unconfigured',
        ]
      );
      continue;
    }

    // Sync env → DB when env has a real key (env is source of truth for live edits)
    if (hasKey && envKey) {
      const current = await getAiProviderSetting(def.name);
      const dbKey = current?.api_key || null;
      const needsKeySync = dbKey !== envKey;
      const needsEnable = !current?.enabled;
      const needsModelBump =
        def.name === 'gemini' &&
        current?.default_model &&
        ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'].includes(
          current.default_model
        );

      if (needsKeySync || needsEnable || needsModelBump) {
        await pool.execute(
          `UPDATE editorial_ai_settings
           SET api_key_encrypted = $1,
               api_key_masked = $2,
               enabled = TRUE,
               status = 'ready',
               default_model = CASE WHEN $4 THEN $5 ELSE default_model END,
               updated_at = (NOW() AT TIME ZONE 'UTC')
           WHERE provider_name = $3`,
          [
            encryptApiKey(envKey),
            maskApiKey(envKey),
            def.name,
            needsModelBump,
            def.default_model,
          ]
        );
      }
    } else {
      // Clear placeholder / fake keys previously stored in DB
      const current = await getAiProviderSetting(def.name);
      if (current?.api_key && isPlaceholderApiKey(current.api_key)) {
        await pool.execute(
          `UPDATE editorial_ai_settings
           SET api_key_encrypted = NULL, api_key_masked = NULL, status = 'unconfigured',
               updated_at = (NOW() AT TIME ZONE 'UTC')
           WHERE provider_name = $1`,
          [def.name]
        );
      }
    }
  }
}

export async function listAiProviderSettings(): Promise<
  Array<ProviderRuntimeConfig & { id: number; models: string[] }>
> {
  if (!pool) return [];
  await ensureAiProviderSettings();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM editorial_ai_settings ORDER BY priority ASC, id ASC`
  );
  return rows.map((r) => {
    const mapped = mapRow(r);
    const def = getProviderDefaults(mapped.provider_name);
    return { ...mapped, models: def.models };
  });
}

export async function getAiProviderSetting(
  name: AiProviderName
): Promise<(ProviderRuntimeConfig & { id: number }) | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM editorial_ai_settings WHERE provider_name = $1 LIMIT 1`,
    [name]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function patchAiProviderSetting(
  name: AiProviderName,
  patch: Record<string, unknown>
): Promise<ProviderRuntimeConfig & { id: number; models: string[] }> {
  if (!pool) throw new Error('Database unavailable');
  await ensureAiProviderSettings();
  const current = await getAiProviderSetting(name);
  if (!current) throw new Error(`Provider ${name} not found`);

  let apiKeyEncrypted = undefined as string | null | undefined;
  let apiKeyMasked = undefined as string | null | undefined;
  if (typeof patch.api_key === 'string' && patch.api_key.trim()) {
    const key = normalizeProviderApiKey(patch.api_key);
    if (!key) {
      throw new Error('API key looks like a placeholder — paste a real key');
    }
    apiKeyEncrypted = encryptApiKey(key);
    apiKeyMasked = maskApiKey(key);
    // Admin → .env + process.env (two-way sync)
    try {
      writeProviderKeyToEnv(name, key);
    } catch (err) {
      // Still save encrypted DB key if .env write fails (e.g. read-only FS)
      const varName = getProviderDefaults(name).env_key;
      if (varName) process.env[varName] = key;
      console.warn(
        `⚠️  Could not write ${varName} to .env:`,
        (err as Error).message
      );
    }
  }

  const enabled =
    typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled;
  const priority =
    typeof patch.priority === 'number' ? Math.floor(patch.priority) : current.priority;
  const default_model =
    typeof patch.default_model === 'string' ? patch.default_model : current.default_model;
  const temperature =
    typeof patch.temperature === 'number' ? patch.temperature : current.temperature;
  const top_p = typeof patch.top_p === 'number' ? patch.top_p : current.top_p;
  const max_output_tokens =
    typeof patch.max_output_tokens === 'number'
      ? Math.floor(patch.max_output_tokens)
      : current.max_output_tokens;
  const max_input_tokens =
    typeof patch.max_input_tokens === 'number'
      ? Math.floor(patch.max_input_tokens)
      : current.max_input_tokens;
  const context_window =
    typeof patch.context_window === 'number'
      ? Math.floor(patch.context_window)
      : current.context_window;
  const rpm_limit =
    patch.rpm_limit === null
      ? null
      : typeof patch.rpm_limit === 'number'
        ? Math.floor(patch.rpm_limit)
        : current.rpm_limit;
  const tpm_limit =
    patch.tpm_limit === null
      ? null
      : typeof patch.tpm_limit === 'number'
        ? Math.floor(patch.tpm_limit)
        : current.tpm_limit;
  const daily_limit =
    patch.daily_limit === null
      ? null
      : typeof patch.daily_limit === 'number'
        ? Math.floor(patch.daily_limit)
        : current.daily_limit;
  const monthly_limit =
    patch.monthly_limit === null
      ? null
      : typeof patch.monthly_limit === 'number'
        ? Math.floor(patch.monthly_limit)
        : current.monthly_limit;
  const fallback_provider =
    typeof patch.fallback_provider === 'string' || patch.fallback_provider === null
      ? (patch.fallback_provider as string | null)
      : current.fallback_provider;

  await pool.execute(
    `UPDATE editorial_ai_settings SET
       enabled = $1,
       priority = $2,
       default_model = $3,
       temperature = $4,
       top_p = $5,
       max_output_tokens = $6,
       max_input_tokens = $7,
       context_window = $8,
       rpm_limit = $9,
       tpm_limit = $10,
       daily_limit = $11,
       monthly_limit = $12,
       fallback_provider = $13,
       api_key_encrypted = COALESCE($14, api_key_encrypted),
       api_key_masked = COALESCE($15, api_key_masked),
       status = CASE WHEN COALESCE($14, api_key_encrypted) IS NOT NULL THEN
         CASE WHEN $1 THEN 'ready' ELSE 'disabled' END
         ELSE 'unconfigured' END,
       updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE provider_name = $16`,
    [
      enabled,
      priority,
      default_model,
      temperature,
      top_p,
      max_output_tokens,
      max_input_tokens,
      context_window,
      rpm_limit,
      tpm_limit,
      daily_limit,
      monthly_limit,
      fallback_provider,
      apiKeyEncrypted ?? null,
      apiKeyMasked ?? null,
      name,
    ]
  );

  // Model failover settings (meta_json): fallback list, auto toggle, reset of the auto-switch.
  const metaPatch: Record<string, unknown> = {};
  if (Array.isArray(patch.fallback_models)) {
    metaPatch.fallback_models = (patch.fallback_models as unknown[])
      .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      .map((m) => m.trim())
      .slice(0, 8);
  }
  if (typeof patch.auto_model_fallback === 'boolean') metaPatch.auto_model_fallback = patch.auto_model_fallback;
  if (patch.reset_auto_model === true || typeof patch.default_model === 'string') metaPatch.auto_model = null;
  if (Object.keys(metaPatch).length) await mergeProviderMeta(name, metaPatch);

  const updated = await getAiProviderSetting(name);
  if (!updated) throw new Error('Update failed');
  return { ...updated, models: getProviderDefaults(name).models };
}

export async function markProviderUsed(
  name: AiProviderName,
  opts: { latencyMs?: number; error?: string | null; status?: string }
): Promise<void> {
  if (!pool) return;
  await pool.execute(
    `UPDATE editorial_ai_settings SET
       last_used_at = (NOW() AT TIME ZONE 'UTC'),
       last_error = $1,
       status = COALESCE($2, status),
       avg_latency_ms = CASE
         WHEN avg_latency_ms IS NULL THEN $3
         ELSE ROUND((avg_latency_ms * 0.7 + $3 * 0.3)::numeric, 2)
       END,
       updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE provider_name = $4`,
    [opts.error ?? null, opts.status ?? null, opts.latencyMs ?? 0, name]
  );
}

export async function markProviderTested(
  name: AiProviderName,
  status: string,
  error: string | null,
  latencyMs: number
): Promise<void> {
  if (!pool) return;
  await pool.execute(
    `UPDATE editorial_ai_settings SET
       last_tested_at = (NOW() AT TIME ZONE 'UTC'),
       status = $1,
       last_error = $2,
       avg_latency_ms = $3,
       updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE provider_name = $4`,
    [status, error, latencyMs, name]
  );
}

export async function insertAiUsageLog(input: {
  provider_name: string;
  model?: string | null;
  stage?: string | null;
  success: boolean;
  latency_ms?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  estimated_cost_usd?: number | null;
  error_message?: string | null;
  retry_count?: number;
  article_id?: number | null;
  meta_json?: Record<string, unknown>;
}): Promise<void> {
  if (!pool) return;
  const meta = {
    ...(input.meta_json ?? {}),
    article_id: input.article_id ?? (input.meta_json as { article_id?: number } | undefined)?.article_id ?? null,
  };
  try {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO editorial_ai_usage_logs
        (provider_name, model, stage, success, latency_ms, tokens_in, tokens_out,
         estimated_cost_usd, error_message, retry_count, article_id, meta_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        input.provider_name,
        input.model ?? null,
        input.stage ?? null,
        input.success,
        input.latency_ms ?? null,
        input.tokens_in ?? null,
        input.tokens_out ?? null,
        input.estimated_cost_usd ?? null,
        input.error_message ?? null,
        input.retry_count ?? 0,
        input.article_id ?? null,
        JSON.stringify(meta),
      ]
    );
  } catch {
    // Fallback when article_id column not yet migrated
    await pool.execute<ResultSetHeader>(
      `INSERT INTO editorial_ai_usage_logs
        (provider_name, model, stage, success, latency_ms, tokens_in, tokens_out,
         estimated_cost_usd, error_message, retry_count, meta_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        input.provider_name,
        input.model ?? null,
        input.stage ?? null,
        input.success,
        input.latency_ms ?? null,
        input.tokens_in ?? null,
        input.tokens_out ?? null,
        input.estimated_cost_usd ?? null,
        input.error_message ?? null,
        input.retry_count ?? 0,
        JSON.stringify(meta),
      ]
    );
  }
}

export async function getAiUsageSummary(days = 7): Promise<{
  total_requests: number;
  success_rate: number;
  failure_rate: number;
  avg_latency_ms: number;
  avg_tokens: number;
  avg_cost_usd: number;
  retry_count: number;
  by_provider: Array<{
    provider: string;
    requests: number;
    successes: number;
    failures: number;
    avg_latency_ms: number;
    tokens: number;
    cost_usd: number;
  }>;
  by_model: Array<{ model: string; requests: number }>;
  daily: Array<{ day: string; requests: number; successes: number; failures: number }>;
}> {
  if (!pool) {
    return {
      total_requests: 0,
      success_rate: 0,
      failure_rate: 0,
      avg_latency_ms: 0,
      avg_tokens: 0,
      avg_cost_usd: 0,
      retry_count: 0,
      by_provider: [],
      by_model: [],
      daily: [],
    };
  }
  const sinceDays = Math.min(Math.max(days, 1), 90);
  const [[totals], [byProvider], [byModel], [daily]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE success)::int AS ok,
         COUNT(*) FILTER (WHERE NOT success)::int AS fail,
         COALESCE(AVG(latency_ms), 0) AS avg_latency,
         COALESCE(AVG(COALESCE(tokens_in,0)+COALESCE(tokens_out,0)), 0) AS avg_tokens,
         COALESCE(AVG(estimated_cost_usd), 0) AS avg_cost,
         COALESCE(SUM(retry_count), 0)::int AS retries
       FROM editorial_ai_usage_logs
       WHERE created_at >= (NOW() AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')`,
      [sinceDays]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT provider_name AS provider,
              COUNT(*)::int AS requests,
              COUNT(*) FILTER (WHERE success)::int AS successes,
              COUNT(*) FILTER (WHERE NOT success)::int AS failures,
              COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
              COALESCE(SUM(COALESCE(tokens_in,0)+COALESCE(tokens_out,0)), 0)::int AS tokens,
              COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd
       FROM editorial_ai_usage_logs
       WHERE created_at >= (NOW() AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')
       GROUP BY provider_name
       ORDER BY requests DESC`,
      [sinceDays]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(model, 'unknown') AS model, COUNT(*)::int AS requests
       FROM editorial_ai_usage_logs
       WHERE created_at >= (NOW() AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')
       GROUP BY model
       ORDER BY requests DESC
       LIMIT 12`,
      [sinceDays]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS requests,
              COUNT(*) FILTER (WHERE success)::int AS successes,
              COUNT(*) FILTER (WHERE NOT success)::int AS failures
       FROM editorial_ai_usage_logs
       WHERE created_at >= (NOW() AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')
       GROUP BY 1
       ORDER BY 1 ASC`,
      [sinceDays]
    ),
  ]);
  const t = (totals[0] || {}) as RowDataPacket;
  const total = Number(t.total || 0);
  const ok = Number(t.ok || 0);

  return {
    total_requests: total,
    success_rate: total ? Math.round((ok / total) * 1000) / 10 : 0,
    failure_rate: total ? Math.round(((total - ok) / total) * 1000) / 10 : 0,
    avg_latency_ms: Math.round(Number(t.avg_latency || 0)),
    avg_tokens: Math.round(Number(t.avg_tokens || 0)),
    avg_cost_usd: Math.round(Number(t.avg_cost || 0) * 1e6) / 1e6,
    retry_count: Number(t.retries || 0),
    by_provider: byProvider.map((r) => ({
      provider: String(r.provider),
      requests: Number(r.requests || 0),
      successes: Number(r.successes || 0),
      failures: Number(r.failures || 0),
      avg_latency_ms: Math.round(Number(r.avg_latency_ms || 0)),
      tokens: Number(r.tokens || 0),
      cost_usd: Math.round(Number(r.cost_usd || 0) * 1e6) / 1e6,
    })),
    by_model: byModel.map((r) => ({
      model: String(r.model),
      requests: Number(r.requests || 0),
    })),
    daily: daily.map((r) => ({
      day: String(r.day),
      requests: Number(r.requests || 0),
      successes: Number(r.successes || 0),
      failures: Number(r.failures || 0),
    })),
  };
}

export async function getProviderTodayStats(name: AiProviderName): Promise<{
  requests_today: number;
  failures_today: number;
  success_rate: number;
  token_usage: number;
}> {
  if (!pool) {
    return { requests_today: 0, failures_today: 0, success_rate: 0, token_usage: 0 };
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)::int AS requests,
       COUNT(*) FILTER (WHERE NOT success)::int AS failures,
       COALESCE(SUM(COALESCE(tokens_in,0)+COALESCE(tokens_out,0)), 0)::int AS tokens
     FROM editorial_ai_usage_logs
     WHERE provider_name = $1
       AND created_at::date = (NOW() AT TIME ZONE 'UTC')::date`,
    [name]
  );
  const r = (rows[0] || {}) as RowDataPacket;
  const requests = Number(r.requests || 0);
  const failures = Number(r.failures || 0);
  return {
    requests_today: requests,
    failures_today: failures,
    success_rate: requests ? Math.round(((requests - failures) / requests) * 1000) / 10 : 0,
    token_usage: Number(r.tokens || 0),
  };
}
