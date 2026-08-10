import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import {
  listIndexableCities,
  listIndexableCountries,
} from '../../seo-catalog.js';
import type { ClusterLevelKind, EditorialCluster } from '../types.js';

const PERSONA_SLUGS = [
  { slug: 'students', title: 'Students' },
  { slug: 'families', title: 'Families' },
  { slug: 'remote-workers', title: 'Remote Workers' },
  { slug: 'retirement', title: 'Retirement' },
  { slug: 'digital-nomads', title: 'Digital Nomads' },
] as const;

const SUB_PILLARS = [
  { slug: 'cities', title: 'Cities' },
  { slug: 'comparisons', title: 'Comparisons' },
  { slug: 'personas', title: 'Personas' },
] as const;

function mapCluster(row: RowDataPacket): EditorialCluster {
  return {
    id: Number(row.id),
    parent_id: row.parent_id != null ? Number(row.parent_id) : null,
    slug: String(row.slug),
    title: String(row.title),
    country_slug: row.country_slug != null ? String(row.country_slug) : null,
    kind: String(row.kind || row.level_kind || 'pillar'),
    level_kind: String(row.level_kind || row.kind || 'pillar'),
    depth: Number(row.depth || 0),
    path: row.path != null ? String(row.path) : null,
  };
}

export async function listClusters(): Promise<EditorialCluster[]> {
  if (!pool) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, parent_id, slug, title, country_slug, kind, level_kind, depth, path
     FROM editorial_clusters ORDER BY depth ASC, id ASC`
  );
  return rows.map(mapCluster);
}

export async function getClusterBySlug(slug: string): Promise<EditorialCluster | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, parent_id, slug, title, country_slug, kind, level_kind, depth, path
     FROM editorial_clusters WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return rows[0] ? mapCluster(rows[0]) : null;
}

async function upsertCluster(input: {
  slug: string;
  title: string;
  parent_id: number | null;
  country_slug: string | null;
  level_kind: ClusterLevelKind;
  depth: number;
  path: string | null;
}): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const existing = await getClusterBySlug(input.slug);
  if (existing) {
    await pool.execute(
      `UPDATE editorial_clusters
       SET title = $1, parent_id = $2, country_slug = $3, kind = $4, level_kind = $5, depth = $6, path = $7
       WHERE id = $8`,
      [
        input.title,
        input.parent_id,
        input.country_slug,
        input.level_kind,
        input.level_kind,
        input.depth,
        input.path,
        existing.id,
      ]
    );
    return existing.id;
  }
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_clusters
      (parent_id, slug, title, country_slug, kind, level_kind, depth, path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.parent_id,
      input.slug,
      input.title,
      input.country_slug,
      input.level_kind,
      input.level_kind,
      input.depth,
      input.path,
    ]
  );
  const id = result.insertId;
  // Finalize path with self id: parentPath + id/
  const path = `${input.path || '/'}${id}/`;
  await pool.execute(`UPDATE editorial_clusters SET path = $1 WHERE id = $2`, [path, id]);
  return id;
}

/**
 * Ensure deeper topical cluster tree:
 * Root pillar → Country → Pillar (COL) → Sub-Pillar → Persona
 * (Article nodes are attached later when content is published.)
 */
export async function ensureClusterRegistry(maxCountries = 40): Promise<{
  countries: number;
  clusters: number;
}> {
  if (!pool) return { countries: 0, clusters: 0 };

  const rootId = await upsertCluster({
    slug: 'cost-of-living',
    title: 'Cost of Living',
    parent_id: null,
    country_slug: null,
    level_kind: 'pillar',
    depth: 0,
    path: '/',
  });
  const rootPath = `/${rootId}/`;

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
    const countryId = await upsertCluster({
      slug: `country-${country.slug}`,
      title: country.name,
      parent_id: rootId,
      country_slug: country.slug,
      level_kind: 'country',
      depth: 1,
      path: rootPath,
    });
    const countryPath = `${rootPath}${countryId}/`;

    const pillarId = await upsertCluster({
      slug: `${country.slug}-cost-of-living`,
      title: `Cost of Living in ${country.name}`,
      parent_id: countryId,
      country_slug: country.slug,
      level_kind: 'pillar',
      depth: 2,
      path: countryPath,
    });
    const pillarPath = `${countryPath}${pillarId}/`;

    for (const sub of SUB_PILLARS) {
      const subId = await upsertCluster({
        slug: `${country.slug}-${sub.slug}`,
        title: `${sub.title} — ${country.name}`,
        parent_id: pillarId,
        country_slug: country.slug,
        level_kind: 'sub_pillar',
        depth: 3,
        path: pillarPath,
      });
      const subPath = `${pillarPath}${subId}/`;

      if (sub.slug === 'personas') {
        for (const persona of PERSONA_SLUGS) {
          await upsertCluster({
            slug: `${country.slug}-${persona.slug}`,
            title: `${persona.title} — ${country.name}`,
            parent_id: subId,
            country_slug: country.slug,
            level_kind: 'persona',
            depth: 4,
            path: subPath,
          });
        }
      }
    }
  }

  // Global persona hubs under root
  const globalPersonasId = await upsertCluster({
    slug: 'global-personas',
    title: 'Global Personas',
    parent_id: rootId,
    country_slug: null,
    level_kind: 'sub_pillar',
    depth: 1,
    path: rootPath,
  });
  const globalPersonasPath = `${rootPath}${globalPersonasId}/`;
  for (const persona of PERSONA_SLUGS) {
    await upsertCluster({
      slug: `global-${persona.slug}`,
      title: persona.title,
      parent_id: globalPersonasId,
      country_slug: null,
      level_kind: 'persona',
      depth: 2,
      path: globalPersonasPath,
    });
  }

  const all = await listClusters();
  return { countries: countries.length, clusters: all.length };
}

export function resolveClusterSlugForTopic(opts: {
  countrySlug?: string | null;
  persona?: string | null;
  kind: 'comparison' | 'city' | 'country' | 'hub';
}): string {
  const country = opts.countrySlug;
  if (opts.kind === 'comparison' && country) return `${country}-comparisons`;
  if (opts.kind === 'city' && country) return `${country}-cities`;
  if (opts.kind === 'country' && country) return `${country}-cost-of-living`;
  if (opts.persona && country) return `${country}-${opts.persona}`;
  if (opts.persona) return `global-${opts.persona}`;
  if (opts.kind === 'hub' && opts.persona) return `global-${opts.persona}`;
  return 'cost-of-living';
}
