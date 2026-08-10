/**
 * Editorial schema bootstrap — PostgreSQL foundation + content + infra.
 * Applies:
 *   db/editorial-foundation.pg.sql
 *   db/editorial-content.pg.sql
 *   db/editorial-infra.pg.sql
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMA_FILES = [
  'editorial-foundation.pg.sql',
  'editorial-content.pg.sql',
  'editorial-infra.pg.sql',
  'editorial-ai.pg.sql',
  'editorial-revision.pg.sql',
  'editorial-observability.pg.sql',
] as const;

/**
 * Apply foundation + content + infra DDL (IF NOT EXISTS). Idempotent.
 */
const SCHEMA_READY_TTL_MS = 60_000;
let schemaReadyCache: { at: number; ready: boolean } | null = null;

function markSchemaReady(ready: boolean): void {
  schemaReadyCache = { at: Date.now(), ready };
}

export async function ensureEditorialSchema(): Promise<boolean> {
  if (!pool) return false;

  const conn = await pool.getConnection();
  try {
    for (const file of SCHEMA_FILES) {
      const sqlPath = path.resolve(__dirname, '../../db', file);
      if (!fs.existsSync(sqlPath)) {
        console.warn(`⚠️  ${file} not found — skip schema ensure`);
        markSchemaReady(false);
        return false;
      }
      const raw = fs.readFileSync(sqlPath, 'utf8');
      const statements = splitSqlStatements(raw);
      for (const statement of statements) {
        await conn.query(statement);
      }
    }
    markSchemaReady(true);
    return true;
  } finally {
    conn.release();
  }
}

export async function isEditorialSchemaReady(): Promise<boolean> {
  if (!pool) return false;
  if (schemaReadyCache && Date.now() - schemaReadyCache.at < SCHEMA_READY_TTL_MS) {
    return schemaReadyCache.ready;
  }
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name IN (
           'editorial_settings',
           'editorial_prompt_templates',
           'editorial_content_types',
           'editorial_admin',
           'editorial_sessions',
           'editorial_articles',
           'editorial_quality_reports',
           'editorial_internal_links',
           'editorial_generation_logs',
           'editorial_jobs',
           'editorial_refresh_logs'
         )`
    );
    const c = Number((rows as Array<{ c: number }>)[0]?.c || 0);
    const ready = c >= 11;
    markSchemaReady(ready);
    return ready;
  } catch {
    markSchemaReady(false);
    return false;
  }
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
