/**
 * Heuristic scorers: EEAT, search intent, human writing, helpful content.
 * Deterministic complements to the AI reviewer (never rewrite content).
 */

import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { ResearchPack } from '../writer/research-engine.js';
import { blockContentText, clampScore, draftBodyText, draftPlainText } from './text-utils.js';

export interface HeuristicScore {
  score: number;
  findings: string[];
}

const AI_TELLS = [
  /delve into/i,
  /landscape of/i,
  /robust/i,
  /leverage/i,
  /unlock the potential/i,
  /in today's world/i,
  /it is important to note/i,
  /as we know/i,
  /in conclusion/i,
  /tapestry/i,
  /embark on/i,
];

export function scoreEeat(
  draft: WriterDraftPayload,
  research?: ResearchPack | null
): HeuristicScore {
  const findings: string[] = [];
  const text = draftPlainText(draft).toLowerCase();
  let score = 55;

  const honesty =
    /unavailable|approximate|index signal|methodology|data source|verify|not a promise|depends on/i.test(
      text
    );
  if (honesty) score += 18;
  else findings.push('Little acknowledgment of data limits / methodology');

  if (/citycost|comparison tool|calculator/i.test(text)) score += 10;
  else findings.push('No natural CityCost tool mention for trust/verification');

  if (research?.eeat_opportunities?.length) {
    const hit = research.eeat_opportunities.some((e) =>
      text.includes(e.toLowerCase().slice(0, 24))
    );
    if (hit) score += 8;
  }

  const hasFaq = (draft.blocks || []).some((b) => b.type === 'faq');
  const hasTip = (draft.blocks || []).some((b) => b.type === 'tip' || b.type === 'warning');
  if (hasFaq) score += 6;
  if (hasTip) score += 6;
  else findings.push('Missing tip/warning for experience-led advice');

  // Penalize precise invented-looking percentages without index language
  const fakeStat = /\b\d{2,3}%\b/.test(text) && !/index|signal|approximate/i.test(text);
  if (fakeStat) {
    score -= 20;
    findings.push('Precise percentages without index/caveat language — possible hallucination risk');
  }

  return { score: clampScore(score), findings };
}

export function scoreSearchIntent(
  draft: WriterDraftPayload,
  research?: ResearchPack | null
): HeuristicScore {
  const findings: string[] = [];
  let score = 50;
  const text = draftPlainText(draft).toLowerCase();
  const title = (draft.seo_title || '').toLowerCase();

  if (research?.target_keyword) {
    const tokens = research.target_keyword.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = tokens.filter((t) => title.includes(t) || text.includes(t)).length;
    const ratio = tokens.length ? hits / tokens.length : 0;
    score += ratio * 30;
    if (ratio < 0.4) findings.push('Weak alignment with target keyword');
  } else {
    findings.push('No research target keyword available');
  }

  if (research?.search_questions?.length) {
    let qHits = 0;
    for (const q of research.search_questions.slice(0, 5)) {
      const key = q
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 3);
      if (key.some((k) => text.includes(k))) qHits += 1;
    }
    score += Math.min(20, qHits * 4);
    if (qHits < 2) findings.push('Few search questions addressed in draft body');
  }

  if (research?.intent === 'commercial_investigation') {
    if (/vs|versus|cheaper|compare|trade-?off/i.test(text)) score += 10;
    else findings.push('Comparison intent but weak comparative language');
  }

  const hasFaq = (draft.blocks || []).some((b) => b.type === 'faq');
  if (hasFaq) score += 8;

  return { score: clampScore(score), findings };
}

const PROMPT_BLEED_PATTERNS: Array<{ re: RegExp; label: string; penalty: number }> = [
  { re: /write for\s+[^,]{3,80},\s*with intent/i, label: 'persona/intent bleed', penalty: 28 },
  { re: /keep the citycost angle in view/i, label: 'article_angle bleed', penalty: 24 },
  { re: /with intent\s*\(/i, label: 'intent meta in prose', penalty: 20 },
  { re: /supporting\s+\w+\s+spoke/i, label: 'strategy seo_reason bleed', penalty: 24 },
  { re: /certification batch/i, label: 'certification meta bleed', penalty: 22 },
  { re: /country signals for/i, label: 'internal fact label in prose', penalty: 12 },
  { re: /use the keyword naturally once/i, label: 'keyword instruction bleed', penalty: 20 },
  { re: /matters when you evaluate/i, label: 'brief meta phrasing', penalty: 12 },
  { re: /keep the persona/i, label: 'persona instruction bleed', penalty: 20 },
];

export function scoreHumanWriting(draft: WriterDraftPayload): HeuristicScore {
  const findings: string[] = [];
  const body = draftBodyText(draft);
  // Base assumes competent editorial draft; bonuses/penalties move toward 90+ or down.
  let score = 86;

  let tellHits = 0;
  for (const re of AI_TELLS) {
    if (re.test(body)) {
      tellHits += 1;
      findings.push(`AI-tell phrase: ${re.source}`);
    }
  }
  score -= tellHits * 10;

  for (const p of PROMPT_BLEED_PATTERNS) {
    if (p.re.test(body)) {
      score -= p.penalty;
      findings.push(`Prompt/meta bleed: ${p.label}`);
    }
  }

  // Template fingerprints that ruin human voice when repeated
  const oncePhrases = [
    'cross-check',
    'when in doubt',
    'before you finalize',
    'indexed averages',
    'the practical answer',
    'budget as a worksheet',
    'use relative indexes',
  ];
  for (const phrase of oncePhrases) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const n = (body.match(re) || []).length;
    if (n > 1) {
      score -= Math.min(18, (n - 1) * 6);
      findings.push(`Overused template phrase: "${phrase}" (×${n})`);
    }
  }

  const paragraphs = (draft.blocks || []).filter(
    (b) => b.type === 'paragraph' || b.type === 'intro' || b.type === 'summary'
  );
  const lengths = paragraphs.map((b) => blockContentText(b).split(/\s+/).filter(Boolean).length);
  if (lengths.length >= 3) {
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance =
      lengths.reduce((sum, n) => sum + (n - avg) ** 2, 0) / lengths.length;
    if (variance < 40) {
      score -= 8;
      findings.push('Paragraph lengths very uniform — may feel mechanical');
    } else if (variance >= 120) {
      score += 4;
    }
  }

  const sentences = body.split(/[.!?]+/).filter((s) => s.trim().split(/\s+/).length >= 4);
  if (sentences.length >= 6) {
    const starts = sentences.map((s) => s.trim().split(/\s+/)[0]?.toLowerCase() || '');
    const firstCounts = new Map<string, number>();
    for (const s of starts) firstCounts.set(s, (firstCounts.get(s) || 0) + 1);
    const maxStart = Math.max(...firstCounts.values());
    if (maxStart / starts.length > 0.35) {
      score -= 10;
      findings.push('Repetitive sentence openings');
    } else if (maxStart / starts.length < 0.18) {
      score += 5;
    }

    const wordLens = sentences.map((s) => s.trim().split(/\s+/).length);
    const shortN = wordLens.filter((n) => n <= 10).length;
    const longN = wordLens.filter((n) => n >= 22).length;
    if (shortN >= 2 && longN >= 1) score += 4;
  }

  // Repeated consecutive sentences
  const norms = sentences.map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '));
  for (let i = 1; i < norms.length; i++) {
    if (norms[i] && norms[i] === norms[i - 1]) {
      score -= 15;
      findings.push('Exact consecutive sentence repetition');
      break;
    }
  }

  // Near-duplicate body paragraphs (classic research-synth failure mode)
  const paraFingerprints = paragraphs
    .map((b) =>
      blockContentText(b)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160)
    )
    .filter((t) => t.length > 80);
  if (paraFingerprints.length >= 4) {
    const seen = new Map<string, number>();
    for (const fp of paraFingerprints) seen.set(fp, (seen.get(fp) || 0) + 1);
    const maxDup = Math.max(...seen.values());
    if (maxDup >= 3) {
      score -= 25;
      findings.push('Near-identical paragraphs repeated across sections (template boilerplate)');
    } else if (maxDup >= 2) {
      score -= 12;
      findings.push('Duplicated paragraph blocks detected');
    } else {
      score += 3;
    }
  }

  // Intra-paragraph sentence loops from pad-while bugs
  for (const b of paragraphs) {
    const text = blockContentText(b);
    const sent = text
      .split(/[.!?]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.split(/\s+/).length >= 6);
    const counts = new Map<string, number>();
    for (const s of sent) counts.set(s, (counts.get(s) || 0) + 1);
    if ([...counts.values()].some((n) => n >= 3)) {
      score -= 20;
      findings.push('Repeated sentence loops inside a paragraph');
      break;
    }
  }

  if (/trade-?off|deposit|neighbourhood|neighborhood|take-home|commute|buffer/i.test(body)) {
    score += 3;
  }

  if (/\[object Object\]/i.test(body)) {
    score -= 30;
    findings.push('Unrendered [object Object] placeholder in prose');
  }

  return { score: clampScore(score), findings };
}

export function scoreHelpfulContent(
  draft: WriterDraftPayload,
  research?: ResearchPack | null
): HeuristicScore {
  const findings: string[] = [];
  let score = 52;
  const blocks = draft.blocks || [];
  const text = draftPlainText(draft).toLowerCase();

  if (blocks.some((b) => b.type === 'intro')) score += 8;
  if (blocks.some((b) => b.type === 'faq')) score += 10;
  if (blocks.some((b) => b.type === 'summary')) score += 8;
  if (blocks.some((b) => b.type === 'tip') || blocks.some((b) => b.type === 'warning')) score += 6;
  if (blocks.some((b) => b.type === 'list' || b.type === 'table' || b.type === 'comparison')) {
    score += 8;
  } else {
    findings.push('Little structured practical content (list/table/comparison)');
  }

  if (/budget|checklist|trade-?off|deposit|example|for example|worksheet|take-home|commute/i.test(text)) {
    score += 12;
  } else {
    findings.push('Weak practical / actionable language');
  }

  // Natural tool mentions beat forced CTAs
  const citycostHits = (text.match(/citycost/gi) || []).length;
  if (citycostHits >= 1 && citycostHits <= 8) score += 6;
  else if (citycostHits > 12) {
    score -= 6;
    findings.push('CityCost mentions feel forced / over-repeated');
  }

  if (research?.article_angle) {
    const angleWords = research.article_angle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .slice(0, 6);
    const hits = angleWords.filter((w) => text.includes(w)).length;
    if (hits >= 2) score += 8;
    else findings.push('Article angle weakly reflected in draft');
  }

  const wordish = text.split(/\s+/).length;
  if (wordish < 1800) {
    score -= 15;
    findings.push('Thin body relative to helpful evergreen target');
  } else if (wordish >= 2200) {
    score += 4;
  }

  return { score: clampScore(score), findings };
}
