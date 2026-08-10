/**
 * Shared draft text helpers for reviewer scoring (read-only).
 */

import type { DraftBlock, WriterDraftPayload } from '../writer/draft-validate.js';

export function blockContentText(block: DraftBlock): string {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return JSON.stringify(item);
        return '';
      })
      .join(' ');
  }
  if (block.content && typeof block.content === 'object') {
    return JSON.stringify(block.content);
  }
  return '';
}

export function draftPlainText(draft: WriterDraftPayload): string {
  const parts = [
    draft.seo_title,
    draft.meta_title,
    draft.meta_description,
    draft.excerpt,
    ...(draft.blocks || []).flatMap((b) => [b.heading || '', blockContentText(b)]),
  ];
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function draftBodyText(draft: WriterDraftPayload): string {
  return (draft.blocks || [])
    .map((b) => [b.heading || '', blockContentText(b)].filter(Boolean).join('. '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}
