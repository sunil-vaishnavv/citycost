import { estimateTokens } from '../prompt-budgeter.js';
import { getProviderDefaults } from '../provider-config.js';
import type {
  AiGenerateInput,
  AiGenerateResult,
  AiProviderAdapter,
  ProviderHealthResult,
} from '../types.js';
import { openaiCompatibleChat } from './openai.js';

const defaults = getProviderDefaults('deepseek');
const BASE_URL = 'https://api.deepseek.com/v1';

export const deepseekProvider: AiProviderAdapter = {
  name: 'deepseek',
  estimateTokens,
  supportsStreaming: () => defaults.supports_streaming,
  supportsJson: () => defaults.supports_json,
  supportsLongContext: () => defaults.supports_long_context,
  listModels: () => [...defaults.models],
  defaultContextWindow: () => defaults.context_window,

  async generate(input: AiGenerateInput, apiKey: string): Promise<AiGenerateResult> {
    const started = Date.now();
    const out = await openaiCompatibleChat(
      apiKey,
      {
        model: input.model,
        temperature: input.temperature,
        max_tokens: input.maxTokens,
        ...(typeof input.topP === 'number' ? { top_p: input.topP } : {}),
        ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      },
      BASE_URL
    );
    return {
      ...out,
      latencyMs: Date.now() - started,
      provider: 'deepseek',
      model: input.model,
    };
  },

  async health(apiKey: string): Promise<ProviderHealthResult> {
    const started = Date.now();
    if (!apiKey) {
      return {
        ok: false,
        provider: 'deepseek',
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
      // Key check (list models) — works even when balance is 0
      const modelsRes = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (modelsRes.status === 401 || modelsRes.status === 403) {
        throw new Error('Invalid DeepSeek API key');
      }

      await openaiCompatibleChat(
        apiKey,
        {
          model: defaults.default_model,
          max_tokens: 8,
          temperature: 0,
          messages: [{ role: 'user', content: 'ping' }],
        },
        BASE_URL
      );
      return {
        ok: true,
        provider: 'deepseek',
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
      const noBalance = /insufficient balance|402|payment required/i.test(message);
      return {
        ok: false,
        provider: 'deepseek',
        latencyMs: Date.now() - started,
        message: noBalance
          ? 'API key is valid, but DeepSeek balance is empty. Top up at platform.deepseek.com'
          : message,
        status: noBalance ? 'degraded' : 'down',
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
