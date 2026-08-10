import {
  ensureAiProviderSettings,
  getAiProviderSetting,
  markProviderTested,
} from '../db/ai-settings-repo.js';
import {
  normalizeProviderApiKey,
  syncProviderKeysFromEnvFile,
} from '../secrets/provider-env.js';
import { getProviderDefaults } from './provider-config.js';
import { getProviderAdapter } from './providers/index.js';
import type { AiProviderName, ProviderHealthResult } from './types.js';

/** Normalize provider errors into actionable health status. */
export function classifyProviderError(message: string): {
  status: ProviderHealthResult['status'];
  message: string;
} {
  const m = message || 'Health check failed';
  if (
    /quota|billing|rate limit|429|402|exceeded your current quota|insufficient_quota|insufficient balance|payment required/i.test(
      m
    )
  ) {
    return {
      status: 'degraded',
      message:
        'API key is valid, but the account has no quota/credits (billing). Top up the provider dashboard — router will fail over to the next healthy provider.',
    };
  }
  if (/invalid.?api.?key|incorrect api key|401|unauthorized|permission|API_KEY_INVALID/i.test(m)) {
    return { status: 'down', message: `Invalid API key — ${m.slice(0, 200)}` };
  }
  if (/not found|404|no longer available/i.test(m)) {
    return { status: 'degraded', message: `Model unavailable — ${m.slice(0, 220)}` };
  }
  return { status: 'down', message: m.slice(0, 400) };
}

export async function testProviderConnection(
  name: AiProviderName
): Promise<ProviderHealthResult> {
  // Always pull latest keys from .env before testing
  syncProviderKeysFromEnvFile();
  await ensureAiProviderSettings();

  const setting = await getAiProviderSetting(name);
  const adapter = getProviderAdapter(name);
  const defaults = getProviderDefaults(name);
  const envKey = defaults.env_key
    ? normalizeProviderApiKey(process.env[defaults.env_key])
    : null;
  const apiKey = setting?.api_key || envKey || null;

  let result = await adapter.health(apiKey || '');
  if (!result.ok && result.message && result.status !== 'unconfigured') {
    const classified = classifyProviderError(result.message);
    result = { ...result, ...classified, ok: false };
  }

  result.models = result.models || defaults.models;
  result.contextWindow = result.contextWindow || defaults.context_window;
  result.supportsJson = adapter.supportsJson();
  result.supportsStreaming = adapter.supportsStreaming();
  result.rpm = setting?.rpm_limit ?? defaults.rpm_limit;
  result.tpm = setting?.tpm_limit ?? defaults.tpm_limit;

  await markProviderTested(
    name,
    result.status,
    result.ok ? null : result.message,
    result.latencyMs
  );
  return result;
}

export function statusColor(status: string): 'green' | 'yellow' | 'red' {
  if (status === 'healthy' || status === 'ready') return 'green';
  if (status === 'degraded' || status === 'unknown' || status === 'disabled') return 'yellow';
  return 'red';
}
