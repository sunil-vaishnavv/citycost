/**
 * Editorial Calendar service (P2).
 * Scheduling only — no AI generation, drafts, or publishing.
 */

import {
  findCalendarByTopicId,
  getCalendarEntryByDate,
  getCalendarEntryById,
  insertCalendarEntry,
  listCalendarRange,
  listOccupiedDates,
  updateCalendarEntry,
} from '../db/calendar-repo.js';
import { getStrategySettings } from '../db/strategy-settings-repo.js';
import {
  getTopicById,
  isTopicSchedulingLocked,
  listSchedulableTopics,
  lockTopic,
  setTopicStatus,
  unlockTopic,
} from '../db/topics-repo.js';
import type { EditorialCalendarEntry } from '../types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidDate(date: string): void {
  if (!DATE_RE.test(date)) throw new Error('publish_date must be YYYY-MM-DD');
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    throw new Error('publish_date is not a valid calendar date');
  }
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

function endOfMonth(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export async function getCalendarDay(date: string): Promise<{
  date: string;
  entry: EditorialCalendarEntry | null;
}> {
  assertValidDate(date);
  return { date, entry: await getCalendarEntryByDate(date) };
}

export async function getCalendarWeek(date: string): Promise<{
  from: string;
  to: string;
  entries: EditorialCalendarEntry[];
}> {
  assertValidDate(date);
  const from = startOfWeekMonday(date);
  const to = addDays(from, 6);
  return { from, to, entries: await listCalendarRange(from, to) };
}

export async function getCalendarMonth(date: string): Promise<{
  from: string;
  to: string;
  entries: EditorialCalendarEntry[];
}> {
  assertValidDate(date);
  const from = startOfMonth(date);
  const to = endOfMonth(date);
  return { from, to, entries: await listCalendarRange(from, to) };
}

/**
 * Validation rules for scheduling.
 */
export async function validateSchedule(opts: {
  publish_date: string;
  topic_id: number;
  allow_past?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    assertValidDate(opts.publish_date);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!opts.allow_past && opts.publish_date < today) {
    return { ok: false, error: 'Cannot schedule in the past' };
  }

  const existing = await getCalendarEntryByDate(opts.publish_date);
  if (existing && existing.status === 'scheduled') {
    return { ok: false, error: `Date ${opts.publish_date} already has a scheduled entry` };
  }
  if (existing?.locked) {
    return { ok: false, error: `Calendar date ${opts.publish_date} is locked` };
  }

  const topic = await getTopicById(opts.topic_id);
  if (!topic) return { ok: false, error: 'Topic not found' };
  if (isTopicSchedulingLocked(topic)) {
    return {
      ok: false,
      error: `Topic is locked or in-progress (status=${topic.status}, locked=${topic.locked})`,
    };
  }
  if (topic.status !== 'candidate' && topic.status !== 'approved') {
    return { ok: false, error: `Topic status '${topic.status}' is not schedulable` };
  }

  const already = await findCalendarByTopicId(opts.topic_id);
  if (already) {
    return {
      ok: false,
      error: `Topic already scheduled on ${already.publish_date}`,
    };
  }

  return { ok: true };
}

export async function scheduleTopicManual(opts: {
  publish_date: string;
  topic_id: number;
  notes?: string;
  allow_past?: boolean;
  schedule_source?: 'manual' | 'auto';
}): Promise<EditorialCalendarEntry> {
  const check = await validateSchedule(opts);
  if (check.ok === false) throw new Error(check.error);

  const source = opts.schedule_source || 'manual';
  const existing = await getCalendarEntryByDate(opts.publish_date);
  let id: number;
  if (existing && existing.status === 'skipped') {
    await updateCalendarEntry(existing.id, {
      topic_id: opts.topic_id,
      status: 'scheduled',
      notes: opts.notes ?? null,
      skip_reason: null,
      schedule_source: source,
    });
    id = existing.id;
  } else {
    id = await insertCalendarEntry({
      publish_date: opts.publish_date,
      topic_id: opts.topic_id,
      notes: opts.notes ?? null,
      schedule_source: source,
    });
  }

  await setTopicStatus(opts.topic_id, 'scheduled');
  await lockTopic(opts.topic_id, `scheduled:${opts.publish_date}`);
  const entry = await getCalendarEntryById(id);
  if (!entry) throw new Error('Failed to load calendar entry');
  return entry;
}

export async function autoScheduleTopics(opts: {
  from_date?: string;
  days?: number;
}): Promise<{
  scheduled: EditorialCalendarEntry[];
  skipped_dates: string[];
  message: string;
}> {
  const strategy = await getStrategySettings();
  const today = new Date().toISOString().slice(0, 10);
  const from = opts.from_date || today;
  assertValidDate(from);
  const days = Math.min(Math.max(opts.days ?? 14, 1), 90);
  const to = addDays(from, days - 1);

  const occupied = await listOccupiedDates(from, to);
  const openDates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    if (!occupied.has(d)) openDates.push(d);
  }

  const topics = await listSchedulableTopics({
    minScore: strategy.options.min_schedule_score,
    limit: openDates.length + 10,
  });

  const scheduled: EditorialCalendarEntry[] = [];
  const skipped_dates: string[] = [];
  let ti = 0;

  for (const date of openDates) {
    while (ti < topics.length && isTopicSchedulingLocked(topics[ti])) ti += 1;
    if (ti >= topics.length) {
      skipped_dates.push(date);
      continue;
    }
    const topic = topics[ti++];
    try {
      const entry = await scheduleTopicManual({
        publish_date: date,
        topic_id: topic.id,
        notes: 'auto-scheduled from priority queue',
        allow_past: date >= today,
        schedule_source: 'auto',
      });
      scheduled.push(entry);
    } catch {
      skipped_dates.push(date);
    }
  }

  return {
    scheduled,
    skipped_dates,
    message: `Auto-scheduled ${scheduled.length} of ${openDates.length} open dates`,
  };
}

export async function rescheduleCalendarEntry(opts: {
  entry_id: number;
  new_date: string;
  allow_past?: boolean;
}): Promise<EditorialCalendarEntry> {
  assertValidDate(opts.new_date);
  const entry = await getCalendarEntryById(opts.entry_id);
  if (!entry) throw new Error('Calendar entry not found');
  if (entry.locked) throw new Error('Calendar entry is locked');
  if (entry.status !== 'scheduled') {
    throw new Error(`Cannot reschedule entry in status '${entry.status}'`);
  }
  if (!entry.topic_id) throw new Error('Entry has no topic');

  const today = new Date().toISOString().slice(0, 10);
  if (!opts.allow_past && opts.new_date < today) {
    throw new Error('Cannot reschedule to a past date');
  }

  const target = await getCalendarEntryByDate(opts.new_date);
  if (target && target.id !== entry.id && target.status === 'scheduled') {
    throw new Error(`Target date ${opts.new_date} already scheduled`);
  }
  if (target?.locked) throw new Error(`Target date ${opts.new_date} is locked`);

  await updateCalendarEntry(entry.id, { publish_date: opts.new_date });
  await lockTopic(entry.topic_id, `scheduled:${opts.new_date}`);
  const updated = await getCalendarEntryById(entry.id);
  if (!updated) throw new Error('Failed to load rescheduled entry');
  return updated;
}

export async function skipCalendarEntry(opts: {
  entry_id: number;
  reason?: string;
}): Promise<EditorialCalendarEntry> {
  const entry = await getCalendarEntryById(opts.entry_id);
  if (!entry) throw new Error('Calendar entry not found');
  if (entry.locked) throw new Error('Calendar entry is locked — unlock first');

  await updateCalendarEntry(entry.id, {
    status: 'skipped',
    skip_reason: opts.reason || 'Skipped by admin',
    topic_id: entry.topic_id,
  });

  if (entry.topic_id) {
    const topic = await getTopicById(entry.topic_id);
    if (topic && topic.status === 'scheduled') {
      await setTopicStatus(entry.topic_id, 'approved');
      await unlockTopic(entry.topic_id);
    }
  }

  const updated = await getCalendarEntryById(entry.id);
  if (!updated) throw new Error('Failed to load skipped entry');
  return updated;
}

export async function lockCalendarEntry(
  entry_id: number,
  locked_by = 'admin'
): Promise<EditorialCalendarEntry> {
  const entry = await getCalendarEntryById(entry_id);
  if (!entry) throw new Error('Calendar entry not found');
  await updateCalendarEntry(entry_id, { locked: true, locked_by });
  const updated = await getCalendarEntryById(entry_id);
  if (!updated) throw new Error('Failed to load locked entry');
  return updated;
}

export async function unlockCalendarEntry(entry_id: number): Promise<EditorialCalendarEntry> {
  const entry = await getCalendarEntryById(entry_id);
  if (!entry) throw new Error('Calendar entry not found');
  await updateCalendarEntry(entry_id, { locked: false, locked_by: null });
  const updated = await getCalendarEntryById(entry_id);
  if (!updated) throw new Error('Failed to load unlocked entry');
  return updated;
}
