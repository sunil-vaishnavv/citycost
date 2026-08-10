import { estimateTokens } from '../prompt-budgeter.js';
import { getProviderDefaults } from '../provider-config.js';
import type {
  AiGenerateInput,
  AiGenerateResult,
  AiProviderAdapter,
  ProviderHealthResult,
} from '../types.js';

const defaults = getProviderDefaults('openrouter');

async function callOpenRouter(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://citycost.online',
      'X-Title': 'CityCost Editorial',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!res.ok) throw new Error(data.error?.message || `OpenRouter HTTP ${res.status}`);
  return {
    text: data.choices?.[0]?.message?.content || '',
    tokensIn: data.usage?.prompt_tokens,
    tokensOut: data.usage?.completion_tokens,
    finishReason: data.choices?.[0]?.finish_reason || null,
  };
}

export const openrouterProvider: AiProviderAdapter = {
  name: 'openrouter',
  estimateTokens,
  supportsStreaming: () => defaults.supports_streaming,
  supportsJson: () => defaults.supports_json,
  supportsLongContext: () => defaults.supports_long_context,
  listModels: () => [...defaults.models],
  defaultContextWindow: () => defaults.context_window,

  async generate(input: AiGenerateInput, apiKey: string): Promise<AiGenerateResult> {
    const started = Date.now();
    const out = await callOpenRouter(apiKey, {
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      ...(typeof input.topP === 'number' ? { top_p: input.topP } : {}),
      ...(input.jsonMode
        ? { response_format: { type: 'json_object' } }
        : {}),
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    });
    return { ...out, latencyMs: Date.now() - started, provider: 'openrouter', model: input.model };
  },

  async health(apiKey: string): Promise<ProviderHealthResult> {
    const started = Date.now();
    if (!apiKey) {
      return {
        ok: false,
        provider: 'openrouter',
        latencyMs: 0,
        message: 'API key missing',
        status: 'unconfigured',
        models: defaults.models,
        contextWindow: defaults.context_window,
        supportsJson: true,
        supportsStreaming: true,
        rpm: defaults.rpm_limit,
        tpm: defaults.tpm_limit,
      };
    }
    try {
      await callOpenRouter(apiKey, {
        model: defaults.default_model,
        max_tokens: 8,
        temperature: 0,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return {
        ok: true,
        provider: 'openrouter',
        latencyMs: Date.now() - started,
        message: 'Connected',
        status: 'healthy',
        models: defaults.models,
        contextWindow: defaults.context_window,
        supportsJson: true,
        supportsStreaming: true,
        rpm: defaults.rpm_limit,
        tpm: defaults.tpm_limit,
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'openrouter',
        latencyMs: Date.now() - started,
        message: (err as Error).message || 'Health check failed',
        status: 'down',
        models: defaults.models,
        contextWindow: defaults.context_window,
        supportsJson: true,
        supportsStreaming: true,
        rpm: defaults.rpm_limit,
        tpm: defaults.tpm_limit,
      };
    }
  },
};
