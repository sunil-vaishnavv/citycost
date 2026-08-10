/**
 * Full published Content Memory — all published articles, no schema change.
 */

import { pool } from '../../../../db.js';
import type { WriterDraftPayload } from '../../draft-validate.js';
import type { RowDataPacket } from 'mysql2/promise';

export interface MemoryDoc {
  id: number;
  slug: string;
  title: string;
  content_type: string;
  text: string;
  openings: string[];
  closings: string[];
  headings: string[];
  faqs: string[];
  summaries: string[];
}

let memoryCache: { at: number; docs: MemoryDoc[] } | null = null;
const MEMORY_TTL_MS = 10 * 60 * 1000;

function extractParts(draft: unknown): Omit<MemoryDoc, 'id' | 'slug' | 'title' | 'content_type'> {
  const d = draft as WriterDraftPayload | null;
  const blocks = Array.isArray(d?.blocks) ? d!.blocks : [];
  const paras: string[] = [];
  const headings: string[] = [];
  const faqs: string[] = [];
  const summaries: string[] = [];
  for (const b of blocks) {
    if (b.type === 'heading' && b.heading) headings.push(String(b.heading));
    if (b.type === 'summary') {
      summaries.push(typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
    }
    if (b.type === 'faq' && Array.isArray(b.content)) {
      for (const item of b.content as Array<{ q?: string; a?: string }>) {
        faqs.push(`${item.q || ''} ${item.a || ''}`);
      }
    }
    if (typeof b.content === 'string' && b.content.trim().length > 40) paras.push(b.content);
  }
  return {
    text: paras.join('\n'),
    openings: paras.slice(0, 3).map((p) => p.slice(0, 180)),
    closings: paras.slice(-3).map((p) => p.slice(0, 180)),
    headings,
    faqs,
    summaries,
  };
}

function parseJson(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

/** Load fingerprints for ALL published articles (cached). */
export async function loadPublishedMemory(): Promise<MemoryDoc[]> {
  if (memoryCache && Date.now() - memoryCache.at < MEMORY_TTL_MS) return memoryCache.docs;
  if (!pool) {
    memoryCache = { at: Date.now(), docs: [] };
    return [];
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, slug, seo_title, excerpt, draft_json, content_type
     FROM editorial_articles
     WHERE status = 'published'
     ORDER BY id DESC`
  );
  const docs: MemoryDoc[] = (rows || []).map((row) => {
    const draft = parseJson(row.draft_json);
    const parts = extractParts(draft);
    return {
      id: Number(row.id),
      slug: String(row.slug || ''),
      title: String(row.seo_title || row.slug || ''),
      content_type: String(row.content_type || ''),
      ...parts,
      text: parts.text || String(row.excerpt || ''),
    };
  });
  memoryCache = { at: Date.now(), docs };
  return docs;
}

export function invalidateWriterMemoryCache(): void {
  memoryCache = null;
}
