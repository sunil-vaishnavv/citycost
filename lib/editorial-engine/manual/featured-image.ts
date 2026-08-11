/**
 * Featured image storage for manual editorial articles.
 * Files live under public/uploads/blog/ — URL path /uploads/blog/...
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'blog');
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface FeaturedImagePayload {
  url: string;
  alt?: string;
  path: string;
}

function extForMime(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.jpg';
}

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function saveFeaturedImage(input: {
  articleId: number;
  dataBase64: string;
  mime: string;
  alt?: string;
}): Promise<FeaturedImagePayload> {
  const mime = input.mime.toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error('Invalid image type — use JPEG, PNG, WebP, or GIF');
  }

  const raw = input.dataBase64.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length > MAX_BYTES) {
    throw new Error(`Image too large — maximum ${Math.round(MAX_BYTES / 1024 / 1024)}MB`);
  }
  if (buf.length < 100) {
    throw new Error('Invalid image data');
  }

  await ensureUploadDir();
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const filename = `article-${input.articleId}-${hash}${extForMime(mime)}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(filePath, buf);

  return {
    url: `/uploads/blog/${filename}`,
    alt: input.alt?.trim() || undefined,
    path: filePath,
  };
}

export async function deleteFeaturedImageFile(publicPath: string | undefined): Promise<void> {
  if (!publicPath?.startsWith('/uploads/blog/')) return;
  const filename = path.basename(publicPath);
  const filePath = path.join(UPLOAD_DIR, filename);
  try {
    await fs.unlink(filePath);
  } catch {
    /* ignore missing */
  }
}
