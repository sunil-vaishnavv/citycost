/**
 * Featured image storage for manual editorial articles.
 * Delegates to the universal image optimization pipeline.
 */

import {
  deleteEditorialImageFile,
  saveOptimizedEditorialImage,
} from '../media/image-upload.js';
import { stripFeaturedImageCacheBust } from './html-blocks.js';

export interface FeaturedImagePayload {
  url: string;
  alt?: string;
  path: string;
}

export async function saveFeaturedImage(input: {
  articleId: number;
  buffer: Buffer;
  alt?: string;
}): Promise<FeaturedImagePayload> {
  const saved = await saveOptimizedEditorialImage({
    buffer: input.buffer,
    prefix: `article-${input.articleId}`,
    alt: input.alt,
    logPrefix: `[featured-image:${input.articleId}]`,
  });
  return { url: saved.url, alt: saved.alt, path: saved.path };
}

/** @deprecated Legacy base64 path — decodes then runs the same optimization pipeline. */
export async function saveFeaturedImageFromBase64(input: {
  articleId: number;
  dataBase64: string;
  mime: string;
  alt?: string;
}): Promise<FeaturedImagePayload> {
  const raw = input.dataBase64.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');
  return saveFeaturedImage({ articleId: input.articleId, buffer: buf, alt: input.alt });
}

export async function deleteFeaturedImageFile(publicPath: string | undefined): Promise<void> {
  return deleteEditorialImageFile(
    publicPath ? stripFeaturedImageCacheBust(publicPath) : publicPath
  );
}
