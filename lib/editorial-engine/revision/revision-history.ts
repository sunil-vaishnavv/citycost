import type { ResultSetHeader, RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { RevisionHistoryRow } from './revision-types.js';

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseDraft(value: unknown): WriterDraftPayload | null {
  if (!value || typeof value !== 'object') return null;
  return value as WriterDraftPayload;
}

function parseMeta(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function mapRow(row: RowDataPacket): RevisionHistoryRow {
  return {
    id: Number(row.id),
    article_id: Number(row.article_id),
    attempt: Number(row.attempt || 1),
    before_score: row.before_score != null ? Number(row.before_score) : null,
    after_score: row.after_score != null ? Number(row.after_score) : null,
    fixed_issues: parseJsonArray(row.fixed_issues_json),
    remaining_issues: parseJsonArray(row.remaining_issues_json),
    prompt_version: row.prompt_version != null ? String(row.prompt_version) : null,
    provider: row.provider != null ? String(row.provider) : null,
    model: row.model != null ? String(row.model) : null,
    tokens_in: row.tokens_in != null ? Number(row.tokens_in) : null,
    tokens_out: row.tokens_out != null ? Number(row.tokens_out) : null,
    duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
    before_draft: parseDraft(row.before_draft_json),
    after_draft: parseDraft(row.after_draft_json),
    created_at: new Date(row.created_at).toISOString(),
    meta_json: parseMeta(row.meta_json),
  };
}

export async function nextRevisionAttempt(articleId: number): Promise<number> {
  if (!pool) return 1;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(attempt), 0) AS m FROM editorial_revision_history WHERE article_id = $1`,
    [articleId]
  );
  return Number(rows[0]?.m || 0) + 1;
}

export async function insertRevisionHistory(input: {
  article_id: number;
  attempt: number;
  before_score: number | null;
  after_score: number | null;
  fixed_issues: string[];
  remaining_issues: string[];
  prompt_version: string;
  provider?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  duration_ms?: number;
  before_draft?: WriterDraftPayload | null;
  after_draft?: WriterDraftPayload | null;
  meta_json?: Record<string, unknown>;
}): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_revision_history
      (article_id, attempt, before_score, after_score, fixed_issues_json, remaining_issues_json,
       prompt_version, provider, model, tokens_in, tokens_out, duration_ms,
       before_draft_json, after_draft_json, meta_json)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb)
     RETURNING id`,
    [
      input.article_id,
      input.attempt,
      input.before_score,
      input.after_score,
      JSON.stringify(input.fixed_issues || []),
      JSON.stringify(input.remaining_issues || []),
      input.prompt_version,
      input.provider ?? null,
      input.model ?? null,
      input.tokens_in ?? null,
      input.tokens_out ?? null,
      input.duration_ms ?? null,
      input.before_draft ? JSON.stringify(input.before_draft) : null,
      input.after_draft ? JSON.stringify(input.after_draft) : null,
      JSON.stringify(input.meta_json || {}),
    ]
  );
  return result.insertId;
}

export async function listRevisionHistory(articleId: number): Promise<RevisionHistoryRow[]> {
  if (!pool) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM editorial_revision_history
     WHERE article_id = $1
     ORDER BY attempt ASC, id ASC`,
    [articleId]
  );
  return rows.map(mapRow);
}

export async function getRevisionStats(days = 30): Promise<{
  revisions: number;
  articles: number;
  avg_before: number;
  avg_after: number;
  avg_score_improvement: number;
  avg_duration_ms: number;
  avg_attempts: number;
  /** Share of article revision sessions that never improved score */
  failure_rate: number;
  /** Share of articles currently in needs_manual_review (touched by revision recently) */
  manual_review_rate: number;
}> {
  if (!pool) {
    return {
      revisions: 0,
      articles: 0,
      avg_before: 0,
      avg_after: 0,
      avg_score_improvement: 0,
      avg_duration_ms: 0,
      avg_attempts: 0,
      failure_rate: 0,
      manual_review_rate: 0,
    };
  }
  const since = Math.min(Math.max(days, 1), 365);
  const [[rows], [sessionRows], [manualRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*)::int AS revisions,
         COUNT(DISTINCT article_id)::int AS articles,
         COALESCE(AVG(before_score), 0) AS avg_before,
         COALESCE(AVG(after_score), 0) AS avg_after,
         COALESCE(AVG(after_score - before_score), 0) AS avg_delta,
         COALESCE(AVG(duration_ms), 0) AS avg_duration,
         COALESCE(AVG(attempt), 0) AS avg_attempts
       FROM editorial_revision_history
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
      [since]
    ),
    pool.execute<RowDataPacket[]>(
      `WITH per_article AS (
         SELECT
           article_id,
           MAX(attempt) AS attempts,
           (ARRAY_AGG(before_score ORDER BY attempt ASC, id ASC))[1] AS first_before,
           MAX(after_score) AS best_after
         FROM editorial_revision_history
         WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
         GROUP BY article_id
       )
       SELECT
         COUNT(*)::int AS articles,
         COALESCE(AVG(attempts), 0) AS avg_attempts,
         COUNT(*) FILTER (
           WHERE best_after IS NULL OR first_before IS NULL OR best_after <= first_before
         )::int AS failures
       FROM per_article`,
      [since]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT
         COUNT(DISTINCT h.article_id)::int AS revised,
         COUNT(DISTINCT h.article_id) FILTER (WHERE a.status = 'needs_manual_review')::int AS manual
       FROM editorial_revision_history h
       JOIN editorial_articles a ON a.id = h.article_id
       WHERE h.created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
      [since]
    ),
  ]);
  const r = (rows[0] || {}) as RowDataPacket;
  const s = (sessionRows[0] || {}) as RowDataPacket;
  const m = (manualRows[0] || {}) as RowDataPacket;
  const articles = Number(s.articles || r.articles || 0);
  const failures = Number(s.failures || 0);
  const revised = Number(m.revised || 0);
  const manual = Number(m.manual || 0);
  return {
    revisions: Number(r.revisions || 0),
    articles,
    avg_before: Math.round(Number(r.avg_before || 0) * 10) / 10,
    avg_after: Math.round(Number(r.avg_after || 0) * 10) / 10,
    avg_score_improvement: Math.round(Number(r.avg_delta || 0) * 10) / 10,
    avg_duration_ms: Math.round(Number(r.avg_duration || 0)),
    avg_attempts: Math.round(Number(s.avg_attempts || r.avg_attempts || 0) * 10) / 10,
    failure_rate: articles ? Math.round((failures / articles) * 1000) / 10 : 0,
    manual_review_rate: revised ? Math.round((manual / revised) * 1000) / 10 : 0,
  };
}
