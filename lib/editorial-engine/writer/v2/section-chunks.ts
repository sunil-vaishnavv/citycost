/**
 * Body-section chunking shared by helpfulness engines (skips protected blocks).
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import { isProtectedBlock } from './block-integrity.js';
import { blockPlain } from './content-quality/text-metrics.js';

export interface SectionChunk {
  heading: string;
  headingId?: string;
  text: string;
  /** Block ids belonging to this section (heading + body) */
  ids: string[];
  /** Body block ids only (paragraph / tip / list / warning / …) */
  bodyIds: string[];
  startIndex: number;
  endIndex: number;
}

export function chunkBodySections(blocks: DraftBlock[]): SectionChunk[] {
  const chunks: SectionChunk[] = [];
  let current: SectionChunk | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || isProtectedBlock(b)) continue;

    if (b.type === 'heading') {
      if (current && current.text.trim().length > 20) chunks.push(current);
      current = {
        heading: String(b.heading || b.content || 'section'),
        headingId: b.id,
        text: '',
        ids: [b.id],
        bodyIds: [],
        startIndex: i,
        endIndex: i,
      };
      continue;
    }

    if (!current) {
      current = {
        heading: 'body',
        text: '',
        ids: [],
        bodyIds: [],
        startIndex: i,
        endIndex: i,
      };
    }

    const t = blockPlain(b);
    const label = b.heading ? `${b.heading}: ` : '';
    current.text += ` ${label}${t}`;
    current.ids.push(b.id);
    current.bodyIds.push(b.id);
    current.endIndex = i;
  }

  if (current && current.text.trim().length > 20) chunks.push(current);
  return chunks;
}

export function draftSectionChunks(draft: WriterDraftPayload): SectionChunk[] {
  return chunkBodySections(draft.blocks || []);
}

/** Last mutable body block index within a section (for appends). */
export function lastBodyBlockIndex(blocks: DraftBlock[], chunk: SectionChunk): number {
  for (let i = chunk.endIndex; i >= chunk.startIndex; i--) {
    const b = blocks[i];
    if (!b || isProtectedBlock(b)) continue;
    if (b.type === 'heading') continue;
    if (typeof b.content === 'string' || Array.isArray(b.content)) return i;
  }
  return -1;
}
