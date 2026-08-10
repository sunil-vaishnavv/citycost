/**
 * Multi-provider AI contracts for Editorial Engine.
 * Writers/Reviewers call AiRouter — never a provider directly.
 */

export type AiProviderName =
  | 'groq'
  | 'gemini'
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'anthropic';

export interface AiGenerateInput {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  jsonMode?: boolean;
}

export interface AiGenerateResult {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs: number;
  finishReason?: string | null;
  provider: AiProviderName;
  model: string;
}

export interface ProviderHealthResult {
  ok: boolean;
  provider: AiProviderName;
  latencyMs: number;
  message: string;
  models?: string[];
  contextWindow?: number;
  supportsJson?: boolean;
  supportsStreaming?: boolean;
  rpm?: number | null;
  tpm?: number | null;
  status: 'healthy' | 'degraded' | 'down' | 'unconfigured';
}

export interface AiProviderAdapter {
  readonly name: AiProviderName;
  generate(input: AiGenerateInput, apiKey: string): Promise<AiGenerateResult>;
  health(apiKey: string): Promise<ProviderHealthResult>;
  estimateTokens(text: string): number;
  supportsStreaming(): boolean;
  supportsJson(): boolean;
  supportsLongContext(): boolean;
  listModels(): string[];
  defaultContextWindow(): number;
}

export interface ProviderRuntimeConfig {
  provider_name: AiProviderName;
  enabled: boolean;
  priority: number;
  api_key: string | null;
  api_key_masked: string | null;
  default_model: string | null;
  temperature: number;
  top_p: number;
  max_output_tokens: number;
  max_input_tokens: number;
  context_window: number;
  rpm_limit: number | null;
  tpm_limit: number | null;
  daily_limit: number | null;
  monthly_limit: number | null;
  fallback_provider: AiProviderName | null;
  status: string;
  last_tested_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  avg_latency_ms: number | null;
  avg_cost_usd: number | null;
}

export interface RouterCompleteInput {
  model?: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  jsonMode?: boolean;
  stage?: string;
  /** Prefer a specific provider first (still falls back). */
  preferredProvider?: AiProviderName;
  /** Cap provider failover attempts (Auto Fix / fast paths). */
  maxFailover?: number;
  /** Per-provider generate timeout (ms). */
  timeoutMs?: number;
  /** Optional article linkage for cost / provider analytics */
  articleId?: number | null;
}
