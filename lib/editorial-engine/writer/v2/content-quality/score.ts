/**
 * Weighted scoring — block save on hard-fail categories.
 */

import {
  BLOCK_SAVE_CATEGORIES,
  CATEGORY_WEIGHTS,
  type ContentQualityDebugReport,
  type QualityCategory,
  type ValidatorResult,
  type ValidatorStatus,
} from './types.js';

export function statusFromScore(score: number, hasError: boolean, hasWarn: boolean): ValidatorStatus {
  if (hasError || score < 50) return 'FAIL';
  if (hasWarn || score < 75) return 'WARNING';
  return 'PASS';
}

export function computeWeightedScore(validators: ValidatorResult[]): number {
  let totalW = 0;
  let acc = 0;
  for (const v of validators) {
    const w = CATEGORY_WEIGHTS[v.category] ?? 1;
    totalW += w;
    acc += w * Math.max(0, Math.min(100, v.score));
  }
  if (!totalW) return 100;
  return Math.round((acc / totalW) * 10) / 10;
}

export function collectBlockReasons(validators: ValidatorResult[]): string[] {
  const reasons: string[] = [];
  for (const v of validators) {
    if (v.status !== 'FAIL') continue;
    if (!(BLOCK_SAVE_CATEGORIES as readonly string[]).includes(v.category)) continue;
    for (const f of v.findings.filter((x) => x.severity === 'error')) {
      reasons.push(`${v.category}:${f.code}`);
    }
    if (!v.findings.some((x) => x.severity === 'error')) {
      reasons.push(`${v.category}:fail`);
    }
  }
  return [...new Set(reasons)];
}

export function shouldBlockSave(validators: ValidatorResult[]): boolean {
  return validators.some(
    (v) =>
      v.status === 'FAIL' && (BLOCK_SAVE_CATEGORIES as readonly QualityCategory[]).includes(v.category)
  );
}

export function buildDebugReport(
  validators: ValidatorResult[],
  counters: Partial<ContentQualityDebugReport>
): ContentQualityDebugReport {
  const score = computeWeightedScore(validators);
  const block_reasons = collectBlockReasons(validators);
  return {
    repeated_paragraphs_removed: counters.repeated_paragraphs_removed ?? 0,
    sentences_repaired: counters.sentences_repaired ?? 0,
    leakage_removed: counters.leakage_removed ?? 0,
    sections_rewritten: counters.sections_rewritten ?? 0,
    examples_added: counters.examples_added ?? 0,
    expansion_words_added: counters.expansion_words_added ?? 0,
    ai_cliches_removed: counters.ai_cliches_removed ?? 0,
    final_score: score,
    validators,
    block_save: shouldBlockSave(validators),
    block_reasons,
  };
}

export function formatQualityDebug(report: ContentQualityDebugReport): string {
  return [
    `score=${report.final_score}`,
    `block_save=${report.block_save ? 'yes' : 'no'}`,
    `dupes_removed=${report.repeated_paragraphs_removed}`,
    `sentences_repaired=${report.sentences_repaired}`,
    `leakage_removed=${report.leakage_removed}`,
    `sections_rewritten=${report.sections_rewritten}`,
    `examples_added=${report.examples_added}`,
    `expansion_words=${report.expansion_words_added}`,
    `cliches_removed=${report.ai_cliches_removed}`,
    report.block_reasons.length ? `reasons=${report.block_reasons.join('|')}` : 'reasons=none',
  ].join(';');
}
