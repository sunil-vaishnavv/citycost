/** Format helpers for IANA timezones used by the daily scheduler. */

export function zonedParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; dateStr: string; timeStr: string } {
  const tz = timeZone?.trim() || 'UTC';
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '00';

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { year, month, day, hour, minute, dateStr, timeStr };
}

export function localDateString(timeZone: string, now = new Date()): string {
  return zonedParts(now, timeZone).dateStr;
}

export function localTimeString(timeZone: string, now = new Date()): string {
  return zonedParts(now, timeZone).timeStr;
}

/** Next publish instant as ISO, or null if time invalid. Best-effort for dashboard. */
export function nextPublishAtIso(
  publishTimeHhMm: string,
  timeZone: string,
  now = new Date()
): string | null {
  const m = publishTimeHhMm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const targetH = parseInt(m[1], 10);
  const targetM = parseInt(m[2], 10);
  const parts = zonedParts(now, timeZone);
  const todayPassed =
    parts.hour > targetH || (parts.hour === targetH && parts.minute >= targetM);

  // Walk forward up to 48h in 1-minute steps to find next matching local HH:MM
  const start = new Date(now.getTime());
  if (todayPassed) {
    // jump ~1 minute past current minute to avoid same-minute match
    start.setUTCMinutes(start.getUTCMinutes() + 1);
  }
  for (let i = 0; i < 60 * 48; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    const z = zonedParts(candidate, timeZone);
    if (z.hour === targetH && z.minute === targetM) {
      return candidate.toISOString();
    }
  }
  return null;
}
