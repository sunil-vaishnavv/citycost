/**
 * Internal links repo — replace-set per article (recommendations snapshot).
 */

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';

export interface InternalLinkRow {
  id: number;
  article_id: number;
  href: string;
  label: string | null;
  link_kind: string | null;
  reason: string | null;
  confidence: number | null;
  location: string | null;
  created_at: Date;
}

export async function listInternalLinks(articleId: number): Promise<InternalLinkRow[]> {
  if (!pool) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, article_id, href, label, link_kind, reason, confidence, location, created_at
     FROM editorial_internal_links
     WHERE article_id = $1
     ORDER BY id ASC`,
    [articleId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    article_id: Number(row.article_id),
    href: String(row.href),
    label: row.label != null ? String(row.label) : null,
    link_kind: row.link_kind != null ? String(row.link_kind) : null,
    reason: row.reason != null ? String(row.reason) : null,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    location: row.location != null ? String(row.location) : null,
    created_at: new Date(row.created_at),
  }));
}

export async function replaceInternalLinks(
  articleId: number,
  links: Array<{
    href: string;
    label: string;
    link_kind: string;
    reason: string;
    confidence: number;
    location: string;
  }>
): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM editorial_internal_links WHERE article_id = $1`, [articleId]);
    for (const link of links) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO editorial_internal_links
          (article_id, href, label, link_kind, reason, confidence, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          articleId,
          link.href,
          link.label,
          link.link_kind,
          link.reason,
          link.confidence,
          link.location,
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
