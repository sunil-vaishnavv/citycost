/**
 * Health-check all AI providers from .env → DB sync, then print results.
 * Does not print full API keys.
 */
import { initEditorialEngine } from '../lib/editorial-engine/init.ts';
import {
  ensureAiProviderSettings,
  listAiProviderSettings,
  patchAiProviderSetting,
} from '../lib/editorial-engine/db/ai-settings-repo.ts';
import { testProviderConnection } from '../lib/editorial-engine/ai/provider-health.ts';
import { getAiRouter } from '../lib/editorial-engine/ai/ai-router.ts';
import { syncProviderKeysFromEnvFile } from '../lib/editorial-engine/secrets/provider-env.ts';
import type { AiProviderName } from '../lib/editorial-engine/ai/types.ts';

async function main() {
  syncProviderKeysFromEnvFile();
  await initEditorialEngine();
  await ensureAiProviderSettings();

  const providers = await listAiProviderSettings();
  const results: Array<Record<string, unknown>> = [];

  for (const p of providers) {
    const name = p.provider_name as AiProviderName;
    // Enable providers that have a real key so failover can use them
    if (p.api_key && !p.enabled) {
      await patchAiProviderSetting(name, { enabled: true });
    }
    const health = await testProviderConnection(name);
    results.push({
      provider: name,
      hasKey: Boolean(p.api_key),
      masked: p.api_key_masked,
      ok: health.ok,
      status: health.status,
      latencyMs: health.latencyMs,
      message: health.message,
      model: health.models?.[0] || null,
    });
  }

  // Router failover smoke: tiny complete()
  let routerOk = false;
  let routerProvider: string | null = null;
  let routerError: string | null = null;
  try {
    const out = await getAiRouter().complete({
      system: 'Reply with exactly: ok',
      user: 'ping',
      temperature: 0,
      maxTokens: 8,
      stage: 'provider_smoke',
    });
    routerOk = Boolean(out.text?.trim());
    routerProvider = out.provider || null;
  } catch (err) {
    routerError = (err as Error).message;
  }

  console.log(
    JSON.stringify(
      {
        providers: results,
        router: { ok: routerOk, provider: routerProvider, error: routerError },
        summary: {
          healthy: results.filter((r) => r.ok).map((r) => r.provider),
          failed: results.filter((r) => !r.ok).map((r) => ({
            provider: r.provider,
            message: r.message,
          })),
        },
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
