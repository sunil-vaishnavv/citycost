import crypto from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import { SESSION_TTL_MS } from '../constants.js';
import { getSettings } from '../db/settings-repo.js';

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function resolveTtlMs(): Promise<number> {
  try {
    const settings = await getSettings();
    const hours = Number(settings.session_ttl_hours);
    if (Number.isFinite(hours) && hours > 0 && hours <= 168) {
      return Math.floor(hours * 60 * 60 * 1000);
    }
  } catch {
    /* use fallback */
  }
  return SESSION_TTL_MS;
}

async function resolveIdleMs(): Promise<number> {
  try {
    const settings = await getSettings();
    const minutes = Number(settings.session_idle_timeout_minutes);
    if (Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60) {
      return Math.floor(minutes * 60 * 1000);
    }
  } catch {
    /* use fallback */
  }
  return 60 * 60 * 1000;
}

export async function createSession(opts: {
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  if (!pool) throw new Error('Database unavailable');
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + (await resolveTtlMs()));
  await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_sessions (token_hash, expires_at, ip_address, user_agent, last_seen_at)
     VALUES ($1, $2, $3, $4, (NOW() AT TIME ZONE 'UTC'))`,
    [tokenHash, expiresAt, opts.ip ?? null, truncate(opts.userAgent, 512)]
  );
  return { token, expiresAt };
}

/**
 * Validates absolute expiry + idle timeout.
 * Auth flow unchanged: cookie/Bearer token → validate → continue.
 */
export async function validateSession(token: string | null | undefined): Promise<boolean> {
  if (!pool || !token || token.length < 32) return false;
  const tokenHash = hashSessionToken(token);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, last_seen_at, expires_at FROM editorial_sessions
     WHERE token_hash = $1 AND expires_at > (NOW() AT TIME ZONE 'UTC')
     LIMIT 1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return false;

  const idleMs = await resolveIdleMs();
  const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (lastSeen > 0 && Date.now() - lastSeen > idleMs) {
    await pool.execute(`DELETE FROM editorial_sessions WHERE id = $1`, [row.id]);
    return false;
  }

  await pool.execute(
    `UPDATE editorial_sessions SET last_seen_at = (NOW() AT TIME ZONE 'UTC') WHERE id = $1`,
    [row.id]
  );
  return true;
}

export async function destroySession(token: string | null | undefined): Promise<void> {
  if (!pool || !token) return;
  const tokenHash = hashSessionToken(token);
  await pool.execute(`DELETE FROM editorial_sessions WHERE token_hash = $1`, [tokenHash]);
}

export async function purgeExpiredSessions(): Promise<void> {
  if (!pool) return;
  await pool.execute(
    `DELETE FROM editorial_sessions WHERE expires_at <= (NOW() AT TIME ZONE 'UTC')`
  );
  await pool.execute(
    `DELETE FROM editorial_sessions
     WHERE last_seen_at IS NOT NULL
       AND last_seen_at < ((NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days')`
  );
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}
