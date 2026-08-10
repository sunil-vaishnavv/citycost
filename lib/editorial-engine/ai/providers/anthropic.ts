import { estimateTokens } from '../prompt-budgeter.js';
import { getProviderDefaults } from '../provider-config.js';
import type {
  AiGenerateInput,
  AiGenerateResult,
  AiProviderAdapter,
  ProviderHealthResult,
} from '../types.js';

const defaults = getProviderDefaults('anthropic');

async function messagesCreate(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (!res.ok) throw new Error(data.error?.message || `Anthropic HTTP ${res.status}`);
  const text = (data.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('');
  return {
    text,
    tokensIn: data.usage?.input_tokens,
    tokensOut: data.usage?.output_tokens,
    finishReason: data.stop_reason || null,
  };
}

export const anthropicProvider: AiProviderAdapter = {
  name: 'anthropic',
  estimateTokens,
  supportsStreaming: () => defaults.supports_streaming,
  supportsJson: () => defaults.supports_json,
  supportsLongContext: () => defaults.supports_long_context,
  listModels: () => [...defaults.models],
  defaultContextWindow: () => defaults.context_window,

  async generate(input: AiGenerateInput, apiKey: string): Promise<AiGenerateResult> {
    const started = Date.now();
    const user = input.jsonMode
      ? `${input.user}\n\nRespond with valid JSON only.`
      : input.user;
    const out = await messagesCreate(apiKey, {
      model: input.model,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      ...(typeof input.topP === 'number' ? { top_p: input.topP } : {}),
      system: input.system,
      messages: [{ role: 'user', content: user }],
    });
    return { ...out, latencyMs: Date.now() - started, provider: 'anthropic', model: input.model };
  },

  async health(apiKey: string): Promise<ProviderHealthResult> {
    const started = Date.now();
    if (!apiKey) {
      return {
        ok: false,
        provider: 'anthropic',
        latencyMs: 0,
        message: 'API key missing (future-ready)',
        status: 'unconfigured',
        models: defaults.models,
        contextWindow: defaults.context_window,
        supportsJson: false,
        supportsStreaming: true,
        rpm: defaults.rpm_limit,
        tpm: defaults.tpm_limit,
      };
    }
    try {
      await messagesCreate(apiKey, {
        model: defaults.default_model,
        max_tokens: 8,
        temperature: 0,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return {
        ok: true,
        provider: 'anthropic',
        latencyMs: Date.now() - started,
        message: 'Connected',
        status: 'healthy',
        models: defaults.models,
        contextWindow: defaults.context_window,
        supportsJson: false,
        supportsStreaming: true,
        rpm: defaults.rpm_limit,
        tpm: defaults.tpm_limit,
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'anthropic',
        latencyMs: Date.now() - started,
        message: (err as Error).message || 'Health check failed',
        status: 'down',
        models: defaults.models,
        contextWindow: defaults.context_window,
        supportsJson: false,
        supportsStreaming: true,
        rpm: defaults.rpm_limit,
        tpm: defaults.tpm_limit,
      };
    }
  },
};
