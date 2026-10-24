/**
 * FAQ validator — direct answer + context + practical advice + decision support.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';

interface FaqPair {
  q: string;
  a: string;
  id?: string;
}

function extractFaq(draft: WriterDraftPayload): FaqPair[] {
  const block = (draft.blocks || []).find((b) => b.type === 'faq');
  if (!block) return [];
  if (Array.isArray(block.content)) {
    return block.content
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const o = item as Record<string, unknown>;
        const q = String(o.q ?? o.question ?? '');
        const a = String(o.a ?? o.answer ?? '');
        if (!q || !a) return null;
        return { q, a, id: typeof o.id === 'string' ? o.id : undefined } as FaqPair;
      })
      .filter((x): x is FaqPair => x !== null);
  }
  if (typeof block.content === 'string') {
    return [{ q: 'FAQ', a: block.content }];
  }
  return [];
}

const INDEX_ONLY =
  /^(?:[^.!?]*(?:index|average|metric|measure|indicator)[^.!?]*\.\s*){1,2}$/i;
const HAS_DIRECT = /\b(yes|no|typically|usually|around|about|most|it depends|in short|generally)\b/i;
const HAS_ADVICE =
  /\b(should|consider|check|compare|plan|budget|avoid|next|confirm|ask|verify)\b/i;
const HAS_CONTEXT = /\b(because|when|if|for|depending|while|after|before|in)\b/i;

/** Generic sentences this validator used to append to FAQ answers. */
export const LEGACY_FAQ_BOILERPLATE = [
  'In practice, treat published figures as a baseline, then confirm with a local quote and decide whether your housing or essentials line needs a larger buffer.',
  'Next step: write down one decision (neighbourhood, lease length, or budget cap) before you rely on the average alone.',
  'Context matters when your situation differs from the citywide mix.',
];

export function stripLegacyFaqBoilerplate(answer: string): string {
  let a = answer;
  for (const sentence of LEGACY_FAQ_BOILERPLATE) a = a.split(sentence).join(' ');
  a = a.replace(/^In short:\s*/i, '');
  return a.replace(/\s+/g, ' ').trim();
}

export function validateFaq(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  rewritten: number;
} {
  const findings: ValidatorFinding[] = [];
  let rewritten = 0;
  const blocks = [...(draft.blocks || [])];
  const faqIdx = blocks.findIndex((b) => b.type === 'faq');
  if (faqIdx < 0) {
    return {
      draft,
      rewritten: 0,
      result: {
        category: 'faq_quality',
        status: 'WARNING',
        score: 50,
        findings: [{ code: 'missing_faq', message: 'No FAQ block', severity: 'warn' }],
      },
    };
  }

  const items = extractFaq(draft);
  const improved = items.map((item) => {
    let a = item.a.trim();
    let changed = false;
    // Report only. Appending the same generic sentences ("In short:", "Next step: write
    // down one decision…", "Context matters…") to every weak answer produced identical
    // FAQ endings; weak answers are now surfaced to the gate instead of padded.
    if (INDEX_ONLY.test(a) || a.split(/\s+/).length < 18) {
      findings.push({
        code: 'faq_index_only',
        message: `Thin/index-only FAQ answer for: ${item.q.slice(0, 60)}`,
        severity: 'warn',
      });
    }
    if (!HAS_DIRECT.test(a)) {
      findings.push({ code: 'faq_not_direct', message: `FAQ answer does not open directly: ${item.q.slice(0, 60)}`, severity: 'warn' });
    }
    if (!HAS_ADVICE.test(a)) {
      findings.push({ code: 'faq_no_advice', message: `FAQ answer has no practical advice: ${item.q.slice(0, 60)}`, severity: 'warn' });
    }
    if (!HAS_CONTEXT.test(a)) {
      findings.push({ code: 'faq_no_context', message: `FAQ answer lacks context: ${item.q.slice(0, 60)}`, severity: 'warn' });
    }
    // Strip boilerplate previously appended by this validator (older drafts / revisions).
    const cleaned = stripLegacyFaqBoilerplate(a);
    if (cleaned !== a) {
      a = cleaned;
      changed = true;
    }
    if (changed) rewritten += 1;
    return { ...item, a: a.replace(/\s+/g, ' ').trim() };
  });

  if (faqIdx >= 0 && Array.isArray(blocks[faqIdx].content)) {
    blocks[faqIdx] = {
      ...blocks[faqIdx],
      content: improved.map((x) => ({ id: x.id, q: x.q, a: x.a })),
    };
  }

  // Residual index-only
  let residual = 0;
  for (const item of improved) {
    if (INDEX_ONLY.test(item.a) || (!HAS_ADVICE.test(item.a) && item.a.split(/\s+/).length < 25)) {
      residual += 1;
      findings.push({
        code: 'faq_still_thin',
        message: `FAQ still thin: ${item.q.slice(0, 40)}`,
        severity: 'warn',
      });
    }
  }

  const score = Math.max(45, 100 - residual * 15 - Math.max(0, rewritten - items.length) * 5);
  return {
    draft: { ...draft, blocks },
    rewritten,
    result: {
      category: 'faq_quality',
      status: statusFromScore(score, false, residual > 0 || rewritten > 0),
      score,
      findings,
      rewritten,
    },
  };
}
