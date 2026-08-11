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
} from '../db/articles-repo.js';
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

function buildDraft(input: {
  seo_title: string;
  meta_title?: string;
  meta_description: string;
  excerpt: string;
  blocks: DraftBlock[];
}): WriterDraftPayload {
  const seoTitle = input.seo_title.trim();
  return {
    seo_title: seoTitle,
    meta_title: (input.meta_title || seoTitle).trim(),
    meta_description: input.meta_description.trim(),
    excerpt: input.excerpt.trim(),
    blocks: input.blocks,
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
    meta_description: input.meta_description,
    excerpt: input.excerpt,
    blocks: input.blocks,
  });

  const settings = await getSettings();
  const minWords = input.minWords ?? 50;
  const validation = validateManualDraft(draft, {
    minWords,
    maxWords: settings.article_length_max,
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
  }
): Promise<{ ok: true; word_count: number }> {
  const article = await getArticleById(articleId);
  if (!article) throw new Error('Article not found');
  if (!isManualArticle(article)) {
    throw new Error('Only manual articles can be updated through this endpoint');
  }
  if (article.status === 'published') {
    throw new Error('Use update-content for published articles');
  }

  const existingDraft: WriterDraftPayload =
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

  const draft = buildDraft({
    seo_title: input.seo_title ?? existingDraft.seo_title,
    meta_title: input.meta_title ?? existingDraft.meta_title,
    meta_description: input.meta_description ?? existingDraft.meta_description,
    excerpt: input.excerpt ?? existingDraft.excerpt,
    blocks: input.blocks ?? existingDraft.blocks,
  });

  const settings = await getSettings();
  const validation = validateManualDraft(draft, {
    minWords: 50,
    maxWords: settings.article_length_max,
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

  return { ok: true, word_count };
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

  await updateArticleStatus(articleId, 'review');
  return {
    ok: true,
    message: 'SEO generated — article ready for publish review',
    status: 'review',
  };
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
