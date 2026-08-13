/**
 * Shared multer middleware + save helper for all editorial image uploads.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import {
  IMAGE_INPUT_MAX_BYTES,
  ImageOptimizeError,
  optimizeImageBuffer,
  type OptimizedImageResult,
} from '../../image-optimize.js';

export const EDITORIAL_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'blog');

/** Multer memory storage — 30 MB cap; Sharp optimizes before disk write. */
export const editorialImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: IMAGE_INPUT_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new ImageOptimizeError('unsupported_format', 'Unsupported format — upload a JPEG, PNG, WebP, or GIF image.'));
      return;
    }
    cb(null, true);
  },
});

export interface SavedImageMeta {
  url: string;
  alt?: string;
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export async function ensureEditorialUploadDir(): Promise<void> {
  await fs.mkdir(EDITORIAL_UPLOAD_DIR, { recursive: true });
}

/**
 * Universal save: buffer → optimize → WebP → disk.
 * @param prefix  Filename prefix, e.g. `article-42` or `inline-42`
 */
export async function saveOptimizedEditorialImage(input: {
  buffer: Buffer;
  prefix: string;
  alt?: string;
  maxWidth?: number;
  logPrefix?: string;
}): Promise<SavedImageMeta> {
  const logPrefix = input.logPrefix || `[image-upload:${input.prefix}]`;
  console.log(`${logPrefix} decode success`, { bytes: input.buffer.length });

  const optimized: OptimizedImageResult = await optimizeImageBuffer(input.buffer, {
    maxWidth: input.maxWidth,
    logPrefix,
  });

  await ensureEditorialUploadDir();
  const hash = crypto.createHash('sha256').update(optimized.buffer).digest('hex').slice(0, 12);
  const filename = `${input.prefix}-${hash}.webp`;
  const filePath = path.join(EDITORIAL_UPLOAD_DIR, filename);

  await fs.writeFile(filePath, optimized.buffer);
  console.log(`${logPrefix} file write complete`, {
    path: filePath,
    bytes: optimized.outputBytes,
    width: optimized.width,
    height: optimized.height,
  });

  return {
    url: `/uploads/blog/${filename}`,
    alt: input.alt?.trim() || undefined,
    path: filePath,
    width: optimized.width,
    height: optimized.height,
    bytes: optimized.outputBytes,
  };
}

export async function deleteEditorialImageFile(publicPath: string | undefined): Promise<void> {
  if (!publicPath?.startsWith('/uploads/blog/')) return;
  const filename = path.basename(publicPath);
  const filePath = path.join(EDITORIAL_UPLOAD_DIR, filename);
  try {
    await fs.unlink(filePath);
  } catch {
    /* ignore missing */
  }
}

/** Multer error → structured response */
export function multerErrorResponse(err: unknown): { status: number; body: { error: string; code: string } } | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: string; message?: string };
  if (e.code === 'LIMIT_FILE_SIZE') {
    return {
      status: 413,
      body: {
        error: `Image is too large. Maximum upload is ${Math.round(IMAGE_INPUT_MAX_BYTES / 1024 / 1024)}MB.`,
        code: 'file_too_large',
      },
    };
  }
  if (e instanceof ImageOptimizeError) {
    return {
      status: e.code === 'file_too_large' ? 413 : 415,
      body: { error: e.message, code: e.code },
    };
  }
  return null;
}
