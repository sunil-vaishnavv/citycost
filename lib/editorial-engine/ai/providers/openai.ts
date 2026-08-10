import { estimateTokens } from '../prompt-budgeter.js';
import { getProviderDefaults } from '../provider-config.js';
import type {
  AiGenerateInput,
  AiGenerateResult,
  AiProviderAdapter,
  ProviderHealthResult,
} from '../types.js';

const defaults = getProviderDefaults('openai');

async function chatCompletions(
  apiKey: string,
  body: Record<string, unknown>,
  baseUrl = 'https://api.openai.com/v1'
): Promise<{
  text: string;
  tokensIn?: number;
  tokensOut?: number;
  finishReason?: string | null;
}> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!res.ok) {
    const msg = data.error?.message || `OpenAI HTTP ${res.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return {
    text: data.choices?.[0]?.message?.content || '',
    tokensIn: data.usage?.prompt_tokens,
    tokensOut: data.usage?.completion_tokens,
    finishReason: data.choices?.[0]?.finish_reason || null,
  };
}

export const openaiProvider: AiProviderAdapter = {
  name: 'openai',
  estimateTokens,
  supportsStreaming: () => defaults.supports_streaming,
  supportsJson: () => defaults.supports_json,
  supportsLongContext: () => defaults.supports_long_context,
  listModels: () => [...defaults.models],
  defaultContextWindow: () => defaults.context_window,

  async generate(input: AiGenerateInput, apiKey: string): Promise<AiGenerateResult> {
    const started = Date.now();
    const out = await chatCompletions(apiKey, {
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      ...(typeof input.topP === 'number' ? { top_p: input.topP } : {}),
      ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    });
    return {
      ...out,
      latencyMs: Date.now() - started,
      provider: 'openai',
      model: input.model,
    };
  },

  async health(apiKey: string): Promise<ProviderHealthResult> {
    const started = Date.now();
    if (!apiKey) {
      return {
        ok: false,
        provider: 'openai',
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
      // Prove the key first (models list works even when chat quota is 0)
      const modelsRes = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (modelsRes.status === 401) {
        throw new Error('Invalid OpenAI API key');
      }

      await chatCompletions(apiKey, {
        model: defaults.default_model,
        max_tokens: 8,
        temperature: 0,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return {
        ok: true,
        provider: 'openai',
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
      const message = (err as Error).message || 'Health check failed';
      const billing = /quota|billing|insufficient/i.test(message);
      return {
        ok: false,
        provider: 'openai',
        latencyMs: Date.now() - started,
        message: billing
          ? 'API key is valid, but OpenAI billing/quota is empty. Add credits at platform.openai.com/account/billing'
          : message,
        status: billing ? 'degraded' : 'down',
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

export { chatCompletions as openaiCompatibleChat };
