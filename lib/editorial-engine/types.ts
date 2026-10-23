/** Editorial Engine shared types (P0+ / P1). */

export type EditorialReadyState = 'ready' | 'disabled' | 'misconfigured';

export type PromptCategory =
  | 'Writer'
  | 'Reviewer'
  | 'Refresh'
  | 'Patch'
  | 'SEO'
  | 'Outline'
  | 'Summary';

export type EditorialPhase = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7';

export type TopicStatus =
  | 'candidate'
  | 'approved'
  | 'scheduled'
  | 'generating'
  | 'draft'
  | 'review'
  | 'published'
  | 'archived'
  | 'rejected';

/** Statuses that lock a topic against duplicate scheduling. */
export const TOPIC_IN_PROGRESS_STATUSES: TopicStatus[] = [
  'scheduled',
  'generating',
  'draft',
  'review',
];

export const TOPIC_TERMINAL_LOCK_STATUSES: TopicStatus[] = [
  ...TOPIC_IN_PROGRESS_STATUSES,
  'published',
];

export type ClusterLevelKind = 'country' | 'pillar' | 'sub_pillar' | 'persona' | 'article';

export type CalendarEntryStatus = 'scheduled' | 'skipped' | 'completed' | 'cancelled';

export type CalendarScheduleSource = 'manual' | 'auto';

export interface ScoreBreakdown {
  factors: Record<string, number>;
  rationale: string[];
  weights_applied: StrategyWeights;
  rejected: boolean;
  reject_reason?: string;
  computed_at: string;
  scorer_version: string;
}

export interface ComponentReadiness {
  ready: boolean;
  status: string;
  detail?: string;
}

export interface EditorialHealth {
  ok: boolean;
  state: EditorialReadyState;
  version: string;
  phase: EditorialPhase;
  database: boolean;
  schema_ready: boolean;
  admin_configured: boolean;
  auto_publish: boolean;
  automation_paused: boolean;
  message: string;
  components: {
    database: ComponentReadiness;
    scheduler: ComponentReadiness;
    writer: ComponentReadiness;
    reviewer: ComponentReadiness;
    refresh: ComponentReadiness;
    strategy: ComponentReadiness;
  };
}

export type ReadingLevel = 'general' | 'intermediate' | 'advanced';

export interface EditorialSettings {
  writer_model: string;
  reviewer_model: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  publishing_time_utc: string;
  /** IANA timezone for daily publish time (e.g. Asia/Kolkata, UTC). */
  timezone: string;
  /** When false, daily scheduler never fires (manual run still allowed). */
  scheduler_enabled: boolean;
  /** Max retries for a failed daily pipeline job (default 3). */
  automation_retry_count: number;
  article_length_min: number;
  article_length_target_min: number;
  article_length_target_max: number;
  article_length_max: number;
  language: string;
  reading_level: ReadingLevel;
  auto_publish: boolean;
  automation_paused: boolean;
  quality_score_threshold: number;
  duplicate_threshold: number;
  internal_link_min: number;
  internal_link_max: number;
  max_writer_retries: number;
  max_reviewer_retries: number;
  /** P4.5 — enable self-healing revision after review FAIL */
  auto_revision_enabled: boolean;
  /** P4.5 — max revise→review cycles (default 3) */
  max_revision_attempts: number;
  /** P4.5 — automatically continue pipeline after a successful revision pass */
  auto_revision_continue_pipeline: boolean;
  articles_per_day: number;
  /** Absolute session lifetime (hours). */
  session_ttl_hours: number;
  /** Idle timeout — session invalidated after this many minutes without activity. */
  session_idle_timeout_minutes: number;
  refresh_enabled: boolean;
  refresh_cron: string;
  sitemap_ping_enabled: boolean;
  freshness_skip_above: number;
  freshness_pure_data_min: number;
  freshness_partial_min: number;
  /** @deprecated Prefer editorial_strategy_settings table; kept for backward compat. */
  strategy_weights: StrategyWeights;
  strategy_max_candidates: number;
  /** When true + confidence Excellent, publish readiness messaging allows auto-publish */
  confidence_auto_publish_excellent: boolean;
  /** Confidence → publish action mapping (messaging / soft readiness only) */
  confidence_action_excellent: 'auto_publish' | 'ready' | 'review' | 'manual';
  confidence_action_high: 'auto_publish' | 'ready' | 'review' | 'manual';
  confidence_action_medium: 'auto_publish' | 'ready' | 'review' | 'manual';
  confidence_action_low: 'auto_publish' | 'ready' | 'review' | 'manual';
}

export interface StrategyWeights {
  /** @deprecated legacy — kept for settings merge compatibility */
  comparison_exists?: number;
  city_page_exists?: number;
  country_page_exists?: number;
  search_opportunity?: number;
  seasonal_opportunity?: number;
  topical_authority?: number;
  weak_topical_value?: number;
  low_information_gain?: number;
  /** Multi-factor scorer (v3) — relative weights summing ~100 */
  search_demand: number;
  competition: number;
  authority_opportunity: number;
  internal_linking: number;
  freshness: number;
  commercial_intent: number;
  coverage_gap: number;
  existing_content: number;
  geographic_priority: number;
  already_published: number;
  near_duplicate: number;
  /** Reject candidates below this final score (0–100). */
  min_accept_score?: number;
}

export interface PromptTemplate {
  id: number;
  prompt_key: string;
  category: PromptCategory;
  version: number;
  title: string;
  body: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ContentTypeRow {
  id: number;
  type_key: string;
  display_name: string;
  enabled: boolean;
  prompt_key: string | null;
  schema_type: string;
  structure_json: Record<string, unknown>;
  seo_rules_json: Record<string, unknown>;
  quality_rules_json: Record<string, unknown>;
}

export interface EditorialDashboard {
  health: EditorialHealth;
  counts: {
    articles_draft: number;
    articles_published: number;
    articles_failed: number;
    topics: number;
    calendar_upcoming: number;
    jobs_queued: number;
    content_gaps_open: number;
  };
  settings_summary: {
    auto_publish: boolean;
    automation_paused: boolean;
    scheduler_enabled: boolean;
    timezone: string;
    writer_model: string;
    reviewer_model: string;
    publishing_time_utc: string;
    articles_per_day: number;
    reading_level: ReadingLevel;
    automation_retry_count: number;
  };
  automation?: {
    today_job: EditorialJobRow | null;
    next_publish: string | null;
    next_topic_title: string | null;
    published_today: number;
    failed_today: number;
    avg_generation_ms: number | null;
  };
  observability?: {
    avg_confidence: number;
    avg_ai_cost_usd: number;
    revision_success_rate: number;
    manual_review_rate: number;
    avg_quality_score: number;
    avg_publish_time_hours: number | null;
    daily_quality: Array<{ day: string; avg_score: number; count: number }>;
    daily_cost: Array<{ day: string; cost_usd: number; requests: number }>;
    daily_confidence: Array<{ day: string; avg_confidence: number; count: number }>;
    provider_usage: Array<{
      provider: string;
      requests: number;
      cost_usd: number;
      avg_latency_ms: number;
      success_rate: number;
    }>;
  };
}

export interface EditorialTopic {
  id: number;
  title: string;
  cluster_id: number | null;
  content_type: string;
  source_refs_json: Record<string, unknown> | null;
  priority_score: number;
  status: TopicStatus | string;
  topic_hash: string;
  rationale_json: string[] | null;
  locked: boolean;
  locked_at: Date | null;
  locked_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EditorialCluster {
  id: number;
  parent_id: number | null;
  slug: string;
  title: string;
  country_slug: string | null;
  kind: string;
  level_kind: ClusterLevelKind | string;
  depth: number;
  path: string | null;
}

export interface TopicCandidate {
  title: string;
  content_type: string;
  cluster_slug: string;
  source_refs: Record<string, unknown>;
  topic_hash: string;
}

export interface TopicScoreResult {
  priority_score: number;
  factors: Record<string, number>;
  rationale: string[];
  rejected: boolean;
  reject_reason?: string;
  breakdown: ScoreBreakdown;
}

export interface EditorialCalendarEntry {
  id: number;
  publish_date: string;
  topic_id: number | null;
  status: CalendarEntryStatus | string;
  notes: string | null;
  schedule_source: CalendarScheduleSource | string;
  locked: boolean;
  locked_at: Date | null;
  locked_by: string | null;
  skip_reason: string | null;
  topic?: EditorialTopic | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContentGap {
  id: number;
  gap_type: string;
  cluster_id: number | null;
  topic_hash: string | null;
  title: string;
  severity: number;
  detail_json: Record<string, unknown> | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/** Port: background job queue (DB now; Redis-swappable later). */
export interface QueuePort {
  enqueue(jobType: string, payload: Record<string, unknown>, runAfter?: Date): Promise<number>;
  getJob(id: number): Promise<EditorialJobRow | null>;
}

export interface EditorialJobRow {
  id: number;
  job_type: string;
  status: string;
  payload_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
}

/** Port: schedulers (in-process now; external cron later). */
export interface SchedulerPort {
  register(name: string, cronOrInterval: string, handler: () => Promise<void>): void;
  start(): void;
  stop(): void;
  listRegistered(): string[];
}

/** Port: AI completion (implemented by AI Router — multi-provider failover). */
export interface AiProviderPort {
  readonly name: string;
  isConfigured(): boolean;
  complete(input: {
    model: string;
    system: string;
    user: string;
    temperature: number;
    maxTokens: number;
    topP?: number;
    jsonMode?: boolean;
  }): Promise<{
    text: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs: number;
    finishReason?: string | null;
  }>;
}

/** Port: persistence facade (PostgreSQL). */
export interface StoragePort {
  ping(): Promise<boolean>;
}
