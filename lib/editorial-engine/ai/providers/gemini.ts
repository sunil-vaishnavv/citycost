import { estimateTokens } from '../prompt-budgeter.js';
import { getProviderDefaults } from '../provider-config.js';
import type {
  AiGenerateInput,
  AiGenerateResult,
  AiProviderAdapter,
  ProviderHealthResult,
} from '../types.js';

const defaults = getProviderDefaults('gemini');

async function generateContent(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  opts: { temperature: number; maxTokens: number; topP?: number; jsonMode?: boolean }
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      ...(typeof opts.topP === 'number' ? { topP: opts.topP } : {}),
      ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: { message?: string; status?: string };
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  if (!res.ok) {
    const err = new Error(data.error?.message || `Gemini HTTP ${res.status}`) as Error & {
      status?: number;
      retryable?: boolean;
    };
    err.status = res.status;
    err.retryable = res.status === 429 || res.status === 404;
    throw err;
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return {
    text,
    tokensIn: data.usageMetadata?.promptTokenCount,
    tokensOut: data.usageMetadata?.candidatesTokenCount,
    finishReason: data.candidates?.[0]?.finishReason || null,
  };
}

function modelCandidates(preferred?: string): string[] {
  const list = [preferred, ...defaults.models, 'gemini-flash-lite-latest', 'gemini-3.5-flash'].filter(
    Boolean
  ) as string[];
  return [...new Set(list)];
}

async function generateWithFallback(
  apiKey: string,
  preferredModel: string,
  system: string,
  user: string,
  opts: { temperature: number; maxTokens: number; topP?: number; jsonMode?: boolean }
) {
  const errors: string[] = [];
  for (const model of modelCandidates(preferredModel)) {
    try {
      const out = await generateContent(apiKey, model, system, user, opts);
      return { ...out, model };
    } catch (err) {
      const e = err as Error & { retryable?: boolean };
      errors.push(`${model}: ${e.message}`);
      if (!e.retryable) throw err;
    }
  }
  throw new Error(errors[0] || 'Gemini: all models failed');
}

async function listModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  const data = (await res.json()) as {
    error?: { message?: string };
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  if (!res.ok) throw new Error(data.error?.message || `Gemini listModels HTTP ${res.status}`);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
}

export const geminiProvider: AiProviderAdapter = {
  name: 'gemini',
  estimateTokens,
  supportsStreaming: () => defaults.supports_streaming,
  supportsJson: () => defaults.supports_json,
  supportsLongContext: () => defaults.supports_long_context,
  listModels: () => [...defaults.models],
  defaultContextWindow: () => defaults.context_window,

  async generate(input: AiGenerateInput, apiKey: string): Promise<AiGenerateResult> {
    const started = Date.now();
    const out = await generateWithFallback(apiKey, input.model, input.system, input.user, {
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      topP: input.topP,
      jsonMode: input.jsonMode,
    });
    return {
      text: out.text,
      tokensIn: out.tokensIn,
      tokensOut: out.tokensOut,
      finishReason: out.finishReason,
      latencyMs: Date.now() - started,
      provider: 'gemini',
      model: out.model,
    };
  },

  async health(apiKey: string): Promise<ProviderHealthResult> {
    const started = Date.now();
    if (!apiKey) {
      return {
        ok: false,
        provider: 'gemini',
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
      let available = defaults.models;
      try {
        const listed = await listModels(apiKey);
        if (listed.length) available = listed.slice(0, 12);
      } catch {
        /* generate path still validates */
      }

      const out = await generateWithFallback(
        apiKey,
        defaults.default_model,
        'You are a health check.',
        'ping',
        { temperature: 0, maxTokens: 8 }
      );
      return {
        ok: true,
        provider: 'gemini',
        latencyMs: Date.now() - started,
        message: `Connected (${out.model})`,
        status: 'healthy',
        models: available,
        contextWindow: defaults.context_window,
        supportsJson: true,
        supportsStreaming: true,
        rpm: defaults.rpm_limit,
        tpm: defaults.tpm_limit,
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'gemini',
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
