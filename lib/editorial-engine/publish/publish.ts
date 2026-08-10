/**
 * Manual publish / unpublish — no scheduler, no auto-publish.
 */

import {
  getArticleById,
  setArticlePublished,
  setArticleUnpublished,
  updatePublishedArticleContent as persistPublishedContent,
} from '../db/articles-repo.js';
import { setTopicStatus } from '../db/topics-repo.js';
import { insertGenerationLog } from '../db/generation-logs-repo.js';
import { getPublishReadiness } from './publish-gate.js';
import { invalidateBlogPublicCache } from '../blog/blog-cache.js';
import {
  countDraftWords,
  readingTimeMinutes,
  type DraftBlock,
  type DraftBlockType,
  type WriterDraftPayload,
} from '../writer/draft-validate.js';

export interface PublishResult {
  ok: boolean;
  article_id: number;
  status: string;
  slug?: string;
  published_at?: string;
  message: string;
  readiness?: Awaited<ReturnType<typeof getPublishReadiness>>;
  errors?: Array<{ code: string; message: string }>;
}

export async function publishArticle(articleId: number): Promise<PublishResult> {
  const readiness = await getPublishReadiness(articleId);
  if (!readiness.ready) {
    return {
      ok: false,
      article_id: articleId,
      status: readiness.status,
      message: 'Publishing gate failed',
      readiness,
      errors: readiness.blocking_errors,
    };
  }

  const article = await getArticleById(articleId);
  if (!article) {
    return {
      ok: false,
      article_id: articleId,
      status: 'missing',
      message: 'Article not found',
      errors: [{ code: 'article_not_found', message: 'Article not found' }],
    };
  }

  const published_at = await setArticlePublished(articleId);
  if (article.topic_id) {
    try {
      await setTopicStatus(article.topic_id, 'published');
    } catch {
      /* topic status best-effort */
    }
  }

  await insertGenerationLog({
    article_id: articleId,
    topic_id: article.topic_id,
    stage: 'publish',
    success: true,
    meta_json: {
      slug: article.slug,
      published_at: published_at.toISOString(),
      quality_score: readiness.quality_score,
      seo_score: readiness.seo_score,
    },
  });

  invalidateBlogPublicCache();

  return {
    ok: true,
    article_id: articleId,
    status: 'published',
    slug: article.slug,
    published_at: published_at.toISOString(),
    message: 'Article published',
    readiness,
  };
}

export async function unpublishArticle(articleId: number): Promise<PublishResult> {
  const article = await getArticleById(articleId);
  if (!article) {
    return {
      ok: false,
      article_id: articleId,
      status: 'missing',
      message: 'Article not found',
      errors: [{ code: 'article_not_found', message: 'Article not found' }],
    };
  }
  if (article.status !== 'published') {
    return {
      ok: false,
      article_id: articleId,
      status: article.status,
      message: `Article is not published (status: ${article.status})`,
      errors: [{ code: 'not_published', message: 'Only published articles can be unpublished' }],
    };
  }

  await setArticleUnpublished(articleId);
  if (article.topic_id) {
    try {
      await setTopicStatus(article.topic_id, 'review');
    } catch {
      /* best-effort */
    }
  }

  await insertGenerationLog({
    article_id: articleId,
    topic_id: article.topic_id,
    stage: 'unpublish',
    success: true,
    meta_json: { slug: article.slug, previous_status: 'published', next_status: 'review' },
  });

  invalidateBlogPublicCache();

  return {
    ok: true,
    article_id: articleId,
    status: 'review',
    slug: article.slug,
    message: 'Article unpublished — returned to review',
  };
}

const BLOCK_TYPES = new Set<DraftBlockType>([
  'intro',
  'heading',
  'paragraph',
  'list',
  'comparison',
  'table',
  'tip',
  'warning',
  'faq',
  'summary',
]);

function asExistingDraft(article: Awaited<ReturnType<typeof getArticleById>>): WriterDraftPayload {
  if (article?.draft_json && typeof article.draft_json === 'object') {
    return article.draft_json as WriterDraftPayload;
  }
  const blocks = Array.isArray(article?.blocks_json)
    ? (article.blocks_json as DraftBlock[])
    : [];
  return {
    seo_title: article?.seo_title || '',
    meta_title: article?.meta_title || article?.seo_title || '',
    meta_description: article?.meta_description || '',
    excerpt: article?.excerpt || '',
    blocks,
  };
}

function normalizeManualBlocks(raw: unknown): DraftBlock[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: DraftBlock[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const rawType = String(rec.type || 'paragraph').toLowerCase().trim();
    let type: DraftBlockType;
    if (BLOCK_TYPES.has(rawType as DraftBlockType)) {
      type = rawType as DraftBlockType;
    } else if (rawType === 'h2' || rawType === 'h3' || rawType === 'header') {
      type = 'heading';
    } else {
      type = 'paragraph';
    }
    const id =
      typeof rec.id === 'string' && rec.id.trim()
        ? rec.id.trim()
        : `manual-${Date.now()}-${i}`;
    const heading = typeof rec.heading === 'string' ? rec.heading.trim() : '';
    const content = rec.content ?? rec.text ?? rec.body ?? '';
    if (type === 'heading') {
      const h = heading || (typeof content === 'string' ? content.trim() : '');
      if (!h) continue;
      out.push({ id, type, heading: h, content: h });
      continue;
    }
    const hasContent =
      (typeof content === 'string' && content.trim().length > 0) ||
      (Array.isArray(content) && content.length > 0) ||
      (content != null && typeof content === 'object');
    if (!hasContent) continue;
    out.push({
      id,
      type,
      heading: heading || undefined,
      content,
      data_keys: Array.isArray(rec.data_keys) ? rec.data_keys.map(String) : undefined,
    });
  }
  return out;
}

function mergeDraftPayload(
  existing: WriterDraftPayload,
  incoming: {
    seo_title?: string;
    meta_title?: string;
    meta_description?: string;
    excerpt?: string;
    blocks?: unknown;
  }
): WriterDraftPayload {
  const blocks = incoming.blocks != null ? normalizeManualBlocks(incoming.blocks) : existing.blocks;
  return {
    seo_title: incoming.seo_title?.trim() || existing.seo_title || '',
    meta_title: incoming.meta_title?.trim() || existing.meta_title || existing.seo_title || '',
    meta_description:
      incoming.meta_description?.trim() || existing.meta_description || existing.excerpt || '',
    excerpt: incoming.excerpt?.trim() || existing.excerpt || '',
    blocks,
  };
}

export interface UpdatePublishedContentInput {
  draft?: Partial<WriterDraftPayload> & { blocks?: unknown };
  blocks?: unknown;
}

export interface UpdatePublishedContentResult {
  ok: boolean;
  article_id: number;
  status: string;
  slug?: string;
  word_count?: number;
  reading_time_minutes?: number;
  message: string;
  errors?: Array<{ code: string; message: string }>;
}

/** Save manual content edits on a published article — no review, no status change. */
export async function updatePublishedContent(
  articleId: number,
  input: UpdatePublishedContentInput
): Promise<UpdatePublishedContentResult> {
  const article = await getArticleById(articleId);
  if (!article) {
    return {
      ok: false,
      article_id: articleId,
      status: 'missing',
      message: 'Article not found',
      errors: [{ code: 'article_not_found', message: 'Article not found' }],
    };
  }
  if (article.status !== 'published') {
    return {
      ok: false,
      article_id: articleId,
      status: article.status,
      message: 'Only published articles can be updated in place',
      errors: [
        {
          code: 'not_published',
          message: 'Use the normal draft workflow for unpublished articles',
        },
      ],
    };
  }

  const existing = asExistingDraft(article);
  let next: WriterDraftPayload;
  if (input.draft && typeof input.draft === 'object') {
    next = mergeDraftPayload(existing, input.draft);
  } else if (input.blocks != null) {
    next = mergeDraftPayload(existing, { blocks: input.blocks });
  } else {
    return {
      ok: false,
      article_id: articleId,
      status: article.status,
      message: 'Provide draft or blocks in the request body',
      errors: [{ code: 'missing_content', message: 'Body must include draft or blocks' }],
    };
  }

  if (!next.blocks.length) {
    return {
      ok: false,
      article_id: articleId,
      status: article.status,
      message: 'Content must include at least one block',
      errors: [{ code: 'empty_blocks', message: 'At least one content block is required' }],
    };
  }

  const word_count = countDraftWords(next);
  const reading_time_minutes = readingTimeMinutes(word_count);
  const saved = await persistPublishedContent({
    id: articleId,
    draft: next,
    word_count,
    reading_time_minutes,
  });
  if (!saved) {
    return {
      ok: false,
      article_id: articleId,
      status: article.status,
      message: 'Update failed — article may have been unpublished',
      errors: [{ code: 'persist_failed', message: 'Could not save content' }],
    };
  }

  await insertGenerationLog({
    article_id: articleId,
    topic_id: article.topic_id,
    stage: 'content_update',
    success: true,
    meta_json: {
      slug: article.slug,
      word_count,
      reading_time_minutes,
      block_count: next.blocks.length,
      manual: true,
    },
  });

  invalidateBlogPublicCache();

  return {
    ok: true,
    article_id: articleId,
    status: 'published',
    slug: article.slug,
    word_count,
    reading_time_minutes,
    message: 'Published content updated',
  };
}
