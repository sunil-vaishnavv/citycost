/**
 * Quality reports repo — append-only. Never overwrite prior reports.
 */

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db.js';
import type { QualityReport } from '../reviewer/quality-report.js';

export interface QualityReportRow {
  id: number;
  article_id: number;
  attempt: number;
  passed: boolean;
  score: number | null;
  findings_json: QualityReport | Record<string, unknown>;
  created_at: Date;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function mapRow(row: RowDataPacket): QualityReportRow {
  return {
    id: Number(row.id),
    article_id: Number(row.article_id),
    attempt: Number(row.attempt),
    passed: Boolean(row.passed),
    score: row.score != null ? Number(row.score) : null,
    findings_json: parseJson(row.findings_json) as unknown as QualityReport,
    created_at: new Date(row.created_at),
  };
}

export async function nextReviewAttempt(articleId: number): Promise<number> {
  if (!pool) return 1;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(attempt), 0) AS m FROM editorial_quality_reports WHERE article_id = $1`,
    [articleId]
  );
  return Number(rows[0]?.m || 0) + 1;
}

/** Insert a new report row — never UPDATE existing findings. */
export async function insertQualityReport(input: {
  article_id: number;
  attempt: number;
  passed: boolean;
  score: number;
  findings: QualityReport;
}): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_quality_reports (article_id, attempt, passed, score, findings_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [
      input.article_id,
      input.attempt,
      input.passed,
      input.score,
      JSON.stringify(input.findings),
    ]
  );
  return result.insertId;
}

export async function listQualityReports(
  articleId: number
): Promise<QualityReportRow[]> {
  if (!pool) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, article_id, attempt, passed, score, findings_json, created_at
     FROM editorial_quality_reports
     WHERE article_id = $1
     ORDER BY attempt ASC, id ASC`,
    [articleId]
  );
  return rows.map(mapRow);
}

/**
 * Latest ACTIVE quality report (skips findings marked rolled_back / inactive).
 * Falls back to absolute latest if every row is inactive (backward compat).
 */
export async function getLatestQualityReport(
  articleId: number
): Promise<QualityReportRow | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, article_id, attempt, passed, score, findings_json, created_at
     FROM editorial_quality_reports
     WHERE article_id = $1
     ORDER BY attempt DESC, id DESC
     LIMIT 20`,
    [articleId]
  );
  if (!rows.length) return null;
  const mapped = rows.map(mapRow);
  const active = mapped.find((r) => {
    const f = r.findings_json as QualityReport & {
      rolled_back?: boolean;
      inactive?: boolean;
      report_status?: string;
    };
    if (!f || typeof f !== 'object') return true;
    if (f.rolled_back || f.inactive) return false;
    if (f.report_status === 'ROLLED_BACK' || f.report_status === 'inactive') return false;
    return true;
  });
  return active || mapped[0];
}

/** Mark a quality report inactive / rolled back in findings_json meta (no schema change). */
export async function markQualityReportRolledBack(
  reportId: number,
  reason: string
): Promise<void> {
  if (!pool || !Number.isFinite(reportId)) return;
  const row = await getQualityReportById(reportId);
  if (!row) return;
  const findings = {
    ...(row.findings_json as Record<string, unknown>),
    rolled_back: true,
    inactive: true,
    report_status: 'ROLLED_BACK',
    rollback_reason: reason,
    rolled_back_at: new Date().toISOString(),
  };
  await pool.execute(
    `UPDATE editorial_quality_reports SET findings_json = $1::jsonb WHERE id = $2`,
    [JSON.stringify(findings), reportId]
  );
}

export async function getQualityReportById(id: number): Promise<QualityReportRow | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, article_id, attempt, passed, score, findings_json, created_at
     FROM editorial_quality_reports
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}
