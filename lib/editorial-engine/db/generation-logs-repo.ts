import type { ResultSetHeader, RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import { estimateGroqCostUsd } from '../ai-cost.js';

export interface GenerationLogInput {
  article_id?: number | null;
  topic_id?: number | null;
  stage: string;
  model_used?: string | null;
  writer_prompt_version?: number | null;
  reviewer_prompt_version?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  latency_ms?: number | null;
  success?: boolean;
  error_message?: string | null;
  meta_json?: Record<string, unknown> | null;
}

/** Admin-only generation debug snapshot (no secrets). */
export interface ArticleGenerationDebug {
  ai_model: string | null;
  prompt_version: number | null;
  generation_time_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  estimated_ai_cost_usd: number | null;
  research_pack_size_chars: number | null;
  prompt_size_chars: number | null;
}

/**
 * Persist a generation-stage log including Writer/Reviewer prompt versions.
 * Ready for Writer/Reviewer phases — safe to call from P1+ without generation.
 */
export async function insertGenerationLog(input: GenerationLogInput): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_generation_logs
      (article_id, topic_id, stage, model_used, writer_prompt_version, reviewer_prompt_version,
       tokens_in, tokens_out, latency_ms, success, error_message, meta_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     RETURNING id`,
    [
      input.article_id ?? null,
      input.topic_id ?? null,
      input.stage,
      input.model_used ?? null,
      input.writer_prompt_version ?? null,
      input.reviewer_prompt_version ?? null,
      input.tokens_in ?? null,
      input.tokens_out ?? null,
      input.latency_ms ?? null,
      input.success !== false,
      input.error_message ?? null,
      JSON.stringify(input.meta_json ?? {}),
    ]
  );
  return result.insertId;
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

/**
 * Latest successful writer log for admin debugging.
 */
export async function getLatestWriterGenerationDebug(
  articleId: number
): Promise<ArticleGenerationDebug | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT model_used, writer_prompt_version, tokens_in, tokens_out, latency_ms, meta_json
     FROM editorial_generation_logs
     WHERE article_id = $1 AND stage = 'writer' AND success = true
     ORDER BY id DESC
     LIMIT 1`,
    [articleId]
  );
  const row = rows[0];
  if (!row) return null;
  const meta = parseMeta(row.meta_json);
  const debug =
    meta.debug && typeof meta.debug === 'object'
      ? (meta.debug as Record<string, unknown>)
      : {};
  const promptTokens =
    row.tokens_in != null
      ? Number(row.tokens_in)
      : typeof debug.tokens_in === 'number'
        ? debug.tokens_in
        : null;
  const completionTokens =
    row.tokens_out != null
      ? Number(row.tokens_out)
      : typeof debug.tokens_out === 'number'
        ? debug.tokens_out
        : null;
  const total =
    promptTokens != null || completionTokens != null
      ? (promptTokens || 0) + (completionTokens || 0)
      : null;
  const model = (row.model_used as string) || (typeof debug.groq_model === 'string' ? debug.groq_model : null);
  return {
    ai_model: model,
    prompt_version:
      row.writer_prompt_version != null
        ? Number(row.writer_prompt_version)
        : null,
    generation_time_ms:
      row.latency_ms != null
        ? Number(row.latency_ms)
        : typeof debug.generation_time_ms === 'number'
          ? debug.generation_time_ms
          : null,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: total,
    estimated_ai_cost_usd: estimateGroqCostUsd({
      model,
      tokens_in: promptTokens,
      tokens_out: completionTokens,
    }),
    research_pack_size_chars:
      typeof debug.research_pack_size_chars === 'number'
        ? debug.research_pack_size_chars
        : null,
    prompt_size_chars:
      typeof debug.prompt_size_chars === 'number'
        ? debug.prompt_size_chars
        : typeof debug.system_size_chars === 'number' && typeof debug.user_size_chars === 'number'
          ? debug.system_size_chars + debug.user_size_chars
          : null,
  };
}
