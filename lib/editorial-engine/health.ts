import { EDITORIAL_ENGINE_VERSION, EDITORIAL_PHASE } from './constants.js';
import { isAdminConfigured } from './db/admin-repo.js';
import { getActivePrompt } from './db/prompts-repo.js';
import { getSettings } from './db/settings-repo.js';
import { getEditorialRuntime } from './init.js';
import { isEditorialSchemaReady } from './schema-bootstrap.js';
import type { ComponentReadiness, EditorialHealth } from './types.js';
import { pool } from '../db.js';

async function pingMysql(): Promise<boolean> {
  if (!pool) return false;
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch {
    return false;
  }
}

function component(ready: boolean, status: string, detail?: string): ComponentReadiness {
  return { ready, status, detail };
}

function baseDisabled(
  message: string,
  extras: Partial<EditorialHealth> = {}
): EditorialHealth {
  const offline = component(false, 'offline');
  return {
    ok: false,
    state: 'disabled',
    version: EDITORIAL_ENGINE_VERSION,
    phase: EDITORIAL_PHASE,
    database: false,
    schema_ready: false,
    admin_configured: false,
    auto_publish: false,
    automation_paused: false,
    message,
    components: {
      database: offline,
      scheduler: offline,
      writer: offline,
      reviewer: offline,
      refresh: offline,
      strategy: offline,
    },
    ...extras,
  };
}

export async function getEditorialHealth(): Promise<EditorialHealth> {
  if (!pool) {
    return baseDisabled('Editorial Engine disabled — MySQL pool unavailable (COL app unaffected).');
  }

  // Schema check also proves connectivity — skip a separate ping RTT on the hot path.
  const schema_ready = await isEditorialSchemaReady();
  if (!schema_ready) {
    const databaseUp = await pingMysql();
    if (!databaseUp) {
      return baseDisabled('Editorial Engine disabled — MySQL connection refused (COL app unaffected).');
    }
    return baseDisabled(
      'Editorial schema not ready — run db/editorial-schema.sql or restart after MySQL is up.',
      {
        database: true,
        components: {
          database: component(true, 'connected'),
          scheduler: component(false, 'unavailable'),
          writer: component(false, 'unavailable'),
          reviewer: component(false, 'unavailable'),
          refresh: component(false, 'unavailable'),
          strategy: component(false, 'unavailable'),
        },
      }
    );
  }

  const runtime = getEditorialRuntime();
  const registered = runtime?.scheduler.listRegistered() || [];
  const aiConfigured = Boolean(runtime?.ai.isConfigured());
  const [admin_configured, settings, writerPrompt, reviewerPrompt] = await Promise.all([
    isAdminConfigured(),
    getSettings(),
    getActivePrompt('master_system'),
    getActivePrompt('reviewer_system'),
  ]);

  const components = {
    database: component(true, 'connected'),
    scheduler: component(
      registered.length > 0,
      settings.scheduler_enabled ? 'enabled' : 'disabled',
      settings.scheduler_enabled
        ? `ON · ${settings.publishing_time_utc} ${settings.timezone} · ${registered.join(', ')}`
        : `OFF · registered: ${registered.join(', ') || 'none'}`
    ),
    writer: component(
      Boolean(writerPrompt) && aiConfigured,
      aiConfigured ? (writerPrompt ? 'configured' : 'prompt_missing') : 'ai_unconfigured',
      writerPrompt ? `prompt_v${writerPrompt.version}` : 'master_system missing'
    ),
    reviewer: component(
      Boolean(reviewerPrompt) && aiConfigured,
      aiConfigured ? (reviewerPrompt ? 'configured' : 'prompt_missing') : 'ai_unconfigured',
      reviewerPrompt ? `prompt_v${reviewerPrompt.version}` : 'reviewer_system missing'
    ),
    refresh: component(
      settings.refresh_enabled,
      settings.refresh_enabled ? 'enabled_idle' : 'disabled',
      `cron=${settings.refresh_cron} (engine not started until refresh phase)`
    ),
    strategy: component(
      true,
      'available',
      'P1 strategy engine + topic scoring ready'
    ),
  };

  if (!admin_configured) {
    return {
      ok: false,
      state: 'misconfigured',
      version: EDITORIAL_ENGINE_VERSION,
      phase: EDITORIAL_PHASE,
      database: true,
      schema_ready: true,
      admin_configured: false,
      auto_publish: Boolean(settings.auto_publish),
      automation_paused: Boolean(settings.automation_paused),
      message: 'Set EDITORIAL_ADMIN_PASSWORD (≥12 chars) and restart to bootstrap admin login.',
      components,
    };
  }

  return {
    ok: true,
    state: 'ready',
    version: EDITORIAL_ENGINE_VERSION,
    phase: EDITORIAL_PHASE,
    database: true,
    schema_ready: true,
    admin_configured: true,
    auto_publish: Boolean(settings.auto_publish),
    automation_paused: Boolean(settings.automation_paused),
    message: settings.scheduler_enabled
      ? 'Editorial Engine ready (P7). Daily scheduler ON — runs once per day at configured time.'
      : 'Editorial Engine ready (P7). Daily scheduler OFF — use Automation page for manual runs.',
    components,
  };
}
