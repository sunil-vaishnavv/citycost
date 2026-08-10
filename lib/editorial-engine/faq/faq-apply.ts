import type { DraftBlock, WriterDraftPayload } from '../writer/draft-validate.js';
import type { FaqItem } from './types.js';

export function toFaqBlock(items: FaqItem[]): DraftBlock {
  return {
    id: 'faq',
    type: 'faq',
    heading: 'FAQ',
    content: items.map((item, i) => ({
      id: item.id || `faq-${i + 1}`,
      q: item.q.trim(),
      a: item.a.trim(),
    })),
  };
}

/** Replace existing FAQ block(s) or insert before summary / at end. */
export function replaceFaqInDraft(
  draft: WriterDraftPayload,
  faqBlock: DraftBlock
): WriterDraftPayload {
  const blocks = [...(draft.blocks || [])];
  const faqIndexes = blocks
    .map((b, i) => (b.type === 'faq' ? i : -1))
    .filter((i) => i >= 0);

  if (faqIndexes.length) {
    // Keep first FAQ slot; drop extras
    const keep = faqIndexes[0]!;
    blocks[keep] = faqBlock;
    for (let i = faqIndexes.length - 1; i >= 1; i--) {
      blocks.splice(faqIndexes[i]!, 1);
    }
    // Drop orphan FAQ heading immediately before the kept block
    const headingIdx = keep - 1;
    if (
      headingIdx >= 0 &&
      blocks[headingIdx]?.type === 'heading' &&
      /^faq$/i.test(String(blocks[headingIdx]?.heading || blocks[headingIdx]?.content || ''))
    ) {
      // leave heading — section chrome often expects it
    }
  } else {
    const summaryIdx = blocks.findIndex((b) => b.type === 'summary');
    if (summaryIdx >= 0) blocks.splice(summaryIdx, 0, faqBlock);
    else blocks.push(faqBlock);
  }

  return { ...draft, blocks };
}

export function extractArticleSummary(draft: WriterDraftPayload | null | undefined): string {
  if (!draft) return '';
  if (draft.excerpt?.trim()) return draft.excerpt.trim();
  for (const b of draft.blocks || []) {
    if (b.type === 'intro' || b.type === 'paragraph') {
      const c = b.content;
      if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 500);
    }
  }
  return draft.seo_title || '';
}
