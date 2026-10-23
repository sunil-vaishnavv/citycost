import type { ResultSetHeader, RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import type { EditorialCalendarEntry, EditorialTopic } from '../types.js';
import { getTopicById } from './topics-repo.js';

function mapEntry(row: RowDataPacket, topic?: EditorialTopic | null): EditorialCalendarEntry {
  const dateVal = row.publish_date;
  const publish_date =
    dateVal instanceof Date
      ? dateVal.toISOString().slice(0, 10)
      : String(dateVal).slice(0, 10);
  return {
    id: Number(row.id),
    publish_date,
    topic_id: row.topic_id != null ? Number(row.topic_id) : null,
    status: String(row.status),
    notes: row.notes != null ? String(row.notes) : null,
    schedule_source: String(row.schedule_source || 'manual'),
    locked: Boolean(row.locked),
    locked_at: row.locked_at ? new Date(row.locked_at) : null,
    locked_by: row.locked_by != null ? String(row.locked_by) : null,
    skip_reason: row.skip_reason != null ? String(row.skip_reason) : null,
    topic: topic ?? null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

const ENTRY_SELECT = `id, publish_date, topic_id, status, notes, schedule_source, locked, locked_at, locked_by, skip_reason, created_at, updated_at`;

export async function getCalendarEntryByDate(date: string): Promise<EditorialCalendarEntry | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${ENTRY_SELECT} FROM editorial_calendar WHERE publish_date = $1 LIMIT 1`,
    [date]
  );
  if (!rows[0]) return null;
  const topic = rows[0].topic_id ? await getTopicById(Number(rows[0].topic_id)) : null;
  return mapEntry(rows[0], topic);
}

export async function getCalendarEntryById(id: number): Promise<EditorialCalendarEntry | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${ENTRY_SELECT} FROM editorial_calendar WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  const topic = rows[0].topic_id ? await getTopicById(Number(rows[0].topic_id)) : null;
  return mapEntry(rows[0], topic);
}

export async function listCalendarRange(
  from: string,
  to: string
): Promise<EditorialCalendarEntry[]> {
  if (!pool) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${ENTRY_SELECT} FROM editorial_calendar
     WHERE publish_date >= $1 AND publish_date <= $2
     ORDER BY publish_date ASC`,
    [from, to]
  );
  const out: EditorialCalendarEntry[] = [];
  for (const row of rows) {
    const topic = row.topic_id ? await getTopicById(Number(row.topic_id)) : null;
    out.push(mapEntry(row, topic));
  }
  return out;
}

/** Single-query next topic title for dashboard/automation status (avoids N+1). */
export async function getNextScheduledTopicTitle(fromDate: string): Promise<string | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.topic_id, t.title
     FROM editorial_calendar c
     LEFT JOIN editorial_topics t ON t.id = c.topic_id
     WHERE c.publish_date >= $1 AND c.status = 'scheduled'
     ORDER BY c.publish_date ASC
     LIMIT 1`,
    [fromDate]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.title) return String(row.title);
  if (row.topic_id != null) return `Topic #${Number(row.topic_id)}`;
  return null;
}

export async function findCalendarByTopicId(
  topicId: number
): Promise<EditorialCalendarEntry | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${ENTRY_SELECT} FROM editorial_calendar
     WHERE topic_id = $1 AND status = 'scheduled'
     ORDER BY publish_date ASC
     LIMIT 1`,
    [topicId]
  );
  if (!rows[0]) return null;
  return mapEntry(rows[0]);
}

export async function insertCalendarEntry(input: {
  publish_date: string;
  topic_id: number;
  status?: string;
  notes?: string | null;
  schedule_source: string;
}): Promise<number> {
  if (!pool) throw new Error('Database unavailable');
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_calendar
      (publish_date, topic_id, status, notes, schedule_source)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.publish_date,
      input.topic_id,
      input.status || 'scheduled',
      input.notes ?? null,
      input.schedule_source,
    ]
  );
  return result.insertId;
}

export async function updateCalendarEntry(
  id: number,
  patch: Partial<{
    publish_date: string;
    topic_id: number | null;
    status: string;
    notes: string | null;
    skip_reason: string | null;
    schedule_source: string;
    locked: boolean;
    locked_by: string | null;
  }>
): Promise<void> {
  if (!pool) throw new Error('Database unavailable');
  const sets: string[] = [];
  const params: Array<string | number | boolean | null> = [];
  let i = 1;
  if (patch.publish_date !== undefined) {
    sets.push(`publish_date = $${i++}`);
    params.push(patch.publish_date);
  }
  if (patch.topic_id !== undefined) {
    sets.push(`topic_id = $${i++}`);
    params.push(patch.topic_id);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(patch.status);
  }
  if (patch.notes !== undefined) {
    sets.push(`notes = $${i++}`);
    params.push(patch.notes);
  }
  if (patch.skip_reason !== undefined) {
    sets.push(`skip_reason = $${i++}`);
    params.push(patch.skip_reason);
  }
  if (patch.schedule_source !== undefined) {
    sets.push(`schedule_source = $${i++}`);
    params.push(patch.schedule_source);
  }
  if (patch.locked !== undefined) {
    sets.push(`locked = $${i++}`);
    params.push(patch.locked);
    if (patch.locked) {
      sets.push(`locked_at = (NOW() AT TIME ZONE 'UTC')`);
      sets.push(`locked_by = $${i++}`);
      params.push(patch.locked_by ?? 'admin');
    } else {
      sets.push('locked_at = NULL');
      sets.push('locked_by = NULL');
    }
  }
  if (!sets.length) return;
  params.push(id);
  await pool.execute(
    `UPDATE editorial_calendar SET ${sets.join(', ')} WHERE id = $${i}`,
    params
  );
}

export async function listOccupiedDates(from: string, to: string): Promise<Set<string>> {
  const entries = await listCalendarRange(from, to);
  const set = new Set<string>();
  for (const e of entries) {
    if (e.status === 'scheduled' || e.status === 'completed') set.add(e.publish_date);
  }
  return set;
}
