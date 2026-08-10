import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import { DRAFT_GENERATE_JOB_TYPE } from '../jobs/draft-job-types.js';
import type { EditorialJobRow } from '../types.js';

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function mapJob(row: RowDataPacket): EditorialJobRow {
  return {
    id: Number(row.id),
    job_type: String(row.job_type),
    status: String(row.status),
    payload_json: parseJson<Record<string, unknown>>(row.payload_json),
    result_json: parseJson<Record<string, unknown>>(row.result_json),
    error_message: row.error_message != null ? String(row.error_message) : null,
    attempts: Number(row.attempts || 0),
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

const JOB_SELECT = `id, job_type, status, payload_json, result_json, error_message, attempts, created_at, updated_at`;

export async function getJobById(id: number): Promise<EditorialJobRow | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${JOB_SELECT} FROM editorial_jobs WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

/** One daily pipeline job per publish_date (application-enforced uniqueness). */
export async function findDailyPipelineJob(
  jobType: string,
  publishDate: string
): Promise<EditorialJobRow | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${JOB_SELECT} FROM editorial_jobs
     WHERE job_type = $1
       AND payload_json->>'publish_date' = $2
     ORDER BY id DESC
     LIMIT 1`,
    [jobType, publishDate]
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function insertJob(
  jobType: string,
  payload: Record<string, unknown>,
  runAfter?: Date | null
): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_jobs (job_type, status, payload_json, run_after, attempts)
     VALUES ($1, 'queued', $2::jsonb, $3, 0)
     RETURNING id`,
    [jobType, JSON.stringify(payload ?? {}), runAfter ?? null]
  );
  return result.insertId;
}

/** Atomically claim a queued job → running. Returns false if already claimed. */
export async function claimJob(id: number, lockedBy: string): Promise<boolean> {
  if (!pool) return false;
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE editorial_jobs
     SET status = 'running',
         locked_at = (NOW() AT TIME ZONE 'UTC'),
         locked_by = $1,
         attempts = attempts + 1,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $2 AND status IN ('queued', 'failed')`,
    [lockedBy, id]
  );
  return result.affectedRows > 0;
}

export async function completeJob(
  id: number,
  result: Record<string, unknown>
): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_jobs
     SET status = 'completed',
         result_json = $1::jsonb,
         error_message = NULL,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $2`,
    [JSON.stringify(result), id]
  );
}

export async function failJob(
  id: number,
  errorMessage: string,
  result?: Record<string, unknown> | null
): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_jobs
     SET status = 'failed',
         error_message = $1,
         result_json = $2::jsonb,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $3`,
    [errorMessage.slice(0, 2000), JSON.stringify(result ?? {}), id]
  );
}

export async function updateJobResult(
  id: number,
  result: Record<string, unknown>
): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  await pool.execute(
    `UPDATE editorial_jobs
     SET result_json = $1::jsonb,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $2`,
    [JSON.stringify(result), id]
  );
}

export async function listRecentJobs(opts: {
  jobType?: string;
  limit?: number;
}): Promise<EditorialJobRow[]> {
  if (!pool) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  if (opts.jobType) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ${JOB_SELECT} FROM editorial_jobs
       WHERE job_type = $1
       ORDER BY id DESC
       LIMIT ${limit}`,
      [opts.jobType]
    );
    return rows.map(mapJob);
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${JOB_SELECT} FROM editorial_jobs ORDER BY id DESC LIMIT ${limit}`
  );
  return rows.map(mapJob);
}

export async function countJobsByStatusToday(
  jobType: string,
  status: string,
  publishDate: string
): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*)::int AS c FROM editorial_jobs
     WHERE job_type = $1
       AND status = $2
       AND payload_json->>'publish_date' = $3`,
    [jobType, status, publishDate]
  );
  return Number(rows[0]?.c || 0);
}

export async function averageCompletedDurationMs(
  jobType: string,
  limit = 30
): Promise<number | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT result_json FROM editorial_jobs
     WHERE job_type = $1 AND status = 'completed'
       AND result_json->>'duration_ms' IS NOT NULL
     ORDER BY id DESC
     LIMIT ${Math.min(Math.max(limit, 1), 100)}`,
    [jobType]
  );
  const values: number[] = [];
  for (const row of rows) {
    const result = parseJson<Record<string, unknown>>(row.result_json);
    const ms = result?.duration_ms;
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) values.push(ms);
  }
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Claim next queued job of a type (FOR UPDATE SKIP LOCKED).
 * Returns claimed row or null.
 */
export async function claimNextQueuedJob(
  jobType: string,
  lockedBy: string
): Promise<EditorialJobRow | null> {
  if (!pool) return null;
  const client = pool;
  // Neon/pg via mysql2-compatible wrapper — use single UPDATE…RETURNING pattern
  const [rows] = await client.execute<RowDataPacket[]>(
    `WITH next AS (
       SELECT id FROM editorial_jobs
       WHERE job_type = $1
         AND status = 'queued'
         AND (run_after IS NULL OR run_after <= (NOW() AT TIME ZONE 'UTC'))
       ORDER BY id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE editorial_jobs j
     SET status = 'running',
         locked_at = (NOW() AT TIME ZONE 'UTC'),
         locked_by = $2,
         attempts = attempts + 1,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     FROM next
     WHERE j.id = next.id
     RETURNING j.id, j.job_type, j.status, j.payload_json, j.result_json,
               j.error_message, j.attempts, j.created_at, j.updated_at`,
    [jobType, lockedBy]
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

/** Deep-merge patch into result_json (shallow top-level + nested objects replaced by patch keys). */
export async function updateJobProgress(
  id: number,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!pool) throw new Error('Database unavailable');
  const current = await getJobById(id);
  const merged = {
    ...(current?.result_json || {}),
    ...patch,
  };
  await pool.execute(
    `UPDATE editorial_jobs
     SET result_json = $1::jsonb,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $2`,
    [JSON.stringify(merged), id]
  );
  return merged;
}

/** Request cancel: queued → failed immediately; running → flag cancel_requested. */
export async function requestJobCancel(id: number): Promise<{
  ok: boolean;
  status: string;
  message: string;
}> {
  if (!pool) throw new Error('Database unavailable');
  const job = await getJobById(id);
  if (!job) return { ok: false, status: 'missing', message: 'Job not found' };
  if (job.status === 'completed' || job.status === 'failed') {
    return { ok: false, status: job.status, message: `Job already ${job.status}` };
  }
  if (job.status === 'queued') {
    const result = {
      ...(job.result_json || {}),
      cancel_requested: true,
      stage: 'failed',
      stage_label: 'Cancelled',
      progress_pct: 100,
    };
    await failJob(id, 'Cancelled by user', result);
    return { ok: true, status: 'failed', message: 'Job cancelled before start' };
  }
  const result = {
    ...(job.result_json || {}),
    cancel_requested: true,
  };
  await updateJobResult(id, result);
  return { ok: true, status: 'running', message: 'Cancel requested — stopping at next safe point' };
}

export async function listDraftJobs(opts: {
  activeOnly?: boolean;
  limit?: number;
}): Promise<EditorialJobRow[]> {
  if (!pool) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  if (opts.activeOnly) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ${JOB_SELECT} FROM editorial_jobs
       WHERE job_type = $1 AND status IN ('queued', 'running')
       ORDER BY id DESC
       LIMIT ${limit}`,
      [DRAFT_GENERATE_JOB_TYPE]
    );
    return rows.map(mapJob);
  }
  return listRecentJobs({ jobType: DRAFT_GENERATE_JOB_TYPE, limit });
}

export async function findActiveDraftJobForTopic(
  topicId: number
): Promise<EditorialJobRow | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${JOB_SELECT} FROM editorial_jobs
     WHERE job_type = $1
       AND status IN ('queued', 'running')
       AND (payload_json->>'topic_id')::text = $2
     ORDER BY id DESC
     LIMIT 1`,
    [DRAFT_GENERATE_JOB_TYPE, String(topicId)]
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function isJobCancelRequested(id: number): Promise<boolean> {
  const job = await getJobById(id);
  if (!job) return true;
  if (job.status === 'failed' || job.status === 'completed') return true;
  return Boolean(job.result_json?.cancel_requested);
}
