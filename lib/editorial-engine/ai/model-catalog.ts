/**
 * Model catalog + automatic model failover.
 *
 * Providers retire models regularly (e.g. Groq's llama-3.x / gemma2 lines), and
 * free tiers apply per-model quotas. Instead of failing the whole provider when
 * one model errors, the router walks an ordered model chain per provider:
 *
 *   preferred (only if it belongs to this provider)
 *   → last auto-switched model that worked
 *   → configured default_model
 *   → admin-configured fallback_models (Settings → AI Providers)
 *   → auto candidates from the provider's live model list (if auto failover is on)
 *
 * Live lists are fetched from each provider's model endpoint (no generation
 * quota is used) and cached for 30 minutes.
 */

import type { AiProviderName } from './types.js';
import { getProviderDefaults } from './provider-config.js';

const CACHE_MS = 30 * 60 * 1000;
const MAX_CHAIN = 5;

export interface ProviderModelMeta {
  /** Admin-ordered fallback models for this provider. */
  fallback_models?: string[];
  /** Auto-switch to another model when the current one errors (default true). */
  auto_model_fallback?: boolean;
  /** Last model the router switched to automatically, and why. */
  auto_model?: { model: string; from: string | null; reason: string; at: string } | null;
}

interface CacheEntry {
  at: number;
  models: string[] | null;
  error?: string;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(provider: AiProviderName, apiKey: string | null): string {
  return `${provider}:${(apiKey || '').slice(-6)}`;
}

/** Text-chat models only (skip speech, guard, embedding, image, TTS, robotics…). */
const NON_CHAT = /whisper|guard|orpheus|tts|safeguard|embed|image|imagen|veo|robotics|computer-use|transcribe|aqa|nano-banana|vision-only|moderation|audio/i;

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (data.error as { message?: string } | undefined)?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function fetchLiveModelsUncached(provider: AiProviderName, apiKey: string | null): Promise<string[] | null> {
  if (provider === 'groq') {
    if (!apiKey) return null;
    const data = (await fetchJson('https://api.groq.com/openai/v1/models', {
      Authorization: `Bearer ${apiKey}`,
    })) as { data?: Array<{ id: string; active?: boolean; context_window?: number }> };
    return (data.data || [])
      .filter((m) => m.active !== false && !NON_CHAT.test(m.id) && (m.context_window ?? 32000) >= 16000)
      .map((m) => m.id);
  }
  if (provider === 'openrouter') {
    const data = (await fetchJson('https://openrouter.ai/api/v1/models')) as {
      data?: Array<{ id: string; context_length?: number; architecture?: { output_modalities?: string[] } }>;
    };
    return (data.data || [])
      .filter(
        (m) =>
          !NON_CHAT.test(m.id) &&
          (m.context_length ?? 0) >= 32000 &&
          (!m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
      )
      .map((m) => m.id);
  }
  if (provider === 'gemini') {
    if (!apiKey) return null;
    const data = (await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`
    )) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter((id) => id && /gemini/i.test(id) && !NON_CHAT.test(id));
  }
  return null; // openai / deepseek / anthropic: static lists
}

/** Live model ids for a provider (cached 30 min). null = unknown (fetch failed / unsupported). */
export async function getLiveModels(provider: AiProviderName, apiKey: string | null): Promise<string[] | null> {
  const key = cacheKey(provider, apiKey);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.models;
  try {
    const models = await fetchLiveModelsUncached(provider, apiKey);
    cache.set(key, { at: Date.now(), models });
    return models;
  } catch (err) {
    cache.set(key, { at: Date.now(), models: null, error: (err as Error).message });
    return null;
  }
}

export function clearModelCache(): void {
  cache.clear();
}

/** All model ids currently known from any provider's live list (cache only, no fetch). */
export function cachedLiveModelIds(): Set<string> {
  const out = new Set<string>();
  for (const entry of cache.values()) for (const m of entry.models || []) out.add(m);
  return out;
}

/** Preferred auto candidates per provider (first match in the live list wins). */
const AUTO_PREFERENCE: Partial<Record<AiProviderName, RegExp[]>> = {
  groq: [/gpt-oss-120b/, /llama-3\.3-70b/, /qwen/, /gpt-oss-20b/, /llama/, /.*/],
  gemini: [/^gemini-3\.\d+-flash$/, /^gemini-flash-latest$/, /flash-lite/, /^gemini-\d/, /.*/],
  // Free tiers (no credits) only work with :free models — prefer well-known instruct families.
  openrouter: [
    /^meta-llama\/llama-3\.3-70b.*:free$/,
    /^google\/gemma-4-31b.*:free$/,
    /^nvidia\/nemotron-3-super.*:free$/,
    /^(?:qwen|deepseek|openai\/gpt-oss|mistralai).*:free$/,
    /:free$/,
    /.*/,
  ],
};

function autoCandidates(provider: AiProviderName, live: string[]): string[] {
  const prefs = AUTO_PREFERENCE[provider] || [/.*/];
  const out: string[] = [];
  for (const re of prefs) {
    const sorted = live.filter((m) => re.test(m)).sort((a, b) => b.localeCompare(a));
    for (const m of sorted) {
      if (!out.includes(m)) out.push(m);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

export function belongsToProvider(provider: AiProviderName, model: string, live: string[] | null): boolean {
  if (!model) return false;
  if (live) return live.includes(model);
  return getProviderDefaults(provider).models.includes(model);
}

export interface ModelChain {
  models: string[];
  /** Configured models that the provider no longer offers (for UI / logs). */
  unavailable: string[];
  live: boolean;
}

export async function buildModelChain(input: {
  provider: AiProviderName;
  apiKey: string | null;
  defaultModel: string | null;
  preferredModel?: string;
  meta?: ProviderModelMeta | null;
}): Promise<ModelChain> {
  const live = await getLiveModels(input.provider, input.apiKey);
  const meta = input.meta || {};
  const auto = meta.auto_model_fallback !== false;
  const defaults = getProviderDefaults(input.provider);
  const wanted: string[] = [];
  if (input.preferredModel && belongsToProvider(input.provider, input.preferredModel, live)) {
    wanted.push(input.preferredModel);
  }
  if (auto && meta.auto_model?.model) wanted.push(meta.auto_model.model);
  if (input.defaultModel) wanted.push(input.defaultModel);
  wanted.push(...(meta.fallback_models || []));
  if (!input.defaultModel) wanted.push(defaults.default_model);

  const unavailable: string[] = [];
  const models: string[] = [];
  for (const m of wanted) {
    if (!m || models.includes(m)) continue;
    if (live && !live.includes(m)) {
      if (!unavailable.includes(m)) unavailable.push(m);
      continue;
    }
    models.push(m);
  }
  if (auto) {
    const pool = live || defaults.models;
    for (const m of autoCandidates(input.provider, pool)) {
      if (models.length >= MAX_CHAIN) break;
      if (!models.includes(m)) models.push(m);
    }
  }
  return { models: models.slice(0, MAX_CHAIN), unavailable, live: Boolean(live) };
}

export type ModelErrorKind = 'auth' | 'model_unavailable' | 'rate_limited' | 'credits' | 'overloaded' | 'request' | 'unknown';

/** Classify a provider error. `auth` stops the whole provider; everything else tries the next model. */
export function classifyModelError(message: string, status?: number): ModelErrorKind {
  const m = message || '';
  if (status === 401 || status === 403 || /invalid api key|api key not valid|unauthori[sz]ed|permission denied|invalid_api_key|UNAUTHENTICATED/i.test(m)) {
    return 'auth';
  }
  if (status === 402 || /insufficient credits|credit balance|payment required|requires more credits/i.test(m)) return 'credits';
  if (status === 404 || /model_not_found|decommissioned|does not exist|not found|no longer (?:available|supported)|deprecated|not supported for|unknown model|is not a valid model/i.test(m)) {
    return 'model_unavailable';
  }
  if (status === 429 || /rate.?limit|quota|tokens per (?:day|minute)|\bTPD\b|\bTPM\b|RESOURCE_EXHAUSTED|too many requests/i.test(m)) {
    return 'rate_limited';
  }
  if ((status && status >= 500) || /overloaded|unavailable|timed? ?out|ETIMEDOUT|ECONNRESET|503|502|bad gateway/i.test(m)) return 'overloaded';
  if (status === 400 || status === 413 || /context length|too large|maximum context|json_validate_failed|failed to generate json/i.test(m)) return 'request';
  return 'unknown';
}

export function statusFromError(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } };
  const s = e?.status ?? e?.statusCode ?? e?.response?.status;
  return typeof s === 'number' ? s : undefined;
}
