/**
 * Daily editorial pipeline — Calendar → Research → Writer → Reviewer → SEO → Internal Links → Publish.
 * Fail-fast. Never publish a partial article. Reuses existing stage engines.
 */

import { DAILY_PIPELINE_JOB_TYPE } from '../constants.js';
import { getCalendarDay } from '../calendar/calendar-service.js';
import { updateCalendarEntry } from '../db/calendar-repo.js';
import {
  averageCompletedDurationMs,
  claimJob,
  completeJob,
  failJob,
  findDailyPipelineJob,
  getJobById,
  insertJob,
  listRecentJobs,
  updateJobResult,
} from '../db/jobs-repo.js';
import {
  countPublishedOnUtcDate,
  getArticleById,
  getLatestArticleByTopicId,
} from '../db/articles-repo.js';
import { getSettings } from '../db/settings-repo.js';
import { getNextScheduledTopicTitle } from '../db/calendar-repo.js';
import { generateArticleDraft, previewTopicResearch } from '../writer/generate.js';
import { regenerateArticleFaq } from '../faq/index.js';
import { reviewArticle } from '../reviewer/review.js';
import { generateArticleSeo } from '../seo/generate-seo.js';
import { publishArticle } from '../publish/publish.js';
import { getEditorialRuntime } from '../init.js';
import { localDateString, nextPublishAtIso } from './timezone.js';
import type { EditorialJobRow, EditorialSettings } from '../types.js';

export type PipelineStageName =
  | 'calendar'
  | 'research'
  | 'writer'
  | 'faq'
  | 'reviewer'
  | 'revision'
  | 'seo'
  | 'internal_links'
  | 'publish';

export interface PipelineStageLog {
  stage: PipelineStageName;
  status: 'ok' | 'failed' | 'skipped';
  at: string;
  detail?: string;
  duration_ms?: number;
}

export interface PipelineResultPayload {
  publish_date: string;
  article_id: number | null;
  slug: string | null;
  published: boolean;
  auto_publish: boolean;
  stages: PipelineStageLog[];
  duration_ms: number;
  message: string;
}

function stageOk(
  stages: PipelineStageLog[],
  stage: PipelineStageName,
  detail: string,
  started: number
): void {
  stages.push({
    stage,
    status: 'ok',
    at: new Date().toISOString(),
    detail,
    duration_ms: Date.now() - started,
  });
}

function stageFail(
  stages: PipelineStageLog[],
  stage: PipelineStageName,
  detail: string,
  started: number
): void {
  stages.push({
    stage,
    status: 'failed',
    at: new Date().toISOString(),
    detail,
    duration_ms: Date.now() - started,
  });
}

function stageSkip(
  stages: PipelineStageLog[],
  stage: PipelineStageName,
  detail: string
): void {
  stages.push({
    stage,
    status: 'skipped',
    at: new Date().toISOString(),
    detail,
  });
}

async function runPipelineStages(
  publishDate: string,
  settings: EditorialSettings
): Promise<PipelineResultPayload> {
  const stages: PipelineStageLog[] = [];
  const pipelineStarted = Date.now();
  let articleId: number | null = null;
  let slug: string | null = null;
  let published = false;

  // 1. Calendar
  let t0 = Date.now();
  const { entry } = await getCalendarDay(publishDate);
  if (!entry) {
    const msg =
      `No article is scheduled for ${publishDate}. ` +
      `Approve a topic, then schedule it for today (Topics → Schedule) or run Auto-schedule before starting the pipeline.`;
    stageFail(stages, 'calendar', msg, t0);
    throw Object.assign(new Error(msg), { stages, articleId, code: 'missing_calendar' });
  }
  if (entry.status === 'skipped' || entry.status === 'cancelled') {
    const msg =
      `Today’s calendar entry is ${entry.status}. ` +
      `Unskip/reschedule a topic for ${publishDate} before running the pipeline.`;
    stageFail(stages, 'calendar', msg, t0);
    throw Object.assign(new Error(msg), { stages, articleId, code: 'calendar_inactive' });
  }
  if (entry.status === 'completed' && entry.topic_id) {
    const existing = await getLatestArticleByTopicId(entry.topic_id);
    if (existing?.status === 'published') {
      stageOk(stages, 'calendar', `Already completed (article #${existing.id})`, t0);
      stageSkip(stages, 'research', 'Already published');
      stageSkip(stages, 'writer', 'Already published');
      stageSkip(stages, 'reviewer', 'Already published');
      stageSkip(stages, 'seo', 'Already published');
      stageSkip(stages, 'internal_links', 'Already published');
      stageSkip(stages, 'publish', 'Already published');
      return {
        publish_date: publishDate,
        article_id: existing.id,
        slug: existing.slug,
        published: true,
        auto_publish: settings.auto_publish,
        stages,
        duration_ms: Date.now() - pipelineStarted,
        message: 'Already published for this calendar day',
      };
    }
  }
  if (!entry.topic_id) {
    const msg =
      `A calendar slot exists for ${publishDate}, but no topic is attached. ` +
      `Schedule an approved topic for that date before running the pipeline.`;
    stageFail(stages, 'calendar', msg, t0);
    throw Object.assign(new Error(msg), { stages, articleId, code: 'calendar_missing_topic' });
  }
  const topicId = entry.topic_id;
  const topicTitle = entry.topic?.title || `topic #${topicId}`;
  stageOk(stages, 'calendar', `${topicTitle} (entry #${entry.id})`, t0);

  // 2. Research
  t0 = Date.now();
  try {
    const research = await previewTopicResearch(topicId);
    stageOk(
      stages,
      'research',
      `intent=${research.research.intent}; keyword=${research.research.target_keyword}`,
      t0
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const detail =
      msg.toLowerCase().includes('empty') || msg.toLowerCase().includes('not found')
        ? `Research Pack returned empty or incomplete data: ${msg}`
        : `Research failed: ${msg}`;
    stageFail(stages, 'research', detail, t0);
    throw Object.assign(new Error(detail), { stages, articleId, code: 'research_failed' });
  }

  // 3. Writer (resume if draft/review already exists for topic)
  t0 = Date.now();
  const existingArticle = await getLatestArticleByTopicId(topicId);
  if (existingArticle && ['draft', 'review', 'published'].includes(existingArticle.status)) {
    articleId = existingArticle.id;
    slug = existingArticle.slug;
    stageOk(
      stages,
      'writer',
      `Reused article #${articleId} (${existingArticle.status})`,
      t0
    );
  } else {
    const gen = await generateArticleDraft(topicId);
    if (!gen.ok || !gen.article_id) {
      stageFail(stages, 'writer', gen.message || 'Writer failed', t0);
      throw Object.assign(new Error(gen.message || 'Writer failed'), { stages, articleId });
    }
    articleId = gen.article_id;
    slug = gen.slug || null;
    stageOk(stages, 'writer', `Draft #${articleId} · ${gen.word_count ?? '?'} words`, t0);
  }

  // 3b. Dedicated FAQ rewrite (Writer/Research/Review unchanged)
  if (articleId && existingArticle?.status !== 'published') {
    t0 = Date.now();
    try {
      const faq = await regenerateArticleFaq(articleId);
      stageOk(
        stages,
        'faq',
        `${faq.source} · ${faq.faq_count} answers · human ${faq.validation.scores.human_writing}`,
        t0
      );
    } catch (err) {
      stageFail(stages, 'faq', (err as Error).message || 'FAQ regenerate failed', t0);
      // Non-fatal: continue to review with Writer FAQ if dedicated FAQ fails
    }
  }

  if (existingArticle?.status === 'published') {
    stageSkip(stages, 'reviewer', 'Already published');
    stageSkip(stages, 'seo', 'Already published');
    stageSkip(stages, 'internal_links', 'Already published');
    stageSkip(stages, 'publish', 'Already published');
    if (entry.status !== 'completed') {
      await updateCalendarEntry(entry.id, { status: 'completed' });
    }
    return {
      publish_date: publishDate,
      article_id: articleId,
      slug,
      published: true,
      auto_publish: settings.auto_publish,
      stages,
      duration_ms: Date.now() - pipelineStarted,
      message: 'Article already published',
    };
  }

  // 4. Reviewer (+ P4.5 self-healing revision loop on FAIL)
  t0 = Date.now();
  const articleBeforeReview = await getArticleById(articleId!);
  if (articleBeforeReview?.status === 'review') {
    stageOk(stages, 'reviewer', `Already in review (score ${articleBeforeReview.quality_score ?? '—'})`, t0);
  } else {
    let review = await reviewArticle(articleId!);
    if ((!review.ok || !review.passed) && settings.auto_revision_enabled) {
      stageOk(
        stages,
        'reviewer',
        `Failed initial review (score ${review.overall_score ?? '—'}) — starting revision`,
        t0
      );
      t0 = Date.now();
      // Single-cycle revision (planning report → one patch batch → one final review).
      // maxAttempts kept for API compat; runRevisionLoop no longer loops Review↔Revision.
      const { runRevisionLoop } = await import('../revision/revision-service.js');
      const loop = await runRevisionLoop(articleId!, {
        maxAttempts: 1,
        force: true,
        reuseLatestReport: true,
      });
      if (loop.passed) {
        stageOk(
          stages,
          'revision',
          `Healed in ${loop.attempts} attempt(s) · ${loop.before_score ?? '—'} → ${loop.after_score ?? '—'}`,
          t0
        );
        if (!settings.auto_revision_continue_pipeline) {
          return {
            publish_date: publishDate,
            article_id: articleId,
            slug,
            published: false,
            auto_publish: settings.auto_publish,
            stages,
            duration_ms: Date.now() - pipelineStarted,
            message: `Revision passed; pipeline paused (auto_revision_continue_pipeline=false)`,
          };
        }
        review = {
          ok: true,
          passed: true,
          article_id: articleId!,
          overall_score: loop.after_score ?? undefined,
          status: 'review',
          message: loop.message,
          report: loop.final_report,
        };
        t0 = Date.now();
      } else {
        stageFail(
          stages,
          'revision',
          loop.message || 'Revision exhausted',
          t0
        );
        throw Object.assign(new Error(loop.message || 'Revision failed'), {
          stages,
          articleId,
        });
      }
    }
    if (!review.ok || !review.passed) {
      stageFail(
        stages,
        'reviewer',
        review.message || `Review failed (score ${review.overall_score ?? '—'})`,
        t0
      );
      throw Object.assign(new Error(review.message || 'Review failed'), { stages, articleId });
    }
    stageOk(
      stages,
      'reviewer',
      `Passed · score ${review.overall_score ?? '—'} · report #${review.report_id ?? '—'}`,
      t0
    );
  }

  // 5. SEO (includes internal link package build)
  t0 = Date.now();
  const seo = await generateArticleSeo(articleId!);
  if (!seo.ok) {
    stageFail(stages, 'seo', seo.message || 'SEO failed', t0);
    throw Object.assign(new Error(seo.message || 'SEO failed'), { stages, articleId });
  }
  stageOk(
    stages,
    'seo',
    `SEO package v${seo.preview_version ?? '?'} · score ${seo.seo_validation?.seo_score ?? '—'}`,
    t0
  );

  // 6. Internal links (verify package from SEO)
  t0 = Date.now();
  const linkCount = seo.internal_links?.count ?? 0;
  if (linkCount < settings.internal_link_min || linkCount > settings.internal_link_max) {
    stageFail(
      stages,
      'internal_links',
      `Link count ${linkCount} outside ${settings.internal_link_min}–${settings.internal_link_max}`,
      t0
    );
    throw Object.assign(
      new Error(`Internal links count ${linkCount} out of range`),
      { stages, articleId }
    );
  }
  stageOk(stages, 'internal_links', `${linkCount} links ready`, t0);

  // 7. Publish (only when auto_publish enabled and all prior stages passed)
  t0 = Date.now();
  if (!settings.auto_publish) {
    stageSkip(stages, 'publish', 'Auto publish disabled — article left in review');
  } else {
    const pub = await publishArticle(articleId!);
    if (!pub.ok) {
      const detail =
        pub.errors?.map((e) => e.message).join('; ') || pub.message || 'Publish failed';
      stageFail(stages, 'publish', detail, t0);
      throw Object.assign(new Error(detail), { stages, articleId });
    }
    published = true;
    slug = pub.slug || slug;
    stageOk(stages, 'publish', `Published /blog/${slug}`, t0);
  }

  await updateCalendarEntry(entry.id, { status: 'completed' });

  return {
    publish_date: publishDate,
    article_id: articleId,
    slug,
    published,
    auto_publish: settings.auto_publish,
    stages,
    duration_ms: Date.now() - pipelineStarted,
    message: published
      ? 'Pipeline completed and published'
      : 'Pipeline completed (awaiting manual publish)',
  };
}

let pipelineBusy = false;

async function executeClaimedJob(jobId: number): Promise<EditorialJobRow> {
  const job = await getJobById(jobId);
  if (!job) throw new Error('Job not found');
  const publishDate =
    typeof job.payload_json?.publish_date === 'string'
      ? job.payload_json.publish_date
      : null;
  if (!publishDate) {
    await failJob(jobId, 'Missing publish_date in payload');
    throw new Error('Missing publish_date in payload');
  }

  const settings = await getSettings();
  const started = Date.now();
  try {
    const result = await runPipelineStages(publishDate, settings);
    await completeJob(jobId, result as unknown as Record<string, unknown>);
  } catch (err) {
    const stages =
      err && typeof err === 'object' && 'stages' in err
        ? ((err as { stages: PipelineStageLog[] }).stages ?? [])
        : [];
    const articleId =
      err && typeof err === 'object' && 'articleId' in err
        ? ((err as { articleId: number | null }).articleId ?? null)
        : null;
    const message = err instanceof Error ? err.message : String(err);
    const payload: PipelineResultPayload = {
      publish_date: publishDate,
      article_id: articleId,
      slug: null,
      published: false,
      auto_publish: settings.auto_publish,
      stages,
      duration_ms: Date.now() - started,
      message,
    };
    await failJob(jobId, message, payload as unknown as Record<string, unknown>);
    throw err;
  }

  return (await getJobById(jobId))!;
}

/**
 * Enqueue today's job if absent, claim it, and run the pipeline.
 * Never creates a second job for the same publish_date.
 */
export async function runTodaysPipeline(opts?: {
  forceRetry?: boolean;
  source?: 'manual' | 'scheduler' | 'retry';
}): Promise<{
  ok: boolean;
  job: EditorialJobRow | null;
  message: string;
  created: boolean;
}> {
  if (pipelineBusy) {
    return { ok: false, job: null, message: 'Pipeline already in progress', created: false };
  }
  pipelineBusy = true;
  try {
    return await runTodaysPipelineInner(opts);
  } finally {
    pipelineBusy = false;
  }
}

async function runTodaysPipelineInner(opts?: {
  forceRetry?: boolean;
  source?: 'manual' | 'scheduler' | 'retry';
}): Promise<{
  ok: boolean;
  job: EditorialJobRow | null;
  message: string;
  created: boolean;
}> {
  const runtime = getEditorialRuntime();
  if (!runtime?.ready) {
    return { ok: false, job: null, message: 'Editorial Engine not ready', created: false };
  }

  const settings = await getSettings();
  if (settings.automation_paused && opts?.source === 'scheduler') {
    return { ok: false, job: null, message: 'Automation is paused. Resume automation in Settings to continue.', created: false };
  }

  const publishDate = localDateString(settings.timezone);

  // Preflight: avoid creating failed jobs when nothing is scheduled for today
  const { entry: todayEntry } = await getCalendarDay(publishDate);
  if (!todayEntry) {
    return {
      ok: false,
      job: null,
      message:
        `No article is scheduled for ${publishDate}. ` +
        `Schedule an approved topic for today (or Auto-schedule) before running the pipeline.`,
      created: false,
    };
  }
  if (!todayEntry.topic_id) {
    return {
      ok: false,
      job: null,
      message:
        `Calendar slot for ${publishDate} has no topic. Attach an approved topic, then retry.`,
      created: false,
    };
  }
  if (todayEntry.status === 'skipped' || todayEntry.status === 'cancelled') {
    return {
      ok: false,
      job: null,
      message: `Today’s calendar entry is ${todayEntry.status}. Reschedule a topic for ${publishDate} first.`,
      created: false,
    };
  }
  if (!runtime.ai.isConfigured()) {
    return {
      ok: false,
      job: null,
      message: 'Groq API key missing. Set GROQ_API_KEY in the server environment and restart.',
      created: false,
    };
  }

  const existing = await findDailyPipelineJob(DAILY_PIPELINE_JOB_TYPE, publishDate);

  if (existing?.status === 'running') {
    return { ok: false, job: existing, message: 'Pipeline already running for today', created: false };
  }
  if (existing?.status === 'completed' && !opts?.forceRetry) {
    return { ok: false, job: existing, message: 'Today’s pipeline already completed', created: false };
  }
  if (existing?.status === 'queued') {
    const claimed = await claimJob(existing.id, opts?.source || 'manual');
    if (!claimed) {
      return { ok: false, job: existing, message: 'Could not claim queued job', created: false };
    }
    try {
      const job = await executeClaimedJob(existing.id);
      return { ok: job.status === 'completed', job, message: job.error_message || 'Done', created: false };
    } catch (err) {
      const job = await getJobById(existing.id);
      return {
        ok: false,
        job,
        message: err instanceof Error ? err.message : String(err),
        created: false,
      };
    }
  }

  if (existing?.status === 'failed') {
    if (!opts?.forceRetry && opts?.source !== 'retry') {
      return {
        ok: false,
        job: existing,
        message: 'Today’s job failed — use Retry Failed Job',
        created: false,
      };
    }
    const maxRetries = settings.automation_retry_count ?? 3;
    // attempts increments on claim: 1 = first run; allow up to maxRetries retries after that
    if (existing.attempts > maxRetries) {
      return {
        ok: false,
        job: existing,
        message: `Max retries reached (${maxRetries})`,
        created: false,
      };
    }
    const claimed = await claimJob(existing.id, opts?.source || 'retry');
    if (!claimed) {
      return { ok: false, job: existing, message: 'Could not claim failed job', created: false };
    }
    try {
      const job = await executeClaimedJob(existing.id);
      return { ok: job.status === 'completed', job, message: job.error_message || 'Done', created: false };
    } catch (err) {
      const job = await getJobById(existing.id);
      return {
        ok: false,
        job,
        message: err instanceof Error ? err.message : String(err),
        created: false,
      };
    }
  }

  // No job yet — create exactly one
  const jobId = await insertJob(DAILY_PIPELINE_JOB_TYPE, {
    publish_date: publishDate,
    source: opts?.source || 'manual',
  });
  await updateJobResult(jobId, { publish_date: publishDate, stages: [] });
  const claimed = await claimJob(jobId, opts?.source || 'manual');
  if (!claimed) {
    const job = await getJobById(jobId);
    return { ok: false, job, message: 'Created but could not claim job', created: true };
  }
  try {
    const job = await executeClaimedJob(jobId);
    return { ok: job.status === 'completed', job, message: job.error_message || 'Done', created: true };
  } catch (err) {
    const job = await getJobById(jobId);
    return {
      ok: false,
      job,
      message: err instanceof Error ? err.message : String(err),
      created: true,
    };
  }
}

export async function retryFailedTodaysJob(): Promise<{
  ok: boolean;
  job: EditorialJobRow | null;
  message: string;
}> {
  const settings = await getSettings();
  const publishDate = localDateString(settings.timezone);
  const existing = await findDailyPipelineJob(DAILY_PIPELINE_JOB_TYPE, publishDate);
  if (!existing) {
    return { ok: false, job: null, message: 'No job for today' };
  }
  if (existing.status !== 'failed') {
    return { ok: false, job: existing, message: `Job is ${existing.status}, not failed` };
  }
  const result = await runTodaysPipeline({ forceRetry: true, source: 'retry' });
  return { ok: result.ok, job: result.job, message: result.message };
}

/** Scheduler tick entry — only when scheduler_enabled and not paused. */
export async function schedulerDailyTick(): Promise<void> {
  const settings = await getSettings();
  if (!settings.scheduler_enabled) return;
  if (settings.automation_paused) return;

  const { localTimeString } = await import('./timezone.js');
  const nowTime = localTimeString(settings.timezone);
  if (nowTime !== settings.publishing_time_utc) return;

  const publishDate = localDateString(settings.timezone);
  const existing = await findDailyPipelineJob(DAILY_PIPELINE_JOB_TYPE, publishDate);
  if (existing && ['queued', 'running', 'completed'].includes(existing.status)) {
    return; // once per day — never duplicate
  }
  if (existing?.status === 'failed') {
    // Auto-retry within configured count
    const maxRetries = settings.automation_retry_count ?? 3;
    if (existing.attempts > maxRetries) return;
    await runTodaysPipeline({ forceRetry: true, source: 'scheduler' });
    return;
  }

  await runTodaysPipeline({ source: 'scheduler' });
}

export async function getAutomationStatus(): Promise<{
  settings: {
    scheduler_enabled: boolean;
    auto_publish: boolean;
    automation_paused: boolean;
    publishing_time_utc: string;
    timezone: string;
    automation_retry_count: number;
  };
  today: string;
  today_job: EditorialJobRow | null;
  next_publish: string | null;
  next_topic_title: string | null;
  queue: EditorialJobRow[];
  published_today: number;
  failed_today: number;
  avg_generation_ms: number | null;
  stages: PipelineStageLog[];
}> {
  const settings = await getSettings();
  const today = localDateString(settings.timezone);
  const [today_job, queue, next_topic_title, published_today, avg_generation_ms] =
    await Promise.all([
      findDailyPipelineJob(DAILY_PIPELINE_JOB_TYPE, today),
      listRecentJobs({ jobType: DAILY_PIPELINE_JOB_TYPE, limit: 14 }),
      getNextScheduledTopicTitle(today),
      countPublishedOnUtcDate(today),
      averageCompletedDurationMs(DAILY_PIPELINE_JOB_TYPE),
    ]);

  const stages =
    (today_job?.result_json?.stages as PipelineStageLog[] | undefined) || [];

  return {
    settings: {
      scheduler_enabled: settings.scheduler_enabled,
      auto_publish: settings.auto_publish,
      automation_paused: settings.automation_paused,
      publishing_time_utc: settings.publishing_time_utc,
      timezone: settings.timezone,
      automation_retry_count: settings.automation_retry_count,
    },
    today,
    today_job,
    next_publish: settings.scheduler_enabled
      ? nextPublishAtIso(settings.publishing_time_utc, settings.timezone)
      : null,
    next_topic_title,
    queue,
    published_today,
    failed_today: today_job?.status === 'failed' ? 1 : 0,
    avg_generation_ms,
    stages,
  };
}
