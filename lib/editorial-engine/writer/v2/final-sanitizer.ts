/**
 * Writer Final Sanitizer — last pass before Quality Audit / save.
 * Sentence · Paragraph · Numeric · Formatting integrity; auto-repair on fail.
 * Preserves protected structure (callers re-apply block integrity).
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import { isProtectedBlock } from './block-integrity.js';
import { blockPlain } from './content-quality/text-metrics.js';
import type { ValidatorFinding, ValidatorResult } from './content-quality/types.js';
import { statusFromScore } from './content-quality/score.js';

export type SanitizerCategory =
  | 'sentence_integrity'
  | 'paragraph_integrity'
  | 'numeric_sanity'
  | 'formatting';

export interface SanitizerSubResult {
  category: SanitizerCategory;
  ok: boolean;
  repaired: number;
  findings: ValidatorFinding[];
}

export interface FinalSanitizerReport {
  sentence: SanitizerSubResult;
  paragraph: SanitizerSubResult;
  numeric: SanitizerSubResult;
  formatting: SanitizerSubResult;
  total_repaired: number;
  ok: boolean;
}

function mapStringContent(
  draft: WriterDraftPayload,
  fn: (text: string, block: DraftBlock) => { text: string; repaired: number; findings: ValidatorFinding[] },
  opts?: { touchProtected?: boolean }
): { draft: WriterDraftPayload; repaired: number; findings: ValidatorFinding[] } {
  let repaired = 0;
  const findings: ValidatorFinding[] = [];
  const blocks = (draft.blocks || []).map((b) => {
    if (isProtectedBlock(b) && !opts?.touchProtected && b.type !== 'intro' && b.type !== 'summary') {
      if (b.type === 'faq' && Array.isArray(b.content)) {
        const next = b.content.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const o = { ...(item as Record<string, unknown>) };
          for (const key of ['a', 'answer', 'q', 'question'] as const) {
            if (typeof o[key] === 'string') {
              const r = fn(o[key] as string, b);
              o[key] = r.text;
              repaired += r.repaired;
              findings.push(...r.findings);
            }
          }
          return o;
        });
        return { ...b, content: next };
      }
      return b;
    }
    if (typeof b.content === 'string') {
      const r = fn(b.content, b);
      repaired += r.repaired;
      findings.push(...r.findings);
      return { ...b, content: r.text };
    }
    if (Array.isArray(b.content) && b.type === 'list') {
      let listRepaired = 0;
      const items = b.content.map((item) => {
        if (typeof item !== 'string') return item;
        const r = fn(item, b);
        listRepaired += r.repaired;
        findings.push(...r.findings);
        return r.text;
      });
      repaired += listRepaired;
      return { ...b, content: items };
    }
    return b;
  });
  return { draft: { ...draft, blocks }, repaired, findings };
}

/** SentenceIntegrityValidator — punctuation, fragments, duplicated periods. */
export function validateSentenceIntegrity(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: SanitizerSubResult;
} {
  const findings: ValidatorFinding[] = [];
  let repaired = 0;

  const out = mapStringContent(draft, (text, block) => {
    let t = text;
    let local = 0;
    const before = t;
    t = t.replace(/\.{2,}/g, '.');
    t = t.replace(/!{2,}/g, '!');
    t = t.replace(/\?{2,}/g, '?');
    t = t.replace(/,\./g, '.');
    t = t.replace(/\.,/g, '.');
    t = t.replace(/\s+([,.!?;:])/g, '$1');
    t = t.replace(/([.!?;:])\1+/g, '$1');
    // Fix broken "word . Word"
    t = t.replace(/\s+\./g, '.');
    t = t.replace(/([.!?]\s*)\1+/g, '$1');
    // Lone connectors / fragments at start
    t = t.replace(/^\s*(and|or|but|then|also)\s+/i, '');
    // Capitalize after sentence end
    t = t.replace(/([.!?]\s+)([a-z])/g, (_m, a, b) => `${a}${b.toUpperCase()}`);
    // Ensure paragraph-like strings end with sentence punct if long
    if (t.length > 40 && !/[.!?]"?$/.test(t.trim()) && !/^[-*]/.test(t.trim())) {
      t = `${t.trim()}.`;
      local += 1;
    }
    t = t.replace(/\s{2,}/g, ' ').trim();
    if (t !== before) {
      local += 1;
      findings.push({
        code: 'sentence_repaired',
        message: 'Repaired sentence punctuation/integrity',
        severity: 'warn',
        location: block.id,
      });
    }
    repaired += local;
    return { text: t, repaired: local, findings: [] };
  }, { touchProtected: true });

  repaired += out.repaired;
  findings.push(...out.findings);

  // Residual scan
  let residual = 0;
  for (const b of out.draft.blocks || []) {
    const plain = blockPlain(b);
    if (/\.\./.test(plain) || /,\./.test(plain) || /\.,/.test(plain)) residual += 1;
  }

  return {
    draft: out.draft,
    result: {
      category: 'sentence_integrity',
      ok: residual === 0,
      repaired,
      findings:
        residual > 0
          ? [
              ...findings,
              {
                code: 'residual_sentence_corruption',
                message: `${residual} block(s) still fail sentence integrity`,
                severity: 'error',
              },
            ]
          : findings,
    },
  };
}

/** ParagraphIntegrityValidator — empty paragraphs, duplicated headings, orphan blocks. */
export function validateParagraphIntegrity(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: SanitizerSubResult;
} {
  const findings: ValidatorFinding[] = [];
  let repaired = 0;
  const blocks = [...(draft.blocks || [])];
  const seenHeadings = new Map<string, number>();
  const keep: DraftBlock[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b) continue;

    // Empty paragraphs
    if (
      (b.type === 'paragraph' || b.type === 'tip' || b.type === 'warning') &&
      typeof b.content === 'string' &&
      !b.content.trim()
    ) {
      repaired += 1;
      findings.push({
        code: 'empty_paragraph_removed',
        message: 'Removed empty paragraph',
        severity: 'warn',
        location: b.id,
      });
      continue;
    }

    // Empty list
    if (b.type === 'list' && Array.isArray(b.content)) {
      const items = b.content.filter((x) => typeof x === 'string' && x.trim());
      if (!items.length && !isProtectedBlock(b)) {
        repaired += 1;
        findings.push({
          code: 'empty_list_removed',
          message: 'Removed empty list',
          severity: 'warn',
          location: b.id,
        });
        continue;
      }
      if (items.length !== b.content.length) {
        repaired += 1;
        keep.push({ ...b, content: items });
        continue;
      }
    }

    // Duplicated headings (body only)
    if (b.type === 'heading' && b.heading) {
      const key = String(b.heading).trim().toLowerCase();
      const prev = seenHeadings.get(key);
      if (prev !== undefined) {
        repaired += 1;
        findings.push({
          code: 'duplicate_heading',
          message: `Deduped heading "${b.heading}"`,
          severity: 'warn',
          location: b.id,
        });
        // Keep first; skip duplicate heading block
        continue;
      }
      seenHeadings.set(key, i);
    }

    keep.push(b);
  }

  // Orphan: body content with no preceding heading after TOC — soft; leave
  // Orphan tip/warning with empty siblings already handled

  // Collapse consecutive duplicate paragraph fingerprints
  const final: DraftBlock[] = [];
  let lastFp = '';
  for (const b of keep) {
    if (typeof b.content === 'string' && (b.type === 'paragraph' || b.type === 'tip')) {
      const fp = b.content.slice(0, 120).toLowerCase().replace(/\s+/g, ' ');
      if (fp && fp === lastFp && !isProtectedBlock(b)) {
        repaired += 1;
        findings.push({
          code: 'duplicate_paragraph_removed',
          message: 'Removed consecutive duplicate paragraph',
          severity: 'warn',
          location: b.id,
        });
        continue;
      }
      lastFp = fp;
    } else {
      lastFp = '';
    }
    final.push(b);
  }

  return {
    draft: { ...draft, blocks: final },
    result: {
      category: 'paragraph_integrity',
      ok: true,
      repaired,
      findings,
    },
  };
}

/** NumericSanityValidator — impossible numerics, malformed indexes. */
export function validateNumericSanity(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: SanitizerSubResult;
} {
  const findings: ValidatorFinding[] = [];
  let repaired = 0;

  const out = mapStringContent(draft, (text, block) => {
    let t = text;
    let local = 0;

    // Malformed index: "Index: ." or "Index  " without number
    const badIndex = t.replace(
      /\b((?:cost|rent|grocery|restaurant|transport|quality of life|safety|health care|cpi|col)\s+index)\s*[:=]?\s*(?:\.|,)?(?!\s*\d)/gi,
      (_m, label) => {
        local += 1;
        findings.push({
          code: 'malformed_index',
          message: `Softened malformed index reference (${label})`,
          severity: 'warn',
          location: block.id,
        });
        return `${label} (confirm locally)`;
      }
    );
    t = badIndex;

    // Impossible percentages > 1000% or negative display glitches like "--50%"
    t = t.replace(/(\d{4,})\s*%/g, (_m, n) => {
      local += 1;
      findings.push({
        code: 'impossible_percent',
        message: `Softened impossible percentage ${n}%`,
        severity: 'warn',
        location: block.id,
      });
      return 'a high share';
    });

    // Doubled currency / broken "$$" or "USD USD"
    t = t.replace(/\$\$+/g, '$');
    t = t.replace(/\b(USD|EUR|GBP|INR|CAD|AUD)\s+\1\b/gi, '$1');

    // Numbers with multiple decimals: 12.34.56 → 12.34
    t = t.replace(/\b(\d+)\.(\d+)\.(\d+)\b/g, (_m, a, b) => {
      local += 1;
      findings.push({
        code: 'malformed_number',
        message: 'Repaired multi-decimal number',
        severity: 'warn',
        location: block.id,
      });
      return `${a}.${b}`;
    });

    // "NaN" / "undefined" / "Infinity" leaks
    if (/\b(NaN|undefined|Infinity)\b/.test(t)) {
      t = t.replace(/\b(NaN|undefined|Infinity)\b/g, 'an unavailable figure');
      local += 1;
      findings.push({
        code: 'numeric_leak',
        message: 'Removed NaN/undefined/Infinity leak',
        severity: 'error',
        location: block.id,
      });
    }

    repaired += local;
    return { text: t, repaired: local, findings: [] };
  }, { touchProtected: true });

  // Residual
  const blob = (out.draft.blocks || []).map(blockPlain).join('\n');
  const residual =
    /\b(NaN|undefined|Infinity)\b/.test(blob) ||
    /\d+\.\d+\.\d+/.test(blob) ||
    /\d{5,}\s*%/.test(blob);

  return {
    draft: out.draft,
    result: {
      category: 'numeric_sanity',
      ok: !residual,
      repaired: repaired + out.repaired,
      findings: residual
        ? [
            ...findings,
            ...out.findings,
            {
              code: 'residual_numeric',
              message: 'Residual numeric sanity issues',
              severity: 'error',
            },
          ]
        : [...findings, ...out.findings],
    },
  };
}

/** FormattingValidator — broken markdown/HTML, orphan brackets, empty links. */
export function validateFormatting(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: SanitizerSubResult;
} {
  const findings: ValidatorFinding[] = [];
  let repaired = 0;

  const out = mapStringContent(draft, (text, block) => {
    let t = text;
    let local = 0;
    const before = t;

    t = t.replace(/<\/?(?:script|style|iframe)[^>]*>/gi, '');
    t = t.replace(/<\/?(?:div|span|p|br|hr|strong|em|b|i|ul|ol|li)\b[^>]*>/gi, ' ');
    t = t.replace(/\[([^\]]*)\]\(\s*\)/g, '$1');
    t = t.replace(/\[([^\]]*)\]\(([^)\s]*)\s+[^)]*\)/g, '[$1]($2)');
    // Unbalanced markdown bold/italic markers (simple)
    const stars = (t.match(/\*/g) || []).length;
    if (stars % 2 === 1) {
      t = t.replace(/\*$/, '');
      local += 1;
    }
    // Orphan brackets
    t = t.replace(/\[\s*\]/g, '');
    t = t.replace(/\(\s*\)/g, '');
    // Stray HTML entities doubled
    t = t.replace(/&amp;amp;/g, '&amp;');
    t = t.replace(/\s{2,}/g, ' ').trim();

    if (t !== before) {
      local += 1;
      findings.push({
        code: 'formatting_repaired',
        message: 'Repaired broken markdown/HTML/formatting',
        severity: 'warn',
        location: block.id,
      });
    }
    repaired += local;
    return { text: t, repaired: local, findings: [] };
  }, { touchProtected: true });

  const blob = (out.draft.blocks || []).map(blockPlain).join('\n');
  const residual =
    /<\/?(?:div|span|script|p)\b/i.test(blob) ||
    /\[[^\]]*\]\(\s*\)/.test(blob);

  return {
    draft: out.draft,
    result: {
      category: 'formatting',
      ok: !residual,
      repaired: repaired + out.repaired,
      findings: residual
        ? [
            ...findings,
            ...out.findings,
            {
              code: 'residual_formatting',
              message: 'Residual formatting issues',
              severity: 'error',
            },
          ]
        : [...findings, ...out.findings],
    },
  };
}

/**
 * Run all Final Sanitizer validators with auto-repair.
 * Order: paragraph → sentence → numeric → formatting (structure first, polish last).
 */
export function runFinalSanitizer(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  report: FinalSanitizerReport;
  /** CQ-compatible validator results */
  validators: ValidatorResult[];
} {
  let working = draft;

  const paragraph = validateParagraphIntegrity(working);
  working = paragraph.draft;

  const sentence = validateSentenceIntegrity(working);
  working = sentence.draft;

  const numeric = validateNumericSanity(working);
  working = numeric.draft;

  const formatting = validateFormatting(working);
  working = formatting.draft;

  const subs = [sentence.result, paragraph.result, numeric.result, formatting.result];
  const ok = subs.every((s) => s.ok);
  const total_repaired = subs.reduce((a, s) => a + s.repaired, 0);

  const validators: ValidatorResult[] = subs.map((s) => ({
    category:
      s.category === 'sentence_integrity'
        ? 'sentence_integrity'
        : s.category === 'paragraph_integrity'
          ? 'paragraph_integrity'
          : s.category === 'numeric_sanity'
            ? 'numeric_sanity'
            : 'formatting_integrity',
    status: s.ok ? statusFromScore(100 - Math.min(20, s.repaired), false, s.repaired > 0) : 'FAIL',
    score: s.ok ? Math.max(80, 100 - s.repaired) : 30,
    findings: s.findings,
    repaired: s.repaired,
  }));

  return {
    draft: working,
    report: {
      sentence: sentence.result,
      paragraph: paragraph.result,
      numeric: numeric.result,
      formatting: formatting.result,
      total_repaired,
      ok,
    },
    validators,
  };
}

export function formatFinalSanitizerDebug(report: FinalSanitizerReport): string {
  return [
    `ok=${report.ok ? 'yes' : 'no'}`,
    `repaired=${report.total_repaired}`,
    `sentence=${report.sentence.ok ? 'pass' : 'fail'}`,
    `paragraph=${report.paragraph.ok ? 'pass' : 'fail'}`,
    `numeric=${report.numeric.ok ? 'pass' : 'fail'}`,
    `formatting=${report.formatting.ok ? 'pass' : 'fail'}`,
  ].join(';');
}
