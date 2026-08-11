/**
 * AI SEO suggestions for manually written articles — uses existing AI Router.
 */

import { getAiRouter } from '../ai/ai-router.js';
import { slugifyTitle } from '../writer/draft-validate.js';
import { blocksToPlainText } from './html-blocks.js';
import type { DraftBlock } from '../writer/draft-validate.js';

export interface ManualSeoSuggestion {
  seo_title: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  excerpt: string;
  primary_keyword: string;
  semantic_keywords: string[];
}

export async function generateManualSeoSuggestion(input: {
  title: string;
  blocks: DraftBlock[];
  excerpt?: string;
  articleId?: number;
}): Promise<ManualSeoSuggestion> {
  const title = input.title.trim();
  if (!title) throw new Error('Blog title is required for SEO generation');

  const contentText = blocksToPlainText(input.blocks).slice(0, 12000);
  if (contentText.split(/\s+/).filter(Boolean).length < 20) {
    throw new Error('Add more article content before generating SEO (minimum ~20 words)');
  }

  const router = getAiRouter();
  if (!(await router.hasAnyProvider())) {
    throw new Error('AI provider not configured — set up AI in Editorial Settings first');
  }

  const result = await router.complete({
    stage: 'seo',
    temperature: 0.35,
    maxTokens: 600,
    jsonMode: true,
    articleId: input.articleId ?? null,
    system: `You are an SEO specialist for CityCost.online, a cost-of-living comparison site.
Return JSON only with keys:
seo_title, meta_title, meta_description, slug, excerpt, primary_keyword, semantic_keywords
Rules:
- seo_title and meta_title: compelling, ≤60 chars, include primary keyword naturally
- meta_description: 150-160 chars, specific to the article, include a clear value prop
- slug: lowercase, hyphen-separated, URL-safe, derived from title (no year unless essential), max 80 chars
- excerpt: 1-2 sentences for blog cards, max 220 chars
- primary_keyword: main search phrase this article targets
- semantic_keywords: array of 3-6 related phrases
Base everything ONLY on the provided title and article content. No generic filler.`,
    user: JSON.stringify({
      title,
      current_excerpt: input.excerpt || '',
      content_preview: contentText.slice(0, 8000),
    }),
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    throw new Error('AI returned invalid JSON for SEO — try again');
  }

  const seoTitle = String(parsed.seo_title || parsed.meta_title || title).trim();
  const metaTitle = String(parsed.meta_title || seoTitle).trim();
  let metaDescription = String(parsed.meta_description || '').trim();
  if (metaDescription.length > 165) metaDescription = metaDescription.slice(0, 160).trim();
  const slugRaw = String(parsed.slug || slugifyTitle(title)).trim();
  const slug = slugifyTitle(slugRaw || title);
  const excerpt = String(parsed.excerpt || input.excerpt || '').trim().slice(0, 280);
  const primary_keyword = String(parsed.primary_keyword || '').trim();
  const semantic_keywords = Array.isArray(parsed.semantic_keywords)
    ? parsed.semantic_keywords.map(String).filter(Boolean).slice(0, 8)
    : [];

  if (!metaDescription) throw new Error('AI did not return a meta description');

  return {
    seo_title: seoTitle,
    meta_title: metaTitle.slice(0, 60),
    meta_description: metaDescription,
    slug,
    excerpt,
    primary_keyword,
    semantic_keywords,
  };
}
