import type { ResultSetHeader, RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import { DEFAULT_EDITORIAL_SETTINGS, DEFAULT_STRATEGY_WEIGHTS } from '../constants.js';
import { assertAllowedGroqModel, isAllowedGroqModel } from '../groq-models.js';
import type { EditorialSettings, ReadingLevel, StrategyWeights } from '../types.js';

const READING_LEVELS = new Set<ReadingLevel>(['general', 'intermediate', 'advanced']);

function parseSettings(raw: unknown): EditorialSettings {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  const merged = { ...DEFAULT_EDITORIAL_SETTINGS, ...obj } as EditorialSettings;
  merged.strategy_weights = {
    ...DEFAULT_STRATEGY_WEIGHTS,
    ...(typeof obj.strategy_weights === 'object' && obj.strategy_weights
      ? (obj.strategy_weights as StrategyWeights)
      : {}),
  };
  if (!READING_LEVELS.has(merged.reading_level)) {
    merged.reading_level = 'general';
  }
  if (!isAllowedGroqModel(merged.writer_model)) {
    merged.writer_model = DEFAULT_EDITORIAL_SETTINGS.writer_model;
  }
  if (!isAllowedGroqModel(merged.reviewer_model)) {
    merged.reviewer_model = DEFAULT_EDITORIAL_SETTINGS.reviewer_model;
  }
  // Migrate legacy duplicate_threshold (e.g. 0.82) to critical policy (>= 0.90 → keep, else 0.95)
  if (
    typeof merged.duplicate_threshold !== 'number' ||
    Number.isNaN(merged.duplicate_threshold) ||
    merged.duplicate_threshold < 0.9
  ) {
    merged.duplicate_threshold = DEFAULT_EDITORIAL_SETTINGS.duplicate_threshold;
  } else {
    merged.duplicate_threshold = Math.min(1, Math.max(0.9, merged.duplicate_threshold));
  }
  return merged;
}

const SETTINGS_CACHE_TTL_MS = 15_000;
let settingsCache: { at: number; value: EditorialSettings } | null = null;
let settingsInflight: Promise<EditorialSettings> | null = null;

function cloneSettings(s: EditorialSettings): EditorialSettings {
  return {
    ...s,
    strategy_weights: { ...s.strategy_weights },
  };
}

export async function getSettings(): Promise<EditorialSettings> {
  if (!pool) return { ...DEFAULT_EDITORIAL_SETTINGS, strategy_weights: { ...DEFAULT_STRATEGY_WEIGHTS } };
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_CACHE_TTL_MS) {
    return cloneSettings(settingsCache.value);
  }
  if (!settingsInflight) {
    settingsInflight = (async () => {
      const [rows] = await pool!.execute<RowDataPacket[]>(
        `SELECT settings_json FROM editorial_settings WHERE id = 1 LIMIT 1`
      );
      if (!rows[0]) {
        const fallback = {
          ...DEFAULT_EDITORIAL_SETTINGS,
          strategy_weights: { ...DEFAULT_STRATEGY_WEIGHTS },
        };
        settingsCache = { at: Date.now(), value: fallback };
        return fallback;
      }
      const parsed = parseSettings(rows[0].settings_json);
      settingsCache = { at: Date.now(), value: parsed };
      return parsed;
    })().finally(() => {
      settingsInflight = null;
    });
  }
  return cloneSettings(await settingsInflight);
}

/** Insert defaults, or merge missing keys into existing JSON (additive settings). */
export async function ensureDefaultSettings(): Promise<void> {
  if (!pool) return;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, settings_json FROM editorial_settings WHERE id = 1 LIMIT 1`
  );
  if (!rows[0]) {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO editorial_settings (id, settings_json) VALUES (1, $1::jsonb)`,
      [JSON.stringify(DEFAULT_EDITORIAL_SETTINGS)]
    );
    return;
  }
  const merged = parseSettings(rows[0].settings_json);
  await pool.execute(
    `UPDATE editorial_settings SET settings_json = $1::jsonb, updated_at = (NOW() AT TIME ZONE 'UTC') WHERE id = 1`,
    [JSON.stringify(merged)]
  );
}

const PATCHABLE_KEYS = new Set<keyof EditorialSettings>([
  'writer_model',
  'reviewer_model',
  'temperature',
  'top_p',
  'max_tokens',
  'publishing_time_utc',
  'timezone',
  'scheduler_enabled',
  'automation_retry_count',
  'article_length_min',
  'article_length_target_min',
  'article_length_target_max',
  'article_length_max',
  'language',
  'reading_level',
  'auto_publish',
  'automation_paused',
  'quality_score_threshold',
  'duplicate_threshold',
  'internal_link_min',
  'internal_link_max',
  'max_writer_retries',
  'max_reviewer_retries',
  'auto_revision_enabled',
  'max_revision_attempts',
  'auto_revision_continue_pipeline',
  'articles_per_day',
  'session_ttl_hours',
  'session_idle_timeout_minutes',
  'refresh_enabled',
  'refresh_cron',
  'sitemap_ping_enabled',
  'freshness_skip_above',
  'freshness_pure_data_min',
  'freshness_partial_min',
  'strategy_weights',
  'strategy_max_candidates',
  'confidence_auto_publish_excellent',
  'confidence_action_excellent',
  'confidence_action_high',
  'confidence_action_medium',
  'confidence_action_low',
]);

export async function patchSettings(patch: Record<string, unknown>): Promise<EditorialSettings> {
  if (!pool) throw new Error('Database unavailable');
  const current = await getSettings();
  const next: EditorialSettings = {
    ...current,
    strategy_weights: { ...current.strategy_weights },
  };

  for (const [key, value] of Object.entries(patch)) {
    if (!PATCHABLE_KEYS.has(key as keyof EditorialSettings)) continue;
    if (key === 'strategy_weights' && value && typeof value === 'object') {
      next.strategy_weights = {
        ...next.strategy_weights,
        ...(value as StrategyWeights),
      };
      continue;
    }
    (next as unknown as Record<string, unknown>)[key] = value;
  }

  if (typeof next.auto_publish !== 'boolean') next.auto_publish = false;
  if (typeof next.confidence_auto_publish_excellent !== 'boolean') {
    next.confidence_auto_publish_excellent = false;
  }
  if (typeof next.automation_paused !== 'boolean') next.automation_paused = false;
  if (typeof next.scheduler_enabled !== 'boolean') next.scheduler_enabled = false;
  if (typeof next.auto_revision_enabled !== 'boolean') next.auto_revision_enabled = true;
  if (typeof next.auto_revision_continue_pipeline !== 'boolean') {
    next.auto_revision_continue_pipeline = true;
  }
  if (typeof next.max_revision_attempts !== 'number' || Number.isNaN(next.max_revision_attempts)) {
    next.max_revision_attempts = 3;
  }
  next.max_revision_attempts = Math.min(3, Math.max(1, Math.floor(next.max_revision_attempts)));
  if (typeof next.timezone !== 'string' || !next.timezone.trim()) next.timezone = 'UTC';
  else {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: next.timezone.trim() });
      next.timezone = next.timezone.trim();
    } catch {
      throw new Error(`Invalid timezone: ${next.timezone}`);
    }
  }
  if (typeof next.automation_retry_count !== 'number' || next.automation_retry_count < 0) {
    next.automation_retry_count = 3;
  }
  next.automation_retry_count = Math.min(10, Math.floor(next.automation_retry_count));
  if (typeof next.publishing_time_utc === 'string') {
    const m = next.publishing_time_utc.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error('publishing_time_utc must be HH:MM');
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    next.publishing_time_utc = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  if (!READING_LEVELS.has(next.reading_level)) next.reading_level = current.reading_level;
  if (typeof next.writer_model === 'string') {
    next.writer_model = assertAllowedGroqModel(next.writer_model.trim(), 'writer_model');
  }
  if (typeof next.reviewer_model === 'string') {
    next.reviewer_model = assertAllowedGroqModel(next.reviewer_model.trim(), 'reviewer_model');
  }
  if (typeof next.temperature !== 'number' || Number.isNaN(next.temperature)) {
    next.temperature = current.temperature;
  }
  if (typeof next.max_tokens !== 'number' || next.max_tokens < 256) {
    next.max_tokens = current.max_tokens;
  }
  if (typeof next.session_idle_timeout_minutes !== 'number' || next.session_idle_timeout_minutes < 5) {
    next.session_idle_timeout_minutes = current.session_idle_timeout_minutes;
  }
  if (typeof next.session_ttl_hours !== 'number' || next.session_ttl_hours < 1) {
    next.session_ttl_hours = current.session_ttl_hours;
  }
  if (next.article_length_min > next.article_length_max) {
    throw new Error('article_length_min cannot exceed article_length_max');
  }
  if (next.internal_link_min > next.internal_link_max) {
    throw new Error('internal_link_min cannot exceed internal_link_max');
  }
  if (
    typeof next.duplicate_threshold !== 'number' ||
    Number.isNaN(next.duplicate_threshold) ||
    next.duplicate_threshold < 0.9
  ) {
    next.duplicate_threshold = DEFAULT_EDITORIAL_SETTINGS.duplicate_threshold;
  } else {
    next.duplicate_threshold = Math.min(1, Math.max(0.9, next.duplicate_threshold));
  }

  await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_settings (id, settings_json) VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       settings_json = EXCLUDED.settings_json,
       updated_at = (NOW() AT TIME ZONE 'UTC')`,
    [JSON.stringify(next)]
  );
  settingsCache = { at: Date.now(), value: next };
  return cloneSettings(next);
}
