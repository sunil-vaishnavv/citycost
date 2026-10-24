import { listAiProviderSettings } from '../db/ai-settings-repo.js';
import type { AiProviderName, ProviderRuntimeConfig } from './types.js';

/**
 * Highest-priority enabled providers with a usable API key.
 */
export async function selectProviderChain(
  preferred?: AiProviderName
): Promise<Array<ProviderRuntimeConfig & { id: number }>> {
  let all: Array<ProviderRuntimeConfig & { id: number }> = [];
  try {
    all = await listAiProviderSettings();
  } catch (err) {
    console.warn('[provider-selector] Failed to query database for AI settings, falling back to .env variables:', (err as Error)?.message || err);
  }
  let enabled = all.filter((p) => p.enabled && p.api_key);

  // Fallback to active environment keys if DB is offline or returned empty
  if (!enabled.length) {
    const { syncProviderKeysFromEnvFile } = await import('../secrets/provider-env.js');
    const { PROVIDER_DEFAULTS } = await import('./provider-config.js');
    const envKeys = syncProviderKeysFromEnvFile();
    for (const def of PROVIDER_DEFAULTS) {
      const k = envKeys[def.name];
      if (k) {
        enabled.push({
          id: 0,
          provider_name: def.name,
          enabled: true,
          priority: def.priority,
          api_key: k,
          api_key_masked: null,
          default_model: def.default_model,
          temperature: def.temperature,
          top_p: def.top_p,
          max_output_tokens: def.max_output_tokens,
          max_input_tokens: def.max_input_tokens,
          context_window: def.context_window,
          rpm_limit: def.rpm_limit,
          tpm_limit: def.tpm_limit,
          daily_limit: def.daily_limit,
          monthly_limit: null,
          fallback_provider: null,
          status: 'ready',
          last_tested_at: null,
          last_used_at: null,
          last_error: null,
          avg_latency_ms: null,
          avg_cost_usd: null,
        });
      }
    }
  }

  // Prefer healthy/ready providers, then degraded (quota), then unknown/down last.
  // Priority is still the primary order within the same health band.
  const rank = (status: string) => {
    if (status === 'healthy' || status === 'ready') return 0;
    if (status === 'degraded' || status === 'unknown' || status === 'disabled') return 1;
    return 2;
  };
  enabled.sort((a, b) => {
    const hr = rank(a.status) - rank(b.status);
    if (hr !== 0) return hr;
    return a.priority - b.priority;
  });

  if (preferred) {
    const pref = enabled.find((p) => p.provider_name === preferred);
    if (pref) {
      return [pref, ...enabled.filter((p) => p.provider_name !== preferred)];
    }
  }

  // Honor explicit fallback_provider links as soft ordering hints
  const ordered: Array<ProviderRuntimeConfig & { id: number }> = [];
  const seen = new Set<string>();
  for (const p of enabled) {
    if (seen.has(p.provider_name)) continue;
    ordered.push(p);
    seen.add(p.provider_name);
    let fb = p.fallback_provider;
    while (fb && !seen.has(fb)) {
      const next = enabled.find((x) => x.provider_name === fb);
      if (!next) break;
      ordered.push(next);
      seen.add(next.provider_name);
      fb = next.fallback_provider;
    }
  }
  for (const p of enabled) {
    if (!seen.has(p.provider_name)) ordered.push(p);
  }
  return ordered;
}
