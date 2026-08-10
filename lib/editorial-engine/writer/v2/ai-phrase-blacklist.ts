/**
 * AI Phrase Blacklist + Human Writing Detector — common AI openings/endings/transitions.
 * Detect and rewrite automatically; guide-aware tone; no city hardcoding.
 */

import type { GuideId } from './types.js';

export interface AiPhraseRule {
  id: string;
  /** Match against full paragraph or sentence start */
  re: RegExp;
  /** Replacement (empty = strip) */
  replacement: string;
  kind: 'opening' | 'transition' | 'ending' | 'filler' | 'cliche';
}

/** Common AI openings / endings / transitions — rewrite automatically. */
export const AI_PHRASE_BLACKLIST: AiPhraseRule[] = [
  // Openings
  { id: 'common_mistake_open', re: /^a common mistake(?:\s+is|\s+people|\s+when)?\b[:,]?\s*/i, replacement: 'Watch for this: ', kind: 'opening' },
  { id: 'when_evaluating', re: /^when evaluating\b[:,]?\s*/i, replacement: 'When you weigh ', kind: 'opening' },
  { id: 'when_it_comes', re: /\bwhen it comes to\b/gi, replacement: 'for', kind: 'cliche' },
  { id: 'in_this_guide', re: /^in this (?:article|guide|section),?\s+we (?:will|shall) (?:explore|discuss|cover)\b[:,]?\s*/i, replacement: 'Here is what matters: ', kind: 'opening' },
  { id: 'it_is_important', re: /\bit(?:'s| is) important to(?: note(?: that)?| (?:understand|remember|consider))?\b[:,]?\s*/gi, replacement: '', kind: 'filler' },
  { id: 'it_is_worth_noting', re: /\bit is worth (?:noting|mentioning)(?: that)?\b[:,]?\s*/gi, replacement: '', kind: 'filler' },
  { id: 'as_mentioned', re: /^as (?:mentioned|noted|discussed)(?: earlier| above)?\b[:,]?\s*/i, replacement: '', kind: 'opening' },
  { id: 'lets_dive', re: /^let'?s (?:dive|delve) (?:in|into)\b[:,]?\s*/i, replacement: 'Start with ', kind: 'opening' },
  { id: 'in_todays_world', re: /\bin today(?:'s|s) (?:fast-paced )?world\b/gi, replacement: 'today', kind: 'cliche' },
  { id: 'navigating_landscape', re: /\bnavigating the (?:complex )?landscape\b/gi, replacement: 'handling', kind: 'cliche' },
  // Transitions
  { id: 'additionally', re: /^(?:additionally|furthermore|moreover|in addition),?\s+/i, replacement: 'Also, ', kind: 'transition' },
  { id: 'on_the_other_hand', re: /^on the other hand,?\s+/i, replacement: 'By contrast, ', kind: 'transition' },
  { id: 'that_said', re: /^that said,?\s+/i, replacement: 'Still, ', kind: 'transition' },
  { id: 'moving_on', re: /^moving on(?: to the next (?:point|section))?,?\s*/i, replacement: '', kind: 'transition' },
  { id: 'in_conclusion', re: /\bin conclusion,?\s*/gi, replacement: '', kind: 'ending' },
  // Endings
  { id: 'ultimately', re: /\bultimately,?\s+/gi, replacement: 'In practice, ', kind: 'ending' },
  { id: 'at_the_end', re: /\bat the end of the day\b/gi, replacement: 'in practice', kind: 'ending' },
  { id: 'all_in_all', re: /\ball in all,?\s*/gi, replacement: '', kind: 'ending' },
  { id: 'needless_to_say', re: /\bneedless to say,?\s*/gi, replacement: '', kind: 'filler' },
  // Cliches
  { id: 'tapestry', re: /\ba tapestry of\b/gi, replacement: 'a mix of', kind: 'cliche' },
  { id: 'dive_deep', re: /\bdive deep into\b/gi, replacement: 'examine', kind: 'cliche' },
  { id: 'delve', re: /\bdelve into\b/gi, replacement: 'look at', kind: 'cliche' },
  { id: 'leverage', re: /\bleverage\b/gi, replacement: 'use', kind: 'cliche' },
  { id: 'robust', re: /\brobust\b/gi, replacement: 'solid', kind: 'cliche' },
  { id: 'seamless', re: /\bseamless(?:ly)?\b/gi, replacement: 'smooth', kind: 'cliche' },
  { id: 'unlock', re: /\bunlock the potential of\b/gi, replacement: 'get more from', kind: 'cliche' },
  { id: 'gamechanger', re: /\bgame-?changer\b/gi, replacement: 'big shift', kind: 'cliche' },
  { id: 'holistic', re: /\bholistic approach\b/gi, replacement: 'practical approach', kind: 'cliche' },
  { id: 'comprehensive_guide', re: /\bcomprehensive (?:guide|overview) to\b/gi, replacement: 'guide to', kind: 'cliche' },
  { id: 'as_an_ai', re: /\bas an ai\b/gi, replacement: '', kind: 'filler' },
  { id: 'journey', re: /\byour (?:cost of living |relocation )?journey\b/gi, replacement: 'your move', kind: 'cliche' },
  { id: 'nestled', re: /\bnestled (?:in|between)\b/gi, replacement: 'in', kind: 'cliche' },
  { id: 'plethora', re: /\bplethora of\b/gi, replacement: 'many', kind: 'cliche' },
  { id: 'paramount', re: /\bis paramount\b/gi, replacement: 'matters most', kind: 'cliche' },
  { id: 'crucial_to', re: /\bit is crucial to\b/gi, replacement: 'you should', kind: 'filler' },
  { id: 'vital_to', re: /\bit is vital to\b/gi, replacement: 'you should', kind: 'filler' },
];

const GUIDE_TONE: Partial<Record<GuideId, string>> = {
  comparison: 'direct and comparative',
  salary: 'numbers-first and residual-focused',
  rent: 'checklist-heavy and deposit-aware',
  visa: 'timeline-aware and fee-cautious',
  student: 'term-aware and shared-housing practical',
  retirement: 'stability-first and healthcare-aware',
  remote: 'connectivity and residency-day aware',
  budget: 'fixed-vs-flexible and cut-order clear',
  healthcare: 'access-first and cover-decision clear',
  moving: 'first-two-weeks cash aware',
  food: 'kitchen-routine and week-one spike aware',
  travel: 'trip vs living cost split',
  city: 'neighbourhood-tradeoff practical',
  country: 'regional-baseline practical',
};

/** Strip / rewrite AI phrases in a string. */
export function applyAiPhraseBlacklist(text: string): {
  text: string;
  hits: string[];
} {
  let out = text;
  const hits: string[] = [];
  for (const rule of AI_PHRASE_BLACKLIST) {
    if (rule.re.test(out)) {
      hits.push(rule.id);
      out = out.replace(rule.re, rule.replacement);
    }
    rule.re.lastIndex = 0;
  }
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  // Capitalize start after strip
  if (out && /^[a-z]/.test(out)) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return { text: out, hits };
}

/** True if residual blacklist phrases remain. */
export function detectAiPhrases(text: string): string[] {
  const hits: string[] = [];
  for (const rule of AI_PHRASE_BLACKLIST) {
    if (rule.re.test(text)) hits.push(rule.id);
    rule.re.lastIndex = 0;
  }
  return hits;
}

/**
 * Vary sentence/paragraph rhythm: inject an occasional short sentence,
 * break monotonous medium-medium-medium patterns.
 */
export function varySentenceRhythm(text: string): { text: string; changed: boolean } {
  const parts = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return { text, changed: false };
  let changed = false;
  const lens = parts.map((s) => s.split(/\s+/).length);
  // If 3+ consecutive medium (10–22 words), split one long or insert short beat
  for (let i = 0; i < lens.length - 2; i++) {
    const med = (n: number) => n >= 10 && n <= 22;
    if (med(lens[i]) && med(lens[i + 1]) && med(lens[i + 2])) {
      // Append a short observational beat after i+1 if not already short nearby
      const beat = observationalBeat(parts[i + 1]);
      if (beat && !parts[i + 1].includes(beat)) {
        parts[i + 1] = `${parts[i + 1]} ${beat}`;
        changed = true;
        break;
      }
    }
  }
  // Collapse identical adjacent openings
  for (let i = 1; i < parts.length; i++) {
    const a = parts[i - 1].split(/\s+/).slice(0, 4).join(' ').toLowerCase();
    const b = parts[i].split(/\s+/).slice(0, 4).join(' ').toLowerCase();
    if (a && a === b) {
      parts[i] = parts[i].replace(/^(\S+\s+){1,3}/, '').trim();
      if (parts[i] && /^[a-z]/.test(parts[i])) {
        parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
      }
      changed = true;
    }
  }
  return { text: parts.filter(Boolean).join(' '), changed };
}

function observationalBeat(nearby: string): string {
  if (/\b(check|confirm|decide|compare)\b/i.test(nearby)) return 'That check is usually worth it.';
  if (/\b(rent|deposit|housing)\b/i.test(nearby)) return 'Cash timing matters here.';
  if (/\b(salary|take-?home|net)\b/i.test(nearby)) return 'Net pay is the real constraint.';
  if (/\b(visa|permit)\b/i.test(nearby)) return 'Timing often costs more than fees.';
  return 'Keep the decision concrete.';
}

/** Natural transition starters rotated to avoid repetitive paragraph structure. */
const NATURAL_TRANSITIONS = [
  'From there,',
  'In practice,',
  'One useful check:',
  'Before you commit,',
  'A sharper question:',
  'On the ground,',
  'If cash is tight,',
  'When quotes disagree,',
];

export function diversifyParagraphOpenings(
  paragraphs: string[]
): { paragraphs: string[]; changed: number } {
  const used = new Set<string>();
  let changed = 0;
  const out = paragraphs.map((p, i) => {
    const open = p.split(/\s+/).slice(0, 5).join(' ').toLowerCase();
    if (!open || !used.has(open)) {
      used.add(open);
      return p;
    }
    const starter = NATURAL_TRANSITIONS[i % NATURAL_TRANSITIONS.length];
    const rest = p.replace(/^[^.!?]*(?:[.!?]|$)\s*/, '') || p;
    changed += 1;
    used.add(starter.toLowerCase());
    return `${starter} ${rest}`.replace(/\s+/g, ' ').trim();
  });
  return { paragraphs: out, changed };
}

export function guideToneHint(guideId: GuideId): string {
  return GUIDE_TONE[guideId] || 'practical and decision-first';
}
