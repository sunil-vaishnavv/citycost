/**
 * PostgreSQL connection layer (node-postgres).
 *
 * `pool.execute` / `pool.query` return `[rows, result]` tuples, and `?`
 * placeholders are converted to `$n`, so repositories share one small API.
 */

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

/** Result header for INSERT/UPDATE/DELETE. */
export interface DbResultHeader {
  insertId: number;
  affectedRows: number;
  rowCount: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** One row returned by a SELECT through `pool`. */
export type RowDataPacket = Record<string, any>;
/** Result of INSERT/UPDATE/DELETE through `pool`. */
export type ResultSetHeader = DbResultHeader;

type SqlParams = unknown[] | undefined;

export interface CompatConnection {
  execute<T = any>(sql: string, params?: SqlParams): Promise<[T, unknown]>;
  query<T = any>(sql: string, params?: SqlParams): Promise<[T, unknown]>;
  ping(): Promise<void>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface CompatPool {
  execute<T = any>(sql: string, params?: SqlParams): Promise<[T, unknown]>;
  query<T = any>(sql: string, params?: SqlParams): Promise<[T, unknown]>;
  getConnection(): Promise<CompatConnection>;
  end(): Promise<void>;
  on(event: 'error', listener: (err: Error) => void): void;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Convert `?` placeholders to node-postgres `$1`, `$2`, … */
export function toPgParams(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function isMutating(sql: string): boolean {
  const head = sql.trim().slice(0, 12).toUpperCase();
  return (
    head.startsWith('INSERT') ||
    head.startsWith('UPDATE') ||
    head.startsWith('DELETE') ||
    head.startsWith('REPLACE')
  );
}

async function runOnClient(
  client: pg.PoolClient | pg.Pool,
  sql: string,
  params?: SqlParams
): Promise<[unknown, unknown]> {
  const text = toPgParams(sql);
  const values = params ?? [];
  const result = await client.query(text, values);

  if (isMutating(sql)) {
    let insertId = 0;
    const returningId = (result.rows?.[0] as { id?: string | number } | undefined)?.id;
    if (returningId != null && returningId !== '') {
      insertId = Number(returningId) || 0;
    } else if (sql.trim().toUpperCase().startsWith('INSERT')) {
      try {
        const idRes = await client.query<{ id: string | number }>('SELECT lastval() AS id');
        insertId = Number(idRes.rows[0]?.id ?? 0) || 0;
      } catch {
        insertId = 0;
      }
    }
    const header: DbResultHeader = {
      insertId,
      affectedRows: result.rowCount ?? 0,
      rowCount: result.rowCount ?? 0,
    };
    return [header, result];
  }

  return [result.rows, result];
}

function wrapClient(client: pg.PoolClient): CompatConnection {
  return {
    execute: ((sql: string, params?: SqlParams) => runOnClient(client, sql, params)) as CompatConnection['execute'],
    query: ((sql: string, params?: SqlParams) => runOnClient(client, sql, params)) as CompatConnection['query'],
    async ping() {
      await client.query('SELECT 1');
    },
    async beginTransaction() {
      await client.query('BEGIN');
    },
    async commit() {
      await client.query('COMMIT');
    },
    async rollback() {
      await client.query('ROLLBACK');
    },
    release() {
      client.release();
    },
  };
}

function createCompatPool(pgPool: pg.Pool): CompatPool {
  return {
    execute: ((sql: string, params?: SqlParams) => runOnClient(pgPool, sql, params)) as CompatPool['execute'],
    query: ((sql: string, params?: SqlParams) => runOnClient(pgPool, sql, params)) as CompatPool['query'],
    async getConnection() {
      const client = await pgPool.connect();
      return wrapClient(client);
    },
    end: () => pgPool.end(),
    on(event, listener) {
      if (event === 'error') pgPool.on('error', listener);
    },
  };
}

function resolveDatabaseUrl(): string | null {
  const url = (process.env.DATABASE_URL || '').trim();
  return url || null;
}

/**
 * TLS is on by default (`sslmode=require`). Turn it off for a Postgres that does
 * not serve TLS — e.g. Coolify's internal Docker network — with
 * `DATABASE_SSL=false` or `sslmode=disable` in DATABASE_URL.
 */
function sslDisabled(url: string): boolean {
  const flag = (process.env.DATABASE_SSL || '').trim().toLowerCase();
  return ['false', '0', 'off', 'disable', 'no'].includes(flag) || /[?&]sslmode=disable\b/i.test(url);
}

function withoutSslMode(url: string): string {
  return url
    .replace(/([?&])sslmode=[^&]*(&|$)/i, (_m, lead: string, tail: string) => (tail ? lead : ''))
    .replace(/[?&]$/, '');
}

function ensureSslInUrl(url: string): string {
  if (/[?&]sslmode=/i.test(url)) return url;
  return url.includes('?') ? `${url}&sslmode=require` : `${url}?sslmode=require`;
}

/** Shared PostgreSQL pool (null when DATABASE_URL is unset or pool creation failed). */
let pool: CompatPool | null = null;
let rawPool: pg.Pool | null = null;
let compatPool: CompatPool | null = null;

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl) {
  try {
    const noSsl = sslDisabled(databaseUrl);
    rawPool = new Pool({
      connectionString: noSsl ? withoutSslMode(databaseUrl) : ensureSslInUrl(databaseUrl),
      max: parseInt(process.env.PG_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ssl: noSsl ? false : { rejectUnauthorized: false },
    });
    compatPool = createCompatPool(rawPool);
    pool = compatPool;
    compatPool.on('error', (err) => {
      console.warn('⚠️  PostgreSQL pool error (non-fatal):', err.message);
    });
  } catch (err) {
    console.warn(
      '⚠️  PostgreSQL pool creation failed — DB features disabled:',
      (err as Error).message
    );
    pool = null;
    compatPool = null;
    rawPool = null;
  }
} else {
  console.warn('⚠️  DATABASE_URL not set — PostgreSQL disabled (app continues without DB)');
}

export interface DbHealthInfo {
  connected: boolean;
  ssl: boolean | null;
  version: string | null;
  database: string | null;
  schema: string | null;
  message: string;
}

/**
 * Test the database connection and log health details.
 * Returns true on success, false on failure (never throws).
 */
async function testConnection(): Promise<boolean> {
  if (!compatPool) return false;
  try {
    const health = await getDbHealth();
    if (!health.connected) {
      throw new Error(health.message);
    }
    console.log('✅ PostgreSQL connection established');
    console.log(
      `   SSL: ${health.ssl === null ? 'unknown' : health.ssl ? 'on' : 'off'} · ` +
        `db: ${health.database ?? '?'} · schema: ${health.schema ?? '?'} · ` +
        `version: ${health.version ?? '?'}`
    );
    return true;
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === '28P01') {
      console.warn(`⚠️  PostgreSQL unavailable (${e.code}) — continuing without DB`);
    } else {
      console.warn('⚠️  PostgreSQL test connection failed:', e.message || String(err));
    }
    const failedCompat = compatPool;
    const failedRaw = rawPool;
    pool = null;
    compatPool = null;
    rawPool = null;
    await failedCompat?.end().catch(() => {});
    await failedRaw?.end().catch(() => {});
    return false;
  }
}

/** Detailed health probe used by startup and diagnostics. */
async function getDbHealth(): Promise<DbHealthInfo> {
  if (!compatPool) {
    return {
      connected: false,
      ssl: null,
      version: null,
      database: null,
      schema: null,
      message: 'DATABASE_URL not configured or pool unavailable',
    };
  }

  const conn = await compatPool.getConnection();
  try {
    await conn.ping();
    const [rows] = await conn.query<
      Array<{
        version: string;
        database: string;
        schema: string;
        ssl: boolean | null;
      }>
    >(`
      SELECT
        version() AS version,
        current_database() AS database,
        current_schema() AS schema,
        (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl
    `);
    const row = Array.isArray(rows) ? rows[0] : null;
    return {
      connected: true,
      ssl: row?.ssl ?? null,
      version: row?.version ?? null,
      database: row?.database ?? null,
      schema: row?.schema ?? null,
      message: 'ok',
    };
  } finally {
    conn.release();
  }
}

export { pool, testConnection, getDbHealth };
export default pool;
