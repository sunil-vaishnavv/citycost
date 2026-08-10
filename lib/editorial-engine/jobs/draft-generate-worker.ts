/**
 * Enqueue + run draft_generate background jobs.
 */

import {
  claimNextQueuedJob,
  completeJob,
  failJob,
  findActiveDraftJobForTopic,
  getJobById,
  insertJob,
  isJobCancelRequested,
  updateJobResult,
} from '../db/jobs-repo.js';
import { getTopicById } from '../db/topics-repo.js';
import { generateArticleDraft, type GenerateArticleOptions } from '../writer/generate.js';
import { emitDraftJobUpdate } from './draft-job-events.js';
import {
  appendLog,
  applyStage,
  createInitialProgress,
  DRAFT_GENERATE_JOB_TYPE,
  type DraftJobPayload,
  type DraftJobProgress,
  type DraftJobStage,
  type DraftProgressEvent,
} from './draft-job-types.js';

let workerBusy = false;
let kickTimer: ReturnType<typeof setTimeout> | null = null;

function asProgress(raw: Record<string, unknown> | null | undefined): DraftJobProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.topic_id !== 'number' && typeof raw.topic_id !== 'string') return null;
  return raw as unknown as DraftJobProgress;
}

async function persistAndEmit(
  jobId: number,
  status: string,
  progress: DraftJobProgress,
  error_message?: string | null
): Promise<void> {
  await updateJobResult(jobId, progress as unknown as Record<string, unknown>);
  emitDraftJobUpdate({ jobId, status, progress, error_message });
}

export async function enqueueDraftGenerate(input: {
  topic_id: number;
  reuse_research?: boolean;
  retry_of_job_id?: number;
  source?: DraftJobPayload['source'];
}): Promise<{ ok: boolean; jobId?: number; status?: string; message: string; error?: string }> {
  const topic = await getTopicById(input.topic_id);
  if (!topic) {
    return { ok: false, message: 'Topic not found', error: 'topic_not_found' };
  }
  const allowed = ['approved', 'scheduled'];
  if (!allowed.includes(topic.status)) {
    return {
      ok: false,
      message: `Topic status '${topic.status}' cannot generate (allowed: ${allowed.join(', ')})`,
      error: 'invalid_topic_status',
    };
  }

  const existing = await findActiveDraftJobForTopic(input.topic_id);
  if (existing) {
    return {
      ok: true,
      jobId: existing.id,
      status: existing.status,
      message: `Draft generation already ${existing.status} (job #${existing.id})`,
    };
  }

  const payload: DraftJobPayload = {
    topic_id: input.topic_id,
    topic_title: topic.title,
    reuse_research: Boolean(input.reuse_research),
    retry_of_job_id: input.retry_of_job_id,
    source: input.source || 'manual',
  };

  // Carry cache from prior failed job on retry
  let progress = createInitialProgress(payload);
  if (input.retry_of_job_id) {
    const prior = await getJobById(input.retry_of_job_id);
    const priorProgress = asProgress(prior?.result_json);
    if (priorProgress?.cache && input.reuse_research !== false) {
      progress = {
        ...progress,
        cache: priorProgress.cache,
        checkpoint: priorProgress.checkpoint !== 'completed_draft' ? priorProgress.checkpoint : 'research',
        metrics: {
          ...progress.metrics,
          retry_count: (priorProgress.metrics?.retry_count || 0) + 1,
        },
      };
      progress = appendLog(progress, 'Retry queued — will reuse research/plan cache where available');
    }
  }

  const jobId = await insertJob(DRAFT_GENERATE_JOB_TYPE, payload as unknown as Record<string, unknown>);
  await updateJobResult(jobId, progress as unknown as Record<string, unknown>);
  emitDraftJobUpdate({ jobId, status: 'queued', progress });

  kickDraftWorker();
  return {
    ok: true,
    jobId,
    status: 'queued',
    message: `Draft generation queued (job #${jobId})`,
  };
}

export function kickDraftWorker(): void {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void processDraftJobs();
  }, 50);
}

export async function processDraftJobs(): Promise<void> {
  if (workerBusy) return;
  workerBusy = true;
  try {
    while (true) {
      const job = await claimNextQueuedJob(DRAFT_GENERATE_JOB_TYPE, 'draft-worker');
      if (!job) break;
      await executeDraftJob(job.id);
    }
  } finally {
    workerBusy = false;
  }
}

async function executeDraftJob(jobId: number): Promise<void> {
  const job = await getJobById(jobId);
  if (!job) return;

  let progress =
    asProgress(job.result_json) ||
    createInitialProgress({
      topic_id: Number(job.payload_json?.topic_id),
      topic_title: typeof job.payload_json?.topic_title === 'string' ? job.payload_json.topic_title : undefined,
    });

  const topicId = Number(job.payload_json?.topic_id || progress.topic_id);
  const reuseResearch = Boolean(job.payload_json?.reuse_research) || Boolean(progress.cache?.research_pack);
  const started = Date.now();

  const controllers = new AbortController();

  const pushProgress = async (
    stage: DraftJobStage,
    opts?: { detail?: string; log?: string; section_detail?: string; checkpoint?: DraftJobProgress['checkpoint'] }
  ) => {
    if (await isJobCancelRequested(jobId)) {
      controllers.abort();
      throw new Error('Cancelled by user');
    }
    progress = applyStage(progress, stage, opts);
    if (opts?.checkpoint) progress = { ...progress, checkpoint: opts.checkpoint };
    await persistAndEmit(jobId, 'running', progress);
  };

  const onProgress = async (event: DraftProgressEvent) => {
    if (await isJobCancelRequested(jobId)) {
      controllers.abort();
      throw new Error('Cancelled by user');
    }
    if (event.stage) {
      progress = applyStage(progress, event.stage, {
        detail: event.detail,
        log: event.message,
        section_detail: event.section_label,
      });
    } else if (event.message) {
      progress = appendLog(progress, event.message, event.type === 'error' ? 'error' : 'info');
    }
    if (event.section_label) {
      progress = {
        ...progress,
        section_detail: event.section_label,
      };
      progress = appendLog(progress, `Writing section: ${event.section_label}`);
    }
    if (event.checkpoint) progress = { ...progress, checkpoint: event.checkpoint };
    if (event.checkpoint === 'outline' || event.checkpoint === 'research' || event.checkpoint === 'half_draft') {
      progress = appendLog(progress, `Checkpoint: ${event.checkpoint}`);
    }
    if (event.progress_pct != null) progress = { ...progress, progress_pct: event.progress_pct };
    if (event.eta_seconds !== undefined) progress = { ...progress, eta_seconds: event.eta_seconds };
    if (event.metrics) {
      progress = { ...progress, metrics: { ...progress.metrics, ...event.metrics } };
    }
    if (event.type === 'checkpoint' && event.checkpoint === 'research' && event.detail) {
      /* research pack may be attached via metrics/debug from generate */
    }
    await persistAndEmit(jobId, 'running', progress);
  };

  try {
    await pushProgress('loading_ai', { log: 'Worker claimed job — starting draft generation' });

    const opts: GenerateArticleOptions = {
      signal: controllers.signal,
      reuseResearch,
      cachedResearch: progress.cache?.research_pack,
      onProgress,
      jobId,
    };

    const result = await generateArticleDraft(topicId, opts);

    if (!result.ok) {
      const failedStage = (
        (typeof result.debug?.failed_stage === 'string' ? result.debug.failed_stage : null) ||
        progress.stage
      ) as DraftJobStage;
      const failureReason =
        result.errors?.[0] || result.message || 'Draft generation failed';
      const errorCategory =
        typeof result.debug?.error_category === 'string'
          ? result.debug.error_category
          : undefined;
      progress = applyStage(progress, 'failed', { log: failureReason });
      progress = {
        ...progress,
        stage: 'failed',
        stage_label: 'Failed',
        progress_pct: 100,
        failed_stage: failedStage,
        failure_reason: failureReason,
        error_category: errorCategory,
        stages: progress.stages.map((s) =>
          s.id === failedStage || s.status === 'active'
            ? { ...s, status: 'failed' as const, detail: failureReason.slice(0, 240) }
            : s
        ),
        metrics: {
          ...progress.metrics,
          total_ms: Date.now() - started,
          duration_ms: Date.now() - started,
          tokens_in: result.debug?.tokens_in,
          tokens_out: result.debug?.tokens_out,
          model: result.debug?.groq_model,
        },
        debug: result.debug as unknown as Record<string, unknown>,
      };
      await failJob(jobId, failureReason, progress as unknown as Record<string, unknown>);
      emitDraftJobUpdate({
        jobId,
        status: 'failed',
        progress,
        error_message: failureReason,
      });
      return;
    }

    progress = applyStage(progress, 'completed', {
      log: `Draft saved as article #${result.article_id}`,
    });
    progress = {
      ...progress,
      article_id: result.article_id,
      stage: 'completed',
      stage_label: 'Completed',
      progress_pct: 100,
      eta_seconds: 0,
      checkpoint: 'completed_draft',
      metrics: {
        ...progress.metrics,
        total_ms: Date.now() - started,
        duration_ms: Date.now() - started,
        tokens_in: result.debug?.tokens_in,
        tokens_out: result.debug?.tokens_out,
        model: result.debug?.groq_model,
      },
      cache: {
        ...progress.cache,
        research_pack: result.research_pack,
      },
      debug: result.debug as unknown as Record<string, unknown>,
    };
    // Store duration_ms at top-level for averageCompletedDurationMs
    const finalResult = {
      ...progress,
      duration_ms: Date.now() - started,
      article_id: result.article_id,
    };
    await completeJob(jobId, finalResult as unknown as Record<string, unknown>);
    emitDraftJobUpdate({ jobId, status: 'completed', progress });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cancelled = /cancel/i.test(message);
    const failedStage = (progress.stage || 'loading_ai') as DraftJobStage;
    progress = appendLog(
      applyStage(progress, 'failed', { log: message }),
      message,
      'error'
    );
    progress = {
      ...progress,
      stage: 'failed',
      stage_label: cancelled ? 'Cancelled' : 'Failed',
      progress_pct: 100,
      failed_stage: failedStage,
      failure_reason: message,
      stages: progress.stages.map((s) =>
        s.id === failedStage || s.status === 'active'
          ? { ...s, status: 'failed' as const, detail: message.slice(0, 240) }
          : s
      ),
      metrics: { ...progress.metrics, total_ms: Date.now() - started, duration_ms: Date.now() - started },
    };
    await failJob(jobId, message, progress as unknown as Record<string, unknown>);
    emitDraftJobUpdate({ jobId, status: 'failed', progress, error_message: message });
  }
}

export async function retryDraftJob(jobId: number): Promise<{
  ok: boolean;
  jobId?: number;
  status?: string;
  message: string;
}> {
  const prior = await getJobById(jobId);
  if (!prior || prior.job_type !== DRAFT_GENERATE_JOB_TYPE) {
    return { ok: false, message: 'Draft job not found' };
  }
  const topic_id = Number(prior.payload_json?.topic_id);
  if (!Number.isFinite(topic_id)) {
    return { ok: false, message: 'Job missing topic_id' };
  }
  return enqueueDraftGenerate({
    topic_id,
    reuse_research: true,
    retry_of_job_id: jobId,
    source: 'retry',
  });
}

/** Start 1s poller for draft_generate queue (registered from init). */
export function startDraftWorkerLoop(): () => void {
  const timer = setInterval(() => {
    void processDraftJobs();
  }, 1000);
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref?.();
  }
  void processDraftJobs();
  return () => clearInterval(timer);
}

export { DRAFT_GENERATE_JOB_TYPE };
