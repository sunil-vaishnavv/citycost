import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import { CONTENT_TYPE_SEEDS } from '../constants.js';
import type { ContentTypeRow } from '../types.js';

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export async function ensureDefaultContentTypes(): Promise<void> {
  if (!pool) return;
  for (const seed of CONTENT_TYPE_SEEDS) {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO editorial_content_types
        (type_key, display_name, enabled, prompt_key, schema_type, structure_json, seo_rules_json, quality_rules_json)
       VALUES ($1, $2, TRUE, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       ON CONFLICT (type_key) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         prompt_key = COALESCE(editorial_content_types.prompt_key, EXCLUDED.prompt_key),
         schema_type = COALESCE(NULLIF(editorial_content_types.schema_type, ''), EXCLUDED.schema_type),
         updated_at = (NOW() AT TIME ZONE 'UTC')`,
      [
        seed.type_key,
        seed.display_name,
        seed.prompt_key,
        seed.schema_type,
        JSON.stringify(seed.structure_json),
        JSON.stringify(seed.seo_rules_json),
        JSON.stringify(seed.quality_rules_json),
      ]
    );
  }
}

export async function listContentTypes(): Promise<ContentTypeRow[]> {
  if (!pool) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, type_key, display_name, enabled, prompt_key, schema_type,
            structure_json, seo_rules_json, quality_rules_json
     FROM editorial_content_types
     ORDER BY id ASC`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    type_key: String(row.type_key),
    display_name: String(row.display_name),
    enabled: Boolean(row.enabled),
    prompt_key: row.prompt_key != null ? String(row.prompt_key) : null,
    schema_type: String(row.schema_type || 'Article'),
    structure_json: parseJson(row.structure_json),
    seo_rules_json: parseJson(row.seo_rules_json),
    quality_rules_json: parseJson(row.quality_rules_json),
  }));
}

export async function patchContentType(
  typeKey: string,
  patch: {
    display_name?: string;
    enabled?: boolean;
    prompt_key?: string | null;
    schema_type?: string;
    structure_json?: Record<string, unknown>;
    seo_rules_json?: Record<string, unknown>;
    quality_rules_json?: Record<string, unknown>;
  }
): Promise<ContentTypeRow | null> {
  if (!pool) throw new Error('Database unavailable');
  const current = (await listContentTypes()).find((c) => c.type_key === typeKey);
  if (!current) return null;

  const next = {
    display_name: patch.display_name ?? current.display_name,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    prompt_key: patch.prompt_key !== undefined ? patch.prompt_key : current.prompt_key,
    schema_type: patch.schema_type ?? current.schema_type,
    structure_json: patch.structure_json ?? current.structure_json,
    seo_rules_json: patch.seo_rules_json ?? current.seo_rules_json,
    quality_rules_json: patch.quality_rules_json ?? current.quality_rules_json,
  };

  await pool.execute(
    `UPDATE editorial_content_types SET
       display_name = $1,
       enabled = $2,
       prompt_key = $3,
       schema_type = $4,
       structure_json = $5::jsonb,
       seo_rules_json = $6::jsonb,
       quality_rules_json = $7::jsonb,
       updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE type_key = $8`,
    [
      next.display_name,
      next.enabled,
      next.prompt_key,
      next.schema_type,
      JSON.stringify(next.structure_json),
      JSON.stringify(next.seo_rules_json),
      JSON.stringify(next.quality_rules_json),
      typeKey,
    ]
  );
  return (await listContentTypes()).find((c) => c.type_key === typeKey) || null;
}
