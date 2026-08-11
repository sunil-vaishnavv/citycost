import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  clearSessionCookie,
  getSessionTokenFromRequest,
  originAllowed,
  setSessionCookie,
} from './auth/cookies.js';
import { createSession, destroySession, validateSession } from './auth/session.js';
import {
  getDashboardCounts,
  isAdminConfigured,
  verifyAdminPassword,
} from './db/admin-repo.js';
import { listContentTypes, patchContentType } from './db/content-types-repo.js';
import { getActivePrompt, listPromptsByCategory, updatePromptBody } from './db/prompts-repo.js';
import { getSettings, patchSettings } from './db/settings-repo.js';
import { GROQ_CHAT_MODELS } from './groq-models.js';
import {
  getGroqKeyAppliedAtMs,
  getGroqKeyStatus,
  syncGroqKeyFromEnvFile,
  updateGroqApiKey,
} from './secrets/groq-env.js';
import {
  getStrategySettings,
  patchStrategySettings,
} from './db/strategy-settings-repo.js';
import {
  approveTopic,
  bulkTopicAction,
  getTopicById,
  getTopicDashboardStats,
  listTopicIds,
  listTopics,
  lockTopic,
  setTopicStatus,
  unlockTopic,
  type BulkTopicAction,
  type TopicListSort,
} from './db/topics-repo.js';
import { listArticles, getArticleById, deleteArticle } from './db/articles-repo.js';
import { getLatestWriterGenerationDebug } from './db/generation-logs-repo.js';
import { estimateGroqCostUsd } from './ai-cost.js';
import {
  getLatestQualityReport,
  getQualityReportById,
  listQualityReports,
} from './db/quality-reports-repo.js';
import {
  autoScheduleTopics,
  getCalendarDay,
  getCalendarMonth,
  getCalendarWeek,
  lockCalendarEntry,
  rescheduleCalendarEntry,
  scheduleTopicManual,
  skipCalendarEntry,
  unlockCalendarEntry,
} from './calendar/calendar-service.js';
import { getEditorialHealth } from './health.js';
import { getEditorialRuntime } from './init.js';
import {
  getAutomationStatus,
  retryFailedTodaysJob,
  runTodaysPipeline,
} from './automation/daily-pipeline.js';
import { listClusters } from './strategy/cluster-registry.js';
import {
  countOpenContentGaps,
  detectContentGaps,
  listContentGaps,
} from './strategy/content-gaps.js';
import { runEditorialStrategy } from './strategy/strategy-engine.js';
import { previewResearchPack } from './research/index.js';
import { buildStructuredContext } from './writer/context-pack.js';
import {
  enqueueDraftGenerate,
  kickDraftWorker,
  retryDraftJob,
} from './jobs/draft-generate-worker.js';
import {
  enqueueRevisionBatch,
  findActiveRevisionJobForArticle,
  kickRevisionWorker,
  retryRevisionJob,
} from './jobs/revision-batch-worker.js';
import { subscribeDraftJob } from './jobs/draft-job-events.js';
import { DRAFT_GENERATE_JOB_TYPE } from './jobs/draft-job-types.js';
import { REVISION_BATCH_JOB_TYPE } from './jobs/revision-batch-types.js';
import {
  getJobById,
  listDraftJobs,
  listRecentJobs,
  requestJobCancel,
} from './db/jobs-repo.js';
import { getArticleReviewHistory, reviewArticle } from './reviewer/review.js';
import { generateArticleSeo, getArticlePreview } from './seo/generate-seo.js';
import { listInternalLinks } from './db/internal-links-repo.js';
import { getPublishReadiness } from './publish/publish-gate.js';
import { publishArticle, unpublishArticle, updatePublishedContent } from './publish/publish.js';
import {
  EDITORIAL_ENGINE_VERSION,
  EDITORIAL_PHASE,
  PROMPT_CATEGORIES,
  TOPIC_STATUSES,
} from './constants.js';
import type { EditorialDashboard, PromptCategory } from './types.js';
import { pool } from '../db.js';

async function requireEditorialAuth(req: Request, res: Response, next: NextFunction) {
  if (!pool) {
    return res.status(503).json({ error: 'Editorial Engine disabled (MySQL unavailable).' });
  }
  const token = getSessionTokenFromRequest(req);
  const ok = await validateSession(token);
  if (!ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function requireOrigin(req: Request, res: Response, next: NextFunction) {
  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  return next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export function createEditorialRouter(): Router {
  const router = Router();

  /** Public readiness (no secrets). */
  router.get('/health', async (_req, res) => {
    const health = await getEditorialHealth();
    res.status(health.ok ? 200 : 503).json(health);
  });

  router.post('/auth/login', loginLimiter, requireOrigin, async (req, res) => {
    try {
      if (!pool) {
        return res.status(503).json({ error: 'Editorial Engine disabled (MySQL unavailable).' });
      }
      if (!(await isAdminConfigured())) {
        return res.status(503).json({
          error: 'Admin not configured. Set EDITORIAL_ADMIN_PASSWORD and restart.',
        });
      }
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password) {
        return res.status(400).json({ error: 'password is required' });
      }
      const valid = await verifyAdminPassword(password);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const { token, expiresAt } = await createSession({
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });
      console.log('[login] Created session, token hash:', token.slice(0, 16) + '...');
      setSessionCookie(res, token, expiresAt);
      return res.json({
        ok: true,
        expires_at: expiresAt.toISOString(),
        // Also return token for non-browser admin tooling (Bearer).
        token,
      });
    } catch (err) {
      console.error('editorial login error:', err);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  router.post('/auth/logout', requireOrigin, async (req, res) => {
    const token = getSessionTokenFromRequest(req);
    await destroySession(token);
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  router.get('/dashboard', requireEditorialAuth, async (_req, res) => {
    const {
      getObservabilityDashboardMetricsFast,
    } = await import('./observability/dashboard-metrics.js');

    // Core cards first: parallelize independent reads. Observability is cache-only
    // here (no cold compute) so Neon aggregates never contend with count cards.
    const [health, settings, automation, counts, contentGapsOpen, observability] =
      await Promise.all([
        getEditorialHealth(),
        getSettings(),
        getAutomationStatus(),
        getDashboardCounts(),
        countOpenContentGaps(),
        getObservabilityDashboardMetricsFast(30),
      ]);

    const payload: EditorialDashboard = {
      health,
      counts: {
        ...counts,
        content_gaps_open: contentGapsOpen,
      },
      settings_summary: {
        auto_publish: settings.auto_publish,
        automation_paused: settings.automation_paused,
        scheduler_enabled: settings.scheduler_enabled,
        timezone: settings.timezone,
        writer_model: settings.writer_model,
        reviewer_model: settings.reviewer_model,
        publishing_time_utc: settings.publishing_time_utc,
        articles_per_day: settings.articles_per_day,
        reading_level: settings.reading_level,
        automation_retry_count: settings.automation_retry_count,
      },
      automation: {
        today_job: automation.today_job,
        next_publish: automation.next_publish,
        next_topic_title: automation.next_topic_title,
        published_today: automation.published_today,
        failed_today: automation.failed_today,
        avg_generation_ms: automation.avg_generation_ms,
      },
      ...(observability ? { observability } : {}),
    };
    return res.json(payload);
  });

  /** Progressive load for charts / cost / confidence (same shape as dashboard.observability). */
  router.get('/dashboard/observability', requireEditorialAuth, async (_req, res) => {
    const { getObservabilityDashboardMetrics } = await import('./observability/dashboard-metrics.js');
    const observability = await getObservabilityDashboardMetrics(30);
    return res.json({ observability });
  });

  router.get('/automation', requireEditorialAuth, async (_req, res) => {
    // Keep live Groq key in sync with `.env` before reporting job errors.
    syncGroqKeyFromEnvFile();
    const status = await getAutomationStatus();
    return res.json({
      ...status,
      groq_key_applied_at: getGroqKeyAppliedAtMs(),
    });
  });

  router.post('/automation/run-today', requireEditorialAuth, requireOrigin, async (_req, res) => {
    try {
      const result = await runTodaysPipeline({ source: 'manual' });
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) {
      console.error('editorial automation run-today error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Pipeline failed' });
    }
  });

  router.post('/automation/retry', requireEditorialAuth, requireOrigin, async (_req, res) => {
    try {
      const result = await retryFailedTodaysJob();
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) {
      console.error('editorial automation retry error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Retry failed' });
    }
  });

  router.get('/settings', requireEditorialAuth, async (_req, res) => {
    const settings = await getSettings();
    return res.json({ settings });
  });

  router.patch('/settings', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const settings = await patchSettings(body as Record<string, unknown>);
      return res.json({ settings });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message || 'Invalid settings' });
    }
  });

  /** Groq-only AI config — syncs from `.env` on every read; full key for admin view toggle. */
  router.get('/ai/groq', requireEditorialAuth, async (_req, res) => {
    const rt = getEditorialRuntime();
    return res.json({
      ...getGroqKeyStatus(),
      ai_configured: Boolean(rt?.ai.isConfigured()),
      models: GROQ_CHAT_MODELS,
    });
  });

  router.put('/ai/groq', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const apiKey = typeof body.api_key === 'string' ? body.api_key : '';
      const status = updateGroqApiKey(apiKey);
      const rt = getEditorialRuntime();
      return res.json({
        ...status,
        ai_configured: Boolean(rt?.ai.isConfigured()),
        models: GROQ_CHAT_MODELS,
        message: 'GROQ_API_KEY updated and applied (no restart needed)',
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message || 'Failed to update GROQ_API_KEY' });
    }
  });

  // ── Multi-provider AI management ───────────────────────────────────────────
  router.get('/ai/providers', requireEditorialAuth, async (_req, res) => {
    try {
      const {
        listAiProviderSettings,
        getProviderTodayStats,
      } = await import('./db/ai-settings-repo.js');
      const { statusColor } = await import('./ai/provider-health.js');
      const { getProviderDefaults } = await import('./ai/provider-config.js');
      const providers = await listAiProviderSettings();
      const enriched = await Promise.all(
        providers.map(async (p) => {
          const today = await getProviderTodayStats(p.provider_name);
          const def = getProviderDefaults(p.provider_name);
          const { api_key: _secret, ...safe } = p;
          return {
            ...safe,
            label: def.label,
            env_key: def.env_key || null,
            models: p.models || def.models,
            supports_json: def.supports_json,
            supports_streaming: def.supports_streaming,
            supports_long_context: def.supports_long_context,
            status_color: statusColor(p.status),
            ...today,
          };
        })
      );
      return res.json({ providers: enriched });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message || 'Failed to list providers' });
    }
  });

  router.patch('/ai/providers/:name', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const { PROVIDER_DEFAULTS } = await import('./ai/provider-config.js');
      const name = String(req.params.name || '') as import('./ai/types.js').AiProviderName;
      const allowed = new Set(PROVIDER_DEFAULTS.map((p) => p.name));
      if (!allowed.has(name)) return res.status(400).json({ error: 'Unknown provider' });
      const { patchAiProviderSetting } = await import('./db/ai-settings-repo.js');
      const { refreshRouterConfiguredCache, getAiRouter } = await import('./ai/ai-router.js');
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const updated = await patchAiProviderSetting(name, body as Record<string, unknown>);
      refreshRouterConfiguredCache(await getAiRouter().hasAnyProvider());
      return res.json({
        provider: { ...updated, api_key: undefined },
        message: `${name} settings saved`,
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message || 'Failed to save provider' });
    }
  });

  router.post('/ai/providers/:name/test', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const { PROVIDER_DEFAULTS } = await import('./ai/provider-config.js');
      const name = String(req.params.name || '') as import('./ai/types.js').AiProviderName;
      const allowed = new Set(PROVIDER_DEFAULTS.map((p) => p.name));
      if (!allowed.has(name)) return res.status(400).json({ error: 'Unknown provider' });
      const { testProviderConnection } = await import('./ai/provider-health.js');
      const result = await testProviderConnection(name);
      return res.json({ result });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message || 'Test failed' });
    }
  });

  router.get('/ai/usage', requireEditorialAuth, async (req, res) => {
    try {
      const days = req.query.days ? parseInt(String(req.query.days), 10) : 7;
      const { getAiUsageSummary } = await import('./db/ai-settings-repo.js');
      const summary = await getAiUsageSummary(Number.isFinite(days) ? days : 7);
      return res.json({ summary });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message || 'Usage summary failed' });
    }
  });

  router.get('/prompts/:key', requireEditorialAuth, async (req, res) => {
    const prompt = await getActivePrompt(req.params.key);
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });
    return res.json({ prompt });
  });

  router.get('/prompts', requireEditorialAuth, async (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    if (category && !PROMPT_CATEGORIES.includes(category as PromptCategory)) {
      return res.status(400).json({ error: 'Invalid category', allowed: PROMPT_CATEGORIES });
    }
    const prompts = await listPromptsByCategory(category as PromptCategory | undefined);
    return res.json({ prompts, categories: PROMPT_CATEGORIES });
  });

  router.patch('/prompts/:key', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
      const category =
        typeof req.body?.category === 'string' ? (req.body.category as PromptCategory) : undefined;
      const prompt = await updatePromptBody(req.params.key, body, title, category);
      return res.json({ prompt });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message || 'Invalid prompt' });
    }
  });

  router.get('/content-types', requireEditorialAuth, async (_req, res) => {
    const content_types = await listContentTypes();
    return res.json({ content_types });
  });

  router.patch('/content-types/:typeKey', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const updated = await patchContentType(req.params.typeKey, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Content type not found' });
      return res.json({ content_type: updated });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message || 'Invalid content type' });
    }
  });

  router.post('/automation/pause', requireEditorialAuth, requireOrigin, async (_req, res) => {
    const settings = await patchSettings({ automation_paused: true });
    return res.json({ ok: true, automation_paused: settings.automation_paused });
  });

  router.post('/automation/resume', requireEditorialAuth, requireOrigin, async (_req, res) => {
    const settings = await patchSettings({ automation_paused: false });
    return res.json({ ok: true, automation_paused: settings.automation_paused });
  });

  // ── P1: Strategy + Topics + Clusters ───────────────────────────────────────

  router.post('/strategy/run', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const rawMax =
        typeof req.body?.max_candidates === 'number' ? req.body.max_candidates : undefined;
      // Always at most 2 unique new topics per research run.
      const maxCandidates =
        typeof rawMax === 'number' && Number.isFinite(rawMax)
          ? Math.min(2, Math.max(1, Math.floor(rawMax)))
          : 2;
      const maxCountries =
        typeof req.body?.max_countries === 'number' ? req.body.max_countries : undefined;
      const result = await runEditorialStrategy({ maxCandidates, maxCountries });
      return res.json(result);
    } catch (err) {
      console.error('editorial strategy/run error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Strategy run failed' });
    }
  });

  function parseTopicListFilters(req: { query: Record<string, unknown> }) {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const content_type =
      typeof req.query.content_type === 'string' ? req.query.content_type : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const country = typeof req.query.country === 'string' ? req.query.country : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const intent = typeof req.query.intent === 'string' ? req.query.intent : undefined;
    const cluster = typeof req.query.cluster === 'string' ? req.query.cluster : undefined;
    const priority = typeof req.query.priority === 'string' ? req.query.priority : undefined;
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'score_desc';
    const allowedSort = new Set([
      'score_desc',
      'score_asc',
      'newest',
      'oldest',
      'country',
      'city',
      'priority',
      'recent',
    ]);
    const sort = (allowedSort.has(sortRaw) ? sortRaw : 'score_desc') as TopicListSort;
    const score_min = req.query.score_min ? parseFloat(String(req.query.score_min)) : undefined;
    const score_max = req.query.score_max ? parseFloat(String(req.query.score_max)) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    return {
      status,
      content_type,
      q,
      country,
      city,
      intent,
      cluster,
      priority,
      score_min: Number.isFinite(score_min) ? score_min : undefined,
      score_max: Number.isFinite(score_max) ? score_max : undefined,
      sort,
      limit,
      offset,
    };
  }

  router.get('/topics', requireEditorialAuth, async (req, res) => {
    // One-shot persist cleanup for QA cert-batch markers left in topic titles
    try {
      const { scrubCertNoiseFromTopics } = await import('./db/topics-repo.js');
      await scrubCertNoiseFromTopics();
    } catch (err) {
      console.warn('editorial topics cert scrub:', (err as Error).message);
    }
    const filters = parseTopicListFilters(req);
    const result = await listTopics(filters);
    return res.json(result);
  });

  router.get('/topics/stats', requireEditorialAuth, async (_req, res) => {
    const stats = await getTopicDashboardStats();
    return res.json({ stats, scorer_version: '3.0.0' });
  });

  router.get('/topics/ids', requireEditorialAuth, async (req, res) => {
    const filters = parseTopicListFilters(req);
    const result = await listTopicIds(filters);
    return res.json(result);
  });

  router.post('/topics/manual', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { createManualTopicService } = await import('./manual/manual-service.js');
      const result = await createManualTopicService({
        title: typeof body.title === 'string' ? body.title : '',
        content_type: typeof body.content_type === 'string' ? body.content_type : 'guide',
        cluster_id:
          body.cluster_id != null && Number.isFinite(Number(body.cluster_id))
            ? Number(body.cluster_id)
            : null,
        brief: typeof body.brief === 'string' ? body.brief : undefined,
        city: typeof body.city === 'string' ? body.city : undefined,
        country: typeof body.country === 'string' ? body.country : undefined,
        comparison: typeof body.comparison === 'string' ? body.comparison : undefined,
      });
      const topic = await getTopicById(result.topic_id);
      return res.status(201).json({ ok: true, ...result, topic });
    } catch (err) {
      console.error('editorial topics/manual error:', err);
      return res.status(400).json({ error: (err as Error).message || 'Create manual topic failed' });
    }
  });

  router.post('/topics/bulk', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action || '') as BulkTopicAction;
      const allowed = new Set(['approve', 'reject', 'archive', 'delete']);
      if (!allowed.has(action)) {
        return res.status(400).json({ error: 'Invalid bulk action' });
      }
      const ids = Array.isArray(body.ids)
        ? body.ids.map((x: unknown) => parseInt(String(x), 10)).filter((n: number) => Number.isFinite(n))
        : [];
      if (!ids.length) return res.status(400).json({ error: 'No topic ids provided' });
      if (ids.length > 2000) return res.status(400).json({ error: 'Max 2000 topics per bulk action' });
      const result = await bulkTopicAction(ids, action);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message || 'Bulk action failed' });
    }
  });

  router.get('/topics/:id', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid topic id' });
    const topic = await getTopicById(id);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    return res.json({ topic });
  });

  router.post('/topics/:id/approve', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const topic = await approveTopic(id);
      if (!topic) return res.status(404).json({ error: 'Topic not found' });
      return res.json({ topic });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/topics/:id/reject', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const topic = await getTopicById(id);
      if (!topic) return res.status(404).json({ error: 'Topic not found' });
      if (topic.locked) {
        return res.status(400).json({ error: 'Topic is locked and cannot be rejected' });
      }
      await setTopicStatus(id, 'rejected');
      const updated = await getTopicById(id);
      return res.json({ topic: updated });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/topics/:id/archive', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const topic = await getTopicById(id);
      if (!topic) return res.status(404).json({ error: 'Topic not found' });
      if (topic.locked || topic.status === 'published') {
        return res.status(400).json({ error: 'Topic cannot be archived' });
      }
      await setTopicStatus(id, 'archived');
      return res.json({ topic: await getTopicById(id) });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/topics/:id/lock', requireEditorialAuth, requireOrigin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual lock';
    const topic = await lockTopic(id, reason);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    return res.json({ topic });
  });

  router.post('/topics/:id/unlock', requireEditorialAuth, requireOrigin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const topic = await unlockTopic(id);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    return res.json({ topic });
  });

  router.get('/clusters', requireEditorialAuth, async (_req, res) => {
    const clusters = await listClusters();
    return res.json({ clusters });
  });

  router.get('/strategy/settings', requireEditorialAuth, async (_req, res) => {
    const settings = await getStrategySettings();
    return res.json({ settings });
  });

  router.patch('/strategy/settings', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const settings = await patchStrategySettings({
        weights: req.body?.weights,
        options: req.body?.options,
      });
      return res.json({ settings });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/content-gaps', requireEditorialAuth, async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const gap_type = typeof req.query.gap_type === 'string' ? req.query.gap_type : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    const result = await listContentGaps({ status, gap_type, limit, offset });
    return res.json(result);
  });

  router.post('/content-gaps/detect', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const result = await detectContentGaps({
        maxCountries:
          typeof req.body?.max_countries === 'number' ? req.body.max_countries : undefined,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── P2: Calendar ───────────────────────────────────────────────────────────

  router.get('/calendar/day', requireEditorialAuth, async (req, res) => {
    try {
      const date = typeof req.query.date === 'string' ? req.query.date : '';
      const result = await getCalendarDay(date);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/calendar/week', requireEditorialAuth, async (req, res) => {
    try {
      const date = typeof req.query.date === 'string' ? req.query.date : '';
      const result = await getCalendarWeek(date);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/calendar/month', requireEditorialAuth, async (req, res) => {
    try {
      const date = typeof req.query.date === 'string' ? req.query.date : '';
      const result = await getCalendarMonth(date);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/calendar/schedule', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const publish_date = typeof req.body?.publish_date === 'string' ? req.body.publish_date : '';
      const topic_id = Number(req.body?.topic_id);
      const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
      const entry = await scheduleTopicManual({ publish_date, topic_id, notes });
      return res.status(201).json({ entry });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/calendar/auto-schedule', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const result = await autoScheduleTopics({
        from_date: typeof req.body?.from_date === 'string' ? req.body.from_date : undefined,
        days: typeof req.body?.days === 'number' ? req.body.days : undefined,
      });
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/calendar/:id/reschedule', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const entry_id = parseInt(req.params.id, 10);
      const new_date = typeof req.body?.new_date === 'string' ? req.body.new_date : '';
      const entry = await rescheduleCalendarEntry({ entry_id, new_date });
      return res.json({ entry });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/calendar/:id/skip', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const entry_id = parseInt(req.params.id, 10);
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const entry = await skipCalendarEntry({ entry_id, reason });
      return res.json({ entry });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/calendar/:id/lock', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const entry_id = parseInt(req.params.id, 10);
      const locked_by = typeof req.body?.locked_by === 'string' ? req.body.locked_by : 'admin';
      const entry = await lockCalendarEntry(entry_id, locked_by);
      return res.json({ entry });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/calendar/:id/unlock', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const entry_id = parseInt(req.params.id, 10);
      const entry = await unlockCalendarEntry(entry_id);
      return res.json({ entry });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/meta/topic-statuses', requireEditorialAuth, (_req, res) => {
    return res.json({ statuses: TOPIC_STATUSES });
  });

  // ── P3: Writer / Drafts (async background jobs) ────────────────────────────

  router.post('/articles/generate', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const topic_id = Number(req.body?.topic_id);
      if (!Number.isFinite(topic_id)) {
        return res.status(400).json({ error: 'topic_id is required' });
      }
      const result = await enqueueDraftGenerate({
        topic_id,
        source: 'manual',
        reuse_research: Boolean(req.body?.reuse_research),
      });
      if (!result.ok) {
        return res.status(422).json(result);
      }
      kickDraftWorker();
      return res.status(202).json({
        ok: true,
        jobId: result.jobId,
        status: result.status || 'queued',
        message: result.message,
      });
    } catch (err) {
      console.error('editorial articles/generate enqueue error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Failed to queue draft generation' });
    }
  });

  function serializeJob(job: NonNullable<Awaited<ReturnType<typeof getJobById>>>) {
    const progress = (job.result_json || {}) as Record<string, unknown>;
    return {
      id: job.id,
      job_type: job.job_type,
      status: job.status,
      payload: job.payload_json,
      progress,
      error_message: job.error_message,
      attempts: job.attempts,
      created_at: job.created_at,
      updated_at: job.updated_at,
      article_id:
        typeof progress.article_id === 'number'
          ? progress.article_id
          : typeof job.payload_json?.article_id === 'number'
            ? job.payload_json.article_id
            : typeof job.result_json?.article_id === 'number'
              ? job.result_json.article_id
              : null,
      topic_id:
        typeof job.payload_json?.topic_id === 'number'
          ? job.payload_json.topic_id
          : Number(job.payload_json?.topic_id) || null,
      topic_title:
        typeof job.payload_json?.topic_title === 'string'
          ? job.payload_json.topic_title
          : typeof progress.topic_title === 'string'
            ? progress.topic_title
            : null,
    };
  }

  router.get('/jobs', requireEditorialAuth, async (req, res) => {
    try {
      const activeOnly = String(req.query.active || '') === '1' || String(req.query.active) === 'true';
      const type = String(req.query.type || DRAFT_GENERATE_JOB_TYPE);
      const limit = Number(req.query.limit) || 20;
      if (type === 'all' || type === 'draft_generate,revision_batch') {
        const [drafts, revisions] = await Promise.all([
          listDraftJobs({ activeOnly, limit }),
          listRecentJobs({ jobType: REVISION_BATCH_JOB_TYPE, limit }),
        ]);
        const filtered = activeOnly
          ? [...drafts, ...revisions.filter((j) => j.status === 'queued' || j.status === 'running')]
          : [...drafts, ...revisions];
        filtered.sort((a, b) => b.id - a.id);
        return res.json({ jobs: filtered.slice(0, limit).map(serializeJob) });
      }
      if (type === REVISION_BATCH_JOB_TYPE) {
        const jobs = await listRecentJobs({ jobType: REVISION_BATCH_JOB_TYPE, limit });
        const filtered = activeOnly
          ? jobs.filter((j) => j.status === 'queued' || j.status === 'running')
          : jobs;
        return res.json({ jobs: filtered.map(serializeJob) });
      }
      const jobs = await listDraftJobs({ activeOnly, limit });
      return res.json({ jobs: jobs.map(serializeJob) });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/jobs/:id', requireEditorialAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid job id' });
      const job = await getJobById(id);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      return res.json({ job: serializeJob(job) });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/jobs/:id/events', requireEditorialAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid job id' });
      const job = await getJobById(id);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
        (res as Response & { flushHeaders: () => void }).flushHeaders();
      }

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send('snapshot', serializeJob(job));

      if (job.status === 'completed' || job.status === 'failed') {
        send('done', serializeJob(job));
        res.end();
        return;
      }

      const unsub = subscribeDraftJob(id, (payload) => {
        send('progress', {
          id: payload.jobId,
          status: payload.status,
          progress: payload.progress,
          error_message: payload.error_message ?? null,
          article_id: payload.progress.article_id ?? null,
          topic_id: payload.progress.topic_id,
          topic_title: payload.progress.topic_title ?? null,
        });
        if (payload.status === 'completed' || payload.status === 'failed') {
          send('done', {
            id: payload.jobId,
            status: payload.status,
            progress: payload.progress,
            error_message: payload.error_message ?? null,
            article_id: payload.progress.article_id ?? null,
          });
          cleanup();
          res.end();
        }
      });

      const heartbeat = setInterval(() => {
        res.write(`: ping\n\n`);
      }, 15000);

      const poll = setInterval(async () => {
        try {
          const latest = await getJobById(id);
          if (!latest) return;
          send('snapshot', serializeJob(latest));
          if (latest.status === 'completed' || latest.status === 'failed') {
            send('done', serializeJob(latest));
            cleanup();
            res.end();
          }
        } catch {
          /* ignore poll errors */
        }
      }, 4000);

      const cleanup = () => {
        unsub();
        clearInterval(heartbeat);
        clearInterval(poll);
      };

      req.on('close', () => {
        cleanup();
      });
    } catch (err) {
      if (!res.headersSent) {
        return res.status(500).json({ error: (err as Error).message });
      }
      res.end();
    }
  });

  router.post('/jobs/:id/cancel', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid job id' });
      const result = await requestJobCancel(id);
      const job = await getJobById(id);
      if (job) {
        const { emitDraftJobUpdate } = await import('./jobs/draft-job-events.js');
        emitDraftJobUpdate({
          jobId: id,
          status: job.status,
          progress: (job.result_json || {}) as unknown as import('./jobs/draft-job-types.js').DraftJobProgress,
          error_message: job.error_message,
        });
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/jobs/:id/retry', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid job id' });
      const prior = await getJobById(id);
      if (!prior) return res.status(404).json({ error: 'Job not found' });
      if (prior.job_type === REVISION_BATCH_JOB_TYPE) {
        const result = await retryRevisionJob(id);
        if (!result.ok) return res.status(422).json(result);
        kickRevisionWorker();
        return res.status(202).json(result);
      }
      const result = await retryDraftJob(id);
      if (!result.ok) return res.status(422).json(result);
      return res.status(202).json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/articles/:id/regenerate-faq', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const { regenerateArticleFaq } = await import('./faq/index.js');
      const faq = await regenerateArticleFaq(id);
      return res.status(faq.ok ? 200 : 422).json(faq);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message || 'FAQ regenerate failed' });
    }
  });

  router.get('/articles/research-preview', requireEditorialAuth, async (req, res) => {
    try {
      const topic_id = Number(req.query.topic_id);
      if (!Number.isFinite(topic_id)) {
        return res.status(400).json({ error: 'topic_id is required' });
      }
      const topic = await getTopicById(topic_id);
      if (!topic) return res.status(404).json({ error: 'Topic not found' });
      const context = buildStructuredContext(topic);
      const { pack, validation } = previewResearchPack(topic, context);
      return res.json({
        topic,
        research: pack,
        validation,
        context_summary: {
          known_facts: context.known_facts,
          data_gaps: context.data_gaps,
          related_cities: context.related_cities.length,
          related_comparisons: context.related_comparisons.length,
        },
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/articles', requireEditorialAuth, async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const sourceRaw = typeof req.query.source === 'string' ? req.query.source : undefined;
    const source =
      sourceRaw === 'manual' || sourceRaw === 'automatic' ? sourceRaw : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 30;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    // Persist-clean cert-batch markers left in article titles/slugs
    try {
      const { scrubCertNoiseFromArticles } = await import('./utils/clean-article-identity.js');
      await scrubCertNoiseFromArticles();
    } catch (err) {
      console.warn('editorial articles cert scrub:', (err as Error).message);
    }
    const result = await listArticles({ status, q, source, limit, offset });
    const { articleSource } = await import('./utils/article-origin.js');
    const articles = result.articles.map((a) => ({
      ...a,
      source: articleSource(a),
    }));
    return res.json({ articles, total: result.total });
  });

  router.post('/articles/manual', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { createManualArticleService } = await import('./manual/manual-service.js');
      const blocks = Array.isArray(body.blocks) ? body.blocks : [];
      const result = await createManualArticleService({
        seo_title: typeof body.seo_title === 'string' ? body.seo_title : '',
        meta_title: typeof body.meta_title === 'string' ? body.meta_title : undefined,
        meta_description:
          typeof body.meta_description === 'string' ? body.meta_description : '',
        excerpt: typeof body.excerpt === 'string' ? body.excerpt : '',
        slug: typeof body.slug === 'string' ? body.slug : undefined,
        content_type: typeof body.content_type === 'string' ? body.content_type : undefined,
        cluster_id:
          body.cluster_id != null && Number.isFinite(Number(body.cluster_id))
            ? Number(body.cluster_id)
            : undefined,
        topic_id:
          body.topic_id != null && Number.isFinite(Number(body.topic_id))
            ? Number(body.topic_id)
            : undefined,
        blocks,
      });
      return res.status(201).json({ ok: true, ...result });
    } catch (err) {
      console.error('editorial articles/manual error:', err);
      return res.status(400).json({ error: (err as Error).message || 'Create manual article failed' });
    }
  });

  router.post('/articles/manual/from-topic/:topicId', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const topicId = parseInt(req.params.topicId, 10);
      if (!Number.isFinite(topicId)) return res.status(400).json({ error: 'Invalid topic id' });
      const { createManualArticleFromTopic } = await import('./manual/manual-service.js');
      const result = await createManualArticleFromTopic(topicId);
      return res.status(201).json({ ok: true, ...result });
    } catch (err) {
      console.error('editorial articles/manual/from-topic error:', err);
      return res.status(400).json({ error: (err as Error).message || 'Create manual article failed' });
    }
  });

  router.put('/articles/:id/manual', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { updateManualArticleService } = await import('./manual/manual-service.js');
      const result = await updateManualArticleService(id, {
        seo_title: typeof body.seo_title === 'string' ? body.seo_title : undefined,
        meta_title: typeof body.meta_title === 'string' ? body.meta_title : undefined,
        meta_description:
          typeof body.meta_description === 'string' ? body.meta_description : undefined,
        excerpt: typeof body.excerpt === 'string' ? body.excerpt : undefined,
        slug: typeof body.slug === 'string' ? body.slug : undefined,
        blocks: Array.isArray(body.blocks) ? body.blocks : undefined,
        featured_image:
          body.featured_image === null
            ? null
            : body.featured_image && typeof body.featured_image === 'object'
              ? (body.featured_image as { url: string; alt?: string; path?: string })
              : undefined,
        primary_keyword: typeof body.primary_keyword === 'string' ? body.primary_keyword : undefined,
        semantic_keywords: Array.isArray(body.semantic_keywords)
          ? body.semantic_keywords.map(String)
          : undefined,
      });
      return res.json(result);
    } catch (err) {
      console.error('editorial articles/manual update error:', err);
      return res.status(400).json({ error: (err as Error).message || 'Update failed' });
    }
  });

  router.post('/articles/:id/prepare-manual-publish', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const { prepareManualArticleForPublish } = await import('./manual/manual-service.js');
      const result = await prepareManualArticleForPublish(id);
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) {
      console.error('editorial prepare-manual-publish error:', err);
      return res.status(400).json({ error: (err as Error).message || 'Prepare failed' });
    }
  });

  router.post('/articles/:id/manual/generate-seo', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { generateManualSeoSuggestion } = await import('./manual/manual-seo-ai.js');
      const blocks = Array.isArray(body.blocks) ? body.blocks : [];
      if (!blocks.length && typeof body.content_html !== 'string') {
        return res.status(400).json({ error: 'Provide blocks or save content first' });
      }
      let finalBlocks = blocks;
      if (!finalBlocks.length && typeof body.content_html === 'string') {
        const article = await getArticleById(id);
        finalBlocks = Array.isArray(article?.blocks_json)
          ? (article!.blocks_json as import('./writer/draft-validate.js').DraftBlock[])
          : [];
      }
      const suggestion = await generateManualSeoSuggestion({
        title: typeof body.seo_title === 'string' ? body.seo_title : '',
        blocks: finalBlocks,
        excerpt: typeof body.excerpt === 'string' ? body.excerpt : undefined,
        articleId: id,
      });
      return res.json({ ok: true, suggestion });
    } catch (err) {
      console.error('editorial manual/generate-seo error:', err);
      return res.status(400).json({ error: (err as Error).message || 'SEO generation failed' });
    }
  });

  router.post('/articles/:id/featured-image', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { uploadManualFeaturedImage } = await import('./manual/manual-service.js');
      const result = await uploadManualFeaturedImage({
        articleId: id,
        dataBase64: String(body.data_base64 || body.dataBase64 || ''),
        mime: String(body.mime || body.content_type || 'image/jpeg'),
        alt: typeof body.alt === 'string' ? body.alt : undefined,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('editorial featured-image upload error:', err);
      return res.status(400).json({ error: (err as Error).message || 'Upload failed' });
    }
  });

  router.delete('/articles/:id/featured-image', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const { removeManualFeaturedImage } = await import('./manual/manual-service.js');
      await removeManualFeaturedImage(id);
      return res.json({ ok: true });
    } catch (err) {
      console.error('editorial featured-image delete error:', err);
      return res.status(400).json({ error: (err as Error).message || 'Remove failed' });
    }
  });

  /** Strip cert-batch QA markers from unpublished article title/slug */
  router.post('/articles/:id/clean-identity', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const { cleanArticlePublicIdentity } = await import('./utils/clean-article-identity.js');
      const result = await cleanArticlePublicIdentity(id);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('editorial articles/clean-identity error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Clean identity failed' });
    }
  });

  router.get('/articles/:id', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    let article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    // Auto-strip cert-batch noise from unpublished titles/slugs on load
    try {
      const { hasCertBatchNoise } = await import('./utils/clean-title.js');
      if (
        hasCertBatchNoise(article.seo_title) ||
        hasCertBatchNoise(article.meta_title) ||
        (article.status !== 'published' && hasCertBatchNoise(article.slug))
      ) {
        const { cleanArticlePublicIdentity } = await import('./utils/clean-article-identity.js');
        await cleanArticlePublicIdentity(id);
        article = (await getArticleById(id)) || article;
      }
    } catch (err) {
      console.warn('editorial clean-identity on load:', (err as Error).message);
    }
    // Omit raw by default for list detail
    const { raw_ai_response: _raw, ...safe } = article;
    const fromLog = await getLatestWriterGenerationDebug(id);
    const promptTokens = fromLog?.prompt_tokens ?? safe.tokens_in ?? null;
    const completionTokens = fromLog?.completion_tokens ?? safe.tokens_out ?? null;
    const totalTokens =
      promptTokens != null || completionTokens != null
        ? (promptTokens || 0) + (completionTokens || 0)
        : null;
    const researchPack = article.research_pack_json
      ? JSON.stringify(article.research_pack_json)
      : '';
    const generation_debug = {
      ai_model: fromLog?.ai_model ?? safe.ai_model ?? null,
      prompt_version: fromLog?.prompt_version ?? safe.prompt_version ?? null,
      generation_time_ms: fromLog?.generation_time_ms ?? safe.generation_time_ms ?? null,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_ai_cost_usd:
        fromLog?.estimated_ai_cost_usd ??
        estimateGroqCostUsd({
          model: safe.ai_model,
          tokens_in: promptTokens,
          tokens_out: completionTokens,
        }),
      research_pack_size_chars:
        fromLog?.research_pack_size_chars ?? (researchPack ? researchPack.length : null),
      prompt_size_chars: fromLog?.prompt_size_chars ?? null,
    };
    const { articleSource } = await import('./utils/article-origin.js');
    return res.json({
      article: { ...safe, generation_debug, source: articleSource(article) },
    });
  });

  router.get('/articles/:id/raw', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    return res.json({
      id: article.id,
      slug: article.slug,
      raw_ai_response: article.raw_ai_response,
      draft_json: article.draft_json,
      research_pack_json: article.research_pack_json,
      prompt_version: article.prompt_version,
      prompt_hash: article.prompt_hash,
      ai_model: article.ai_model,
    });
  });

  // ── P4: Reviewer / Quality ─────────────────────────────────────────────────

  router.post('/articles/:id/review', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const result = await reviewArticle(id);
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) {
      console.error('editorial articles/review error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Review failed' });
    }
  });

  /** P4.5 — Fix Issues as async revision_batch job (timeline + reconnect). Body.sync=true for blocking. */
  router.post('/articles/:id/revise', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const sync =
        req.body?.sync === true ||
        String(req.query.sync || '') === '1' ||
        String(req.query.sync) === 'true';

      if (sync) {
        const { autoFixArticle } = await import('./revision/revision-service.js');
        const { getRevisionStats } = await import('./revision/revision-history.js');
        const result = await autoFixArticle(id);
        const verification = await getRevisionStats(30);
        return res.status(result.ok ? 200 : 422).json({ ...result, verification });
      }

      const result = await enqueueRevisionBatch({
        article_id: id,
        reuse_report: true,
        source: 'manual',
      });
      if (!result.ok) return res.status(422).json(result);
      kickRevisionWorker();
      return res.status(202).json({
        ok: true,
        jobId: result.jobId,
        status: result.status || 'queued',
        message: result.message,
        async: true,
      });
    } catch (err) {
      console.error('editorial articles/revise error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Revision failed' });
    }
  });

  router.get('/articles/:id/revision-job', requireEditorialAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const active = await findActiveRevisionJobForArticle(id);
      if (active) {
        return res.json({ job: { id: active.id, status: active.status, progress: active.progress } });
      }
      // Fall back to most recent revision_batch for this article (reconnect after complete/fail)
      const recent = await listRecentJobs({ jobType: REVISION_BATCH_JOB_TYPE, limit: 40 });
      const match = recent.find(
        (j) => Number(j.payload_json?.article_id || j.result_json?.article_id) === id
      );
      if (!match) return res.json({ job: null });
      return res.json({
        job: {
          id: match.id,
          status: match.status,
          progress: match.result_json,
          error_message: match.error_message,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/articles/:id/revisions', requireEditorialAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const article = await getArticleById(id);
      if (!article) return res.status(404).json({ error: 'Article not found' });
      const { listRevisionHistory } = await import('./revision/revision-history.js');
      const revisions = await listRevisionHistory(id);
      return res.json({ article_id: id, revisions });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message || 'Failed to load revisions' });
    }
  });

  router.get('/articles/:id/observability', requireEditorialAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const article = await getArticleById(id);
      if (!article) return res.status(404).json({ error: 'Article not found' });
      const { getArticleCostAnalytics } = await import('./observability/cost-analytics.js');
      const { computeArticleHealth } = await import('./observability/article-health.js');
      const latest = await getLatestQualityReport(id);
      const findings = (latest?.findings_json || null) as Record<string, unknown> | null;
      const { listRevisionHistory } = await import('./revision/revision-history.js');
      const revisions = await listRevisionHistory(id);
      const cost = await getArticleCostAnalytics(id);
      const decision = (findings?.decision as string) || null;
      const overall_confidence =
        (findings?.overall_confidence as number) ?? article.overall_confidence ?? null;
      const confidence_level =
        (findings?.confidence_level as string) ?? article.confidence_level ?? null;
      const article_health =
        (findings?.article_health as string) ||
        article.article_health ||
        computeArticleHealth({
          status: article.status,
          decision,
          overall_confidence,
          confidence_level: confidence_level as 'Excellent' | 'High' | 'Medium' | 'Low' | null,
        });
      return res.json({
        article_id: id,
        article_health,
        overall_confidence,
        confidence_level,
        confidence_breakdown: findings?.confidence_breakdown ?? null,
        prompt_versions: findings?.prompt_versions ?? null,
        revision_count: revisions.length,
        total_ai_cost_usd: cost.total_cost_usd,
        cost,
        provider_analytics: cost.by_provider,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message || 'Observability failed' });
    }
  });

  router.get('/articles/:id/export-debug', requireEditorialAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const { buildArticleDebugBundle } = await import('./observability/debug-bundle.js');
      const bundle = await buildArticleDebugBundle(id);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="article-${id}-debug-bundle.json"`
      );
      return res.status(200).json(bundle);
    } catch (err) {
      const message = (err as Error).message || 'Export failed';
      if (/not found/i.test(message)) return res.status(404).json({ error: message });
      return res.status(500).json({ error: message });
    }
  });

  router.get('/revision/stats', requireEditorialAuth, async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days || '30'), 10) || 30, 1), 365);
      const { getRevisionStats } = await import('./revision/revision-history.js');
      const stats = await getRevisionStats(days);
      return res.json({ days, ...stats });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message || 'Failed to load revision stats' });
    }
  });

  router.get('/articles/:id/reviews', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const history = await getArticleReviewHistory(id);
    return res.json(history);
  });

  router.get('/articles/:id/quality-report', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const latest = await getLatestQualityReport(id);
    if (!latest) return res.status(404).json({ error: 'No quality report yet' });
    return res.json({ report: latest });
  });

  router.get('/quality-reports/:id', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid report id' });
    const report = await getQualityReportById(id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    return res.json({ report });
  });

  router.get('/articles/:id/quality-reports', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const reports = await listQualityReports(id);
    return res.json({ article_id: id, reports });
  });

  // ── P5: SEO / Internal Links / Preview (admin-only) ────────────────────────

  router.post('/articles/:id/seo/generate', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const result = await generateArticleSeo(id);
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) {
      console.error('editorial seo/generate error:', err);
      return res.status(500).json({ error: (err as Error).message || 'SEO generation failed' });
    }
  });

  router.get('/articles/:id/seo', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    return res.json({
      article_id: id,
      seo_package: article.seo_package_json,
      entity_map: article.entity_map_json,
      json_ld: article.json_ld_json,
      internal_links: article.internal_links_json,
      seo_validation: article.seo_validation_json,
      preview_version: article.preview_version,
      canonical_url: article.canonical_url,
    });
  });

  router.get('/articles/:id/internal-links', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const rows = await listInternalLinks(id);
    return res.json({
      article_id: id,
      package: article.internal_links_json,
      rows,
    });
  });

  router.get('/articles/:id/schema', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    return res.json({
      article_id: id,
      json_ld: article.json_ld_json,
      schema_status:
        article.json_ld_json && typeof article.json_ld_json === 'object'
          ? (article.json_ld_json as { schema_status?: unknown }).schema_status
          : null,
    });
  });

  router.get('/articles/:id/preview', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const preview = await getArticlePreview(id);
    if (!preview) return res.status(404).json({ error: 'Article not found' });
    return res.json({ preview });
  });

  // ── P6: Manual publish / unpublish ─────────────────────────────────────────

  router.get('/articles/:id/publish-readiness', requireEditorialAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
    const readiness = await getPublishReadiness(id);
    return res.json({ readiness });
  });

  router.post('/articles/:id/publish', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const result = await publishArticle(id);
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) {
      console.error('editorial publish error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Publish failed' });
    }
  });

  router.post('/articles/:id/unpublish', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const result = await unpublishArticle(id);
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) {
      console.error('editorial unpublish error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Unpublish failed' });
    }
  });

  /** Manual in-place content update for published articles — skips review. */
  router.post('/articles/:id/update-content', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await updatePublishedContent(id, {
        draft: body.draft,
        blocks: body.blocks,
      });
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) {
      console.error('editorial update-content error:', err);
      return res.status(500).json({ error: (err as Error).message || 'Update failed' });
    }
  });

  router.post('/articles/:id/delete', requireEditorialAuth, requireOrigin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article id' });
      const confirmSlug =
        typeof req.body?.confirm_slug === 'string' ? req.body.confirm_slug : undefined;
      const result = await deleteArticle(id, { confirmSlug });
      return res.json({ ok: true, ...result });
    } catch (err) {
      const message = (err as Error).message || 'Delete failed';
      const status = message.includes('not found') ? 404 : 400;
      return res.status(status).json({ error: message });
    }
  });

  /** Runtime introspection — adapters only. */
  router.get('/runtime', requireEditorialAuth, async (_req, res) => {
    const rt = getEditorialRuntime();
    const groq = getGroqKeyStatus();
    return res.json({
      ready: Boolean(rt?.ready),
      ai_provider: rt?.ai.name || 'groq',
      ai_configured: Boolean(rt?.ai.isConfigured()),
      groq_key_configured: groq.configured,
      groq_key_masked: groq.masked_key,
      groq_models: GROQ_CHAT_MODELS,
      queue: 'db',
      scheduler: 'inprocess',
      scheduler_jobs: rt?.scheduler.listRegistered() || [],
      storage: 'mysql',
      phase: EDITORIAL_PHASE,
      version: EDITORIAL_ENGINE_VERSION,
    });
  });

  return router;
}
