import type { AiProviderName } from './types.js';

export interface ProviderDefaults {
  name: AiProviderName;
  label: string;
  priority: number;
  default_model: string;
  models: string[];
  temperature: number;
  top_p: number;
  max_output_tokens: number;
  max_input_tokens: number;
  context_window: number;
  rpm_limit: number | null;
  tpm_limit: number | null;
  daily_limit: number | null;
  supports_json: boolean;
  supports_streaming: boolean;
  supports_long_context: boolean;
  env_key?: string;
}

export const PROVIDER_DEFAULTS: ProviderDefaults[] = [
  {
    name: 'groq',
    label: 'Groq',
    priority: 10,
    // Groq retired the llama-3.x / gemma2 chat lines; live list is fetched at runtime
    // (model-catalog.ts) and these are only the offline fallback.
    default_model: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    temperature: 0.45,
    top_p: 0.9,
    max_output_tokens: 8192,
    max_input_tokens: 28000,
    context_window: 128000,
    rpm_limit: 30,
    tpm_limit: 6000,
    daily_limit: 100000,
    supports_json: true,
    supports_streaming: true,
    supports_long_context: true,
    env_key: 'GROQ_API_KEY',
  },
  {
    name: 'gemini',
    label: 'Gemini',
    priority: 20,
    default_model: 'gemini-flash-latest',
    models: [
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
    ],
    temperature: 0.45,
    top_p: 0.9,
    max_output_tokens: 8192,
    max_input_tokens: 100000,
    context_window: 1000000,
    rpm_limit: 60,
    tpm_limit: 1000000,
    daily_limit: null,
    supports_json: true,
    supports_streaming: true,
    supports_long_context: true,
    env_key: 'GEMINI_API_KEY',
  },
  {
    name: 'openai',
    label: 'OpenAI',
    priority: 30,
    default_model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    temperature: 0.45,
    top_p: 0.9,
    max_output_tokens: 8192,
    max_input_tokens: 100000,
    context_window: 128000,
    rpm_limit: 500,
    tpm_limit: 200000,
    daily_limit: null,
    supports_json: true,
    supports_streaming: true,
    supports_long_context: true,
    env_key: 'OPENAI_API_KEY',
  },
  {
    name: 'deepseek',
    label: 'DeepSeek',
    priority: 35,
    default_model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    temperature: 0.45,
    top_p: 0.9,
    max_output_tokens: 8192,
    max_input_tokens: 64000,
    context_window: 128000,
    rpm_limit: 60,
    tpm_limit: 200000,
    daily_limit: null,
    supports_json: true,
    supports_streaming: true,
    supports_long_context: true,
    env_key: 'DEEPSEEK_API_KEY',
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    priority: 40,
    default_model: 'openai/gpt-4o-mini',
    models: [
      'openai/gpt-4o-mini',
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
    ],
    temperature: 0.45,
    top_p: 0.9,
    max_output_tokens: 8192,
    max_input_tokens: 100000,
    context_window: 128000,
    rpm_limit: 200,
    tpm_limit: 200000,
    daily_limit: null,
    supports_json: true,
    supports_streaming: true,
    supports_long_context: true,
    env_key: 'OPENROUTER_API_KEY',
  },
  {
    name: 'anthropic',
    label: 'Anthropic',
    priority: 50,
    default_model: 'claude-3-5-sonnet-latest',
    models: [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest',
    ],
    temperature: 0.45,
    top_p: 0.9,
    max_output_tokens: 8192,
    max_input_tokens: 180000,
    context_window: 200000,
    rpm_limit: 50,
    tpm_limit: 40000,
    daily_limit: null,
    supports_json: false,
    supports_streaming: true,
    supports_long_context: true,
    env_key: 'ANTHROPIC_API_KEY',
  },
];

export function getProviderDefaults(name: AiProviderName): ProviderDefaults {
  const found = PROVIDER_DEFAULTS.find((p) => p.name === name);
  if (!found) throw new Error(`Unknown provider ${name}`);
  return found;
}

/** Rough USD / 1M tokens for analytics (not billing-accurate). */
export function estimateCostUsd(
  provider: AiProviderName,
  tokensIn: number,
  tokensOut: number
): number {
  const rates: Record<AiProviderName, { in: number; out: number }> = {
    groq: { in: 0.59, out: 0.79 },
    gemini: { in: 0.1, out: 0.4 },
    openai: { in: 0.15, out: 0.6 },
    deepseek: { in: 0.28, out: 0.42 },
    openrouter: { in: 0.2, out: 0.8 },
    anthropic: { in: 3, out: 15 },
  };
  const r = rates[provider];
  return Math.round(((tokensIn / 1e6) * r.in + (tokensOut / 1e6) * r.out) * 1e6) / 1e6;
}
