/**
 * Public content quality checks run in the final integrity gate:
 *  - generation-directive / prompt leakage ("quote them as given", "FACTS=", JSON stubs…)
 *  - semantic boilerplate repetition (same advice re-worded across sections / FAQ)
 *  - thin or empty H2 sections
 *  - FAQ answers that do not address their own question
 *  - unsupported category winners (no comparable evidence) and broad winner claims
 *
 * Repairs are subtractive only (remove the offending sentence / duplicate); nothing
 * is padded. What cannot be repaired is reported as a blocking finding.
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import type { CalculationLedger, LedgerCategory } from '../../research/comparison-ledger.js';
import { collectDraftText, mapDraftText, type TextLocation } from './prose-integrity.js';
import { renderedHeadingText, headingLevelOf } from './heading-integrity.js';

export interface ContentQualityFinding {
  code:
    | 'directive_leak'
    | 'repeated_boilerplate'
    | 'thin_section'
    | 'faq_off_topic'
    | 'faq_empty'
    | 'unsupported_category_winner'
    | 'unsupported_broad_claim';
  severity: 'error' | 'warning';
  message: string;
  location?: TextLocation | { blockId?: string };
}

/* ── Sentence utilities ───────────────────────────────────────────────── */

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(*[])/);
}

const STOP = new Set(
  'a an the and or but if then than that this these those to of in on for with by from at as is are was were be been being it its your you we our they their there here can could should would will may might do does did not no so such very more most less least about into over under per each every any some one two also just only still even what which who how when where why'.split(
    ' '
  )
);

function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[^a-z0-9$€£¥₹ ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

/** Light stemmer so re-worded boilerplate still matches ("averages" ≈ "average"). */
function stem(w: string): string {
  if (w.length <= 4) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3);
  if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/* ── 1. Directive / prompt leakage ────────────────────────────────────── */

const DIRECTIVE_PATTERNS: RegExp[] = [
  /\bfigures?\s+(?:below|above)\s+(?:are|is)\s+final\b/i,
  /\bquote\s+(?:them|these|those|it|the\s+(?:figures?|numbers?|values?))\s+(?:exactly\s+)?as\s+given\b/i,
  /\bdo\s+not\s+(?:compute|calculate|invent|derive)\s+(?:any\s+|other\s+|new\s+|additional\s+)?(?:differences?|figures?|numbers?|statistics|totals?)\b/i,
  /\bdo\s+not\s+state\s+one\b/i,
  /\bno\s+figure\s+available\b/i,
  /\bdata\s+gap:/i,
  /\b(?:evidence|writing)\s+rules?:/i,
  /\b(?:in|from|per|according\s+to)\s+(?:the\s+)?(?:facts\s+block|ledger|research\s+pack|data\s+digest|system\s+prompt|prompt|writer\s+brief|outline\s+brief)\b/i,
  /\b(?:LEDGER|SECTION_SO_FAR|NEED_WORDS|CONTENT_MEMORY|FACTS=|TITLE=|PURPOSE=|GUIDE=|PASS=)/,
  /\breturn\s+(?:only\s+)?(?:valid\s+)?JSON\b/i,
  /\{\s*"blocks"\s*:/,
  /"type"\s*:\s*"(?:paragraph|heading|intro|faq|summary)"/,
  /\bas an AI\b|\bI (?:cannot|can't) (?:browse|access|verify)\b|\bhere is (?:the|your) (?:section|article|rewritten|json|draft)\b/i,
  /\bcopy\s+(?:labels|notes|instructions)\b/i,
];

export function findDirectiveLeaks(text: string): string[] {
  const hits: string[] = [];
  for (const sentence of splitSentences(text || '')) {
    if (DIRECTIVE_PATTERNS.some((re) => re.test(sentence))) hits.push(sentence.trim().slice(0, 160));
  }
  return hits;
}

function removeSentences(text: string, drop: (s: string) => boolean): { text: string; removed: number } {
  let removed = 0;
  // Keep paragraph / list structure: work line by line.
  const out = text
    .split('\n')
    .map((line) => {
      if (/^\s*\|/.test(line)) return line; // markdown table row
      const parts = splitSentences(line);
      const kept = parts.filter((s) => {
        if (s.trim() && drop(s)) {
          removed += 1;
          return false;
        }
        return true;
      });
      return kept.join(' ');
    })
    .join('\n');
  return { text: removed ? out.replace(/[ \t]{2,}/g, ' ').trim() : text, removed };
}

/* ── 2. Unsupported claims ────────────────────────────────────────────── */

const CATEGORY_CUES: Array<[LedgerCategory, RegExp]> = [
  ['groceries', /\b(?:grocer(?:y|ies)|supermarket|food\s+(?:costs?|prices?|bills?|shopping|budget)|food\b)/i],
  ['restaurants', /\b(?:restaurants?|dining\s+out|eating\s+out|caf[eé]s?)\b/i],
  ['transport', /\b(?:transport|transit|commut\w*|fares?|public\s+transport|train|bus|metro)\b/i],
  ['utilities', /\b(?:utilit(?:y|ies)|electricity|energy\s+bills?|water\s+bills?|gas\s+bills?)\b/i],
  ['salary', /\b(?:salar(?:y|ies)|wages?|pay\s+packet|income)\b/i],
];
const WINNER_CUE =
  /\b(?:cheaper|less\s+expensive|more\s+affordable|better\s+value|lower\s+(?:prices?|costs?)|wins?|comes\s+out\s+ahead|has\s+the\s+edge|edges\s+out|undercuts?)\b/i;
const QUALIFIED = /\b(?:not\s+available|unavailable|no\s+comparable|can(?:not|'t)\s+(?:compare|say)|data\s+(?:is|are)\s+missing|lack(?:s|ing)?\s+(?:comparable\s+)?data|may|might|could|depends?)\b/i;
const BROAD_WINNER =
  /\b(?:is|remains|emerges\s+as|comes\s+out\s+as|stands\s+out\s+as)\s+(?:the\s+)?(?:clear|overall|outright|undisputed|obvious|definitive)\s+(?:winner|choice|best\s+(?:city|choice|option|place))\b|\b(?:wins|wins\s+out)\s+(?:overall|outright|hands\s+down|across\s+the\s+board|on\s+every\s+front)\b|\bbetter\s+(?:city|place)\s+(?:to\s+live\s+)?(?:for\s+everyone|overall|in\s+every\s+way)\b/i;
const COST_BASIS = /\b(?:rent|housing|basket|core\s+(?:monthly\s+)?(?:costs?|basket)|on\s+(?:cost|price)s?|for\s+(?:renters|students|families|singles|couples|budget))\b/i;

function cityMentioned(sentence: string, cities: string[]): boolean {
  const low = sentence.toLowerCase();
  return cities.some((c) => c && low.includes(c.toLowerCase()));
}

export function isUnsupportedCategoryWinner(sentence: string, ledger: CalculationLedger | null | undefined): LedgerCategory | null {
  if (!ledger || ledger.kind !== 'comparison' || ledger.sides.length < 2) return null;
  const cities = ledger.sides.map((s) => s.city);
  if (!cityMentioned(sentence, cities) || !WINNER_CUE.test(sentence) || QUALIFIED.test(sentence)) return null;
  for (const [cat, re] of CATEGORY_CUES) {
    if (re.test(sentence) && ledger.evidence && ledger.evidence[cat] === false) return cat;
  }
  return null;
}

export function isUnsupportedBroadClaim(sentence: string): boolean {
  return BROAD_WINNER.test(sentence) && !COST_BASIS.test(sentence) && !QUALIFIED.test(sentence);
}

/* ── 3. Repetition / thin sections / FAQ ─────────────────────────────── */

const REPEAT_SIM = 0.7;
const MIN_REPEAT_WORDS = 6;
export const THIN_SECTION_WORDS = 50;

function isProseField(loc: TextLocation): boolean {
  return loc.field === 'prose' || loc.field === 'list_item' || loc.field === 'faq_a';
}

interface SentenceRef {
  words: Set<string>;
  text: string;
  loc: TextLocation;
}

function collectSentences(draft: WriterDraftPayload): SentenceRef[] {
  const out: SentenceRef[] = [];
  for (const { text, loc } of collectDraftText(draft)) {
    if (!isProseField(loc) || loc.blockId === 'toc') continue;
    for (const s of splitSentences(text)) {
      const words = contentWords(s);
      if (words.length >= MIN_REPEAT_WORDS) out.push({ words: new Set(words), text: s.trim(), loc });
    }
  }
  return out;
}

export function findRepeatedBoilerplate(draft: WriterDraftPayload): Array<{ first: string; repeat: string; loc: TextLocation }> {
  const seen: SentenceRef[] = [];
  const repeats: Array<{ first: string; repeat: string; loc: TextLocation }> = [];
  for (const s of collectSentences(draft)) {
    const prior = seen.find((p) => jaccard(p.words, s.words) >= REPEAT_SIM);
    if (prior) repeats.push({ first: prior.text.slice(0, 120), repeat: s.text.slice(0, 120), loc: s.loc });
    else seen.push(s);
  }
  return repeats;
}

function sectionBodies(blocks: DraftBlock[]): Array<{ heading: string; blockId: string; words: number }> {
  const out: Array<{ heading: string; blockId: string; words: number }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type !== 'heading' || headingLevelOf(b) >= 3) continue;
    const heading = renderedHeadingText(b);
    if (!heading) continue;
    let words = 0;
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j]!;
      if ((n.type === 'heading' && headingLevelOf(n) < 3) || n.type === 'faq' || n.type === 'summary' || n.id === 'toc') break;
      words += collectDraftText({ seo_title: '', meta_title: '', meta_description: '', excerpt: '', blocks: [n] })
        .filter((t) => t.loc.field !== 'heading')
        .map((t) => t.text.split(/\s+/).filter(Boolean).length)
        .reduce((a, c) => a + c, 0);
    }
    out.push({ heading, blockId: b.id, words });
  }
  return out;
}

export function findThinSections(draft: WriterDraftPayload): Array<{ heading: string; blockId: string; words: number }> {
  return sectionBodies(draft.blocks || []).filter((s) => s.words < THIN_SECTION_WORDS);
}

function faqItems(draft: WriterDraftPayload): Array<{ q: string; a: string }> {
  const faq = (draft.blocks || []).find((b) => b.type === 'faq');
  if (!faq || !Array.isArray(faq.content)) return [];
  return (faq.content as Array<Record<string, unknown>>).map((it) => ({
    q: String(it.q ?? it.question ?? ''),
    a: String(it.a ?? it.answer ?? ''),
  }));
}

/** First sentence of the answer must share a topic word with the question (or be a yes/no answer). */
export function faqAnswerIsDirect(q: string, a: string): boolean {
  const first = splitSentences(a.trim())[0] || '';
  if (/^(?:yes|no|usually|generally|typically|it depends|in most cases|for most|about|around|roughly)\b/i.test(first.trim())) return true;
  const qw = new Set(contentWords(q));
  return contentWords(first).some((w) => qw.has(w));
}

/* ── Gate entry points ───────────────────────────────────────────────── */

export function repairPublicContentQuality(
  draft: WriterDraftPayload,
  ledger: CalculationLedger | null | undefined
): { draft: WriterDraftPayload; fixes: string[] } {
  const fixes: string[] = [];
  let leaks = 0;
  let unsupported = 0;
  let d = mapDraftText(draft, (text, loc) => {
    if (!isProseField(loc) && loc.field !== 'meta') return text;
    const r = removeSentences(text, (s) => {
      if (DIRECTIVE_PATTERNS.some((re) => re.test(s))) {
        leaks += 1;
        return true;
      }
      if (loc.field !== 'meta' && (isUnsupportedCategoryWinner(s, ledger) || isUnsupportedBroadClaim(s))) {
        unsupported += 1;
        return true;
      }
      return false;
    });
    return r.text;
  });
  if (leaks) fixes.push(`directive_sentences_removed:${leaks}`);
  if (unsupported) fixes.push(`unsupported_claims_removed:${unsupported}`);

  // Remove later near-duplicates of a sentence already used (keep the first).
  const seen: Array<Set<string>> = [];
  let dupes = 0;
  d = mapDraftText(d, (text, loc) => {
    if (!isProseField(loc) || loc.blockId === 'toc') return text;
    const r = removeSentences(text, (s) => {
      const words = contentWords(s);
      if (words.length < MIN_REPEAT_WORDS) return false;
      const set = new Set(words);
      if (seen.some((p) => jaccard(p, set) >= REPEAT_SIM)) {
        dupes += 1;
        return true;
      }
      seen.push(set);
      return false;
    });
    return r.text;
  });
  if (dupes) fixes.push(`repeated_sentences_removed:${dupes}`);
  return { draft: d, fixes };
}

export function inspectPublicContentQuality(
  draft: WriterDraftPayload,
  ledger: CalculationLedger | null | undefined
): ContentQualityFinding[] {
  const findings: ContentQualityFinding[] = [];
  for (const { text, loc } of collectDraftText(draft)) {
    for (const leak of findDirectiveLeaks(text)) {
      findings.push({ code: 'directive_leak', severity: 'error', message: `Generation instruction in public content: "${leak}"`, location: loc });
    }
    if (!isProseField(loc)) continue;
    for (const s of splitSentences(text)) {
      const cat = isUnsupportedCategoryWinner(s, ledger);
      if (cat) {
        findings.push({
          code: 'unsupported_category_winner',
          severity: 'error',
          message: `Names a ${cat} winner without comparable ${cat} evidence: "${s.trim().slice(0, 140)}"`,
          location: loc,
        });
      } else if (isUnsupportedBroadClaim(s)) {
        findings.push({ code: 'unsupported_broad_claim', severity: 'error', message: `Unsupported broad winner claim: "${s.trim().slice(0, 140)}"`, location: loc });
      }
    }
  }
  for (const r of findRepeatedBoilerplate(draft)) {
    findings.push({ code: 'repeated_boilerplate', severity: 'error', message: `Repeated advice: "${r.repeat}" (already said: "${r.first}")`, location: r.loc });
  }
  for (const t of findThinSections(draft)) {
    findings.push({
      code: 'thin_section',
      severity: 'error',
      message: `Section "${t.heading}" has only ${t.words} words of content (min ${THIN_SECTION_WORDS})`,
      location: { blockId: t.blockId },
    });
  }
  const items = faqItems(draft);
  for (const it of items) {
    if (!it.a.trim()) {
      findings.push({ code: 'faq_empty', severity: 'error', message: `FAQ without an answer: "${it.q.slice(0, 80)}"` });
    } else if (!faqAnswerIsDirect(it.q, it.a)) {
      findings.push({ code: 'faq_off_topic', severity: 'warning', message: `FAQ answer does not open by answering: "${it.q.slice(0, 80)}"` });
    }
  }
  return findings;
}
