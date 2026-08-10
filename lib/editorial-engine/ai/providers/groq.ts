import Groq from 'groq-sdk';
import { estimateTokens } from '../prompt-budgeter.js';
import { getProviderDefaults } from '../provider-config.js';
import type {
  AiGenerateInput,
  AiGenerateResult,
  AiProviderAdapter,
  ProviderHealthResult,
} from '../types.js';

const defaults = getProviderDefaults('groq');

export const groqProvider: AiProviderAdapter = {
  name: 'groq',
  estimateTokens,
  supportsStreaming: () => defaults.supports_streaming,
  supportsJson: () => defaults.supports_json,
  supportsLongContext: () => defaults.supports_long_context,
  listModels: () => [...defaults.models],
  defaultContextWindow: () => defaults.context_window,

  async generate(input: AiGenerateInput, apiKey: string): Promise<AiGenerateResult> {
    const client = new Groq({ apiKey });
    const started = Date.now();
    const completion = await client.chat.completions.create({
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      ...(typeof input.topP === 'number' ? { top_p: input.topP } : {}),
      ...(input.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    });
    const choice = completion.choices?.[0];
    return {
      text: choice?.message?.content || '',
      tokensIn: completion.usage?.prompt_tokens,
      tokensOut: completion.usage?.completion_tokens,
      latencyMs: Date.now() - started,
      finishReason: choice?.finish_reason || null,
      provider: 'groq',
      model: input.model,
    };
  },

  async health(apiKey: string): Promise<ProviderHealthResult> {
    const started = Date.now();
    if (!apiKey) {
      return {
        ok: false,
        provider: 'groq',
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
      const client = new Groq({ apiKey });
      await client.chat.completions.create({
        model: defaults.default_model,
        max_tokens: 8,
        temperature: 0,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return {
        ok: true,
        provider: 'groq',
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
        provider: 'groq',
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
