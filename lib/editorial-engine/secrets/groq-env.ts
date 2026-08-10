/**
 * Groq-specific admin helpers (Settings → AI tab).
 * Backed by shared provider-env sync (.env ↔ process ↔ DB).
 */

import { encryptApiKey, maskApiKey as maskEncryptedKey } from '../ai/crypto-keys.js';
import { pool } from '../../db.js';
import {
  normalizeProviderApiKey,
  readProviderKeyFromEnvFile,
  syncProviderKeysFromEnvFile,
  writeProviderKeyToEnv,
} from './provider-env.js';

export interface GroqKeyStatus {
  configured: boolean;
  /** Full key for authenticated admin UI (view toggle). */
  api_key: string | null;
  masked_key: string | null;
  source: 'env';
  provider: 'groq';
  /** Epoch ms when the live process key last matched `.env` / was saved from admin. */
  key_applied_at: number;
}

let keyAppliedAtMs = Date.now();

export function getGroqKeyAppliedAtMs(): number {
  return keyAppliedAtMs;
}

/** Mask for locked field preview (Groq gsk_ style). */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  const prefix = key.startsWith('gsk_') ? 'gsk_' : '';
  const body = key.startsWith('gsk_') ? key.slice(4) : key;
  const last4 = body.slice(-4);
  return `${prefix}••••••••${last4}`;
}

/** Read GROQ_API_KEY from `.env` (source of truth for admin sync). */
export function readGroqKeyFromEnvFile(): string | null {
  return readProviderKeyFromEnvFile('groq');
}

export function resolveGroqApiKey(): string | null {
  return normalizeProviderApiKey(process.env.GROQ_API_KEY);
}

/**
 * Prefer `.env` file, sync into process.env + Groq clients when it differs.
 * Call on every admin status read so manual `.env` edits appear in the panel.
 */
export function syncGroqKeyFromEnvFile(): GroqKeyStatus {
  syncProviderKeysFromEnvFile();
  const key = readGroqKeyFromEnvFile() ?? resolveGroqApiKey();
  keyAppliedAtMs = Date.now();

  if (key && pool) {
    void pool
      .execute(
        `UPDATE editorial_ai_settings
         SET api_key_encrypted = $1, api_key_masked = $2, enabled = TRUE, status = 'ready',
             updated_at = (NOW() AT TIME ZONE 'UTC')
         WHERE provider_name = 'groq'
           AND (api_key_masked IS NULL OR api_key_masked <> $2)`,
        [encryptApiKey(key), maskEncryptedKey(key)]
      )
      .catch(() => undefined);
  }

  return {
    configured: Boolean(key),
    api_key: key,
    masked_key: key ? maskApiKey(key) : null,
    source: 'env',
    provider: 'groq',
    key_applied_at: keyAppliedAtMs,
  };
}

export function getGroqKeyStatus(): GroqKeyStatus {
  return syncGroqKeyFromEnvFile();
}

/**
 * Persist GROQ_API_KEY to `.env`, update process.env, DB, and refresh clients.
 */
export function updateGroqApiKey(rawKey: string): GroqKeyStatus {
  const apiKey = writeProviderKeyToEnv('groq', rawKey);
  keyAppliedAtMs = Date.now();

  void import('../db/ai-settings-repo.js')
    .then(({ patchAiProviderSetting }) =>
      patchAiProviderSetting('groq', { api_key: apiKey, enabled: true })
    )
    .catch(() => undefined);

  return {
    configured: true,
    api_key: apiKey,
    masked_key: maskApiKey(apiKey),
    source: 'env',
    provider: 'groq',
    key_applied_at: keyAppliedAtMs,
  };
}
