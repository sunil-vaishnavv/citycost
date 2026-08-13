/**
 * Manual blog/topic creation — additive workflow alongside automatic AI pipeline.
 */

import {
  getArticleById,
  insertManualDraftArticle,
  slugExists,
  updateArticleDraft,
  updateArticleIdentity,
  updateArticleStatus,
  updatePublishedArticleContent,
} from '../db/articles-repo.js';
import { insertGenerationLog } from '../db/generation-logs-repo.js';
import { invalidateBlogPublicCache } from '../blog/blog-cache.js';
import { createManualTopic, getTopicById, setTopicStatus } from '../db/topics-repo.js';
import { generateArticleSeo } from '../seo/generate-seo.js';
import { isManualArticle } from '../utils/article-origin.js';
import {
  countDraftWords,
  readingTimeMinutes,
  slugifyTitle,
  validateManualDraft,
  type WriterDraftPayload,
} from '../writer/draft-validate.js';
import { getSettings } from '../db/settings-repo.js';
import type { DraftBlock } from '../writer/draft-validate.js';
import { bustFeaturedImageUrl, type FeaturedImageMeta } from './html-blocks.js';

const MANUAL_CONTENT_TYPES = new Set([
  'guide',
  'country_guide',
  'city_guide',
  'comparison_guide',
  'salary_guide',
  'rent_guide',
  'food_guide',
  'transportation_guide',
  'healthcare_guide',
  'tax_guide',
  'student_guide',
  'remote_worker_guide',
  'retirement_guide',
  'moving_guide',
  'budget_guide',
  'visa_guide',
]);

function normalizeSlug(raw: string, fallbackTitle: string): string {
  const slug = slugifyTitle(raw || fallbackTitle);
  if (!slug) throw new Error('Valid slug is required');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Slug must be lowercase letters, numbers, and hyphens only');
  }
  return slug;
}

type ManualDraftPayload = WriterDraftPayload & {
  featured_image?: FeaturedImageMeta | null;
  primary_keyword?: string;
  semantic_keywords?: string[];
};

function readExistingManualDraft(article: NonNullable<Awaited<ReturnType<typeof getArticleById>>>): ManualDraftPayload {
  const existingRaw =
    article.draft_json && typeof article.draft_json === 'object'
      ? (article.draft_json as Record<string, unknown>)
      : {};

  return {
    seo_title: article.seo_title || '',
    meta_title: article.meta_title || '',
    meta_description: article.meta_description || '',
    excerpt: article.excerpt || '',
    blocks: Array.isArray(article.blocks_json)
      ? (article.blocks_json as DraftBlock[])
      : [],
    featured_image:
      existingRaw.featured_image && typeof existingRaw.featured_image === 'object'
        ? (existingRaw.featured_image as FeaturedImageMeta)
        : null,
    primary_keyword:
      typeof existingRaw.primary_keyword === 'string' ? existingRaw.primary_keyword : undefined,
    semantic_keywords: Array.isArray(existingRaw.semantic_keywords)
      ? existingRaw.semantic_keywords.map(String)
      : undefined,
  };
}

async function persistManualArticleContent(input: {
  article: NonNullable<Awaited<ReturnType<typeof getArticleById>>>;
  articleId: number;
  slug: string;
  draft: ManualDraftPayload;
  word_count: number;
  reading_time: number;
}): Promise<void> {
  const { article, articleId, slug, draft, word_count, reading_time } = input;

  if (article.status === 'published') {
    const saved = await updatePublishedArticleContent({
      id: articleId,
      slug: slug !== article.slug ? slug : undefined,
      draft,
      word_count,
      reading_time_minutes: reading_time,
    });
    if (!saved) {
      throw new Error('Update failed — article may have been unpublished');
    }

    await insertGenerationLog({
      article_id: articleId,
      topic_id: article.topic_id,
      stage: 'content_update',
      success: true,
      meta_json: {
        slug,
        word_count,
        reading_time_minutes: reading_time,
        block_count: draft.blocks.length,
        manual: true,
      },
    }).catch(() => {
      /* non-blocking audit log */
    });
    invalidateBlogPublicCache();
    return;
  }

  if (
    slug !== article.slug ||
    draft.seo_title !== article.seo_title ||
    draft.meta_title !== article.meta_title ||
    draft.meta_description !== (article.meta_description || '') ||
    draft.excerpt !== (article.excerpt || '')
  ) {
    await updateArticleIdentity({
      id: articleId,
      slug,
      seo_title: draft.seo_title,
      meta_title: draft.meta_title,
      meta_description: draft.meta_description,
      excerpt: draft.excerpt,
      draft,
    });
  } else {
    await updateArticleDraft({
      id: articleId,
      draft,
      word_count,
      reading_time_minutes: reading_time,
    });
  }
}

function buildDraft(input: {
  seo_title: string;
  meta_title?: string;
  meta_description: string;
  excerpt: string;
  blocks: DraftBlock[];
  featured_image?: FeaturedImageMeta | null;
  primary_keyword?: string;
  semantic_keywords?: string[];
}): WriterDraftPayload & {
  featured_image?: FeaturedImageMeta | null;
  primary_keyword?: string;
  semantic_keywords?: string[];
} {
  const seoTitle = input.seo_title.trim();
  return {
    seo_title: seoTitle,
    meta_title: (input.meta_title || seoTitle).trim(),
    meta_description: input.meta_description.trim(),
    excerpt: input.excerpt.trim(),
    blocks: input.blocks,
    featured_image: input.featured_image ?? null,
    primary_keyword: input.primary_keyword?.trim() || undefined,
    semantic_keywords: input.semantic_keywords?.length ? input.semantic_keywords : undefined,
  };
}

export async function createManualTopicService(input: {
  title: string;
  content_type: string;
  cluster_id?: number | null;
  brief?: string;
  city?: string;
  country?: string;
  comparison?: string;
}): Promise<{ topic_id: number }> {
  if (!input.title?.trim()) throw new Error('Topic title is required');
  const contentType = input.content_type?.trim() || 'guide';
  const topicId = await createManualTopic({
    title: input.title,
    content_type: contentType,
    cluster_id: input.cluster_id ?? null,
    brief: input.brief,
    city: input.city,
    country: input.country,
    comparison: input.comparison,
    status: 'approved',
  });
  return { topic_id: topicId };
}

export async function createManualArticleService(input: {
  seo_title: string;
  meta_title?: string;
  meta_description: string;
  excerpt: string;
  slug?: string;
  content_type?: string;
  cluster_id?: number | null;
  topic_id?: number | null;
  blocks: DraftBlock[];
  minWords?: number;
}): Promise<{ article_id: number; slug: string }> {
  const seoTitle = input.seo_title.trim();
  if (!seoTitle) throw new Error('Blog title is required');

  const metaDescription =
    (input.meta_description || '').trim() || `Draft summary for ${seoTitle}`.slice(0, 160);
  const excerpt = (input.excerpt || '').trim() || seoTitle.slice(0, 220);

  const slug = normalizeSlug(input.slug || seoTitle, seoTitle);
  if (await slugExists(slug)) {
    throw new Error(`Slug "${slug}" is already in use`);
  }

  let contentType = (input.content_type || 'guide').trim();
  let clusterId = input.cluster_id ?? null;
  let topicId = input.topic_id ?? null;

  if (topicId) {
    const topic = await getTopicById(topicId);
    if (!topic) throw new Error('Topic not found');
    contentType = topic.content_type;
    clusterId = topic.cluster_id;
  }

  if (!MANUAL_CONTENT_TYPES.has(contentType)) {
    contentType = 'guide';
  }

  const draft = buildDraft({
    seo_title: seoTitle,
    meta_title: input.meta_title,
    meta_description: metaDescription,
    excerpt,
    blocks: input.blocks,
  });

  const settings = await getSettings();
  const minWords = input.minWords ?? 50;
  const validation = validateManualDraft(draft, {
    minWords,
    maxWords: settings.article_length_max,
    mode: 'draft',
  });
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }

  const word_count = validation.word_count;
  const reading_time = readingTimeMinutes(word_count);

  const articleId = await insertManualDraftArticle({
    slug,
    content_type: contentType,
    cluster_id: clusterId,
    topic_id: topicId,
    draft,
    word_count,
    reading_time_minutes: reading_time,
  });

  if (topicId) {
    try {
      await setTopicStatus(topicId, 'draft');
    } catch {
      /* best-effort */
    }
  }

  return { article_id: articleId, slug };
}

export async function updateManualArticleService(
  articleId: number,
  input: {
    seo_title?: string;
    meta_title?: string;
    meta_description?: string;
    excerpt?: string;
    slug?: string;
    blocks?: DraftBlock[];
    featured_image?: FeaturedImageMeta | null;
    primary_keyword?: string;
    semantic_keywords?: string[];
  }
): Promise<{ ok: true; word_count: number; blocks: DraftBlock[]; draft_json: ManualDraftPayload }> {
  const t0 = Date.now();
  const article = await getArticleById(articleId);
  if (!article) throw new Error('Article not found');
  if (!isManualArticle(article)) {
    throw new Error('Only manual articles can be updated through this endpoint');
  }

  const existingDraft = readExistingManualDraft(article);

  const draft = buildDraft({
    seo_title: input.seo_title ?? existingDraft.seo_title,
    meta_title: input.meta_title ?? existingDraft.meta_title,
    meta_description: input.meta_description ?? existingDraft.meta_description,
    excerpt: input.excerpt ?? existingDraft.excerpt,
    blocks: input.blocks ?? existingDraft.blocks,
    featured_image:
      input.featured_image !== undefined ? input.featured_image : existingDraft.featured_image,
    primary_keyword: input.primary_keyword ?? existingDraft.primary_keyword,
    semantic_keywords: input.semantic_keywords ?? existingDraft.semantic_keywords,
  });

  const settings = await getSettings();
  const validation = validateManualDraft(draft, {
    minWords: 50,
    maxWords: settings.article_length_max,
    mode: article.status === 'published' ? 'publish' : 'draft',
  });
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }

  const slug =
    input.slug != null && input.slug.trim()
      ? normalizeSlug(input.slug, draft.seo_title)
      : article.slug;

  if (slug !== article.slug && (await slugExists(slug, articleId))) {
    throw new Error(`Slug "${slug}" is already in use`);
  }

  const word_count = validation.word_count;
  const reading_time = readingTimeMinutes(word_count);

  await persistManualArticleContent({
    article,
    articleId,
    slug,
    draft,
    word_count,
    reading_time,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[manual-save:${articleId}] ${Date.now() - t0}ms status=${article.status}`);
  }

  return { ok: true, word_count, blocks: draft.blocks, draft_json: draft };
}

/** Generate SEO package and move manual article to review — no AI writing. */
export async function prepareManualArticleForPublish(
  articleId: number
): Promise<{ ok: boolean; message: string; status?: string }> {
  const article = await getArticleById(articleId);
  if (!article) throw new Error('Article not found');
  if (!isManualArticle(article)) {
    throw new Error('Only manual articles can use prepare-manual-publish');
  }
  if (article.status === 'published') {
    return { ok: true, message: 'Already published', status: 'published' };
  }

  const seo = await generateArticleSeo(articleId, { skipAiPolish: true });
  if (!seo.ok) {
    return {
      ok: false,
      message: seo.message || 'SEO generation failed',
    };
  }

  return {
    ok: true,
    message: 'SEO package generated',
    status: article.status,
  };
}

import type { SeoPackage } from '../seo/seo-package.js';

function hasUsableSeoPackage(article: NonNullable<Awaited<ReturnType<typeof getArticleById>>>): boolean {
  const pkg = article.seo_package_json as SeoPackage | null;
  if (!pkg || typeof pkg !== 'object') return false;
  const meta = (pkg.meta_description || '').trim();
  const title = (pkg.seo_title || pkg.meta_title || '').trim();
  return Boolean(meta && title);
}

/** Validate, generate SEO if needed, and publish a manual article directly (no review queue). */
export async function publishManualArticleService(
  articleId: number
): Promise<import('../publish/publish.js').PublishResult> {
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
  if (!isManualArticle(article)) {
    return {
      ok: false,
      article_id: articleId,
      status: article.status,
      message: 'Only manual articles can use direct manual publish',
      errors: [{ code: 'not_manual', message: 'Not a manual article' }],
    };
  }
  if (article.status === 'published') {
    return {
      ok: true,
      article_id: articleId,
      status: 'published',
      slug: article.slug,
      message: 'Already published',
    };
  }

  const settings = await getSettings();
  const draft =
    article.draft_json && typeof article.draft_json === 'object'
      ? (article.draft_json as WriterDraftPayload)
      : {
          seo_title: article.seo_title || '',
          meta_title: article.meta_title || '',
          meta_description: article.meta_description || '',
          excerpt: article.excerpt || '',
          blocks: Array.isArray(article.blocks_json)
            ? (article.blocks_json as DraftBlock[])
            : [],
        };

  const validation = validateManualDraft(draft, {
    minWords: 50,
    maxWords: settings.article_length_max,
    mode: 'publish',
  });
  if (!validation.ok) {
    return {
      ok: false,
      article_id: articleId,
      status: article.status,
      message: validation.errors.join('; '),
      errors: validation.errors.map((e) => ({ code: 'validation', message: e })),
    };
  }

  if (!hasUsableSeoPackage(article)) {
    const seo = await generateArticleSeo(articleId, { skipAiPolish: true });
    if (!seo.ok) {
      return {
        ok: false,
        article_id: articleId,
        status: article.status,
        message: seo.message || 'SEO generation failed — check title, excerpt, and meta description',
        errors: (seo.errors || [seo.message]).map((m) => ({
          code: 'seo_failed',
          message: String(m),
        })),
      };
    }
  }

  const { publishArticle } = await import('../publish/publish.js');
  return publishArticle(articleId);
}

function featuredImageForResponse(
  featured_image: FeaturedImageMeta,
  version: number | string = Date.now()
): FeaturedImageMeta {
  return {
    ...featured_image,
    url: bustFeaturedImageUrl(featured_image.url, version),
  };
}

export async function uploadManualFeaturedImage(input: {
  articleId: number;
  buffer?: Buffer;
  dataBase64?: string;
  mime?: string;
  alt?: string;
}): Promise<{ featured_image: FeaturedImageMeta }> {
  const article = await getArticleById(input.articleId);
  if (!article) throw new Error('Article not found');
  if (!isManualArticle(article)) throw new Error('Featured image upload is for manual articles only');

  const { saveFeaturedImage, saveFeaturedImageFromBase64, deleteFeaturedImageFile } = await import(
    './featured-image.js'
  );
  const { extractFeaturedImage } = await import('./html-blocks.js');

  const existingDraft =
    article.draft_json && typeof article.draft_json === 'object'
      ? (article.draft_json as Record<string, unknown>)
      : {};
  const prev = extractFeaturedImage(existingDraft);
  if (prev?.url) await deleteFeaturedImageFile(prev.url);

  let featured_image: FeaturedImageMeta;
  if (input.buffer && input.buffer.length > 0) {
    featured_image = await saveFeaturedImage({
      articleId: input.articleId,
      buffer: input.buffer,
      alt: input.alt,
    });
  } else if (input.dataBase64) {
    featured_image = await saveFeaturedImageFromBase64({
      articleId: input.articleId,
      dataBase64: input.dataBase64,
      mime: input.mime || 'image/jpeg',
      alt: input.alt,
    });
  } else {
    throw new Error('No image data received');
  }

  const manualDraft = readExistingManualDraft(article);
  const draft = buildDraft({
    ...manualDraft,
    featured_image,
  });

  await persistManualArticleContent({
    article,
    articleId: input.articleId,
    slug: article.slug,
    draft,
    word_count: article.word_count,
    reading_time: article.reading_time_minutes || readingTimeMinutes(article.word_count),
  });

  const cacheVersion = Date.now();
  return { featured_image: featuredImageForResponse(featured_image, cacheVersion) };
}

export async function removeManualFeaturedImage(articleId: number): Promise<void> {
  const article = await getArticleById(articleId);
  if (!article) throw new Error('Article not found');
  if (!isManualArticle(article)) throw new Error('Featured image removal is for manual articles only');

  const { deleteFeaturedImageFile } = await import('./featured-image.js');
  const existingDraft =
    article.draft_json && typeof article.draft_json === 'object'
      ? (article.draft_json as Record<string, unknown>)
      : {};
  const prev =
    existingDraft.featured_image && typeof existingDraft.featured_image === 'object'
      ? (existingDraft.featured_image as FeaturedImageMeta)
      : null;
  if (prev?.url) await deleteFeaturedImageFile(prev.url);

  const manualDraft = readExistingManualDraft(article);
  const draft = buildDraft({
    ...manualDraft,
    featured_image: null,
  });

  await persistManualArticleContent({
    article,
    articleId,
    slug: article.slug,
    draft,
    word_count: article.word_count,
    reading_time: article.reading_time_minutes || readingTimeMinutes(article.word_count),
  });
}

export async function createManualArticleFromTopic(topicId: number): Promise<{
  article_id: number;
  slug: string;
}> {
  const topic = await getTopicById(topicId);
  if (!topic) throw new Error('Topic not found');

  const refs = topic.source_refs_json || {};
  const brief = typeof refs.brief === 'string' ? refs.brief : '';

  const introText =
    brief.trim() ||
    `Use this manual draft to write about ${topic.title}. Replace this placeholder with your own research, cost context, and practical guidance for readers comparing cities or planning a move.`;

  const blocks: DraftBlock[] = [
    {
      id: `manual-intro-${Date.now()}`,
      type: 'intro',
      content: introText,
    },
    {
      id: `manual-h-${Date.now()}`,
      type: 'heading',
      heading: 'Overview',
      content: 'Overview',
    },
    {
      id: `manual-p-${Date.now()}`,
      type: 'paragraph',
      content:
        'Start writing your article here. Add sections with ## headings, bullet lists, and links to CityCost tools such as /compare or /blog where they help the reader.',
    },
  ];

  return createManualArticleService({
    seo_title: topic.title,
    meta_description: brief.trim() || `Guide: ${topic.title}`,
    excerpt: brief.trim() || topic.title,
    content_type: topic.content_type,
    cluster_id: topic.cluster_id,
    topic_id: topicId,
    blocks,
    minWords: 20,
  });
}

export { slugifyTitle, countDraftWords };
