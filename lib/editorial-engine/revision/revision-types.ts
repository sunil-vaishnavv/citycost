/**
 * P4.5 Self-Healing Revision Engine — contracts (issue-driven).
 */

import type { QualityReport } from '../reviewer/quality-report.js';
import type { IssueCategory } from '../validation/issue-plan.js';
import type { ResearchPack } from '../writer/research-engine.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';

export const REVISION_PROMPT_VERSION = 'revision-v1.4.0-batch';
export const REVISION_ENGINE_VERSION = '1.4.0';

/** Progress events for revision_batch jobs / timeline UI (shared GenerationDrawer). */
export type RevisionProgressStage =
  | 'queued'
  | 'planning_revision'
  | 'analyzing_failed_rules'
  | 'expanding_words'
  | 'improving_readability'
  | 'humanization'
  | 'fixing_links'
  | 'seo_repair'
  | 'updating_faq'
  | 'updating_summary'
  | 'applying_batch'
  | 'quality_audit'
  | 'final_review'
  | 'completed'
  | 'failed'
  /** @deprecated legacy aliases — worker canonicalizes these */
  | 'reading_quality_report'
  | 'found_issues'
  | 'adding_table'
  | 'validation';

export interface RevisionProgressEvent {
  stage: RevisionProgressStage;
  label?: string;
  detail?: string;
  log?: string;
  issue_summary?: import('./revision-plan.js').IssueSummaryItem[];
  word_budget?: import('./revision-plan.js').WordBudget;
  actions?: string[];
  issue_count?: number;
  active_fix_stages?: string[];
  plan?: import('./revision-plan.js').RevisionBatchPlan;
}

export interface RevisionIssue {
  code: string;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  section_hint?: string;
  category?: IssueCategory;
}

export interface RevisionInput {
  article_id: number;
  draft: WriterDraftPayload;
  research: ResearchPack | null;
  report: QualityReport;
  attempt: number;
  max_attempts: number;
}

export interface RevisionAiPatch {
  seo_title?: string;
  meta_title?: string;
  meta_description?: string;
  excerpt?: string;
  /** Section rewrites keyed by block id (preferred) */
  block_patches?: Array<{
    id: string;
    heading?: string;
    content?: unknown;
    type?: string;
  }>;
  /** Full blocks array replacement (only when AI cannot patch by id) */
  blocks?: WriterDraftPayload['blocks'];
  fixed_issues?: string[];
  notes?: string;
  category?: IssueCategory;
}

export interface RevisionResult {
  ok: boolean;
  article_id: number;
  attempt: number;
  draft: WriterDraftPayload;
  fixed_issues: string[];
  remaining_issues: string[];
  deterministic_fixes: string[];
  provider?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  duration_ms: number;
  prompt_version: string;
  message: string;
  used_ai: boolean;
  /** Primary category targeted this pass */
  category?: IssueCategory | null;
  /** Progress gate / success flags */
  successful?: boolean;
  estimated_score?: number | null;
  progress_reason?: string;
  corrupted?: boolean;
  corruption_reasons?: string[];
}

export interface RevisionLoopResult {
  ok: boolean;
  /** Quality review gate passed (decision approved / status review). */
  passed: boolean;
  /** Full publish readiness after remediation (all publish-gate checks). */
  publish_ready?: boolean;
  article_id: number;
  status: string;
  attempts: number;
  before_score: number | null;
  after_score: number | null;
  revisions: RevisionResult[];
  final_report?: QualityReport;
  failure_reasons?: string[];
  message: string;
  needs_manual_review: boolean;
  /** Verification helpers */
  avg_score_delta?: number | null;
  unsuccessful_attempts?: number;
}

export interface RevisionHistoryRow {
  id: number;
  article_id: number;
  attempt: number;
  before_score: number | null;
  after_score: number | null;
  fixed_issues: string[];
  remaining_issues: string[];
  prompt_version: string | null;
  provider: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  before_draft: WriterDraftPayload | null;
  after_draft: WriterDraftPayload | null;
  created_at: string;
  /** Observability meta: category, timeline, confidence, prompt versions */
  meta_json?: Record<string, unknown> | null;
}
