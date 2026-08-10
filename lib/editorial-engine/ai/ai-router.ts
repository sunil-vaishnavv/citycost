/**
 * AI Router — single entry for Writer / Reviewer / SEO AI calls.
 * Selects highest-priority enabled provider, budgets prompts, fails over.
 */

import type { AiProviderPort } from '../types.js';
import {
  insertAiUsageLog,
  listAiProviderSettings,
  markProviderUsed,
} from '../db/ai-settings-repo.js';
import { estimateCostUsd } from './provider-config.js';
import { selectProviderChain } from './provider-selector.js';
import { mergeChunkTexts, planRequest } from './prompt-budgeter.js';
import { getProviderAdapter } from './providers/index.js';
import type { AiGenerateResult, AiProviderName, RouterCompleteInput } from './types.js';

let configuredCache = false;

export function refreshRouterConfiguredCache(configured: boolean): void {
  configuredCache = configured;
}

export class AiRouter {
  readonly name = 'ai-router';

  isConfigured(): boolean {
    const groq = process.env.GROQ_API_KEY?.trim();
    if (groq && groq !== 'YOUR_GROQ_API_KEY') return true;
    return configuredCache;
  }

  async hasAnyProvider(): Promise<boolean> {
    try {
      const chain = await selectProviderChain();
      const ok = chain.length > 0;
      configuredCache = ok || Boolean(process.env.GROQ_API_KEY?.trim());
      return ok || configuredCache;
    } catch {
      const groq = process.env.GROQ_API_KEY?.trim();
      return Boolean(groq && groq !== 'YOUR_GROQ_API_KEY');
    }
  }

  /**
   * Primary API used by Writer / Reviewer / SEO assist.
   */
  async complete(input: RouterCompleteInput): Promise<{
    text: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs: number;
    finishReason?: string | null;
    provider?: AiProviderName;
    model?: string;
    retries?: number;
  }> {
    let chain = await selectProviderChain(input.preferredProvider);

    // Env-only Groq fallback if DB empty / unavailable
    if (!chain.length) {
      const groqKey = process.env.GROQ_API_KEY?.trim();
      if (groqKey && groqKey !== 'YOUR_GROQ_API_KEY') {
        chain = [
          {
            id: 0,
            provider_name: 'groq',
            enabled: true,
            priority: 10,
            api_key: groqKey,
            api_key_masked: null,
            default_model: input.model || 'llama-3.3-70b-versatile',
            temperature: input.temperature,
            top_p: input.topP ?? 0.9,
            max_output_tokens: input.maxTokens,
            max_input_tokens: 28000,
            context_window: 128000,
            rpm_limit: 30,
            tpm_limit: 6000,
            daily_limit: null,
            monthly_limit: null,
            fallback_provider: null,
            status: 'ready',
            last_tested_at: null,
            last_used_at: null,
            last_error: null,
            avg_latency_ms: null,
            avg_cost_usd: null,
          },
        ];
      }
    }

    if (!chain.length) {
      throw new Error('No AI providers configured. Add a key in Settings → AI Providers.');
    }

    if (input.maxFailover && input.maxFailover > 0) {
      chain = chain.slice(0, input.maxFailover);
    }

    const errors: string[] = [];
    let retries = 0;
    const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : 0;

    for (const providerCfg of chain) {
      const adapter = getProviderAdapter(providerCfg.provider_name);
      const apiKey = providerCfg.api_key;
      if (!apiKey) {
        errors.push(`${providerCfg.provider_name}: missing key`);
        continue;
      }

      const model =
        input.model ||
        providerCfg.default_model ||
        adapter.listModels()[0] ||
        'unknown';

      const jsonMode = Boolean(input.jsonMode) && adapter.supportsJson();
      const budget = planRequest(
        {
          model,
          system: input.system,
          user: input.user,
          temperature: input.temperature ?? providerCfg.temperature,
          maxTokens: Math.min(input.maxTokens, providerCfg.max_output_tokens),
          topP: input.topP ?? providerCfg.top_p,
          jsonMode,
        },
        {
          maxInputTokens: providerCfg.max_input_tokens,
          maxOutputTokens: providerCfg.max_output_tokens,
          contextWindow: providerCfg.context_window,
          tpmLimit: providerCfg.tpm_limit,
        }
      );

      try {
        const started = Date.now();
        const texts: string[] = [];
        let tokensIn = 0;
        let tokensOut = 0;
        let finishReason: string | null = null;
        let last: AiGenerateResult | null = null;

        for (const chunk of budget.chunks) {
          const generatePromise = adapter.generate(chunk, apiKey);
          last =
            timeoutMs > 0
              ? await Promise.race([
                  generatePromise,
                  new Promise<never>((_, reject) => {
                    setTimeout(
                      () =>
                        reject(
                          new Error(
                            `${providerCfg.provider_name} timed out after ${timeoutMs}ms`
                          )
                        ),
                      timeoutMs
                    );
                  }),
                ])
              : await generatePromise;
          texts.push(last.text);
          tokensIn += last.tokensIn || 0;
          tokensOut += last.tokensOut || 0;
          finishReason = last.finishReason || finishReason;
        }

        const text = mergeChunkTexts(texts);
        const latencyMs = Date.now() - started;
        const cost = estimateCostUsd(providerCfg.provider_name, tokensIn, tokensOut);

        await insertAiUsageLog({
          provider_name: providerCfg.provider_name,
          model,
          stage: input.stage || 'complete',
          success: true,
          latency_ms: latencyMs,
          tokens_in: tokensIn || undefined,
          tokens_out: tokensOut || undefined,
          estimated_cost_usd: cost,
          retry_count: retries,
          article_id: input.articleId ?? null,
          meta_json: {
            trimmed: budget.trimmed,
            chunks: budget.chunks.length,
            article_id: input.articleId ?? null,
            fallback: retries > 0,
          },
        });
        await markProviderUsed(providerCfg.provider_name, {
          latencyMs,
          status: 'healthy',
          error: null,
        });

        return {
          text,
          tokensIn: tokensIn || last?.tokensIn,
          tokensOut: tokensOut || last?.tokensOut,
          latencyMs,
          finishReason,
          provider: providerCfg.provider_name,
          model,
          retries,
        };
      } catch (err) {
        retries += 1;
        const message = (err as Error).message || 'provider failed';
        errors.push(`${providerCfg.provider_name}: ${message}`);
        const quota =
          /quota|billing|rate limit|429|insufficient_quota/i.test(message);
        await insertAiUsageLog({
          provider_name: providerCfg.provider_name,
          model,
          stage: input.stage || 'complete',
          success: false,
          error_message: message.slice(0, 500),
          retry_count: retries,
          article_id: input.articleId ?? null,
          meta_json: {
            article_id: input.articleId ?? null,
            fallback: true,
          },
        });
        await markProviderUsed(providerCfg.provider_name, {
          status: quota ? 'degraded' : 'down',
          error: message.slice(0, 500),
        });
        // continue failover
      }
    }

    throw new Error(
      `All AI providers failed (${errors.length} attempts). ${errors.slice(0, 3).join(' | ')}`
    );
  }
}

let routerSingleton: AiRouter | null = null;

export function getAiRouter(): AiRouter {
  if (!routerSingleton) routerSingleton = new AiRouter();
  return routerSingleton;
}

/**
 * AiProviderPort adapter — drop-in replacement for createGroqAiProvider().
 * Writer / Reviewer keep calling runtime.ai.complete(...) unchanged.
 */
export function createRoutedAiProvider(): AiProviderPort {
  const router = getAiRouter();
  return {
    name: 'ai-router',
    isConfigured() {
      return router.isConfigured();
    },
    async complete(input) {
      const result = await router.complete({
        model: input.model,
        system: input.system,
        user: input.user,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        topP: input.topP,
        jsonMode: input.jsonMode,
        stage: 'editorial',
      });
      return {
        text: result.text,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs,
        finishReason: result.finishReason,
      };
    },
  };
}

export async function listConfiguredProviders() {
  return listAiProviderSettings();
}
