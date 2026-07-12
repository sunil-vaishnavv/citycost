/**
 * Disk + memory cache for generated content documents.
 * Invalidate on fingerprint / version change.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CachedEnvelope, ContentKind } from './types.js';
import { CONTENT_ENGINE_VERSION } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = path.resolve(__dirname, '../../data/content-cache');

const memory = new Map<string, CachedEnvelope<unknown>>();

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function filePath(kind: ContentKind, slug: string): string {
  const safe = slug.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 180);
  return path.join(CACHE_ROOT, kind, `${safe}.json`);
}

function memKey(kind: ContentKind, slug: string): string {
  return `${kind}:${slug}`;
}

export function readContentCache<T>(
  kind: ContentKind,
  slug: string,
  dataFingerprint: string
): CachedEnvelope<T> | null {
  const key = memKey(kind, slug);
  const mem = memory.get(key) as CachedEnvelope<T> | undefined;
  if (mem && mem.data_fingerprint === dataFingerprint && mem.meta.content_version === CONTENT_ENGINE_VERSION) {
    return mem;
  }

  const fp = filePath(kind, slug);
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(raw) as CachedEnvelope<T>;
    if (parsed.data_fingerprint !== dataFingerprint) return null;
    if (parsed.meta?.content_version !== CONTENT_ENGINE_VERSION) return null;
    memory.set(key, parsed as CachedEnvelope<unknown>);
    return parsed;
  } catch {
    return null;
  }
}

export function writeContentCache<T>(kind: ContentKind, slug: string, envelope: CachedEnvelope<T>): void {
  ensureDir(path.join(CACHE_ROOT, kind));
  const fp = filePath(kind, slug);
  fs.writeFileSync(fp, JSON.stringify(envelope), 'utf-8');
  memory.set(memKey(kind, slug), envelope as CachedEnvelope<unknown>);
}

export function invalidateContentCache(kind?: ContentKind, slug?: string): number {
  let n = 0;
  if (kind && slug) {
    memory.delete(memKey(kind, slug));
    const fp = filePath(kind, slug);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      n++;
    }
    return n;
  }
  memory.clear();
  if (!fs.existsSync(CACHE_ROOT)) return 0;
  const kinds: ContentKind[] = kind ? [kind] : ['city', 'country', 'compare'];
  for (const k of kinds) {
    const dir = path.join(CACHE_ROOT, k);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, f));
      n++;
    }
  }
  return n;
}

export function contentCacheStats(): { root: string; memory_entries: number; files: number } {
  let files = 0;
  if (fs.existsSync(CACHE_ROOT)) {
    for (const k of ['city', 'country', 'compare']) {
      const dir = path.join(CACHE_ROOT, k);
      if (fs.existsSync(dir)) files += fs.readdirSync(dir).length;
    }
  }
  return { root: CACHE_ROOT, memory_entries: memory.size, files };
}
