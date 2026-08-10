/**
 * AES-256-GCM encryption for provider API keys at rest.
 * Key material from EDITORIAL_SECRETS_KEY (preferred) or derived env fingerprint.
 */

import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function secretsKey(): Buffer {
  const raw =
    process.env.EDITORIAL_SECRETS_KEY?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.EDITORIAL_ADMIN_PASSWORD?.trim() ||
    'citycost-editorial-dev-secrets';
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptApiKey(plain: string): string {
  const key = secretsKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptApiKey(payload: string | null | undefined): string | null {
  if (!payload) return null;
  if (!payload.startsWith(PREFIX)) {
    // Legacy / plaintext migration path
    const t = payload.trim();
    return t && t !== 'YOUR_GROQ_API_KEY' ? t : null;
  }
  try {
    const body = payload.slice(PREFIX.length);
    const [ivB64, tagB64, dataB64] = body.split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const key = secretsKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return out.toString('utf8');
  } catch {
    return null;
  }
}

export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  const prefix = key.startsWith('gsk_')
    ? 'gsk_'
    : key.startsWith('sk-')
      ? 'sk-'
      : key.startsWith('AIza')
        ? 'AIza'
        : '';
  const body = prefix ? key.slice(prefix.length) : key;
  return `${prefix}••••••••${body.slice(-4)}`;
}
