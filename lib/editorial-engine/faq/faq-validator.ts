/**
 * FAQ quality validator — rejects templated / repetitive AI patterns.
 */

import type { FaqItem, FaqQuestionKind, FaqValidationIssue, FaqValidationResult } from './types.js';

export const BANNED_FAQ_PHRASES = [
  'the practical answer',
  'budget as a worksheet',
  'budget australia as a worksheet',
  'when you choose',
  'indexed averages',
  'cross-check',
  'compare two citycost pages',
  'before you finalize',
  'use relative indexes',
  'treat public averages',
  'as planning ranges, not promises',
  'leave a contingency line',
  'most people under-count',
  'furthermore',
  'moreover',
  'in conclusion',
  'therefore',
  'comprehensive',
  'robust overall',
];

const AI_FILLER = /\b(robust|comprehensive|overall|delve|tapestry|landscape|leverage|utilize)\b/i;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function firstSentence(text: string): string {
  const m = text.trim().match(/^[^.!?]+[.!?]?/);
  return (m?.[0] || text).trim().toLowerCase().replace(/\s+/g, ' ');
}

function lastSentence(text: string): string {
  const parts = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (parts[parts.length - 1] || text).toLowerCase().replace(/\s+/g, ' ');
}

function openerKey(sentence: string): string {
  return sentence
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

export function classifyFaqQuestion(q: string): FaqQuestionKind {
  const s = q.trim().toLowerCase();
  if (/^how much|^what does .* cost|^what'?s the (average|typical) cost/.test(s)) return 'how_much';
  if (/^is it worth|^should i|^does it make sense/.test(s)) return 'worth';
  if (/^can i|^can students|^is it possible|^am i able/.test(s)) return 'can';
  if (/^why\b/.test(s)) return 'why';
  if (/^which\b|^what city|^where (should|is)/.test(s)) return 'which';
  if (/^what (is|are|does)\b|^what'?s\b/.test(s)) return 'what';
  return 'generic';
}

export function validateFaqItems(items: FaqItem[]): FaqValidationResult {
  const issues: FaqValidationIssue[] = [];
  if (items.length < 6) {
    issues.push({ code: 'faq_min_6', message: `Need ≥6 FAQs, got ${items.length}` });
  }

  const openers = new Map<string, string[]>();
  const closings = new Map<string, string[]>();
  let bannedHits = 0;
  let lengthFails = 0;
  let fillerHits = 0;

  for (const item of items) {
    const q = (item.q || '').trim();
    const a = (item.a || '').trim();
    if (!q || !a) {
      issues.push({ code: 'empty_faq', message: 'Empty question or answer', question: q || undefined });
      continue;
    }
    const wc = wordCount(a);
    if (wc < 70 || wc > 160) {
      lengthFails += 1;
      issues.push({
        code: 'faq_length',
        message: `Answer word count ${wc} outside 80–140 band (soft 70–160)`,
        question: q,
      });
    }
    const lower = a.toLowerCase();
    for (const ban of BANNED_FAQ_PHRASES) {
      if (lower.includes(ban)) {
        bannedHits += 1;
        issues.push({
          code: 'banned_phrase',
          message: `Banned phrase: "${ban}"`,
          question: q,
        });
        break;
      }
    }
    if (AI_FILLER.test(a)) {
      fillerHits += 1;
      issues.push({ code: 'ai_filler', message: 'AI filler wording detected', question: q });
    }

    const op = openerKey(firstSentence(a));
    if (op) {
      const list = openers.get(op) || [];
      list.push(q);
      openers.set(op, list);
    }
    const cl = openerKey(lastSentence(a));
    if (cl) {
      const list = closings.get(cl) || [];
      list.push(q);
      closings.set(cl, list);
    }
  }

  for (const [op, qs] of openers) {
    if (qs.length > 1) {
      issues.push({
        code: 'repeated_opener',
        message: `Repeated sentence opener "${op}" across ${qs.length} answers`,
        question: qs[0],
      });
    }
  }
  for (const [cl, qs] of closings) {
    if (qs.length > 1) {
      issues.push({
        code: 'repeated_closing',
        message: `Repeated closing "${cl}" across ${qs.length} answers`,
        question: qs[0],
      });
    }
  }

  // Soft uniqueness: CityCost sentence bodies (not required closings)
  const cityCostLines = items
    .map((i) => (i.a.match(/[^.!?]*citycost[^.!?]*/i) || [])[0] || '')
    .map((s) => openerKey(s))
    .filter(Boolean);
  const cityCostUniq = new Set(cityCostLines);
  if (cityCostLines.length >= 4 && cityCostUniq.size < Math.ceil(cityCostLines.length * 0.5)) {
    issues.push({
      code: 'repeated_citycost_wording',
      message: 'CityCost references reuse the same wording too often',
    });
  }

  const critical = issues.filter((i) =>
    ['faq_min_6', 'empty_faq', 'banned_phrase', 'repeated_opener', 'repeated_closing'].includes(
      i.code
    )
  );

  const openerDupes = [...openers.values()].filter((v) => v.length > 1).length;
  const closingDupes = [...closings.values()].filter((v) => v.length > 1).length;

  const human = Math.max(
    0,
    96 - bannedHits * 18 - openerDupes * 12 - closingDupes * 10 - fillerHits * 6
  );
  const helpful = Math.max(0, 94 - bannedHits * 14 - lengthFails * 4 - openerDupes * 8);
  const readability = Math.max(0, 82 - lengthFails * 5 - fillerHits * 4);
  const intent = Math.max(0, 96 - (items.length < 6 ? 20 : 0) - lengthFails * 3);

  return {
    ok: critical.length === 0 && bannedHits === 0 && openerDupes === 0,
    issues,
    scores: {
      human_writing: human,
      helpful_content: helpful,
      readability,
      search_intent: intent,
    },
  };
}
