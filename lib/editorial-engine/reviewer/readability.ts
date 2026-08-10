/**
 * Readability analyzer — grade-band estimate for CityCost editorial target (8–10).
 */

import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { clampScore, draftBodyText } from './text-utils.js';

export interface ReadabilityResult {
  score: number;
  grade_estimate: number;
  target_band: [number, number];
  in_target_band: boolean;
  metrics: {
    words: number;
    sentences: number;
    avg_sentence_words: number;
    avg_word_chars: number;
    long_sentence_ratio: number;
  };
  findings: string[];
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length || 1);
}

export function analyzeReadability(draft: WriterDraftPayload): ReadabilityResult {
  const text = draftBodyText(draft);
  const findings: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 3);

  const wordCount = words.length || 1;
  const sentenceCount = Math.max(1, sentences.length);
  const avg_sentence_words = wordCount / sentenceCount;
  const avg_word_chars =
    words.reduce((sum, w) => sum + w.replace(/[^a-zA-Z]/g, '').length, 0) / wordCount;
  const longSentences = sentences.filter((s) => s.split(/\s+/).length > 24).length;
  const long_sentence_ratio = longSentences / sentenceCount;

  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const grade_estimate =
    0.39 * avg_sentence_words + 11.8 * (syllables / wordCount) - 15.59;

  const target: [number, number] = [8, 10];
  const in_target_band = grade_estimate >= 8 && grade_estimate <= 10;

  let score = 100;
  if (grade_estimate < 8) score -= (8 - grade_estimate) * 12;
  else if (grade_estimate > 10) score -= (grade_estimate - 10) * 10;
  // Target average sentence length 15–20 words
  if (avg_sentence_words > 20) score -= Math.min(20, (avg_sentence_words - 20) * 2);
  if (avg_sentence_words < 12) score -= 6;
  if (long_sentence_ratio > 0.2) score -= 10;
  if (avg_word_chars > 6.0) score -= 8;

  if (!in_target_band) {
    findings.push(
      `Estimated grade ${grade_estimate.toFixed(1)} outside target band ${target[0]}–${target[1]}`
    );
  }
  if (avg_sentence_words > 20 || avg_sentence_words < 15) {
    findings.push(
      `Average sentence length ${avg_sentence_words.toFixed(1)} words (target 15–20)`
    );
  }
  if (long_sentence_ratio > 0.2) {
    findings.push('Many long sentences — may feel dense');
  }

  return {
    score: clampScore(score),
    grade_estimate: Math.round(grade_estimate * 10) / 10,
    target_band: target,
    in_target_band,
    metrics: {
      words: wordCount,
      sentences: sentenceCount,
      avg_sentence_words: Math.round(avg_sentence_words * 10) / 10,
      avg_word_chars: Math.round(avg_word_chars * 10) / 10,
      long_sentence_ratio: Math.round(long_sentence_ratio * 100) / 100,
    },
    findings,
  };
}
