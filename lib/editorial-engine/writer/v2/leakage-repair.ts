/**
 * Pre-audit leakage repair — rewrite ONLY paragraphs that contain prompt leakage.
 * Does not disable the Quality Audit leakage detector.
 */

import { draftBodyText } from '../../reviewer/text-utils.js';
import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import {
  detectPromptLeakage,
  promptLeakageIssues,
  stripPromptLeakage,
} from '../prompt-leakage.js';
import { sanitizePromptText } from './prompt-sanitizer.js';

export interface LeakageRepairReport {
  before_hits: string[];
  after_hits: string[];
  stripped_sentences: number;
  rewritten_blocks: number;
  block_ids: string[];
  ok: boolean;
}

function blockLeakHits(block: DraftBlock): string[] {
  if (typeof block.content === 'string') return detectPromptLeakage(block.content);
  if (Array.isArray(block.content)) {
    return detectPromptLeakage(
      block.content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            return `${o.q || o.question || ''} ${o.a || o.answer || ''}`;
          }
          return '';
        })
        .join(' ')
    );
  }
  return [];
}

/**
 * Deterministic scrub of leaked sentences, then optional AI rewrite of remaining
 * leaked string paragraphs only.
 */
export async function repairPromptLeakage(input: {
  draft: WriterDraftPayload;
  complete: (system: string, user: string) => Promise<string>;
}): Promise<{ draft: WriterDraftPayload; report: LeakageRepairReport }> {
  const before_hits = detectPromptLeakage(draftBodyText(input.draft));
  if (!before_hits.length) {
    return {
      draft: input.draft,
      report: {
        before_hits: [],
        after_hits: [],
        stripped_sentences: 0,
        rewritten_blocks: 0,
        block_ids: [],
        ok: true,
      },
    };
  }

  const stripped = stripPromptLeakage(input.draft);
  let draft = stripped.draft;
  let rewritten_blocks = 0;
  const block_ids: string[] = [];

  const remaining = detectPromptLeakage(draftBodyText(draft));
  if (remaining.length) {
    const nextBlocks: DraftBlock[] = [];
    for (const block of draft.blocks || []) {
      const hits = blockLeakHits(block);
      if (!hits.length || typeof block.content !== 'string') {
        nextBlocks.push(block);
        continue;
      }

      const system = sanitizePromptText(
        [
          'You rewrite one article paragraph to remove internal planning vocabulary.',
          'Keep all real numbers, place names, and useful advice.',
          'Never use: indexed averages, cross-check, search intent, required_h2, editorial angle, persona, research notes, data sources (as a label), CityCost angle.',
          'Return JSON {"content":"..."} only.',
        ].join('\n')
      ).text;
      const user = sanitizePromptText(
        `LEAKED_PHRASES=${hits.join(', ')}\nPARAGRAPH:\n${block.content}`
      ).text;

      try {
        const text = await input.complete(system, user);
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
          const parsed = JSON.parse(text.slice(start, end + 1)) as { content?: string };
          if (typeof parsed.content === 'string' && parsed.content.trim().length > 40) {
            const cleaned = parsed.content.trim();
            if (!detectPromptLeakage(cleaned).length) {
              nextBlocks.push({ ...block, content: cleaned });
              rewritten_blocks += 1;
              block_ids.push(block.id || `block-${nextBlocks.length}`);
              continue;
            }
          }
        }
      } catch {
        /* keep stripped version */
      }
      // Last resort: drop leaked sentences already attempted; if still dirty, blank soft filler
      const fallback = cleanedFallback(block.content, hits);
      nextBlocks.push({ ...block, content: fallback });
      rewritten_blocks += 1;
      block_ids.push(block.id || `block-${nextBlocks.length}`);
    }
    draft = { ...draft, blocks: nextBlocks };
  }

  const after_hits = detectPromptLeakage(draftBodyText(draft));
  console.warn(
    `[writer-v2] leakage repair: before=[${before_hits.join('; ')}] stripped=${stripped.removed} rewritten=${rewritten_blocks} after=[${after_hits.join('; ') || 'none'}] blocks=${block_ids.join(',') || '—'}`
  );

  return {
    draft,
    report: {
      before_hits,
      after_hits,
      stripped_sentences: stripped.removed,
      rewritten_blocks,
      block_ids,
      ok: after_hits.length === 0,
    },
  };
}

function cleanedFallback(content: string, hits: string[]): string {
  let text = content;
  for (const h of hits) {
    const re = new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    text = text.replace(re, '');
  }
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  if (text.split(/\s+/).length >= 12) return text;
  return 'Local costs vary by neighbourhood and household size; treat published indices as planning baselines and confirm rent and everyday prices with current local quotes.';
}

export function leakageIssuesForAudit(draft: WriterDraftPayload): string[] {
  return promptLeakageIssues(draft);
}
