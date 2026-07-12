/**
 * Optional AI refinement — ONLY rephrases template prose.
 * Must not add facts. Disabled by default (CONTENT_AI_REFINE=1 to enable).
 */

import type { ContentBlock } from './types.js';

export async function refineBlocksOptional(
  blocks: ContentBlock[],
  context: { place: string; locked_numbers: string[] }
): Promise<{ blocks: ContentBlock[]; method: 'template' | 'template+refine' }> {
  const enabled = process.env.CONTENT_AI_REFINE === '1' || process.env.CONTENT_AI_REFINE === 'true';
  if (!enabled) return { blocks, method: 'template' };

  // Soft polish without external calls: tighten whitespace / ensure numbers remain.
  // Full Groq rewrite is intentionally not used for COL facts (anti-hallucination).
  const locked = new Set(context.locked_numbers.filter(Boolean));
  const polished = blocks.map((b) => ({
    ...b,
    paragraphs: b.paragraphs.map((p) => {
      let out = p.replace(/\s+/g, ' ').trim();
      for (const num of locked) {
        if (num && !out.includes(num) && p.includes(num)) {
          // If polish somehow dropped a locked token, restore original paragraph
          out = p;
          break;
        }
      }
      return out;
    }),
  }));

  return { blocks: polished, method: 'template+refine' };
}
