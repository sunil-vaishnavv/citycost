/**
 * Draft generation background job — progress schema stored in editorial_jobs.result_json.
 */

export const DRAFT_GENERATE_JOB_TYPE = 'draft_generate';

export const DRAFT_JOB_STAGES = [
  'queued',
  'preparing_research',
  'loading_ai',
  'editorial_brain',
  'selecting_guide',
  'building_outline',
  'writing_sections',
  'generating_faq',
  'generating_summary',
  'humanization',
  'similarity',
  'quality_audit',
  'saving_draft',
  'completed',
  'failed',
] as const;

export type DraftJobStage = (typeof DRAFT_JOB_STAGES)[number];

export type DraftJobStageStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface DraftJobStageState {
  id: DraftJobStage;
  label: string;
  status: DraftJobStageStatus;
  detail?: string;
}

export interface DraftJobLogEntry {
  t: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface DraftJobMetrics {
  total_ms?: number;
  ai_ms?: number;
  humanize_ms?: number;
  similarity_ms?: number;
  audit_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  provider?: string;
  model?: string;
  cost_usd?: number;
  retry_count?: number;
  duration_ms?: number;
  /** Process heap diagnostics for the job (numbers only). */
  peak_heap_mb?: number;
  heap_delta_mb?: number;
}

export type DraftCheckpoint =
  | 'none'
  | 'research'
  | 'outline'
  | 'half_draft'
  | 'completed_draft';

export interface DraftJobProgress {
  topic_id: number;
  topic_title?: string;
  article_id?: number;
  stage: DraftJobStage;
  stage_label: string;
  progress_pct: number;
  eta_seconds: number | null;
  stages: DraftJobStageState[];
  logs: DraftJobLogEntry[];
  metrics: DraftJobMetrics;
  checkpoint: DraftCheckpoint;
  cancel_requested?: boolean;
  section_detail?: string;
  /** Populated when status=failed */
  failed_stage?: DraftJobStage;
  failure_reason?: string;
  error_category?: string;
  /** Cached planning artifacts for retry */
  cache?: {
    research_pack?: unknown;
    outline_headings?: string[];
    guide_id?: string;
    half_draft_blocks?: unknown[];
  };
  debug?: Record<string, unknown>;
}

export interface DraftJobPayload {
  topic_id: number;
  topic_title?: string;
  reuse_research?: boolean;
  retry_of_job_id?: number;
  source?: 'manual' | 'retry' | 'pipeline';
}

export const STAGE_LABELS: Record<DraftJobStage, string> = {
  queued: 'Queued',
  preparing_research: 'Preparing Research',
  loading_ai: 'Loading AI',
  editorial_brain: 'Editorial Brain',
  selecting_guide: 'Selecting Guide',
  building_outline: 'Building Outline',
  writing_sections: 'Writing Sections',
  generating_faq: 'Generating FAQ',
  generating_summary: 'Generating Summary',
  humanization: 'Humanization Pass',
  similarity: 'Similarity Check',
  quality_audit: 'Quality Audit',
  saving_draft: 'Saving Draft',
  completed: 'Completed',
  failed: 'Failed',
};

/** Approximate remaining seconds seed when no historical average. */
export const STAGE_ETA_SEED: Partial<Record<DraftJobStage, number>> = {
  queued: 2,
  preparing_research: 3,
  loading_ai: 2,
  editorial_brain: 1,
  selecting_guide: 1,
  building_outline: 1,
  writing_sections: 55,
  generating_faq: 8,
  generating_summary: 6,
  humanization: 18,
  similarity: 8,
  quality_audit: 10,
  saving_draft: 2,
};

export const STAGE_PROGRESS_PCT: Record<DraftJobStage, number> = {
  queued: 0,
  preparing_research: 5,
  loading_ai: 8,
  editorial_brain: 12,
  selecting_guide: 15,
  building_outline: 18,
  writing_sections: 25,
  generating_faq: 62,
  generating_summary: 68,
  humanization: 74,
  similarity: 84,
  quality_audit: 90,
  saving_draft: 96,
  completed: 100,
  failed: 100,
};

export function buildInitialStages(): DraftJobStageState[] {
  return DRAFT_JOB_STAGES.filter((s) => s !== 'completed' && s !== 'failed').map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: id === 'queued' ? 'active' : 'pending',
  }));
}

export function createInitialProgress(payload: DraftJobPayload): DraftJobProgress {
  return {
    topic_id: payload.topic_id,
    topic_title: payload.topic_title,
    stage: 'queued',
    stage_label: STAGE_LABELS.queued,
    progress_pct: 0,
    eta_seconds: sumRemainingEta('queued'),
    stages: buildInitialStages(),
    logs: [
      {
        t: new Date().toISOString(),
        level: 'info',
        message: `Draft job queued for topic #${payload.topic_id}`,
      },
    ],
    metrics: { retry_count: payload.retry_of_job_id ? 1 : 0 },
    checkpoint: 'none',
    cancel_requested: false,
  };
}

export function sumRemainingEta(fromStage: DraftJobStage): number {
  const idx = DRAFT_JOB_STAGES.indexOf(fromStage);
  let total = 0;
  for (let i = Math.max(0, idx); i < DRAFT_JOB_STAGES.length; i++) {
    const s = DRAFT_JOB_STAGES[i];
    if (s === 'completed' || s === 'failed') continue;
    total += STAGE_ETA_SEED[s] ?? 0;
  }
  return total;
}

export function applyStage(
  progress: DraftJobProgress,
  stage: DraftJobStage,
  opts?: { detail?: string; log?: string; section_detail?: string; failed_stage?: DraftJobStage }
): DraftJobProgress {
  const isFailed = stage === 'failed';
  const targetFailedStage = opts?.failed_stage || progress.failed_stage || progress.stage;
  const failedOrder = isFailed ? DRAFT_JOB_STAGES.indexOf(targetFailedStage) : -1;

  const stages = progress.stages.map((s) => {
    if (isFailed) {
      const order = DRAFT_JOB_STAGES.indexOf(s.id);
      if (s.id === targetFailedStage) {
        return { ...s, status: 'failed' as const, detail: opts?.detail };
      }
      if (order < failedOrder && s.status !== 'skipped') {
        return { ...s, status: 'done' as const };
      }
      if (order > failedOrder) {
        return { ...s, status: 'skipped' as const };
      }
      return s;
    }
    if (s.id === stage) return { ...s, status: 'active' as const, detail: opts?.detail };
    const order = DRAFT_JOB_STAGES.indexOf(s.id);
    const cur = DRAFT_JOB_STAGES.indexOf(stage);
    if (order < cur && s.status !== 'skipped') return { ...s, status: 'done' as const };
    return s;
  });
  const logs = [...progress.logs];
  if (opts?.log) {
    logs.push({ t: new Date().toISOString(), level: 'info', message: opts.log });
  }
  if (logs.length > 200) logs.splice(0, logs.length - 200);

  return {
    ...progress,
    stage,
    stage_label: STAGE_LABELS[stage],
    progress_pct: STAGE_PROGRESS_PCT[stage],
    eta_seconds: sumRemainingEta(stage),
    stages,
    logs,
    section_detail: opts?.section_detail ?? progress.section_detail,
  };
}

export function appendLog(
  progress: DraftJobProgress,
  message: string,
  level: DraftJobLogEntry['level'] = 'info'
): DraftJobProgress {
  const logs = [
    ...progress.logs,
    { t: new Date().toISOString(), level, message },
  ];
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  return { ...progress, logs };
}

export type DraftProgressEvent = {
  type: 'stage' | 'log' | 'section' | 'checkpoint' | 'metrics' | 'done' | 'error';
  stage?: DraftJobStage;
  stage_label?: string;
  detail?: string;
  section_label?: string;
  progress_pct?: number;
  eta_seconds?: number | null;
  checkpoint?: DraftCheckpoint;
  message?: string;
  metrics?: Partial<DraftJobMetrics>;
};
