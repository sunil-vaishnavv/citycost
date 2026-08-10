/**
 * Sentence repair — punctuation, spacing, fragments, broken markdown/HTML/links.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import { isProtectedBlock } from '../block-integrity.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';

const BROKEN_PATTERNS: Array<{ re: RegExp; fix: (m: string, ...args: string[]) => string; code: string }> = [
  { re: /\s{2,}/g, fix: () => ' ', code: 'double_space' },
  { re: /\s+([,.!?;:])/g, fix: (_m, p) => p, code: 'space_before_punct' },
  { re: /([,.!?;:]){2,}/g, fix: (m) => m[0], code: 'repeated_punct' },
  { re: /\.\s*and\b/gi, fix: () => ', and', code: 'period_and' },
  { re: /\.\s*or\b/gi, fix: () => ', or', code: 'period_or' },
  { re: /\.\s*then\b/gi, fix: () => ', then', code: 'period_then' },
  { re: /,\./g, fix: () => '.', code: 'comma_period' },
  { re: /\.,/g, fix: () => '.', code: 'period_comma' },
  { re: /\n{3,}/g, fix: () => '\n\n', code: 'excess_breaks' },
  { re: /<\/?(?:script|style|iframe)[^>]*>/gi, fix: () => '', code: 'dangerous_html' },
  { re: /<([^>]+)>/g, fix: (m, inner) => {
      if (/^(br|hr)\s*\/?$/i.test(inner)) return ' ';
      if (/^\/?(p|div|span|strong|em|b|i|ul|ol|li)\b/i.test(inner)) return ' ';
      return m;
    }, code: 'html_tags' },
  { re: /\[([^\]]*)\]\(\s*\)/g, fix: (_m, label) => label, code: 'empty_link' },
  { re: /\[([^\]]*)\]\(([^)\s]*)\s+[^)]*\)/g, fix: (_m, label, url) => `[${label}](${url})`, code: 'broken_md_link' },
  { re: /\(\s*\)/g, fix: () => '', code: 'empty_parens' },
  { re: /\b(\w+)\s+\1\b/gi, fix: (_m, w) => w, code: 'doubled_word' },
];

function repairString(input: string): { text: string; fixes: number; codes: string[] } {
  let text = input;
  let fixes = 0;
  const codes: string[] = [];
  for (const p of BROKEN_PATTERNS) {
    const before = text;
    text = text.replace(p.re, (...args) => {
      fixes += 1;
      codes.push(p.code);
      return p.fix(args[0], ...(args.slice(1) as string[]));
    });
    if (text === before && p.re.test(before)) {
      // some replaces are no-ops after first pass
    }
    p.re.lastIndex = 0;
  }
  // Fix "word . Word" → "word. Word"
  text = text.replace(/\s+\./g, '.');
  // Capitalize after sentence end
  text = text.replace(/([.!?]\s+)([a-z])/g, (_m, a, b) => `${a}${b.toUpperCase()}`);
  // Fragments: lone connectors
  text = text.replace(/^\s*(and|or|but|then)\s+/i, '');
  text = text.replace(/\s{2,}/g, ' ').trim();
  return { text, fixes, codes };
}

function looksCorrupted(s: string): boolean {
  return (
    /\.\s*(and|or|then)\b/i.test(s) ||
    /\s{2,}/.test(s) ||
    /,\./.test(s) ||
    /\.,/.test(s) ||
    /\(\s*\)/.test(s) ||
    /\[[^\]]*\]\(\s*\)/.test(s) ||
    /<\/?(?:div|span|p|script)\b/i.test(s)
  );
}

export function repairSentences(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  repaired: number;
} {
  const findings: ValidatorFinding[] = [];
  let repaired = 0;
  const blocks = (draft.blocks || []).map((b) => {
    if (isProtectedBlock(b) && b.type !== 'intro' && b.type !== 'summary') {
      // Still repair FAQ answer strings for corruption; TOC lists left alone
      if (b.type === 'faq' && Array.isArray(b.content)) {
        const next = b.content.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const o = { ...(item as Record<string, unknown>) };
          for (const key of ['a', 'answer', 'q', 'question'] as const) {
            if (typeof o[key] === 'string' && looksCorrupted(o[key] as string)) {
              const r = repairString(o[key] as string);
              o[key] = r.text;
              repaired += r.fixes;
              findings.push({
                code: 'faq_sentence_repair',
                message: `Repaired FAQ ${key}`,
                severity: 'warn',
                location: b.id,
              });
            }
          }
          return o;
        });
        return { ...b, content: next };
      }
      return b;
    }
    if (typeof b.content !== 'string') return b;
    if (!looksCorrupted(b.content) && !/\s{2,}|,\.|\.,/.test(b.content)) {
      // light normalize always
      const light = b.content.replace(/\s{2,}/g, ' ').trim();
      if (light !== b.content) {
        repaired += 1;
        return { ...b, content: light };
      }
      return b;
    }
    const r = repairString(b.content);
    if (r.fixes || r.text !== b.content) {
      repaired += Math.max(1, r.fixes);
      for (const c of [...new Set(r.codes)].slice(0, 4)) {
        findings.push({
          code: c,
          message: `Repaired ${c}`,
          severity: 'warn',
          location: b.id,
        });
      }
      return { ...b, content: r.text };
    }
    return b;
  });

  // Residual corruption scan (body + intro/summary)
  let residual = 0;
  for (const b of blocks) {
    if (typeof b.content !== 'string') continue;
    if (looksCorrupted(b.content)) residual += 1;
  }

  const score = residual > 0 ? Math.max(0, 35 - residual * 10) : Math.max(80, 100 - findings.length);
  return {
    draft: { ...draft, blocks },
    repaired,
    result: {
      category: 'broken_sentences',
      status: residual > 0 ? 'FAIL' : statusFromScore(score, false, findings.length > 0),
      score: residual > 0 ? score : Math.max(score, 85),
      findings:
        residual > 0
          ? [
              ...findings,
              {
                code: 'residual_corruption',
                message: `${residual} block(s) still corrupted`,
                severity: 'error',
              },
            ]
          : findings,
      repaired,
    },
  };
}
