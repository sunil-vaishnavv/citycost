import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import { getSettings } from './settings-repo.js';
import type { ResearchPack } from '../writer/research-engine.js';
import {
  validateManualDraft,
  validateWriterDraft,
  type WriterDraftPayload,
} from '../writer/draft-validate.js';

export interface EditorialArticleRow {
  id: number;
  slug: string;
  content_type: string;
  cluster_id: number | null;
  topic_id: number | null;
  status: string;
  seo_title: string | null;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  blocks_json: unknown;
  research_pack_json: unknown;
  draft_json: unknown;
  raw_ai_response: string | null;
  prompt_version: number | null;
  prompt_hash: string | null;
  ai_model: string | null;
  temperature: number | null;
  top_p: number | null;
  generation_time_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  reading_time_minutes: number | null;
  word_count: number;
  quality_score: number | null;
  review_score: number | null;
  overall_confidence: number | null;
  confidence_level: string | null;
  article_health: string | null;
  seo_package_json: unknown;
  entity_map_json: unknown;
  json_ld_json: unknown;
  internal_links_json: unknown;
  seo_validation_json: unknown;
  preview_version: number | null;
  canonical_url: string | null;
  published_at: Date | null;
  last_public_update_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function parseJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function mapRow(row: RowDataPacket): EditorialArticleRow {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    content_type: String(row.content_type),
    cluster_id: row.cluster_id != null ? Number(row.cluster_id) : null,
    topic_id: row.topic_id != null ? Number(row.topic_id) : null,
    status: String(row.status),
    seo_title: row.seo_title != null ? String(row.seo_title) : null,
    meta_title: row.meta_title != null ? String(row.meta_title) : null,
    meta_description: row.meta_description != null ? String(row.meta_description) : null,
    excerpt: row.excerpt != null ? String(row.excerpt) : null,
    blocks_json: parseJson(row.blocks_json),
    research_pack_json: parseJson(row.research_pack_json),
    draft_json: parseJson(row.draft_json),
    raw_ai_response: row.raw_ai_response != null ? String(row.raw_ai_response) : null,
    prompt_version: row.prompt_version != null ? Number(row.prompt_version) : null,
    prompt_hash: row.prompt_hash != null ? String(row.prompt_hash) : null,
    ai_model: row.ai_model != null ? String(row.ai_model) : null,
    temperature: row.temperature != null ? Number(row.temperature) : null,
    top_p: row.top_p != null ? Number(row.top_p) : null,
    generation_time_ms: row.generation_time_ms != null ? Number(row.generation_time_ms) : null,
    tokens_in: row.tokens_in != null ? Number(row.tokens_in) : null,
    tokens_out: row.tokens_out != null ? Number(row.tokens_out) : null,
    reading_time_minutes:
      row.reading_time_minutes != null ? Number(row.reading_time_minutes) : null,
    word_count: Number(row.word_count || 0),
    quality_score: row.quality_score != null ? Number(row.quality_score) : null,
    review_score: row.review_score != null ? Number(row.review_score) : null,
    overall_confidence: row.overall_confidence != null ? Number(row.overall_confidence) : null,
    confidence_level: row.confidence_level != null ? String(row.confidence_level) : null,
    article_health: row.article_health != null ? String(row.article_health) : null,
    seo_package_json: parseJson(row.seo_package_json),
    entity_map_json: parseJson(row.entity_map_json),
    json_ld_json: parseJson(row.json_ld_json),
    internal_links_json: parseJson(row.internal_links_json),
    seo_validation_json: parseJson(row.seo_validation_json),
    preview_version: row.preview_version != null ? Number(row.preview_version) : null,
    canonical_url: row.canonical_url != null ? String(row.canonical_url) : null,
    published_at: row.published_at != null ? new Date(row.published_at) : null,
    last_public_update_at:
      row.last_public_update_at != null ? new Date(row.last_public_update_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

const SELECT_COLS = `id, slug, content_type, cluster_id, topic_id, status, seo_title, meta_title,
  meta_description, excerpt, blocks_json, research_pack_json, draft_json, raw_ai_response,
  prompt_version, prompt_hash, ai_model, temperature, top_p, generation_time_ms,
  tokens_in, tokens_out, reading_time_minutes, word_count, quality_score, review_score,
  overall_confidence, confidence_level, article_health,
  seo_package_json, entity_map_json, json_ld_json, internal_links_json, seo_validation_json,
  preview_version, canonical_url, published_at, last_public_update_at, created_at, updated_at`;

export async function listArticles(opts: {
  status?: string;
  q?: string;
  source?: 'manual' | 'automatic';
  limit?: number;
  offset?: number;
}): Promise<{ articles: EditorialArticleRow[]; total: number }> {
  if (!pool) return { articles: [], total: 0 };
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where: string[] = [];
  const params: Array<string | number> = [];
  let i = 1;
  if (opts.status) {
    where.push(`status = $${i++}`);
    params.push(opts.status);
  }
  if (opts.q) {
    where.push(`(seo_title LIKE $${i} OR slug LIKE $${i + 1} OR excerpt LIKE $${i + 2})`);
    params.push(`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`);
    i += 3;
  }
  if (opts.source === 'manual') {
    where.push(`prompt_hash = $${i++}`);
    params.push('manual');
  } else if (opts.source === 'automatic') {
    where.push(`(prompt_hash IS NULL OR prompt_hash <> $${i++})`);
    params.push('manual');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*)::int AS c FROM editorial_articles ${whereSql}`,
    params
  );
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${SELECT_COLS} FROM editorial_articles
     ${whereSql}
     ORDER BY id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return { articles: rows.map(mapRow), total: Number(countRows[0]?.c || 0) };
}

export async function getArticleById(id: number): Promise<EditorialArticleRow | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${SELECT_COLS} FROM editorial_articles WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Latest non-failed article for a topic (daily pipeline resume). */
export async function getLatestArticleByTopicId(
  topicId: number
): Promise<EditorialArticleRow | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM editorial_articles
     WHERE topic_id = $1 AND status IN ('draft', 'review', 'published')
     ORDER BY id DESC
     LIMIT 1`,
    [topicId]
  );
  if (!rows[0]) return null;
  return getArticleById(Number(rows[0].id));
}

export async function countPublishedOnUtcDate(dateStr: string): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*)::int AS c FROM editorial_articles
     WHERE status = 'published'
       AND ((published_at AT TIME ZONE 'UTC')::date) = $1::date`,
    [dateStr]
  );
  return Number(rows[0]?.c || 0);
}

export async function slugExists(slug: string, excludeId?: number): Promise<boolean> {
  if (!pool) return false;
  if (excludeId) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM editorial_articles WHERE slug = $1 AND id != $2 LIMIT 1`,
      [slug, excludeId]
    );
    return Boolean(rows[0]);
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM editorial_articles WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return Boolean(rows[0]);
}

export async function insertDraftArticle(input: {
  slug: string;
  content_type: string;
  cluster_id: number | null;
  topic_id: number;
  draft: WriterDraftPayload;
  research: ResearchPack;
  raw_ai_response: string;
  prompt_version: number;
  prompt_hash: string;
  ai_model: string;
  temperature: number;
  top_p: number;
  generation_time_ms: number;
  tokens_in?: number;
  tokens_out?: number;
  word_count: number;
  reading_time_minutes: number;
}): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const settings = await getSettings();
  const validation = validateWriterDraft(input.draft, {
    min: settings.article_length_min,
    max: settings.article_length_max,
  });
  if (!validation.ok) {
    throw new Error(
      `Draft validation failed — refusing to save invalid draft: ${validation.errors.join('; ')}`
    );
  }
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_articles
      (slug, content_type, cluster_id, topic_id, status,
       seo_title, meta_title, meta_description, excerpt,
       blocks_json, research_pack_json, draft_json, raw_ai_response,
       prompt_version, prompt_hash, ai_model, temperature, top_p,
       generation_time_ms, tokens_in, tokens_out, reading_time_minutes, word_count)
     VALUES ($1, $2, $3, $4, 'draft',
       $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, $12,
       $13, $14, $15, $16, $17,
       $18, $19, $20, $21, $22)
     RETURNING id`,
    [
      input.slug,
      input.content_type,
      input.cluster_id,
      input.topic_id,
      input.draft.seo_title,
      input.draft.meta_title,
      input.draft.meta_description,
      input.draft.excerpt,
      JSON.stringify(input.draft.blocks),
      JSON.stringify(input.research),
      JSON.stringify(input.draft),
      input.raw_ai_response,
      input.prompt_version,
      input.prompt_hash,
      input.ai_model,
      input.temperature,
      input.top_p,
      input.generation_time_ms,
      input.tokens_in ?? null,
      input.tokens_out ?? null,
      input.reading_time_minutes,
      input.word_count,
    ]
  );
  return result.insertId;
}

/** Admin-written article — no AI generation fields, relaxed validation. */
export async function insertManualDraftArticle(input: {
  slug: string;
  content_type: string;
  cluster_id: number | null;
  topic_id: number | null;
  draft: WriterDraftPayload;
  word_count: number;
  reading_time_minutes: number;
}): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const settings = await getSettings();
  const validation = validateManualDraft(input.draft, {
    minWords: 50,
    maxWords: settings.article_length_max,
  });
  if (!validation.ok) {
    throw new Error(
      `Manual draft validation failed: ${validation.errors.join('; ')}`
    );
  }
  const researchPack = { origin: 'manual' as const };
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_articles
      (slug, content_type, cluster_id, topic_id, status,
       seo_title, meta_title, meta_description, excerpt,
       blocks_json, research_pack_json, draft_json, raw_ai_response,
       prompt_version, prompt_hash, ai_model, temperature, top_p,
       generation_time_ms, tokens_in, tokens_out, reading_time_minutes, word_count)
     VALUES ($1, $2, $3, $4, 'draft',
       $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, NULL,
       0, 'manual', 'manual', NULL, NULL,
       NULL, NULL, NULL, $12, $13)
     RETURNING id`,
    [
      input.slug,
      input.content_type,
      input.cluster_id,
      input.topic_id,
      input.draft.seo_title,
      input.draft.meta_title,
      input.draft.meta_description,
      input.draft.excerpt,
      JSON.stringify(input.draft.blocks),
      JSON.stringify(researchPack),
      JSON.stringify(input.draft),
      input.reading_time_minutes,
      input.word_count,
    ]
  );
  return result.insertId;
}

export async function updateArticleReviewState(input: {
  id: number;
  status: 'draft' | 'review' | 'needs_manual_review';
  quality_score: number;
  review_score: number;
  overall_confidence?: number | null;
  confidence_level?: string | null;
  article_health?: string | null;
}): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_articles
     SET status = $1, quality_score = $2, review_score = $3,
         overall_confidence = COALESCE($4, overall_confidence),
         confidence_level = COALESCE($5, confidence_level),
         article_health = COALESCE($6, article_health),
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $7`,
    [
      input.status,
      input.quality_score,
      input.review_score,
      input.overall_confidence ?? null,
      input.confidence_level ?? null,
      input.article_health ?? null,
      input.id,
    ]
  );
}

/** Update public identity (slug + titles) for unpublished articles. */
export async function updateArticleIdentity(input: {
  id: number;
  slug: string;
  seo_title: string;
  meta_title: string;
  meta_description?: string | null;
  excerpt?: string | null;
  draft?: unknown;
  seo_package?: unknown;
  canonical_url?: string | null;
}): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_articles
     SET slug = $1,
         seo_title = $2,
         meta_title = $3,
         meta_description = COALESCE($4, meta_description),
         excerpt = COALESCE($5, excerpt),
         draft_json = COALESCE($6::jsonb, draft_json),
         seo_package_json = COALESCE($7::jsonb, seo_package_json),
         canonical_url = COALESCE($8, canonical_url),
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $9`,
    [
      input.slug,
      input.seo_title,
      input.meta_title,
      input.meta_description ?? null,
      input.excerpt ?? null,
      input.draft != null ? JSON.stringify(input.draft) : null,
      input.seo_package != null ? JSON.stringify(input.seo_package) : null,
      input.canonical_url ?? null,
      input.id,
    ]
  );
}

/** In-place draft update for P4.5 revision engine (never changes slug). */
export async function updateArticleDraft(input: {
  id: number;
  draft: {
    seo_title: string;
    meta_title: string;
    meta_description: string;
    excerpt: string;
    blocks: unknown[];
  };
  word_count: number;
  reading_time_minutes: number;
  raw_ai_response?: string | null;
}): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_articles
     SET seo_title = $1,
         meta_title = $2,
         meta_description = $3,
         excerpt = $4,
         blocks_json = $5::jsonb,
         draft_json = $6::jsonb,
         word_count = $7,
         reading_time_minutes = $8,
         raw_ai_response = COALESCE($9, raw_ai_response),
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $10`,
    [
      input.draft.seo_title,
      input.draft.meta_title,
      input.draft.meta_description,
      input.draft.excerpt,
      JSON.stringify(input.draft.blocks),
      JSON.stringify(input.draft),
      input.word_count,
      input.reading_time_minutes,
      input.raw_ai_response ?? null,
      input.id,
    ]
  );
}

export async function updateArticleStatus(
  id: number,
  status: 'draft' | 'review' | 'needs_manual_review' | 'published'
): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_articles
     SET status = $1, updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $2`,
    [status, id]
  );
}

/** Lightweight rows for near-duplicate scanning (excludes current article). */
export async function listArticlesForDuplicateScan(
  excludeId: number,
  limit = 80
): Promise<
  Array<{
    id: number;
    slug: string;
    seo_title: string | null;
    excerpt: string | null;
    draft_json: unknown;
    content_type: string | null;
  }>
> {
  if (!pool) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  // Only READY/published peers — abandoned draft attempts must not poison uniqueness.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, slug, seo_title, excerpt, draft_json, content_type
     FROM editorial_articles
     WHERE id != $1
       AND status IN ('review', 'published')
     ORDER BY id DESC
     LIMIT ${safeLimit}`,
    [excludeId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    seo_title: row.seo_title != null ? String(row.seo_title) : null,
    excerpt: row.excerpt != null ? String(row.excerpt) : null,
    draft_json: parseJson(row.draft_json),
    content_type: row.content_type != null ? String(row.content_type) : null,
  }));
}

export async function setArticlePublished(id: number): Promise<Date> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_articles
     SET status = 'published',
         published_at = (NOW() AT TIME ZONE 'UTC'),
         last_public_update_at = (NOW() AT TIME ZONE 'UTC'),
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $1`,
    [id]
  );
  const article = await getArticleById(id);
  return article?.published_at || new Date();
}

export async function setArticleUnpublished(id: number): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_articles
     SET status = 'review',
         last_public_update_at = (NOW() AT TIME ZONE 'UTC'),
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $1`,
    [id]
  );
}

/** In-place content update for published articles — keeps status published, no review. */
export async function updatePublishedArticleContent(input: {
  id: number;
  draft: WriterDraftPayload;
  word_count: number;
  reading_time_minutes: number;
}): Promise<boolean> {
  if (!pool) throw new Error('Database unavailable');
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE editorial_articles
     SET seo_title = $1,
         meta_title = $2,
         meta_description = $3,
         excerpt = $4,
         blocks_json = $5::jsonb,
         draft_json = $6::jsonb,
         word_count = $7,
         reading_time_minutes = $8,
         last_public_update_at = (NOW() AT TIME ZONE 'UTC'),
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $9 AND status = 'published'`,
    [
      input.draft.seo_title,
      input.draft.meta_title,
      input.draft.meta_description,
      input.draft.excerpt,
      JSON.stringify(input.draft.blocks),
      JSON.stringify(input.draft),
      input.word_count,
      input.reading_time_minutes,
      input.id,
    ]
  );
  return (result.affectedRows ?? 0) > 0;
}

/** Permanently remove an article and cascaded snapshots/reports. Published requires slug confirmation. */
export async function deleteArticle(
  id: number,
  options?: { confirmSlug?: string }
): Promise<{ deleted: true; slug: string; wasPublished: boolean }> {
  if (!pool) throw new Error('Database unavailable');
  const article = await getArticleById(id);
  if (!article) throw new Error('Article not found');
  const wasPublished = article.status === 'published';
  if (wasPublished) {
    const typed = String(options?.confirmSlug || '').trim();
    if (!typed || typed !== article.slug) {
      throw new Error('Type the article slug to confirm deleting a published article');
    }
  }
  await pool.execute(`DELETE FROM editorial_articles WHERE id = $1`, [id]);
  return { deleted: true, slug: article.slug, wasPublished };
}

export async function saveArticleSeoPackage(input: {
  id: number;
  seo_package: unknown;
  entity_map: unknown;
  json_ld: unknown;
  internal_links: unknown;
  seo_validation: unknown;
  preview_version: number;
  canonical_url: string;
  seo_title: string;
  meta_title: string;
  meta_description: string;
}): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_articles SET
       seo_package_json = $1::jsonb,
       entity_map_json = $2::jsonb,
       json_ld_json = $3::jsonb,
       internal_links_json = $4::jsonb,
       seo_validation_json = $5::jsonb,
       preview_version = $6,
       canonical_url = $7,
       seo_title = $8,
       meta_title = $9,
       meta_description = $10,
       updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $11`,
    [
      JSON.stringify(input.seo_package),
      JSON.stringify(input.entity_map),
      JSON.stringify(input.json_ld),
      JSON.stringify(input.internal_links),
      JSON.stringify(input.seo_validation),
      input.preview_version,
      input.canonical_url,
      input.seo_title,
      input.meta_title,
      input.meta_description,
      input.id,
    ]
  );
}
