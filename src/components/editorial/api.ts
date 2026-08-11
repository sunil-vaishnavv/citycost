/**
 * Shared API client for the CityCost Editorial Admin UI.
 * Every request attaches the bearer session token (when present) and
 * browser cookies, matching the existing `/api/editorial/*` auth model.
 */

const TOKEN_KEY = 'editorial_token';

let authToken: string | null =
  typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(TOKEN_KEY) : null;

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (typeof sessionStorage === 'undefined') return;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(path, { ...init, headers, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'DELETE', body: body != null ? JSON.stringify(body) : undefined }),
};

export interface GroqModelOption {
  id: string;
  label: string;
  hint?: string;
}

export interface GroqAiStatus {
  configured: boolean;
  api_key: string | null;
  masked_key: string | null;
  source: 'env';
  provider: 'groq';
  key_applied_at: number;
  ai_configured: boolean;
  models: GroqModelOption[];
  message?: string;
}

export async function login(password: string): Promise<{ token: string }> {
  const data = await api.post<{ token: string; ok: boolean }>('/api/editorial/auth/login', {
    password,
  });
  setAuthToken(data.token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/editorial/auth/logout');
  } catch {
    /* best-effort */
  }
  setAuthToken(null);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/* ─────────────────────────────── Shared types ─────────────────────────────── */

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

export type ArticleStatus = 'draft' | 'review' | 'published' | 'failed' | 'archived';

export interface Topic {
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
  locked_at: string | null;
  locked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Cluster {
  id: number;
  parent_id: number | null;
  slug: string;
  title: string;
  country_slug: string | null;
  kind: string;
  level_kind: string;
  depth: number;
  path: string | null;
}

export interface ArticleGenerationDebug {
  ai_model: string | null;
  prompt_version: number | null;
  generation_time_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  estimated_ai_cost_usd: number | null;
  research_pack_size_chars: number | null;
  prompt_size_chars: number | null;
}

export interface Article {
  id: number;
  slug: string;
  content_type: string;
  cluster_id: number | null;
  topic_id: number | null;
  status: ArticleStatus | string;
  seo_title: string | null;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  prompt_version: number | null;
  prompt_hash: string | null;
  ai_model: string | null;
  temperature: number | null;
  top_p: number | null;
  generation_time_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  reading_time_minutes: number | null;
  word_count: number;
  quality_score: number | null;
  review_score: number | null;
  overall_confidence?: number | null;
  confidence_level?: string | null;
  article_health?: string | null;
  preview_version: number | null;
  canonical_url: string | null;
  published_at: string | null;
  last_public_update_at: string | null;
  created_at: string;
  updated_at: string;
  /** Admin-only generation diagnostics */
  generation_debug?: ArticleGenerationDebug;
  /** manual | automatic — from API list/detail */
  source?: 'manual' | 'automatic';
}

export interface ResearchPreview {
  intent: string;
  target_keyword: string;
  article_angle: string;
  reader_persona: string;
  search_questions: string[];
  semantic_keywords: string[];
  recommended_outline: string[];
}

export interface ArticleBlock {
  id: string;
  type: string;
  heading?: string;
  content: unknown;
}

export interface SeoPackage {
  seo_title?: string;
  meta_title?: string;
  meta_description?: string;
  canonical?: string;
  suggested_url?: string;
  primary_keyword?: string;
  og?: Record<string, unknown>;
  twitter?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SeoValidation {
  seo_score?: number;
  errors?: Array<{ message: string }>;
  warnings?: Array<{ message: string }>;
  recommendations?: Array<{ message: string }>;
  missing_items?: string[];
  checks?: Record<string, unknown>;
}

export interface InternalLinkRecommendation {
  anchor: string;
  target: string;
  reason: string;
  confidence: number;
  location: string;
  link_kind: string;
}

export interface ArticlePreview {
  article_id: number;
  slug: string;
  status: string;
  preview_version: number | null;
  reading_time_minutes: number | null;
  word_count: number;
  quality_score: number | null;
  review_score: number | null;
  blocks: ArticleBlock[];
  excerpt: string | null;
  seo_package: SeoPackage | null;
  entity_map: Record<string, unknown> | null;
  json_ld: (Record<string, unknown> & { schema_status?: Record<string, unknown> }) | null;
  internal_links: { recommendations?: InternalLinkRecommendation[]; count?: number } | null;
  seo_validation: SeoValidation | null;
  quality_panel: {
    overall_seo_score: number | null;
    eeat_score: number | null;
    helpful_content_score: number | null;
    search_intent_score: number | null;
    readability_score: number | null;
    internal_link_count: number;
    schema_status: Record<string, unknown> | null;
    missing_items: string[];
    quality_score: number | null;
  };
}

export interface ReviewHistoryItem {
  id: number;
  attempt: number;
  passed: boolean;
  score: number | null;
  created_at: string;
  summary: string | null;
  scores?: Record<string, number> | null;
  issues?: string[];
  decision?: string | null;
  remaining_rules?: string[];
  resolved_rules?: string[];
  rule_groups?: Record<string, string[]> | null;
  critical_fail?: boolean;
  overall_confidence?: number | null;
  confidence_level?: string | null;
  confidence_breakdown?: Record<string, number> | null;
  article_health?: string | null;
  prompt_versions?: Record<string, unknown> | null;
  /** Score-rejected / rolled-back review — not current active report */
  rolled_back?: boolean;
  inactive?: boolean;
  report_status?: string | null;
  rollback_reason?: string | null;
}

export interface PublishCheckItem {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface PublishReadiness {
  ready: boolean;
  article_id: number;
  status: string;
  slug: string | null;
  title: string | null;
  quality_score: number | null;
  seo_score: number | null;
  word_count: number;
  /** In-body markdown/HTML internal links */
  internal_link_count: number;
  /** SEO package recommendation count */
  package_link_count?: number;
  canonical_url: string | null;
  checks: PublishCheckItem[];
  blocking_errors: Array<{ code: string; message: string }>;
  confidence_level?: string | null;
  overall_confidence?: number | null;
  confidence_publish_action?: string | null;
  confidence_publish_message?: string | null;
}

export interface QualityReport {
  passed: boolean;
  overall_score: number;
  scores: Record<string, number>;
  issues: string[];
  failure_reasons?: string[];
  summary: string;
  engine_version: string;
  threshold: number;
  duplicate_threshold: number;
  decision?: 'approved' | 'revision' | 'manual_review' | string;
  decision_reasons?: string[];
  critical_fail?: boolean;
  critical_reasons?: string[];
  ready?: boolean;
  rule_groups?: Record<string, string[]>;
  resolved_rules?: string[];
  remaining_rules?: string[];
  ai_review?: Record<string, unknown>;
  rule_validator?: Record<string, unknown>;
  duplicate?: Record<string, unknown>;
  readability?: Record<string, unknown>;
  eeat?: Record<string, unknown>;
  search_intent?: Record<string, unknown>;
  human_writing?: Record<string, unknown>;
  helpful_content?: Record<string, unknown>;
  overall_confidence?: number;
  confidence_level?: string;
  confidence_breakdown?: Record<string, number>;
  article_health?: string;
  prompt_versions?: Record<string, unknown>;
  rolled_back?: boolean;
  inactive?: boolean;
  report_status?: string;
  rollback_reason?: string;
}

export interface ArticleObservability {
  article_id: number;
  article_health: string;
  overall_confidence: number | null;
  confidence_level: string | null;
  confidence_breakdown: Record<string, number> | null;
  prompt_versions: Record<string, unknown> | null;
  revision_count: number;
  total_ai_cost_usd: number;
  cost: {
    total_cost_usd: number;
    total_calls: number;
    by_stage: Array<{
      stage: string;
      calls: number;
      estimated_cost_usd: number;
      avg_latency_ms: number;
    }>;
    by_provider: Array<{
      provider: string;
      calls: number;
      failures: number;
      fallbacks: number;
      avg_latency_ms: number;
      success_rate: number;
      estimated_cost_usd: number;
    }>;
  };
  provider_analytics: Array<{
    provider: string;
    calls: number;
    failures: number;
    fallbacks: number;
    avg_latency_ms: number;
    success_rate: number;
    estimated_cost_usd: number;
  }>;
}

export interface ReviewArticleResponse {
  ok: boolean;
  passed: boolean;
  article_id: number;
  overall_score?: number;
  threshold?: number;
  status: string;
  message: string;
  failure_reasons?: string[];
  errors?: string[];
}

export interface UpdatePublishedContentResponse {
  ok: boolean;
  article_id: number;
  status: string;
  slug?: string;
  word_count?: number;
  reading_time_minutes?: number;
  message: string;
  errors?: Array<{ code: string; message: string }>;
}

export interface ArticleRaw {
  id: number;
  slug: string;
  raw_ai_response: string | null;
  draft_json: unknown;
  research_pack_json: {
    intent?: string;
    target_keyword?: string;
    article_angle?: string;
    reader_persona?: string;
    search_questions?: string[];
    semantic_keywords?: string[];
    recommended_outline?: string[];
    [key: string]: unknown;
  } | null;
  prompt_version: number | null;
  prompt_hash: string | null;
  ai_model: string | null;
}

export interface EditorialHealth {
  ok: boolean;
  state: 'ready' | 'disabled' | 'misconfigured';
  version: string;
  phase: string;
  database: boolean;
  schema_ready: boolean;
  admin_configured: boolean;
  auto_publish: boolean;
  automation_paused: boolean;
  message: string;
  components: Record<
    string,
    { ready: boolean; status: string; detail?: string }
  >;
}

export interface DashboardObservability {
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
}

export interface DashboardData {
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
    reading_level: string;
    automation_retry_count: number;
  };
  automation?: {
    today_job: Job | null;
    next_publish: string | null;
    next_topic_title: string | null;
    published_today: number;
    failed_today: number;
    avg_generation_ms: number | null;
  };
  observability?: DashboardObservability;
}

export type StageStatus = 'ok' | 'failed' | 'skipped';

export interface StageLog {
  stage: string;
  status: StageStatus;
  at: string;
  detail?: string;
  duration_ms?: number;
}

export interface Job {
  id: number;
  job_type: string;
  status: string;
  payload_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationStatus {
  settings: {
    scheduler_enabled: boolean;
    auto_publish: boolean;
    automation_paused: boolean;
    publishing_time_utc: string;
    timezone: string;
    automation_retry_count: number;
  };
  today: string;
  today_job: Job | null;
  next_publish: string | null;
  next_topic_title: string | null;
  queue: Job[];
  published_today: number;
  failed_today: number;
  avg_generation_ms: number | null;
  stages: StageLog[];
  /** When GROQ_API_KEY was last synced/applied — used to hide stale rate-limit errors. */
  groq_key_applied_at?: number;
}

export interface EditorialSettings {
  writer_model: string;
  reviewer_model: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  publishing_time_utc: string;
  timezone: string;
  scheduler_enabled: boolean;
  automation_retry_count: number;
  article_length_min: number;
  article_length_target_min: number;
  article_length_target_max: number;
  article_length_max: number;
  language: string;
  reading_level: string;
  auto_publish: boolean;
  automation_paused: boolean;
  quality_score_threshold: number;
  duplicate_threshold: number;
  internal_link_min: number;
  internal_link_max: number;
  max_writer_retries: number;
  max_reviewer_retries: number;
  auto_revision_enabled: boolean;
  max_revision_attempts: number;
  auto_revision_continue_pipeline: boolean;
  articles_per_day: number;
  session_ttl_hours: number;
  session_idle_timeout_minutes: number;
  refresh_enabled: boolean;
  refresh_cron: string;
  sitemap_ping_enabled: boolean;
  freshness_skip_above: number;
  freshness_pure_data_min: number;
  freshness_partial_min: number;
  strategy_max_candidates: number;
  confidence_auto_publish_excellent?: boolean;
  confidence_action_excellent?: 'auto_publish' | 'ready' | 'review' | 'manual';
  confidence_action_high?: 'auto_publish' | 'ready' | 'review' | 'manual';
  confidence_action_medium?: 'auto_publish' | 'ready' | 'review' | 'manual';
  confidence_action_low?: 'auto_publish' | 'ready' | 'review' | 'manual';
  [key: string]: unknown;
}
