/**
 * Orchestration: regenerate dedicated FAQs onto an existing article draft.
 * Does not modify Writer / Research / Review engines.
 */

import { getArticleById, updateArticleDraft } from '../db/articles-repo.js';
import type { ResearchPack } from '../research/schema.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { extractArticleSummary, replaceFaqInDraft } from './faq-apply.js';
import { generateDedicatedFaqs } from './faq-generator.js';
import type { FaqApplyResult } from './types.js';

function asDraft(raw: unknown): WriterDraftPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as WriterDraftPayload;
  if (!Array.isArray(d.blocks)) return null;
  return {
    seo_title: String(d.seo_title || ''),
    meta_title: String(d.meta_title || ''),
    meta_description: String(d.meta_description || ''),
    excerpt: String(d.excerpt || ''),
    blocks: d.blocks,
  };
}

function asResearch(raw: unknown): ResearchPack | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as ResearchPack;
}

function countWords(draft: WriterDraftPayload): number {
  const parts: string[] = [draft.seo_title, draft.excerpt];
  for (const b of draft.blocks || []) {
    if (typeof b.content === 'string') parts.push(b.content);
    else if (Array.isArray(b.content)) {
      for (const item of b.content) {
        if (typeof item === 'string') parts.push(item);
        else if (item && typeof item === 'object') {
          const o = item as { q?: string; a?: string };
          if (o.q) parts.push(o.q);
          if (o.a) parts.push(o.a);
        }
      }
    }
    if (b.heading) parts.push(b.heading);
  }
  return parts.join(' ').split(/\s+/).filter(Boolean).length;
}

export async function regenerateArticleFaq(articleId: number): Promise<FaqApplyResult> {
  const article = await getArticleById(articleId);
  if (!article) {
    return {
      ok: false,
      draft: {
        seo_title: '',
        meta_title: '',
        meta_description: '',
        excerpt: '',
        blocks: [],
      },
      faq_count: 0,
      source: 'deterministic',
      validation: {
        ok: false,
        issues: [{ code: 'not_found', message: 'Article not found' }],
        scores: { human_writing: 0, helpful_content: 0, readability: 0, search_intent: 0 },
      },
      message: 'Article not found',
    };
  }

  const draft =
    asDraft(article.draft_json) ||
    asDraft({
      seo_title: article.seo_title || '',
      meta_title: article.meta_title || '',
      meta_description: article.meta_description || '',
      excerpt: article.excerpt || '',
      blocks: Array.isArray(article.blocks_json) ? article.blocks_json : [],
    });
  const research = asResearch(article.research_pack_json);
  if (!draft || !research) {
    return {
      ok: false,
      draft: draft || {
        seo_title: '',
        meta_title: '',
        meta_description: '',
        excerpt: '',
        blocks: [],
      },
      faq_count: 0,
      source: 'deterministic',
      validation: {
        ok: false,
        issues: [{ code: 'missing_pack', message: 'Draft or research pack missing' }],
        scores: { human_writing: 0, helpful_content: 0, readability: 0, search_intent: 0 },
      },
      message: 'Draft or research pack missing',
    };
  }

  const seoKeywords: string[] = [];
  const seo = article.seo_package_json;
  if (seo && typeof seo === 'object') {
    const s = seo as { primary_keyword?: string; secondary_keywords?: string[] };
    if (s.primary_keyword) seoKeywords.push(s.primary_keyword);
    if (Array.isArray(s.secondary_keywords)) seoKeywords.push(...s.secondary_keywords.map(String));
  }

  const generated = await generateDedicatedFaqs({
    research,
    article_summary: extractArticleSummary(draft),
    seo_keywords: seoKeywords,
    articleId,
  });

  const next = replaceFaqInDraft(draft, generated.block);
  const words = countWords(next);
  await updateArticleDraft({
    id: articleId,
    draft: next,
    word_count: words,
    reading_time_minutes: Math.max(1, Math.round(words / 220)),
  });

  return {
    ok: generated.ok,
    draft: next,
    faq_count: generated.items.length,
    source: generated.source,
    validation: generated.validation,
    message: generated.message,
  };
}
