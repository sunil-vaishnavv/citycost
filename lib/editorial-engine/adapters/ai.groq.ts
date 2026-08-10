import Groq from 'groq-sdk';
import type { AiProviderPort } from '../types.js';

/**
 * Groq AI provider adapter for Editorial Writer / Research stages.
 * Reads GROQ_API_KEY from process.env on each use so admin key updates apply without restart.
 */
let client: Groq | null = null;
let clientKey: string | null = null;

function resolveKey(): string | null {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY') return null;
  return apiKey;
}

function getClient(): Groq | null {
  const key = resolveKey();
  if (!key) {
    client = null;
    clientKey = null;
    return null;
  }
  if (!client || clientKey !== key) {
    client = new Groq({ apiKey: key });
    clientKey = key;
  }
  return client;
}

/** Drop cached client after GROQ_API_KEY changes. */
export function refreshGroqAiClient(): void {
  client = null;
  clientKey = null;
}

export function createGroqAiProvider(): AiProviderPort {
  return {
    name: 'groq',
    isConfigured() {
      return getClient() != null;
    },
    async complete(input) {
      const groq = getClient();
      if (!groq) {
        throw new Error('Groq AI provider is not configured (GROQ_API_KEY missing)');
      }
      const started = Date.now();
      const completion = await groq.chat.completions.create({
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
      const text = choice?.message?.content || '';
      const finishReason = choice?.finish_reason || null;
      return {
        text,
        tokensIn: completion.usage?.prompt_tokens,
        tokensOut: completion.usage?.completion_tokens,
        latencyMs: Date.now() - started,
        finishReason,
      };
    },
  };
}
