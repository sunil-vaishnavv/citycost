/**
 * Word Budget Engine — plan section min/target/max BEFORE writing so the
 * finished draft lands above article_length_min without post-hoc failure.
 */

import type { OutlineSection, SectionKey } from './types.js';

export interface WordBudgetReserve {
  intro: number;
  faq: number;
  summary: number;
  overhead: number;
}

export interface SectionWordBudget {
  key: SectionKey;
  heading: string;
  min_words: number;
  target_words: number;
  max_words: number;
  weight: number;
}

export interface WordBudgetPlan {
  article_min: number;
  target_total: number;
  reserve: WordBudgetReserve;
  body_budget: number;
  sections: SectionWordBudget[];
}

const DEFAULT_RESERVE: WordBudgetReserve = {
  intro: 160,
  faq: 280,
  summary: 140,
  overhead: 80, // TOC, tips, meta in word count
};

/**
 * Allocate a word budget across outline sections so
 * intro + body targets + faq + summary ≈ target_total (>= article_min + buffer).
 */
export function allocateWordBudgets(
  outline: OutlineSection[],
  articleMin: number,
  reserve: Partial<WordBudgetReserve> = {}
): WordBudgetPlan {
  const res: WordBudgetReserve = { ...DEFAULT_RESERVE, ...reserve };
  const target_total = Math.max(articleMin + 200, Math.round(articleMin * 1.09));
  const reserved =
    res.intro + res.faq + res.summary + res.overhead;
  const body_budget = Math.max(900, target_total - reserved);

  const body = outline.filter((s) => s.key !== 'faq' && s.key !== 'summary');
  const weights = body.map((s) => {
    const w = Math.max(1, (s.min_words || 100) * (0.5 + Math.min(1, s.priority || 0.5)));
    return { section: s, weight: w };
  });
  const weightSum = weights.reduce((a, b) => a + b.weight, 0) || 1;

  const sections: SectionWordBudget[] = weights.map(({ section, weight }) => {
    const share = body_budget * (weight / weightSum);
    const target_words = Math.max(section.min_words || 100, Math.round(share));
    const min_words = Math.max(90, Math.round(target_words * 0.88));
    const max_words = Math.max(
      section.max_words || target_words,
      Math.round(target_words * 1.35)
    );
    return {
      key: section.key,
      heading: section.heading,
      min_words,
      target_words,
      max_words,
      weight: Math.round(weight * 10) / 10,
    };
  });

  return {
    article_min: articleMin,
    target_total,
    reserve: res,
    body_budget,
    sections,
  };
}

/** Apply budget mins/maxes onto outline sections (mutates copies). */
export function applyWordBudgetToOutline(
  outline: OutlineSection[],
  budget: WordBudgetPlan
): OutlineSection[] {
  const byKey = new Map(budget.sections.map((s) => [s.key, s]));
  return outline.map((s) => {
    if (s.key === 'faq') {
      return {
        ...s,
        min_words: budget.reserve.faq,
        max_words: Math.round(budget.reserve.faq * 1.4),
      };
    }
    if (s.key === 'summary') {
      return {
        ...s,
        min_words: budget.reserve.summary,
        max_words: Math.round(budget.reserve.summary * 1.4),
      };
    }
    const b = byKey.get(s.key);
    if (!b) return s;
    return {
      ...s,
      min_words: b.min_words,
      max_words: b.max_words,
      brief: `${s.brief || ''} Target ~${b.target_words} words (min ${b.min_words}).`.trim(),
    };
  });
}

export function formatWordBudgetDebug(budget: WordBudgetPlan): string {
  const rows = budget.sections
    .map((s) => `${s.key}:${s.min_words}/${s.target_words}/${s.max_words}`)
    .join(';');
  return `target=${budget.target_total};min=${budget.article_min};body=${budget.body_budget};${rows}`;
}
