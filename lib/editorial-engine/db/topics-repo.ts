import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import type { EditorialTopic, ScoreBreakdown, TopicStatus } from '../types.js';
import { TOPIC_TERMINAL_LOCK_STATUSES } from '../types.js';
import { cleanEditorialTitle, hasCertBatchNoise } from '../utils/clean-title.js';

function parseJsonArray(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseJsonObj(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function mapTopic(row: RowDataPacket): EditorialTopic {
  return {
    id: Number(row.id),
    title: cleanEditorialTitle(String(row.title || '')),
    cluster_id: row.cluster_id != null ? Number(row.cluster_id) : null,
    content_type: String(row.content_type),
    source_refs_json: parseJsonObj(row.source_refs_json),
    priority_score: Number(row.priority_score || 0),
    status: String(row.status),
    topic_hash: String(row.topic_hash),
    rationale_json: parseJsonArray(row.rationale_json),
    locked: Boolean(row.locked),
    locked_at: row.locked_at ? new Date(row.locked_at) : null,
    locked_reason: row.locked_reason != null ? String(row.locked_reason) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

const TOPIC_SELECT = `id, title, cluster_id, content_type, source_refs_json, priority_score, status,
            topic_hash, rationale_json, locked, locked_at, locked_reason, created_at, updated_at`;

export function isTopicSchedulingLocked(topic: EditorialTopic): boolean {
  if (topic.locked) return true;
  return TOPIC_TERMINAL_LOCK_STATUSES.includes(topic.status as TopicStatus);
}

export type TopicListSort =
  | 'score_desc'
  | 'score_asc'
  | 'newest'
  | 'oldest'
  | 'country'
  | 'city'
  | 'priority'
  | 'recent';

export interface TopicListFilters {
  status?: string;
  content_type?: string;
  q?: string;
  country?: string;
  city?: string;
  intent?: string;
  cluster?: string;
  priority?: string;
  score_min?: number;
  score_max?: number;
  sort?: TopicListSort;
  limit?: number;
  offset?: number;
}

function buildTopicWhere(opts: TopicListFilters): {
  whereSql: string;
  params: Array<string | number>;
} {
  const where: string[] = [];
  const params: Array<string | number> = [];
  let i = 1;

  if (opts.status) {
    where.push(`status = $${i++}`);
    params.push(opts.status);
  }
  if (opts.content_type) {
    where.push(`content_type = $${i++}`);
    params.push(opts.content_type);
  }
  if (opts.q) {
    where.push(`title ILIKE $${i++}`);
    params.push(`%${opts.q}%`);
  }
  if (opts.country) {
    where.push(
      `(source_refs_json->>'country' ILIKE $${i} OR source_refs_json->>'country_slug' ILIKE $${i} OR source_refs_json->>'country_code' ILIKE $${i})`
    );
    params.push(`%${opts.country}%`);
    i += 1;
  }
  if (opts.city) {
    where.push(
      `(source_refs_json->>'city' ILIKE $${i} OR source_refs_json->'cities'->>0 ILIKE $${i} OR title ILIKE $${i} OR source_refs_json::text ILIKE $${i})`
    );
    params.push(`%${opts.city}%`);
    i += 1;
  }
  if (opts.intent) {
    where.push(`source_refs_json->>'intent' = $${i++}`);
    params.push(opts.intent);
  }
  if (opts.cluster) {
    where.push(
      `(source_refs_json->>'cluster' ILIKE $${i} OR EXISTS (
         SELECT 1 FROM editorial_clusters ec
         WHERE ec.id = editorial_topics.cluster_id AND ec.slug ILIKE $${i}
       ))`
    );
    params.push(`%${opts.cluster}%`);
    i += 1;
  }
  if (opts.priority) {
    where.push(`source_refs_json->>'priority' = $${i++}`);
    params.push(opts.priority);
  }
  if (typeof opts.score_min === 'number' && Number.isFinite(opts.score_min)) {
    where.push(`priority_score >= $${i++}`);
    params.push(opts.score_min);
  }
  if (typeof opts.score_max === 'number' && Number.isFinite(opts.score_max)) {
    where.push(`priority_score <= $${i++}`);
    params.push(opts.score_max);
  }
  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function topicOrderBy(sort?: TopicListSort): string {
  switch (sort) {
    case 'score_asc':
      return 'priority_score ASC, id ASC';
    case 'newest':
    case 'recent':
      return 'created_at DESC, id DESC';
    case 'oldest':
      return 'created_at ASC, id ASC';
    case 'country':
      return `COALESCE(source_refs_json->>'country', source_refs_json->>'country_slug', '') ASC, priority_score DESC`;
    case 'city':
      return `COALESCE(source_refs_json->>'city', source_refs_json->'cities'->>0, '') ASC, priority_score DESC`;
    case 'priority':
      return `CASE source_refs_json->>'priority' WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC, priority_score DESC`;
    case 'score_desc':
    default:
      return 'priority_score DESC, id DESC';
  }
}

export async function listTopics(
  opts: TopicListFilters
): Promise<{ topics: EditorialTopic[]; total: number }> {
  if (!pool) return { topics: [], total: 0 };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 250);
  const offset = Math.max(opts.offset ?? 0, 0);
  const { whereSql, params } = buildTopicWhere(opts);
  const orderBy = topicOrderBy(opts.sort);

  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM editorial_topics ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.c || 0);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${TOPIC_SELECT}
     FROM editorial_topics
     ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return { topics: rows.map(mapTopic), total };
}

/** IDs for “select all filtered” (capped for safety). */
export async function listTopicIds(
  opts: TopicListFilters,
  max = 2000
): Promise<{ ids: number[]; total: number }> {
  if (!pool) return { ids: [], total: 0 };
  const { whereSql, params } = buildTopicWhere(opts);
  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM editorial_topics ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.c || 0);
  const cap = Math.min(Math.max(max, 1), 5000);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM editorial_topics ${whereSql} ORDER BY ${topicOrderBy(opts.sort)} LIMIT ${cap}`,
    params
  );
  return { ids: rows.map((r) => Number(r.id)), total };
}

export interface TopicDashboardStats {
  total: number;
  candidates: number;
  approved: number;
  scheduled: number;
  published: number;
  rejected: number;
  archived: number;
  average_score: number;
  highest_score: number;
  generated_today: number;
}

export async function getTopicDashboardStats(): Promise<TopicDashboardStats> {
  const empty: TopicDashboardStats = {
    total: 0,
    candidates: 0,
    approved: 0,
    scheduled: 0,
    published: 0,
    rejected: 0,
    archived: 0,
    average_score: 0,
    highest_score: 0,
    generated_today: 0,
  };
  if (!pool) return empty;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'candidate')::int AS candidates,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
       COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
       COUNT(*) FILTER (WHERE status = 'published')::int AS published,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE status = 'archived')::int AS archived,
       COALESCE(ROUND(AVG(priority_score)::numeric, 1), 0) AS average_score,
       COALESCE(MAX(priority_score), 0) AS highest_score,
       COUNT(*) FILTER (WHERE created_at::date = (NOW() AT TIME ZONE 'UTC')::date)::int AS generated_today
     FROM editorial_topics`
  );
  const r = (rows[0] || {}) as RowDataPacket;
  return {
    total: Number(r.total || 0),
    candidates: Number(r.candidates || 0),
    approved: Number(r.approved || 0),
    scheduled: Number(r.scheduled || 0),
    published: Number(r.published || 0),
    rejected: Number(r.rejected || 0),
    archived: Number(r.archived || 0),
    average_score: Number(r.average_score || 0),
    highest_score: Number(r.highest_score || 0),
    generated_today: Number(r.generated_today || 0),
  };
}

export type BulkTopicAction = 'approve' | 'reject' | 'archive' | 'delete';

export async function bulkTopicAction(
  ids: number[],
  action: BulkTopicAction
): Promise<{ ok: number; failed: number; errors: string[] }> {
  if (!pool) throw new Error('Database unavailable');
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of unique) {
    try {
      const topic = await getTopicById(id);
      if (!topic) {
        failed += 1;
        errors.push(`#${id}: not found`);
        continue;
      }
      if (topic.locked && action !== 'approve') {
        failed += 1;
        errors.push(`#${id}: locked`);
        continue;
      }
      if (action === 'approve') {
        if (topic.status !== 'candidate' && topic.status !== 'approved') {
          failed += 1;
          errors.push(`#${id}: cannot approve from ${topic.status}`);
          continue;
        }
        await setTopicStatus(id, 'approved');
      } else if (action === 'reject') {
        if (topic.status === 'published') {
          failed += 1;
          errors.push(`#${id}: cannot reject published`);
          continue;
        }
        await setTopicStatus(id, 'rejected');
      } else if (action === 'archive') {
        if (topic.status === 'published') {
          failed += 1;
          errors.push(`#${id}: cannot archive published`);
          continue;
        }
        await setTopicStatus(id, 'archived');
      } else if (action === 'delete') {
        if (topic.status === 'published' || topic.locked) {
          failed += 1;
          errors.push(`#${id}: cannot delete`);
          continue;
        }
        await pool.execute(`DELETE FROM editorial_topics WHERE id = $1`, [id]);
      }
      ok += 1;
    } catch (err) {
      failed += 1;
      errors.push(`#${id}: ${(err as Error).message || 'failed'}`);
    }
  }
  return { ok, failed, errors: errors.slice(0, 20) };
}

export async function getTopicById(id: number): Promise<EditorialTopic | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${TOPIC_SELECT} FROM editorial_topics WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ? mapTopic(rows[0]) : null;
}

/**
 * All previously researched topic hashes/titles (any status), plus article titles.
 * Used so strategy never re-researches the same topic (including rejected/archived).
 */
export async function listPublishedTopicSignals(): Promise<{
  hashes: string[];
  titles: string[];
}> {
  if (!pool) return { hashes: [], titles: [] };
  const [topicRows] = await pool.execute<RowDataPacket[]>(
    `SELECT topic_hash, title FROM editorial_topics`
  );
  let articleRows: RowDataPacket[] = [];
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT slug, seo_title, meta_title FROM editorial_articles
       WHERE status IN ('published', 'approved', 'draft', 'review')`
    );
    articleRows = rows;
  } catch {
    // Articles table not migrated yet (Phase 3A foundation only).
    articleRows = [];
  }
  const hashes = topicRows.map((r) => String(r.topic_hash));
  const titles = [
    ...topicRows.map((r) => String(r.title)),
    ...articleRows.map((r) => String(r.seo_title || r.meta_title || r.slug || '')),
  ].filter(Boolean);
  return { hashes, titles };
}

/** True when this topic_hash was already researched / stored. */
export async function topicHashExists(topicHash: string): Promise<boolean> {
  if (!pool || !topicHash) return false;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM editorial_topics WHERE topic_hash = $1 LIMIT 1`,
    [topicHash]
  );
  return Boolean(rows[0]);
}

export async function listSchedulableTopics(opts: {
  minScore?: number;
  limit?: number;
}): Promise<EditorialTopic[]> {
  if (!pool) return [];
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
  const minScore = opts.minScore ?? 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${TOPIC_SELECT}
     FROM editorial_topics
     WHERE locked = FALSE
       AND status IN ('candidate', 'approved')
       AND priority_score >= $1
     ORDER BY
       CASE status WHEN 'approved' THEN 0 ELSE 1 END,
       priority_score DESC,
       id ASC
     LIMIT ${limit}`,
    [minScore]
  );
  return rows.map(mapTopic);
}

export async function upsertScoredTopic(input: {
  title: string;
  cluster_id: number | null;
  content_type: string;
  source_refs: Record<string, unknown>;
  priority_score: number;
  topic_hash: string;
  rationale: string[];
  status: string;
}): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const title = cleanEditorialTitle(input.title);
  const [existing] = await pool.execute<RowDataPacket[]>(
    `SELECT id, status, locked FROM editorial_topics WHERE topic_hash = $1 LIMIT 1`,
    [input.topic_hash]
  );
  if (existing[0]) {
    const id = Number(existing[0].id);
    const prev = String(existing[0].status);
    const locked = Boolean(existing[0].locked);
    // Never overwrite locked / in-progress / published topics' status via strategy re-score
    const preserve = locked || TOPIC_TERMINAL_LOCK_STATUSES.includes(prev as TopicStatus);
    const status = preserve ? prev : input.status;
    await pool.execute(
      `UPDATE editorial_topics SET
         title = $1, cluster_id = $2, content_type = $3, source_refs_json = $4::jsonb,
         priority_score = $5, rationale_json = $6::jsonb, status = $7
       WHERE id = $8`,
      [
        title,
        input.cluster_id,
        input.content_type,
        JSON.stringify(input.source_refs),
        input.priority_score,
        JSON.stringify(input.rationale),
        status,
        id,
      ]
    );
    return id;
  }
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_topics
      (title, cluster_id, content_type, source_refs_json, priority_score, status, topic_hash, rationale_json)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      title,
      input.cluster_id,
      input.content_type,
      JSON.stringify(input.source_refs),
      input.priority_score,
      input.status,
      input.topic_hash,
      JSON.stringify(input.rationale),
    ]
  );
  return result.insertId;
}

/** Persist-clean any topic titles that still contain cert-batch QA markers. */
export async function scrubCertNoiseFromTopics(): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, title FROM editorial_topics
     WHERE title ILIKE '%cert%' OR title ~* '\\(cert'`
  );
  let fixed = 0;
  for (const row of rows) {
    const raw = String(row.title || '');
    if (!hasCertBatchNoise(raw)) continue;
    const cleaned = cleanEditorialTitle(raw);
    if (!cleaned || cleaned === raw) continue;
    await pool.execute(`UPDATE editorial_topics SET title = $1 WHERE id = $2`, [
      cleaned,
      Number(row.id),
    ]);
    fixed += 1;
  }
  return fixed;
}

export async function insertTopicScore(
  topicId: number,
  factors: Record<string, number>,
  priorityScore: number,
  breakdown: ScoreBreakdown
): Promise<void> {
  if (!pool) return;
  await pool.execute(
    `INSERT INTO editorial_topic_scores (topic_id, factors_json, breakdown_json, priority_score)
     VALUES ($1, $2::jsonb, $3::jsonb, $4)`,
    [topicId, JSON.stringify(factors), JSON.stringify(breakdown), priorityScore]
  );
}

export async function setTopicStatus(id: number, status: TopicStatus): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(`UPDATE editorial_topics SET status = $1 WHERE id = $2`, [status, id]);
}

export async function lockTopic(id: number, reason: string): Promise<EditorialTopic | null> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_topics
     SET locked = TRUE, locked_at = (NOW() AT TIME ZONE 'UTC'), locked_reason = $1
     WHERE id = $2`,
    [reason.slice(0, 255), id]
  );
  return getTopicById(id);
}

export async function unlockTopic(id: number): Promise<EditorialTopic | null> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_topics SET locked = FALSE, locked_at = NULL, locked_reason = NULL WHERE id = $1`,
    [id]
  );
  return getTopicById(id);
}

export async function approveTopic(id: number): Promise<EditorialTopic | null> {
  const topic = await getTopicById(id);
  if (!topic) return null;
  if (topic.status !== 'candidate' && topic.status !== 'approved') {
    throw new Error(`Cannot approve topic in status '${topic.status}'`);
  }
  await setTopicStatus(id, 'approved');
  return getTopicById(id);
}
