import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

export async function isAdminConfigured(): Promise<boolean> {
  if (!pool) return false;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM editorial_admin WHERE id = 1 LIMIT 1`
  );
  return Boolean(rows[0]);
}

export async function bootstrapAdminFromEnv(): Promise<boolean> {
  if (!pool) return false;
  const password = process.env.EDITORIAL_ADMIN_PASSWORD || '';
  if (!password || password.length < 12) {
    if (!(await isAdminConfigured())) {
      console.warn(
        '⚠️  Editorial admin not configured — set EDITORIAL_ADMIN_PASSWORD (≥12 chars) to enable login'
      );
    }
    return false;
  }

  if (!(await isAdminConfigured())) {
    const passwordHash = await hashPassword(password);
    await pool.execute<ResultSetHeader>(
      `INSERT INTO editorial_admin (id, password_hash) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         updated_at = (NOW() AT TIME ZONE 'UTC')`,
      [passwordHash]
    );
    console.log('✅ Editorial admin password bootstrapped from EDITORIAL_ADMIN_PASSWORD');
    return true;
  }

  if (process.env.NODE_ENV !== 'production') {
    const matches = await verifyAdminPassword(password);
    if (!matches) {
      const passwordHash = await hashPassword(password);
      await pool.execute<ResultSetHeader>(
        `UPDATE editorial_admin SET password_hash = $1, updated_at = (NOW() AT TIME ZONE 'UTC') WHERE id = 1`,
        [passwordHash]
      );
      console.log('✅ Editorial admin password synced from EDITORIAL_ADMIN_PASSWORD (development)');
      return true;
    }
  }

  return false;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!pool || !password) return false;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT password_hash FROM editorial_admin WHERE id = 1 LIMIT 1`
  );
  if (!rows[0]?.password_hash) return false;
  return verifyPassword(password, String(rows[0].password_hash));
}

export async function countArticlesByStatus(status: string): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*)::int AS c FROM editorial_articles WHERE status = $1`,
    [status]
  );
  return Number(rows[0]?.c || 0);
}

export async function countTopics(): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*)::int AS c FROM editorial_topics`
  );
  return Number(rows[0]?.c || 0);
}

export async function countUpcomingCalendar(): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*)::int AS c FROM editorial_calendar
     WHERE publish_date >= CURRENT_DATE AND status IN ('scheduled', 'generating', 'draft')`
  );
  return Number(rows[0]?.c || 0);
}

export async function countQueuedJobs(): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*)::int AS c FROM editorial_jobs WHERE status IN ('queued', 'running')`
  );
  return Number(rows[0]?.c || 0);
}

/** Single round-trip for dashboard count cards. */
export async function getDashboardCounts(): Promise<{
  articles_draft: number;
  articles_published: number;
  articles_failed: number;
  topics: number;
  calendar_upcoming: number;
  jobs_queued: number;
}> {
  if (!pool) {
    return {
      articles_draft: 0,
      articles_published: 0,
      articles_failed: 0,
      topics: 0,
      calendar_upcoming: 0,
      jobs_queued: 0,
    };
  }

  const [[articleRows], [topicRows], [calRows], [jobRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*)::int AS c
       FROM editorial_articles
       WHERE status IN ('draft', 'published', 'failed')
       GROUP BY status`
    ),
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*)::int AS c FROM editorial_topics`),
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*)::int AS c FROM editorial_calendar
       WHERE publish_date >= CURRENT_DATE AND status IN ('scheduled', 'generating', 'draft')`
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*)::int AS c FROM editorial_jobs WHERE status IN ('queued', 'running')`
    ),
  ]);

  const byStatus = new Map(
    articleRows.map((r) => [String(r.status), Number(r.c || 0)] as const)
  );
  return {
    articles_draft: byStatus.get('draft') || 0,
    articles_published: byStatus.get('published') || 0,
    articles_failed: byStatus.get('failed') || 0,
    topics: Number(topicRows[0]?.c || 0),
    calendar_upcoming: Number(calRows[0]?.c || 0),
    jobs_queued: Number(jobRows[0]?.c || 0),
  };
}
