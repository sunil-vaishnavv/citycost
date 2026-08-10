import { listAiProviderSettings } from '../db/ai-settings-repo.js';
import type { AiProviderName, ProviderRuntimeConfig } from './types.js';

/**
 * Highest-priority enabled providers with a usable API key.
 */
export async function selectProviderChain(
  preferred?: AiProviderName
): Promise<Array<ProviderRuntimeConfig & { id: number }>> {
  const all = await listAiProviderSettings();
  const enabled = all.filter((p) => p.enabled && p.api_key);
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
