/**
 * Prompt leakage blocker — strip / reject instruction language that must never ship in prose.
 *
 * Threat model: block system-prompt echo, writer-planning vocabulary, JSON/schema
 * instructions, and meta labels (research pack, required_h2, etc.) from reader-facing prose.
 * Some banned prompt phrases ("ask whether") also appear as legitimate editorial advice;
 * those use contextual rules — never a blind allowlist.
 */

import type { WriterDraftPayload } from './draft-validate.js';
import { draftBodyText } from '../reviewer/text-utils.js';

/** Exact / near instruction phrases from prompts that leaked into articles. */
export const PROMPT_LEAKAGE_PHRASES = [
  'if housing stays vague',
  'when you choose',
  'ask whether',
  'cross-check',
  'cross check',
  'before you finalize',
  'write next to rent',
  'if quotes disagree',
  'revisit section',
  'revisit this section',
  'keep the citycost angle',
  'write for ',
  'with intent',
  'supporting spoke',
  'certification batch',
  'use the keyword naturally',
  'keep the persona',
  'matters when you evaluate',
  'frame the answer as',
  'prefer short sentences',
  'focus this section on',
  'related phrases can include',
  'country signals for',
  'indexed averages',
  'the practical answer',
  'budget as a worksheet',
  'when in doubt',
  'widen the contingency instead of inventing',
  'for housing, write a number you can defend',
  'write a number you can defend',
  'leave the cell blank',
  'hold lifestyle constant', // allowed in comparison writer only — checked separately
];

/** Substring match — always leakage in any context. */
export const HARD_LEAKAGE_STRICT = [
  'if housing stays vague',
  'cross-check',
  'cross check',
  'before you finalize',
  'write next to rent',
  'if quotes disagree',
  'revisit section',
  'revisit this section',
  'write for ',
  'with intent',
  'supporting spoke',
  'certification batch',
  'use the keyword naturally',
  'keep the persona',
  'matters when you evaluate',
  'frame the answer as',
  'prefer short sentences',
  'focus this section on',
  'related phrases can include',
  'country signals for',
  'write a number you can defend',
  'leave the cell blank',
  'when you choose',
  'indexed averages',
  'budget as a worksheet',
  'the practical answer',
  'ignore previous instructions',
  'disregard all prior instructions',
  'forget everything above',
];

/** Full writer prompt ban list (includes contextual-only entries). */
export const HARD_LEAKAGE = [...HARD_LEAKAGE_STRICT, 'ask whether'];

const META_INSTRUCTION_RE =
  /\b(?:required h2|research pack|section brief|writer engine|keep the persona|use the keyword naturally|focus this section|frame the answer as|planning note|return json|you are a (?:helpful|senior) (?:writer|assistant))\b/i;

/** Prompt-echo tails after "ask whether" — writer planning, not reader advice. */
const ASK_WHETHER_META_TAIL_RE =
  /\bask whether (?:the )?(?:section|outline|keyword|prompt|writer|comparison is clear|housing stays vague|reader needs)\b/i;

/** Reader-facing verification with a concrete object and predicate. */
const ASK_WHETHER_EDITORIAL_RE =
  /\bask whether(?: the| your| a| an)? [a-z][\w\s,'-]{2,60}?\b(?:is|are|has|have|can|will|includes?|compensates?|covers?|separate|permit|worth|still|actually|really|enough|fits?|works?|matters?|doubles?|applies?|makes?)\b/i;

/** Prompt-injection / system-instruction patterns (regex). */
const PROMPT_INJECTION_RES: Array<{ re: RegExp; code: string }> = [
  { re: /\bignore previous instructions\b/i, code: 'ignore previous instructions' },
  {
    re: /\bdisregard (?:all )?(?:prior|previous) (?:instructions|prompts)\b/i,
    code: 'disregard prior instructions',
  },
  { re: /\bforget (?:everything|all) (?:above|before)\b/i, code: 'forget everything above' },
  { re: /\byou are a (?:helpful|senior) (?:writer|assistant)\b/i, code: 'system_role' },
  { re: /\breturn json\b/i, code: 'return json' },
  { re: /\bdo not invent (?:statistics|numbers)\b/i, code: 'do_not_invent' },
];

/**
 * Classify "ask whether" in one sentence — editorial advice vs prompt echo.
 * Exported for tests and richer audit messages.
 */
export function isAskWhetherLeakage(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  if (!lower.includes('ask whether')) return false;

  if (META_INSTRUCTION_RE.test(sentence)) return true;
  if (ASK_WHETHER_META_TAIL_RE.test(sentence)) return true;

  for (const p of HARD_LEAKAGE_STRICT) {
    if (lower.includes(p)) return true;
  }

  if (ASK_WHETHER_EDITORIAL_RE.test(sentence)) return false;
  if (/\bask whether .+ and whether\b/i.test(sentence)) return false;

  if (/^ask whether[.\s!,]*$/i.test(sentence.trim())) return true;

  // Substantive sentence — reader-facing checklist / decision advice
  if (sentence.split(/\s+/).filter(Boolean).length >= 10) return false;

  return true;
}

function detectInjection(text: string): string[] {
  const hits: string[] = [];
  for (const { re, code } of PROMPT_INJECTION_RES) {
    if (re.test(text)) hits.push(code);
    re.lastIndex = 0;
  }
  return hits;
}

export function detectPromptLeakage(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];

  for (const p of HARD_LEAKAGE_STRICT) {
    if (lower.includes(p)) hits.push(p);
  }

  hits.push(...detectInjection(text));

  if (lower.includes('ask whether')) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const hasLeak =
      sentences.length <= 1
        ? isAskWhetherLeakage(text)
        : sentences.some((s) => isAskWhetherLeakage(s));
    if (hasLeak) hits.push('ask whether');
  }

  return [...new Set(hits)];
}

/** Remove sentences containing hard leakage phrases. */
export function stripPromptLeakage(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  removed: number;
  hits: string[];
} {
  const hits = new Set<string>();
  let removed = 0;
  const blocks = (draft.blocks || []).map((b) => {
    if (!['paragraph', 'intro', 'summary', 'tip', 'warning'].includes(b.type)) return b;
    if (typeof b.content !== 'string') return b;
    const parts = b.content.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];
    for (const sentence of parts) {
      const leak = detectPromptLeakage(sentence);
      if (leak.length) {
        leak.forEach((h) => hits.add(h));
        removed += 1;
        continue;
      }
      kept.push(sentence);
    }
    const text = kept.join(' ').replace(/\s+/g, ' ').trim();
    if (text.split(/\s+/).length < 8) return b;
    return text === b.content ? b : { ...b, content: text };
  });
  return { draft: { ...draft, blocks }, removed, hits: [...hits] };
}

export function promptLeakageIssues(draft: WriterDraftPayload): string[] {
  const body = draftBodyText(draft);
  return detectPromptLeakage(body).map((p) => `Prompt leakage: "${p}"`);
}
