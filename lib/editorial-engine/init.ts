import {
  createRoutedAiProvider,
  getAiRouter,
  refreshRouterConfiguredCache,
} from './ai/ai-router.js';
import { createDbQueue } from './adapters/queue.db.js';
import { createInProcessScheduler } from './adapters/scheduler.inprocess.js';
import { createMysqlStorage } from './adapters/storage.mysql.js';
import { bootstrapAdminFromEnv } from './db/admin-repo.js';
import { ensureAiProviderSettings } from './db/ai-settings-repo.js';
import { ensureDefaultContentTypes } from './db/content-types-repo.js';
import { ensureDefaultPrompts } from './db/prompts-repo.js';
import { ensureDefaultSettings } from './db/settings-repo.js';
import { ensureStrategySettings } from './db/strategy-settings-repo.js';
import { purgeExpiredSessions } from './auth/session.js';
import { ensureEditorialSchema } from './schema-bootstrap.js';
import type { AiProviderPort, QueuePort, SchedulerPort, StoragePort } from './types.js';
import { pool } from '../db.js';
import { EDITORIAL_ENGINE_VERSION, EDITORIAL_PHASE } from './constants.js';

export interface EditorialRuntime {
  ready: boolean;
  scheduler: SchedulerPort;
  queue: QueuePort;
  ai: AiProviderPort;
  storage: StoragePort;
}

let runtime: EditorialRuntime | null = null;

/**
 * Idempotent bootstrap. Safe when MySQL is down (returns ready:false).
 */
export async function initEditorialEngine(): Promise<EditorialRuntime> {
  const scheduler = createInProcessScheduler();
  const queue = createDbQueue();
  // Multi-provider AI Router (Groq retained as first-class provider + env fallback)
  const ai = createRoutedAiProvider();
  const storage = createMysqlStorage();

  if (!pool) {
    runtime = { ready: false, scheduler, queue, ai, storage };
    console.warn('⚠️  Editorial Engine inactive — MySQL unavailable');
    return runtime;
  }

  try {
    const reachable = await storage.ping();
    if (!reachable) {
      runtime = { ready: false, scheduler, queue, ai, storage };
      console.warn('⚠️  Editorial Engine inactive — MySQL connection refused');
      return runtime;
    }

    await ensureEditorialSchema();
    await ensureDefaultSettings();
    await ensureStrategySettings();
    await ensureDefaultPrompts();
    await ensureDefaultContentTypes();
    await ensureAiProviderSettings();
    try {
      const has = await getAiRouter().hasAnyProvider();
      refreshRouterConfiguredCache(has);
    } catch {
      /* optional */
    }
    await bootstrapAdminFromEnv();
    await purgeExpiredSessions();

    // Daily pipeline tick (gated by scheduler_enabled inside handler). Sunday refresh not implemented.
    const { schedulerDailyTick } = await import('./automation/daily-pipeline.js');
    scheduler.register('daily_generate', 'settings:publishing_time_utc+timezone', async () => {
      await schedulerDailyTick();
    });
    scheduler.register('sunday_refresh', 'settings:refresh_cron', async () => {
      /* P7: intentionally empty — Sunday Refresh is out of scope */
    });
    scheduler.start();

    // Async draft_generate worker (1s tick + kick on enqueue)
    const { startDraftWorkerLoop } = await import('./jobs/draft-generate-worker.js');
    startDraftWorkerLoop();

    // Async revision_batch worker (Fix Issues — continues if user leaves page)
    const { startRevisionWorkerLoop } = await import('./jobs/revision-batch-worker.js');
    startRevisionWorkerLoop();

    runtime = { ready: true, scheduler, queue, ai, storage };
    try {
      const { warmBlogPublicCache } = await import('./blog/blog-cache.js');
      await warmBlogPublicCache();
    } catch {
      /* blog cache optional at boot */
    }
    console.log(
      `✅ Editorial Engine ${EDITORIAL_PHASE} (${EDITORIAL_ENGINE_VERSION}) initialized — daily automation ready (scheduler gated by settings)`
    );
    return runtime;
  } catch (err) {
    const message = err instanceof Error ? err.message || (err as NodeJS.ErrnoException).code || 'unknown error' : String(err);
    console.warn('⚠️  Editorial Engine init failed:', message);
    runtime = { ready: false, scheduler, queue, ai, storage };
    return runtime;
  }
}

export function getEditorialRuntime(): EditorialRuntime | null {
  return runtime;
}
