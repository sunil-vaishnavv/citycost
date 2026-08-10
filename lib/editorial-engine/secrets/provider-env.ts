/**
 * Two-way sync for AI provider API keys:
 *   .env file  ↔  process.env  ↔  editorial_ai_settings (encrypted)
 *
 * Admin AI Providers panel and Settings → AI (Groq) both use this.
 */

import fs from 'fs';
import path from 'path';
import { PROVIDER_DEFAULTS, getProviderDefaults } from '../ai/provider-config.js';
import type { AiProviderName } from '../ai/types.js';

const PLACEHOLDER_RE =
  /^(YOUR_|MY_|TODO|CHANGE_ME|REPLACE|XXX|xxx|test|dummy|placeholder)/i;

function envPath(): string {
  return path.resolve(process.cwd(), '.env');
}

export function isPlaceholderApiKey(raw: string | null | undefined): boolean {
  const key = raw?.trim();
  if (!key) return true;
  if (key.length < 16) return true;
  if (PLACEHOLDER_RE.test(key)) return true;
  if (/API_KEY$/i.test(key) && key.length < 40) return true;
  return false;
}

export function normalizeProviderApiKey(raw: string | null | undefined): string | null {
  const key = raw?.trim();
  if (!key || isPlaceholderApiKey(key)) return null;
  return key;
}

export function envVarNameForProvider(name: AiProviderName): string {
  const def = getProviderDefaults(name);
  if (!def.env_key) throw new Error(`No env key for provider ${name}`);
  return def.env_key;
}

/** Parse a single KEY=value line value (quotes / inline comments). */
function parseEnvValue(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const hash = value.indexOf(' #');
  if (hash >= 0) value = value.slice(0, hash).trim();
  return value;
}

/** Read a named variable from the `.env` file (source of truth for admin sync). */
export function readEnvVarFromFile(name: string): string | null {
  const file = envPath();
  if (!fs.existsSync(file)) return null;
  const contents = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm');
  const match = contents.match(re);
  if (!match) return null;
  return normalizeProviderApiKey(parseEnvValue(match[1]));
}

export function readProviderKeyFromEnvFile(name: AiProviderName): string | null {
  return readEnvVarFromFile(envVarNameForProvider(name));
}

export function upsertEnvVar(contents: string, name: string, value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const line = `${name}="${escaped}"`;
  const re = new RegExp(`^\\s*${name}\\s*=.*$`, 'm');
  if (re.test(contents)) {
    return contents.replace(re, line);
  }
  const trimmed = contents.replace(/\s*$/, '');
  return `${trimmed}${trimmed ? '\n' : ''}${line}\n`;
}

/** Write / update a key in `.env` and process.env. */
export function writeProviderKeyToEnv(name: AiProviderName, rawKey: string): string {
  const apiKey = normalizeProviderApiKey(rawKey);
  if (!apiKey) {
    throw new Error(`${envVarNameForProvider(name)} cannot be empty or a placeholder`);
  }
  if (/\s/.test(apiKey)) {
    throw new Error(`${envVarNameForProvider(name)} must not contain whitespace`);
  }

  const varName = envVarNameForProvider(name);
  const file = envPath();
  let contents = '';
  if (fs.existsSync(file)) {
    contents = fs.readFileSync(file, 'utf8');
  }
  fs.writeFileSync(file, upsertEnvVar(contents, varName, apiKey), 'utf8');
  process.env[varName] = apiKey;

  if (name === 'groq') {
    void import('../../groq.js')
      .then(({ reconfigureGroqClient }) => reconfigureGroqClient())
      .catch(() => undefined);
    void import('../adapters/ai.groq.js')
      .then(({ refreshGroqAiClient }) => refreshGroqAiClient())
      .catch(() => undefined);
  }

  return apiKey;
}

/**
 * Ensure `.env` declares all provider key slots (placeholders if missing).
 * Does not overwrite existing real keys.
 */
export function ensureProviderEnvSlots(): void {
  const file = envPath();
  let contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  let changed = false;

  for (const def of PROVIDER_DEFAULTS) {
    if (!def.env_key) continue;
    const re = new RegExp(`^\\s*${def.env_key}\\s*=`, 'm');
    if (re.test(contents)) continue;
    const placeholder = `YOUR_${def.env_key}`;
    contents = upsertEnvVar(contents, def.env_key, placeholder);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, contents, 'utf8');
  }
}

/**
 * Pull keys from `.env` into process.env for every provider.
 * Returns map of provider → real key (null if missing/placeholder).
 */
export function syncProviderKeysFromEnvFile(): Record<AiProviderName, string | null> {
  const out = {} as Record<AiProviderName, string | null>;
  for (const def of PROVIDER_DEFAULTS) {
    if (!def.env_key) {
      out[def.name] = null;
      continue;
    }
    const fromFile = readEnvVarFromFile(def.env_key);
    const fromProcess = normalizeProviderApiKey(process.env[def.env_key]);
    // Drop placeholder values from process.env so they never seed the DB
    if (process.env[def.env_key] && !fromProcess && !fromFile) {
      delete process.env[def.env_key];
    }
    if (fromFile && fromFile !== fromProcess) {
      process.env[def.env_key] = fromFile;
      if (def.name === 'groq') {
        void import('../../groq.js')
          .then(({ reconfigureGroqClient }) => reconfigureGroqClient())
          .catch(() => undefined);
        void import('../adapters/ai.groq.js')
          .then(({ refreshGroqAiClient }) => refreshGroqAiClient())
          .catch(() => undefined);
      }
    } else if (!fromFile && fromProcess) {
      // process has real key but file missing — keep process; admin save will write file
    } else if (fromFile) {
      process.env[def.env_key] = fromFile;
    }
    out[def.name] = fromFile ?? fromProcess;
  }
  return out;
}

/**
 * After admin saves a key to DB: also persist to `.env` + process.env.
 * When syncing from env into DB, pass `{ skipEnvWrite: true }`.
 */
export async function mirrorProviderKeyToEnv(
  name: AiProviderName,
  apiKey: string,
  opts?: { skipEnvWrite?: boolean }
): Promise<void> {
  if (opts?.skipEnvWrite) {
    process.env[envVarNameForProvider(name)] = apiKey;
    return;
  }
  writeProviderKeyToEnv(name, apiKey);
}
