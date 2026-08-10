import crypto from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import {
  countrySlugFromCode,
  listIndexableCities,
  listIndexableComparisons,
  listIndexableCountries,
} from '../../seo-catalog.js';
import type { ContentGap } from '../types.js';

function hashGap(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|').toLowerCase()).digest('hex');
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

function mapGap(row: RowDataPacket): ContentGap {
  return {
    id: Number(row.id),
    gap_type: String(row.gap_type),
    cluster_id: row.cluster_id != null ? Number(row.cluster_id) : null,
    topic_hash: row.topic_hash != null ? String(row.topic_hash) : null,
    title: String(row.title),
    severity: Number(row.severity || 0),
    detail_json: parseJsonObj(row.detail_json),
    status: String(row.status),
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

async function upsertGap(input: {
  gap_type: string;
  cluster_id: number | null;
  topic_hash: string;
  title: string;
  severity: number;
  detail: Record<string, unknown>;
}): Promise<void> {
  if (!pool) return;
  await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_content_gaps
      (gap_type, cluster_id, topic_hash, title, severity, detail_json, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'open')
     ON CONFLICT (gap_type, topic_hash) DO UPDATE SET
       title = EXCLUDED.title,
       severity = EXCLUDED.severity,
       detail_json = EXCLUDED.detail_json,
       cluster_id = EXCLUDED.cluster_id,
       status = CASE
         WHEN editorial_content_gaps.status = 'ignored' THEN editorial_content_gaps.status
         ELSE 'open'
       END,
       updated_at = (NOW() AT TIME ZONE 'UTC')`,
    [
      input.gap_type,
      input.cluster_id,
      input.topic_hash,
      input.title,
      input.severity,
      JSON.stringify(input.detail),
    ]
  );
}

/**
 * Content-gap detection framework.
 * Identifies missing editorial opportunities — does NOT generate content.
 */
export async function detectContentGaps(opts?: {
  maxCountries?: number;
}): Promise<{ scanned: number; gaps_upserted: number }> {
  if (!pool) return { scanned: 0, gaps_upserted: 0 };

  const [topicRows] = await pool.execute<RowDataPacket[]>(
    `SELECT topic_hash, content_type, source_refs_json, status
     FROM editorial_topics
     WHERE status NOT IN ('rejected', 'archived')`
  );
  const hashes = new Set(topicRows.map((r) => String(r.topic_hash)));
  const byTypeHref = new Set<string>();
  for (const row of topicRows) {
    const refs = parseJsonObj(row.source_refs_json) || {};
    if (refs.comparison_slug) byTypeHref.add(`comparison:${refs.comparison_slug}`);
    if (refs.city_slug) byTypeHref.add(`city:${refs.city_slug}`);
    if (refs.country_slug) byTypeHref.add(`country:${refs.country_slug}`);
    if (refs.hub_id) byTypeHref.add(`hub:${refs.hub_id}`);
  }

  let gaps = 0;
  let scanned = 0;
  const maxCountries = opts?.maxCountries ?? 40;

  const cities = listIndexableCities();
  const byCountry = new Map<string, number>();
  for (const c of cities) {
    byCountry.set(c.countryCode, (byCountry.get(c.countryCode) || 0) + 1);
  }
  const countries = listIndexableCountries()
    .map((c) => ({ ...c, n: byCountry.get(c.code) || 0 }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, maxCountries);

  for (const country of countries) {
    scanned += 1;
    const key = `country:${country.slug}`;
    const topicHash = hashGap(['country_guide', country.slug]);
    if (!byTypeHref.has(key) && !hashes.has(topicHash)) {
      await upsertGap({
        gap_type: 'missing_country_guide',
        cluster_id: null,
        topic_hash: topicHash,
        title: `Missing country guide opportunity: ${country.name}`,
        severity: 3,
        detail: {
          country_slug: country.slug,
          country_code: country.code,
          indexed_cities: country.n,
          suggested_content_type: 'country_guide',
          href: `/country/${country.slug}`,
        },
      });
      gaps += 1;
    }
  }

  for (const comp of listIndexableComparisons().slice(0, 200)) {
    scanned += 1;
    const key = `comparison:${comp.slug}`;
    const topicHash = hashGap(['comparison_guide', comp.slug]);
    if (!byTypeHref.has(key) && !hashes.has(topicHash)) {
      await upsertGap({
        gap_type: 'missing_comparison_guide',
        cluster_id: null,
        topic_hash: topicHash,
        title: `Missing comparison guide: ${comp.cityA} vs ${comp.cityB}`,
        severity: 4,
        detail: {
          comparison_slug: comp.slug,
          suggested_content_type: 'comparison_guide',
          href: `/compare/${comp.slug}`,
        },
      });
      gaps += 1;
    }
  }

  for (const city of cities.slice(0, 100)) {
    scanned += 1;
    const key = `city:${city.pageSlug}`;
    const topicHash = hashGap(['city_guide', city.pageSlug]);
    if (!byTypeHref.has(key) && !hashes.has(topicHash)) {
      const countrySlug = countrySlugFromCode(city.countryCode);
      await upsertGap({
        gap_type: 'missing_city_guide',
        cluster_id: null,
        topic_hash: topicHash,
        title: `Missing city guide: ${city.city}, ${city.country}`,
        severity: 2,
        detail: {
          city_slug: city.pageSlug,
          country_slug: countrySlug,
          suggested_content_type: 'city_guide',
          href: `/city/${city.pageSlug}`,
        },
      });
      gaps += 1;
    }
  }

  // Thin persona coverage: country has cities but no student/family/etc topic hash pattern
  for (const country of countries.slice(0, 20)) {
    for (const persona of ['students', 'families', 'remote-workers', 'retirement'] as const) {
      scanned += 1;
      const topicHash = hashGap(['persona_guide', country.slug, persona]);
      const hasPersonaTopic = [...topicRows].some((r) => {
        const refs = parseJsonObj(r.source_refs_json) || {};
        return (
          String(r.content_type).includes(persona.replace('-workers', '_worker').replace('-', '_')) ||
          (refs.country_slug === country.slug && String(refs.hub_id || '').includes(persona.split('-')[0]))
        );
      });
      if (!hasPersonaTopic && !hashes.has(topicHash)) {
        await upsertGap({
          gap_type: 'missing_persona_guide',
          cluster_id: null,
          topic_hash: topicHash,
          title: `Missing ${persona} guide opportunity for ${country.name}`,
          severity: 2.5,
          detail: {
            country_slug: country.slug,
            persona,
            suggested_content_type:
              persona === 'students'
                ? 'student_guide'
                : persona === 'retirement'
                  ? 'retirement_guide'
                  : persona === 'remote-workers'
                    ? 'remote_worker_guide'
                    : 'guide',
          },
        });
        gaps += 1;
      }
    }
  }

  return { scanned, gaps_upserted: gaps };
}

export async function listContentGaps(opts: {
  status?: string;
  gap_type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ gaps: ContentGap[]; total: number }> {
  if (!pool) return { gaps: [], total: 0 };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where: string[] = [];
  const params: Array<string | number> = [];
  let i = 1;
  if (opts.status) {
    where.push(`status = $${i++}`);
    params.push(opts.status);
  }
  if (opts.gap_type) {
    where.push(`gap_type = $${i++}`);
    params.push(opts.gap_type);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM editorial_content_gaps ${whereSql}`,
    params
  );
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, gap_type, cluster_id, topic_hash, title, severity, detail_json, status, created_at, updated_at
     FROM editorial_content_gaps
     ${whereSql}
     ORDER BY severity DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return { gaps: rows.map(mapGap), total: Number(countRows[0]?.c || 0) };
}

export async function countOpenContentGaps(): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM editorial_content_gaps WHERE status = 'open'`
  );
  return Number(rows[0]?.c || 0);
}
