import type { ResultSetHeader, RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import { DEFAULT_STRATEGY_WEIGHTS } from '../constants.js';
import type { StrategyWeights } from '../types.js';

export interface StrategySettings {
  weights: StrategyWeights;
  options: {
    max_candidates: number;
    min_schedule_score: number;
  };
}

const DEFAULT_OPTIONS = {
  /** New unique topics to insert per Generate Topics run (hard-capped at 2 in engine). */
  max_candidates: 2,
  min_schedule_score: 20,
};

function parseWeights(raw: unknown): StrategyWeights {
  let obj: Partial<StrategyWeights> = {};
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Partial<StrategyWeights>;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Partial<StrategyWeights>;
  }
  const merged: StrategyWeights = { ...DEFAULT_STRATEGY_WEIGHTS, ...obj };
  // Upgrade path from scorer v2 keys
  if (obj.search_demand == null && typeof obj.search_opportunity === 'number') {
    merged.search_demand = obj.search_opportunity;
  }
  if (obj.authority_opportunity == null && typeof obj.topical_authority === 'number') {
    merged.authority_opportunity = obj.topical_authority;
  }
  if (obj.freshness == null && typeof obj.seasonal_opportunity === 'number') {
    merged.freshness = obj.seasonal_opportunity;
  }
  if (obj.min_accept_score == null) {
    merged.min_accept_score = DEFAULT_STRATEGY_WEIGHTS.min_accept_score;
  }
  return merged;
}

function parseOptions(raw: unknown): StrategySettings['options'] {
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
  const rawMax =
    typeof obj.max_candidates === 'number' ? obj.max_candidates : DEFAULT_OPTIONS.max_candidates;
  return {
    max_candidates: Math.min(2, Math.max(1, Math.floor(rawMax))),
    min_schedule_score:
      typeof obj.min_schedule_score === 'number'
        ? obj.min_schedule_score
        : DEFAULT_OPTIONS.min_schedule_score,
  };
}

export async function ensureStrategySettings(): Promise<void> {
  if (!pool) return;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM editorial_strategy_settings WHERE id = 1 LIMIT 1`
  );
  if (rows[0]) return;
  await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_strategy_settings (id, weights_json, options_json)
     VALUES (1, $1::jsonb, $2::jsonb)`,
    [JSON.stringify(DEFAULT_STRATEGY_WEIGHTS), JSON.stringify(DEFAULT_OPTIONS)]
  );
}

export async function getStrategySettings(): Promise<StrategySettings> {
  if (!pool) {
    return { weights: { ...DEFAULT_STRATEGY_WEIGHTS }, options: { ...DEFAULT_OPTIONS } };
  }
  await ensureStrategySettings();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT weights_json, options_json FROM editorial_strategy_settings WHERE id = 1 LIMIT 1`
  );
  if (!rows[0]) {
    return { weights: { ...DEFAULT_STRATEGY_WEIGHTS }, options: { ...DEFAULT_OPTIONS } };
  }
  return {
    weights: parseWeights(rows[0].weights_json),
    options: parseOptions(rows[0].options_json),
  };
}

export async function patchStrategySettings(patch: {
  weights?: Partial<StrategyWeights>;
  options?: Partial<StrategySettings['options']>;
}): Promise<StrategySettings> {
  if (!pool) throw new Error('Database unavailable');
  const current = await getStrategySettings();
  const next: StrategySettings = {
    weights: { ...current.weights, ...(patch.weights || {}) },
    options: { ...current.options, ...(patch.options || {}) },
  };
  await pool.execute(
    `INSERT INTO editorial_strategy_settings (id, weights_json, options_json)
     VALUES (1, $1::jsonb, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       weights_json = EXCLUDED.weights_json,
       options_json = EXCLUDED.options_json,
       updated_at = (NOW() AT TIME ZONE 'UTC')`,
    [JSON.stringify(next.weights), JSON.stringify(next.options)]
  );
  return next;
}
