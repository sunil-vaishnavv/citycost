/**
 * Public blog repository — published articles ONLY.
 * Never reuse unrestricted admin queries for public surfaces.
 */

import type { RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import { SITE_URL } from '../../../src/utils/seo.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { SeoPackage } from '../seo/seo-package.js';
import type { EntityMap } from '../seo/entity-map.js';
import type { EditorialJsonLd } from '../seo/json-ld.js';
import type { InternalLinkPackage } from '../seo/internal-links.js';
import type { SeoValidationResult } from '../seo/content-seo-validator.js';

export interface PublicBlogListItem {
  id: number;
  slug: string;
  seo_title: string;
  excerpt: string | null;
  content_type: string;
  word_count: number;
  reading_time_minutes: number | null;
  published_at: Date;
  last_public_update_at: Date | null;
  updated_at: Date;
}

export interface PublicBlogArticle {
  id: number;
  slug: string;
  content_type: string;
  seo_title: string;
  meta_title: string;
  meta_description: string;
  excerpt: string | null;
  word_count: number;
  reading_time_minutes: number | null;
  published_at: Date;
  last_public_update_at: Date | null;
  updated_at: Date;
  draft: WriterDraftPayload;
  seo_package: SeoPackage | null;
  entity_map: EntityMap | null;
  json_ld: EditorialJsonLd | null;
  internal_links: InternalLinkPackage | null;
  seo_validation: SeoValidationResult | null;
  canonical_url: string;
  quality_score: number | null;
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

function mapListItem(row: RowDataPacket): PublicBlogListItem {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    seo_title: String(row.seo_title || row.meta_title || row.slug),
    excerpt: row.excerpt != null ? String(row.excerpt) : null,
    content_type: String(row.content_type),
    word_count: Number(row.word_count || 0),
    reading_time_minutes:
      row.reading_time_minutes != null ? Number(row.reading_time_minutes) : null,
    published_at: new Date(row.published_at),
    last_public_update_at:
      row.last_public_update_at != null ? new Date(row.last_public_update_at) : null,
    updated_at: new Date(row.updated_at),
  };
}

export async function listPublishedBlogArticles(opts: {
  limit?: number;
  offset?: number;
}): Promise<{ articles: PublicBlogListItem[]; total: number }> {
  if (!pool) return { articles: [], total: 0 };
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);

  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*)::int AS c FROM editorial_articles WHERE status = 'published'`
  );
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, slug, seo_title, meta_title, excerpt, content_type, word_count,
            reading_time_minutes, published_at, last_public_update_at, updated_at
     FROM editorial_articles
     WHERE status = 'published'
     ORDER BY published_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`
  );
  return {
    articles: rows.map(mapListItem),
    total: Number(countRows[0]?.c || 0),
  };
}

export async function getPublishedBlogArticleBySlug(
  slug: string
): Promise<PublicBlogArticle | null> {
  if (!pool) return null;
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) return null;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, slug, content_type, seo_title, meta_title, meta_description, excerpt,
            word_count, reading_time_minutes, published_at, last_public_update_at, updated_at,
            draft_json, blocks_json, seo_package_json, entity_map_json, json_ld_json,
            internal_links_json, seo_validation_json, canonical_url, quality_score
     FROM editorial_articles
     WHERE status = 'published' AND slug = $1
     LIMIT 1`,
    [clean]
  );
  const row = rows[0];
  if (!row) return null;

  const draftJson = parseJson(row.draft_json);
  const blocksJson = parseJson(row.blocks_json);
  let draft: WriterDraftPayload;
  if (draftJson && typeof draftJson === 'object') {
    draft = draftJson as WriterDraftPayload;
  } else {
    draft = {
      seo_title: String(row.seo_title || ''),
      meta_title: String(row.meta_title || ''),
      meta_description: String(row.meta_description || ''),
      excerpt: row.excerpt != null ? String(row.excerpt) : '',
      blocks: Array.isArray(blocksJson) ? (blocksJson as WriterDraftPayload['blocks']) : [],
    };
  }

  const seo_package = (parseJson(row.seo_package_json) as SeoPackage | null) || null;
  const canonical =
    (row.canonical_url && String(row.canonical_url)) ||
    seo_package?.canonical ||
    `${SITE_URL}/blog/${clean}`;

  return {
    id: Number(row.id),
    slug: String(row.slug),
    content_type: String(row.content_type),
    seo_title: String(row.seo_title || draft.seo_title || row.slug),
    meta_title: String(row.meta_title || draft.meta_title || row.seo_title || row.slug),
    meta_description: String(
      row.meta_description || draft.meta_description || row.excerpt || ''
    ),
    excerpt: row.excerpt != null ? String(row.excerpt) : null,
    word_count: Number(row.word_count || 0),
    reading_time_minutes:
      row.reading_time_minutes != null ? Number(row.reading_time_minutes) : null,
    published_at: new Date(row.published_at),
    last_public_update_at:
      row.last_public_update_at != null ? new Date(row.last_public_update_at) : null,
    updated_at: new Date(row.updated_at),
    draft,
    seo_package,
    entity_map: (parseJson(row.entity_map_json) as EntityMap | null) || null,
    json_ld: (parseJson(row.json_ld_json) as EditorialJsonLd | null) || null,
    internal_links: (parseJson(row.internal_links_json) as InternalLinkPackage | null) || null,
    seo_validation: (parseJson(row.seo_validation_json) as SeoValidationResult | null) || null,
    canonical_url: canonical,
    quality_score: row.quality_score != null ? Number(row.quality_score) : null,
  };
}

export async function listPublishedBlogSitemapEntries(): Promise<
  Array<{ loc: string; lastmod: string }>
> {
  if (!pool) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT slug,
            COALESCE(last_public_update_at, published_at, updated_at) AS lm
     FROM editorial_articles
     WHERE status = 'published'
     ORDER BY published_at DESC`
  );
  return rows.map((row) => ({
    loc: `${SITE_URL}/blog/${String(row.slug)}`,
    lastmod: new Date(row.lm).toISOString().slice(0, 10),
  }));
}
