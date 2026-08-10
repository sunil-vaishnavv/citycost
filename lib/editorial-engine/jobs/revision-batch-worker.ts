/**
 * Enqueue + run revision_batch background jobs (Fix Issues).
 * Continues if the user leaves the page; SSE/poll reconnect like draft_generate.
 */

import {
  claimNextQueuedJob,
  completeJob,
  failJob,
  getJobById,
  insertJob,
  isJobCancelRequested,
  updateJobResult,
} from '../db/jobs-repo.js';
import { getArticleById } from '../db/articles-repo.js';
import { getTopicById } from '../db/topics-repo.js';
import { emitDraftJobUpdate } from './draft-job-events.js';
import type { DraftJobProgress } from './draft-job-types.js';
import type { RevisionProgressEvent } from '../revision/revision-types.js';
import { autoFixArticle } from '../revision/revision-service.js';
import {
  appendRevisionLog,
  applyRevisionStage,
  createInitialRevisionProgress,
  markRevisionStagesFromPlan,
  REVISION_BATCH_JOB_TYPE,
  type RevisionBatchPayload,
  type RevisionBatchProgress,
  type RevisionBatchStage,
} from './revision-batch-types.js';

let workerBusy = false;
let kickTimer: ReturnType<typeof setTimeout> | null = null;

function asProgress(raw: Record<string, unknown> | null | undefined): RevisionBatchProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.article_id !== 'number' && typeof raw.article_id !== 'string') return null;
  return raw as unknown as RevisionBatchProgress;
}

function toDraftShaped(progress: RevisionBatchProgress): DraftJobProgress {
  return progress as unknown as DraftJobProgress;
}

async function persistAndEmit(
  jobId: number,
  status: string,
  progress: RevisionBatchProgress,
  error_message?: string | null
): Promise<void> {
  await updateJobResult(jobId, progress as unknown as Record<string, unknown>);
  emitDraftJobUpdate({
    jobId,
    status,
    progress: toDraftShaped(progress),
    error_message,
  });
}

export async function findActiveRevisionJobForArticle(
  articleId: number
): Promise<{ id: number; status: string; progress: RevisionBatchProgress } | null> {
  const { pool } = await import('../../db.js');
  if (!pool) return null;
  const { listRecentJobs } = await import('../db/jobs-repo.js');
  const jobs = await listRecentJobs({ jobType: REVISION_BATCH_JOB_TYPE, limit: 30 });
  const active = jobs.find(
    (j) =>
      (j.status === 'queued' || j.status === 'running') &&
      Number(j.payload_json?.article_id || j.result_json?.article_id) === articleId
  );
  if (!active) return null;
  return {
    id: active.id,
    status: active.status,
    progress:
      asProgress(active.result_json) ||
      createInitialRevisionProgress({ article_id: articleId }),
  };
}

export async function enqueueRevisionBatch(input: {
  article_id: number;
  reuse_report?: boolean;
  retry_of_job_id?: number;
  resume_stage?: RevisionBatchStage;
  source?: RevisionBatchPayload['source'];
}): Promise<{ ok: boolean; jobId?: number; status?: string; message: string; error?: string }> {
  const article = await getArticleById(input.article_id);
  if (!article) {
    return { ok: false, message: 'Article not found', error: 'article_not_found' };
  }

  const existing = await findActiveRevisionJobForArticle(input.article_id);
  if (existing) {
    return {
      ok: true,
      jobId: existing.id,
      status: existing.status,
      message: `Revision already ${existing.status} (job #${existing.id})`,
    };
  }

  let topic_title: string | undefined;
  const topic_id = article.topic_id ? Number(article.topic_id) : undefined;
  if (topic_id) {
    try {
      const topic = await getTopicById(topic_id);
      topic_title = topic?.title || article.seo_title || undefined;
    } catch {
      topic_title = article.seo_title || undefined;
    }
  } else {
    topic_title = article.seo_title || undefined;
  }

  const payload: RevisionBatchPayload = {
    article_id: input.article_id,
    topic_id,
    topic_title,
    reuse_report: input.reuse_report !== false,
    retry_of_job_id: input.retry_of_job_id,
    resume_stage: input.resume_stage,
    source: input.source || 'manual',
  };

  let progress = createInitialRevisionProgress(payload);
  if (input.retry_of_job_id) {
    const prior = await getJobById(input.retry_of_job_id);
    const priorProgress = asProgress(prior?.result_json);
    if (priorProgress) {
      progress = {
        ...progress,
        issue_summary: priorProgress.issue_summary,
        word_budget: priorProgress.word_budget,
        resume_stage:
          input.resume_stage ||
          priorProgress.resume_stage ||
          priorProgress.failed_stage ||
          priorProgress.checkpoint,
        metrics: {
          ...progress.metrics,
          retry_count: (priorProgress.metrics?.retry_count || 0) + 1,
        },
      };
      progress = appendRevisionLog(
        progress,
        `Retry queued — resume from ${progress.resume_stage || 'planning'}; reusing quality report, draft, research (no article regenerate)`
      );
      if (priorProgress.issue_summary) {
        progress = markRevisionStagesFromPlan(
          progress,
          (priorProgress.debug?.active_fix_stages as string[]) || [],
          priorProgress.metrics?.issue_count || priorProgress.issue_summary.length
        );
      }
    }
  }

  const jobId = await insertJob(REVISION_BATCH_JOB_TYPE, payload as unknown as Record<string, unknown>);
  await updateJobResult(jobId, progress as unknown as Record<string, unknown>);
  emitDraftJobUpdate({
    jobId,
    status: 'queued',
    progress: toDraftShaped(progress),
  });

  kickRevisionWorker();
  return {
    ok: true,
    jobId,
    status: 'queued',
    message: `Revision batch queued (job #${jobId})`,
  };
}

export function kickRevisionWorker(): void {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void processRevisionJobs();
  }, 50);
}

export async function processRevisionJobs(): Promise<void> {
  if (workerBusy) return;
  workerBusy = true;
  try {
    while (true) {
      const job = await claimNextQueuedJob(REVISION_BATCH_JOB_TYPE, 'revision-worker');
      if (!job) break;
      await executeRevisionJob(job.id);
    }
  } finally {
    workerBusy = false;
  }
}

async function executeRevisionJob(jobId: number): Promise<void> {
  const job = await getJobById(jobId);
  if (!job) return;

  let progress =
    asProgress(job.result_json) ||
    createInitialRevisionProgress({
      article_id: Number(job.payload_json?.article_id),
      topic_id: Number(job.payload_json?.topic_id) || undefined,
      topic_title:
        typeof job.payload_json?.topic_title === 'string'
          ? job.payload_json.topic_title
          : undefined,
    });

  const articleId = Number(job.payload_json?.article_id || progress.article_id);
  const started = Date.now();
  const resumeFrom =
    (typeof job.payload_json?.resume_stage === 'string'
      ? job.payload_json.resume_stage
      : progress.resume_stage) || undefined;

  try {
    if (await isJobCancelRequested(jobId)) {
      throw new Error('Cancelled by user');
    }

    progress = applyRevisionStage(progress, 'planning_revision', {
      log: 'Starting Fix Issues revision batch',
    });
    await persistAndEmit(jobId, 'running', progress);

    const onProgress = async (event: RevisionProgressEvent) => {
      if (await isJobCancelRequested(jobId)) {
        throw new Error('Cancelled by user');
      }
      const stage = event.stage as RevisionBatchStage;
      if (stage === 'failed') return;

      if (event.active_fix_stages || event.issue_count != null) {
        progress = markRevisionStagesFromPlan(
          progress,
          event.active_fix_stages || [],
          event.issue_count ?? progress.metrics.issue_count ?? 0
        );
      }

      if (event.issue_summary) progress = { ...progress, issue_summary: event.issue_summary };
      if (event.word_budget) progress = { ...progress, word_budget: event.word_budget };
      if (event.actions?.length) {
        progress = {
          ...progress,
          actions_taken: [...(progress.actions_taken || []), ...event.actions].slice(-80),
        };
      }
      if (event.issue_count != null) {
        progress = {
          ...progress,
          metrics: { ...progress.metrics, issue_count: event.issue_count },
        };
      }
      if (event.active_fix_stages) {
        progress = {
          ...progress,
          debug: { ...progress.debug, active_fix_stages: event.active_fix_stages },
        };
      }

      if (stage === 'completed') {
        // Mark remaining stages done then completed
        progress = {
          ...progress,
          stages: progress.stages.map((s) =>
            s.status === 'skipped' ? s : { ...s, status: 'done' as const }
          ),
          stage: 'completed',
          stage_label: 'Completed',
          progress_pct: 100,
          eta_seconds: 0,
          checkpoint: 'completed',
          resume_stage: 'completed',
        };
        if (event.log) progress = appendRevisionLog(progress, event.log);
        if (event.actions?.length) {
          for (const a of event.actions.slice(0, 20)) {
            progress = appendRevisionLog(progress, a);
          }
        }
      } else {
        progress = applyRevisionStage(progress, stage, {
          detail: event.detail || event.label,
          log: event.log,
        });
        if (
          (stage === 'analyzing_failed_rules' ||
            stage === 'found_issues' ||
            stage === 'reading_quality_report') &&
          event.issue_count != null
        ) {
          progress = {
            ...progress,
            stage_label: `Analyzing Failed Rules · ${event.issue_count} issues`,
            stages: progress.stages.map((s) =>
              s.id === 'analyzing_failed_rules'
                ? {
                    ...s,
                    label: `Analyzing Failed Rules · ${event.issue_count} issues`,
                    status: 'active' as const,
                  }
                : s
            ),
          };
        }
      }

      await persistAndEmit(jobId, 'running', progress);
    };

    const result = await autoFixArticle(articleId, {
      onProgress,
      resumeFromStage: resumeFrom,
    });

    const fixedIssues = result.revisions.flatMap((r) => r.fixed_issues);
    const remainingIssues =
      result.failure_reasons ||
      result.revisions.flatMap((r) => r.remaining_issues).slice(-40);
    progress = {
      ...progress,
      passed: result.passed,
      publish_ready: result.publish_ready ?? result.passed,
      result_message: result.message,
      fixed_count: fixedIssues.length,
      remaining_count: remainingIssues.length,
      metrics: {
        ...progress.metrics,
        total_ms: Date.now() - started,
        duration_ms: Date.now() - started,
        before_score: result.before_score,
        after_score: result.after_score,
        passed: result.passed,
        fixed_count: fixedIssues.length,
        remaining_count: remainingIssues.length,
        tokens_in: result.revisions.reduce((n, r) => n + (r.tokens_in || 0), 0),
        tokens_out: result.revisions.reduce((n, r) => n + (r.tokens_out || 0), 0),
        provider: result.revisions.find((r) => r.provider)?.provider,
        model: result.revisions.find((r) => r.model)?.model,
      },
      actions_taken: [...(progress.actions_taken || []), ...fixedIssues].slice(-80),
      stage: 'completed',
      stage_label: 'Completed',
      progress_pct: 100,
      eta_seconds: 0,
      stages: progress.stages.map((s) =>
        s.status === 'skipped' ? s : { ...s, status: 'done' as const }
      ),
    };
    progress = appendRevisionLog(progress, result.message);

    await completeJob(jobId, progress as unknown as Record<string, unknown>);
    emitDraftJobUpdate({
      jobId,
      status: 'completed',
      progress: toDraftShaped(progress),
    });
  } catch (err) {
    const message = (err as Error).message || 'Revision batch failed';
    const failedStage = (progress.stage || 'applying_batch') as RevisionBatchStage;
    progress = appendRevisionLog(
      {
        ...progress,
        stage: 'failed',
        stage_label: 'Failed',
        progress_pct: 100,
        failed_stage: failedStage,
        failure_reason: message,
        resume_stage: failedStage,
        metrics: {
          ...progress.metrics,
          total_ms: Date.now() - started,
          duration_ms: Date.now() - started,
        },
        stages: progress.stages.map((s) =>
          s.id === failedStage || s.status === 'active'
            ? { ...s, status: 'failed' as const, detail: message }
            : s
        ),
      },
      message,
      'error'
    );
    await failJob(jobId, message, progress as unknown as Record<string, unknown>);
    emitDraftJobUpdate({
      jobId,
      status: 'failed',
      progress: toDraftShaped(progress),
      error_message: message,
    });
  }
}

export async function retryRevisionJob(jobId: number): Promise<{
  ok: boolean;
  jobId?: number;
  status?: string;
  message: string;
}> {
  const prior = await getJobById(jobId);
  if (!prior || prior.job_type !== REVISION_BATCH_JOB_TYPE) {
    return { ok: false, message: 'Revision job not found' };
  }
  const article_id = Number(prior.payload_json?.article_id || prior.result_json?.article_id);
  if (!Number.isFinite(article_id)) {
    return { ok: false, message: 'Job missing article_id' };
  }
  const priorProgress = asProgress(prior.result_json);
  return enqueueRevisionBatch({
    article_id,
    reuse_report: true,
    retry_of_job_id: jobId,
    resume_stage:
      priorProgress?.resume_stage ||
      priorProgress?.failed_stage ||
      priorProgress?.checkpoint,
    source: 'retry',
  });
}

/** Start 1s poller for revision_batch queue (registered from init). */
export function startRevisionWorkerLoop(): () => void {
  const timer = setInterval(() => {
    void processRevisionJobs();
  }, 1000);
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref?.();
  }
  void processRevisionJobs();
  return () => clearInterval(timer);
}

export { REVISION_BATCH_JOB_TYPE };
