/**
 * Universal server-side image optimization — compress, resize, convert to WebP.
 * Used by every image upload path in the editorial platform.
 */

import sharp from 'sharp';

/** Max raw upload size accepted before optimization (30 MB). */
export const IMAGE_INPUT_MAX_BYTES = 30 * 1024 * 1024;

/** Default max output width for featured / blog images. */
export const IMAGE_DEFAULT_MAX_WIDTH = 1600;

/** Default WebP quality (0–100). */
export const IMAGE_DEFAULT_WEBP_QUALITY = 80;

export type ImageErrorCode =
  | 'file_too_large'
  | 'unsupported_format'
  | 'invalid_image_data'
  | 'image_processing_failed'
  | 'upload_failed';

export class ImageOptimizeError extends Error {
  readonly code: ImageErrorCode;

  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.name = 'ImageOptimizeError';
    this.code = code;
  }
}

export interface OptimizeImageOptions {
  maxWidth?: number;
  quality?: number;
  /** Prefix for server log lines, e.g. `[featured-image:42]` */
  logPrefix?: string;
}

export interface OptimizedImageResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'webp';
  inputBytes: number;
  outputBytes: number;
}

function logStep(prefix: string, step: string, detail?: Record<string, unknown>): void {
  const extra = detail ? ` ${JSON.stringify(detail)}` : '';
  console.log(`${prefix} ${step}${extra}`);
}

/** Quick magic-byte sniff — rejects non-images before Sharp runs. */
export function detectImageFormat(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'avif';
  return null;
}

/**
 * Optimize any supported image buffer: validate → resize → WebP.
 * Output is typically < 500 KB regardless of input size.
 */
export async function optimizeImageBuffer(
  input: Buffer,
  options: OptimizeImageOptions = {}
): Promise<OptimizedImageResult> {
  const prefix = options.logPrefix || '[image-optimize]';
  const maxWidth = options.maxWidth ?? IMAGE_DEFAULT_MAX_WIDTH;
  const quality = options.quality ?? IMAGE_DEFAULT_WEBP_QUALITY;
  const inputBytes = input.length;

  logStep(prefix, 'request received', { inputBytes });

  if (inputBytes < 16) {
    logStep(prefix, 'reject: buffer too small', { inputBytes });
    throw new ImageOptimizeError('invalid_image_data', 'Invalid image data — file is empty or corrupt.');
  }

  if (inputBytes > IMAGE_INPUT_MAX_BYTES) {
    logStep(prefix, 'reject: file too large', { inputBytes, max: IMAGE_INPUT_MAX_BYTES });
    throw new ImageOptimizeError(
      'file_too_large',
      `Image is too large (${Math.round(inputBytes / 1024 / 1024)}MB). Maximum upload is ${Math.round(IMAGE_INPUT_MAX_BYTES / 1024 / 1024)}MB before optimization.`
    );
  }

  const detected = detectImageFormat(input);
  if (!detected) {
    logStep(prefix, 'reject: unsupported format (magic bytes)');
    throw new ImageOptimizeError(
      'unsupported_format',
      'Unsupported image format. Use JPEG, PNG, WebP, GIF, or AVIF.'
    );
  }

  logStep(prefix, 'format detected', { format: detected });

  try {
    const pipeline = sharp(input, { failOn: 'error' })
      .rotate() // respect EXIF orientation
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality, effort: 4 });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    logStep(prefix, 'sharp processing complete', {
      inputBytes,
      outputBytes: data.length,
      width: info.width,
      height: info.height,
    });

    return {
      buffer: data,
      width: info.width,
      height: info.height,
      format: 'webp',
      inputBytes,
      outputBytes: data.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep(prefix, 'sharp processing failed', { error: msg });
    throw new ImageOptimizeError(
      'image_processing_failed',
      'Image processing failed. The file may be corrupt or an unsupported variant.'
    );
  }
}

/** Map ImageOptimizeError (and unknown errors) to HTTP status + JSON body. */
export function imageErrorResponse(err: unknown): { status: number; body: { error: string; code: string } } {
  if (err instanceof ImageOptimizeError) {
    const status =
      err.code === 'file_too_large' ? 413 : err.code === 'unsupported_format' ? 415 : 400;
    return { status, body: { error: err.message, code: err.code } };
  }
  const msg = err instanceof Error ? err.message : 'Upload failed';
  return { status: 400, body: { error: msg, code: 'upload_failed' as ImageErrorCode } };
}
