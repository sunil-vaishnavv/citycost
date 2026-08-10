/**
 * Writer self-review — human-quality + guide-type gate before insertDraftArticle.
 */

import { scoreEeat, scoreHelpfulContent, scoreHumanWriting, scoreSearchIntent } from '../reviewer/scorers.js';
import { blockContentText, draftBodyText } from '../reviewer/text-utils.js';
import type { ResearchPack } from './research-engine.js';
import type { DraftBlock, WriterDraftPayload } from './draft-validate.js';
import { WRITER_HARD_BAN_PHRASES, WRITER_ONCE_PHRASES } from './section-strategies.js';
import { normalizeGuideFamily } from './guide-contracts.js';
import { validateAndRepairDraftLinks } from './link-validate.js';
import {
  detectSentenceRepetition,
  repairRepeatedAdvice,
  repairRepeatedOpenings,
} from './repetition.js';
import { promptLeakageIssues, stripPromptLeakage } from './prompt-leakage.js';
import { routeWriter } from './router.js';

export interface WriterSelfReviewResult {
  ok: boolean;
  scores: {
    human_writing: number;
    helpful_content: number;
    eeat: number;
    search_intent: number;
    readability: number;
  };
  issues: string[];
  draft: WriterDraftPayload;
  repaired: boolean;
}

function paragraphs(draft: WriterDraftPayload): DraftBlock[] {
  return (draft.blocks || []).filter((b) =>
    ['paragraph', 'intro', 'summary', 'tip', 'warning'].includes(b.type)
  );
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
  return (parts[parts.length - 1] || '').toLowerCase().replace(/\s+/g, ' ');
}

function openerKey(s: string): string {
  return s
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function countPhrase(body: string, phrase: string): number {
  const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return (body.match(re) || []).length;
}

function readabilityScore(body: string): number {
  const sentences = body.split(/[.!?]+/).filter((s) => s.trim().split(/\s+/).length >= 3);
  const words = body.split(/\s+/).filter(Boolean);
  if (!sentences.length || !words.length) return 50;
  const avg = words.length / sentences.length;
  let score = 78;
  if (avg < 8 || avg > 28) score -= 15;
  else if (avg < 11 || avg > 24) score -= 6;
  const short = sentences.filter((s) => s.trim().split(/\s+/).length <= 10).length;
  const long = sentences.filter((s) => s.trim().split(/\s+/).length >= 22).length;
  if (short >= 2 && long >= 1) score += 8;
  if (short === 0 || long === 0) score -= 8;
  return Math.max(0, Math.min(100, score));
}

/** Strip or rewrite the worst template fingerprints deterministically. */
export function repairTemplateFingerprints(draft: WriterDraftPayload): WriterDraftPayload {
  const onceHits = new Map<string, number>();
  const blocks = (draft.blocks || []).map((b) => {
    if (!['paragraph', 'intro', 'summary', 'tip', 'warning'].includes(b.type)) return b;
    if (typeof b.content !== 'string') return b;
    let text = b.content;
    for (const phrase of WRITER_ONCE_PHRASES) {
      const re = new RegExp(
        `([^.!?]*${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.!?]*[.!?])`,
        'gi'
      );
      text = text.replace(re, (sentence) => {
        const n = (onceHits.get(phrase) || 0) + 1;
        onceHits.set(phrase, n);
        if (n === 1) return sentence;
        return '';
      });
    }
    for (const ban of WRITER_HARD_BAN_PHRASES) {
      const re = new RegExp(ban.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      text = text.replace(re, '');
    }
    text = text
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.!?])/g, '$1')
      .replace(/(?:[.!?]\s*){2,}/g, '. ')
      .trim();
    if (!text || text.split(/\s+/).length < 12) return b;
    return { ...b, content: text };
  });
  return { ...draft, blocks };
}

export function detectRepetitionIssues(draft: WriterDraftPayload): string[] {
  const issues: string[] = [];
  const paras = paragraphs(draft);
  const openers = new Map<string, number>();
  const endings = new Map<string, number>();

  for (const b of paras) {
    const text = blockContentText(b);
    if (text.split(/\s+/).length < 20) continue;
    const op = openerKey(firstSentence(text));
    const en = openerKey(lastSentence(text));
    if (op) openers.set(op, (openers.get(op) || 0) + 1);
    if (en) endings.set(en, (endings.get(en) || 0) + 1);
  }

  for (const [k, n] of openers) {
    if (n >= 2) issues.push(`Repeated paragraph opening: "${k}" (×${n})`);
  }
  for (const [k, n] of endings) {
    if (n >= 2) issues.push(`Repeated paragraph ending: "${k}" (×${n})`);
  }

  const body = draftBodyText(draft);
  for (const phrase of WRITER_ONCE_PHRASES) {
    const n = countPhrase(body, phrase);
    if (n > 1) issues.push(`Phrase overused (${n}×): "${phrase}"`);
  }
  for (const ban of WRITER_HARD_BAN_PHRASES) {
    if (countPhrase(body, ban) > 0) issues.push(`Hard-banned wording: "${ban}"`);
  }

  const linkShapes = (body.match(/\[[^\]]+\]\(\/[^)]+\)/g) || []).map((m) =>
    m.toLowerCase().replace(/\s+/g, ' ').slice(0, 40)
  );
  const shapeCounts = new Map<string, number>();
  for (const s of linkShapes) shapeCounts.set(s, (shapeCounts.get(s) || 0) + 1);
  for (const [s, n] of shapeCounts) {
    if (n >= 3) issues.push(`Repeated internal-link wording: "${s}"`);
  }

  const citycostHits = (body.match(/citycost/gi) || []).length;
  if (citycostHits > 10) issues.push(`Repeated CityCost promotion (${citycostHits}×)`);

  const intro = paras.find((b) => b.type === 'intro');
  const summary = paras.find((b) => b.type === 'summary');
  if (intro && summary) {
    const a = blockContentText(intro).toLowerCase().slice(0, 180);
    const b = blockContentText(summary).toLowerCase().slice(0, 180);
    const aw = new Set(a.split(/\s+/).filter((w) => w.length > 4));
    const bw = b.split(/\s+/).filter((w) => w.length > 4);
    const overlap = bw.filter((w) => aw.has(w)).length;
    if (bw.length > 12 && overlap / bw.length > 0.55) {
      issues.push('Summary repeats introduction wording');
    }
  }

  issues.push(...detectSentenceRepetition(draft));
  return issues;
}

/** Guide-type structural checks (country ≠ two-city comparison, etc.). */
export function detectGuideTypeIssues(
  draft: WriterDraftPayload,
  research?: ResearchPack | null
): string[] {
  const issues: string[] = [];
  const family = normalizeGuideFamily(research?.topic?.content_type);
  const body = draftBodyText(draft).toLowerCase();
  const cities = (research?.entities?.cities || []).filter(Boolean);

  if (family === 'country') {
    const country =
      research?.entities?.countries?.[0] ||
      research?.primary_entity ||
      '';
    if (country && !body.includes(String(country).toLowerCase())) {
      issues.push('Wrong guide type: country guide barely mentions the country');
    }
    // Detect "A and B" framing dominating when A/B are first two cities
    if (cities.length >= 2) {
      const a = cities[0]!.toLowerCase();
      const b = cities[1]!.toLowerCase();
      const pair = `${a} and ${b}`;
      const pairHits = countPhrase(body, pair);
      const countryHits = country ? countPhrase(body, String(country).toLowerCase()) : 0;
      if (pairHits >= 6 && pairHits > countryHits) {
        issues.push('Country behaving like city comparison (two cities dominate)');
      }
      // Count distinct city mentions — need more than 2 example cities when available
      const mentioned = cities.filter((c) => body.includes(c.toLowerCase())).length;
      if (cities.length >= 4 && mentioned <= 2) {
        issues.push('Country guide uses too few city examples (only 1–2 of many)');
      }
    }
    if (/\bhold lifestyle constant\b/i.test(body) && /vs\.?/i.test(body)) {
      issues.push('Country guide uses comparison-guide cadence');
    }
  }

  if (family === 'city') {
    const city = research?.primary_entity || cities[0] || '';
    if (city && !body.includes(String(city).toLowerCase())) {
      issues.push('Wrong guide type: city guide barely mentions the city');
    }
    if (cities.length >= 2) {
      const other = cities.find((c) => c.toLowerCase() !== String(city).toLowerCase());
      if (other) {
        const cityHits = countPhrase(body, String(city).toLowerCase());
        const otherHits = countPhrase(body, other.toLowerCase());
        if (otherHits >= cityHits && otherHits >= 5) {
          issues.push('City behaving like comparison (secondary city overweighted)');
        }
      }
    }
  }

  if (family === 'comparison' && cities.length >= 2) {
    const a = cities[0]!.toLowerCase();
    const b = cities[1]!.toLowerCase();
    if (!body.includes(a) || !body.includes(b)) {
      issues.push('Comparison guide missing one of the two cities');
    }
  }

  return issues;
}

export function runWriterSelfReview(
  draft: WriterDraftPayload,
  research?: ResearchPack | null
): WriterSelfReviewResult {
  let next = repairTemplateFingerprints(draft);
  const leak = stripPromptLeakage(next);
  next = leak.draft;
  const rep = repairRepeatedAdvice(next);
  next = rep.draft;
  const openFix = repairRepeatedOpenings(next);
  next = openFix.draft;
  const links = validateAndRepairDraftLinks(next, research);
  next = links.draft;
  // Second pass after link/opening repairs
  const rep2 = repairRepeatedAdvice(next);
  next = rep2.draft;
  const leak2 = stripPromptLeakage(next);
  next = leak2.draft;
  const repaired =
    JSON.stringify(next.blocks) !== JSON.stringify(draft.blocks) ||
    leak.removed > 0 ||
    leak2.removed > 0 ||
    rep.removed > 0 ||
    openFix.removed > 0 ||
    rep2.removed > 0 ||
    links.removed_hrefs.length > 0;

  const human = scoreHumanWriting(next);
  const helpful = scoreHelpfulContent(next, research);
  const eeat = scoreEeat(next, research);
  const intent = scoreSearchIntent(next, research);
  const body = draftBodyText(next);
  const readability = readabilityScore(body);
  const routed = routeWriter(research?.topic?.content_type);
  const issues = [
    ...detectRepetitionIssues(next),
    ...detectGuideTypeIssues(next, research),
    ...promptLeakageIssues(next),
    ...links.issues.filter((i) => /Nonsensical|Invalid path|Repeated CityCost/i.test(i)),
    ...human.findings.map((f) => `human: ${f}`),
    ...helpful.findings.map((f) => `helpful: ${f}`),
    `writer:${routed.writer.id}`,
  ];

  const scores = {
    human_writing: human.score,
    helpful_content: helpful.score,
    eeat: eeat.score,
    search_intent: intent.score,
    readability,
  };

  const ok =
    scores.human_writing >= 90 &&
    scores.helpful_content >= 90 &&
    scores.readability >= 70 &&
    !issues.some((i) =>
      /Hard-banned|Phrase overused|Repeated paragraph opening|Repeated paragraph ending|Repeated sentence|Repeated advice|Summary repeats|Prompt\/meta bleed|Prompt leakage|AI-tell|Wrong guide type|Country behaving|City behaving|Comparison guide missing|Nonsensical|Repeated CityCost|comparison-guide cadence/i.test(
        i
      )
    );

  return { ok, scores, issues: issues.slice(0, 40), draft: next, repaired };
}

/** Corpus helper for uniqueness scripts */
export function paragraphFingerprints(draft: WriterDraftPayload): string[] {
  return paragraphs(draft)
    .map((b) =>
      blockContentText(b)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
    )
    .filter((t) => t.length > 40);
}
