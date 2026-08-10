/**
 * Writer-side FAQ bridge — uses the dedicated FAQ module (not Writer prompts).
 */

import {
  extractArticleSummary,
  generateDedicatedFaqs,
  replaceFaqInDraft,
} from '../faq/index.js';
import type { ResearchPack } from './research-engine.js';
import type { WriterDraftPayload } from './draft-validate.js';

export async function applyFaqWriter(
  draft: WriterDraftPayload,
  research: ResearchPack,
  articleId?: number | null,
  options?: { preferDeterministic?: boolean }
): Promise<{ draft: WriterDraftPayload; source: string; message: string }> {
  const generated = await generateDedicatedFaqs({
    research: research as never,
    article_summary: extractArticleSummary(draft),
    seo_keywords: [
      research.primary_keyword,
      ...(research.secondary_keywords || []).slice(0, 4),
    ].filter(Boolean) as string[],
    articleId: articleId ?? null,
    preferDeterministic: options?.preferDeterministic,
  });
  return {
    draft: replaceFaqInDraft(draft, generated.block),
    source: generated.source,
    message: generated.message,
  };
}
