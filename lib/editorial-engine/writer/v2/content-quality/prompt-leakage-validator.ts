/**
 * Prompt leakage validator — reject instruction / planning vocabulary in prose.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import { isProtectedBlock } from '../block-integrity.js';
import { detectPromptLeakage, stripPromptLeakage } from '../../prompt-leakage.js';
import { draftBodyText } from '../../../reviewer/text-utils.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';

/** Extra leakage phrases beyond HARD_LEAKAGE (instruction scaffolding). */
export const CQ_LEAKAGE_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /\brequired h2\b/i, code: 'required_h2' },
  { re: /\bresearch says\b/i, code: 'research_says' },
  { re: /\b\bprompt\b:/i, code: 'prompt_label' },
  { re: /\boutline:\b/i, code: 'outline_label' },
  { re: /\bsystem:\b/i, code: 'system_label' },
  { re: /\bplanning note\b/i, code: 'planning_note' },
  { re: /\bexpand section\b/i, code: 'expand_section' },
  { re: /\bresearch pack\b/i, code: 'research_pack' },
  { re: /\baverage cost index\b/i, code: 'average_cost_index' },
  { re: /\bindexed averages\b/i, code: 'indexed_averages' },
  { re: /\breturn json\b/i, code: 'return_json' },
  { re: /\bjson\s*\{/i, code: 'json_blob' },
  { re: /\byou are a (?:helpful|senior) (?:writer|assistant)\b/i, code: 'system_role' },
  { re: /\bdo not invent (?:statistics|numbers)\b/i, code: 'do_not_invent' },
  { re: /\bsection brief\b/i, code: 'section_brief' },
  { re: /\bwriter engine\b/i, code: 'writer_engine' },
];

function stripCqLeakageFromString(text: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  let working = text;
  // Phrase-level scrub for scaffolding labels that may not form full sentences
  for (const p of CQ_LEAKAGE_PATTERNS) {
    if (p.re.test(working)) {
      hits.push(p.code);
      working = working.replace(p.re, ' ');
    }
    p.re.lastIndex = 0;
  }
  const parts = working.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const sentence of parts) {
    let bad = false;
    for (const p of CQ_LEAKAGE_PATTERNS) {
      if (p.re.test(sentence)) {
        hits.push(p.code);
        bad = true;
        break;
      }
      p.re.lastIndex = 0;
    }
    const hard = detectPromptLeakage(sentence);
    if (hard.length) {
      hits.push(...hard);
      bad = true;
    }
    if (!bad && sentence.replace(/\s+/g, ' ').trim().length > 0) kept.push(sentence.trim());
  }
  return { text: kept.join(' ').replace(/\s+/g, ' ').trim(), hits: [...new Set(hits)] };
}

export function validateAndStripPromptLeakage(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  leakage_removed: number;
} {
  // First pass: shared stripper
  const stripped = stripPromptLeakage(draft);
  let next = stripped.draft;
  const findings: ValidatorFinding[] = [];
  let leakage_removed = stripped.removed;

  for (const h of stripped.hits) {
    findings.push({
      code: `hard_leak:${h}`,
      message: `Removed leakage phrase: ${h}`,
      severity: 'warn',
    });
  }

  const blocks = (next.blocks || []).map((b) => {
    if (typeof b.content === 'string') {
      const r = stripCqLeakageFromString(b.content);
      if (r.hits.length) {
        leakage_removed += r.hits.length;
        for (const code of r.hits) {
          findings.push({
            code,
            message: `Removed prompt leakage (${code})`,
            severity: 'warn',
            location: b.id,
          });
        }
        return { ...b, content: r.text };
      }
    }
    if (b.type === 'faq' && Array.isArray(b.content)) {
      const items = b.content.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const o = { ...(item as Record<string, unknown>) };
        for (const key of ['a', 'answer', 'q', 'question'] as const) {
          if (typeof o[key] === 'string') {
            const r = stripCqLeakageFromString(o[key] as string);
            if (r.hits.length) {
              leakage_removed += r.hits.length;
              o[key] = r.text;
            }
          }
        }
        return o;
      });
      return { ...b, content: items };
    }
    void isProtectedBlock;
    return b;
  });

  // Drop emptied leaky paragraphs (keep headings/lists)
  const cleanedBlocks = blocks.filter((b) => {
    if (typeof b.content === 'string' && b.type === 'paragraph') {
      return b.content.trim().length > 0;
    }
    return true;
  });

  next = { ...next, blocks: cleanedBlocks };

  // Residual detection — aggressive second strip if anything remains
  let body = draftBodyText(next);
  for (const p of CQ_LEAKAGE_PATTERNS) {
    if (p.re.test(body)) {
      next = {
        ...next,
        blocks: (next.blocks || []).map((b) => {
          if (typeof b.content !== 'string') return b;
          const r = stripCqLeakageFromString(b.content);
          return r.hits.length ? { ...b, content: r.text } : b;
        }),
      };
      break;
    }
  }
  body = draftBodyText(next);
  const residualHits: string[] = [];
  for (const p of CQ_LEAKAGE_PATTERNS) {
    if (p.re.test(body)) residualHits.push(p.code);
  }
  residualHits.push(...detectPromptLeakage(body));

  const uniqueResidual = [...new Set(residualHits)];
  for (const code of uniqueResidual) {
    findings.push({
      code: `residual:${code}`,
      message: `Residual leakage: ${code}`,
      severity: 'error',
    });
  }

  const score = uniqueResidual.length ? Math.max(0, 25 - uniqueResidual.length * 8) : Math.max(85, 100 - leakage_removed);
  return {
    draft: next,
    leakage_removed,
    result: {
      category: 'prompt_leakage',
      status: uniqueResidual.length ? 'FAIL' : 'PASS',
      score,
      findings,
      repaired: leakage_removed,
    },
  };
}
