/**
 * Summary validator — must not repeat intro; recap + decision guidance + reader action.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import { fingerprint, similarityScore, splitSentences } from './text-metrics.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';

function blockText(draft: WriterDraftPayload, type: string): string {
  const b = (draft.blocks || []).find((x) => x.type === type);
  if (!b) return '';
  return typeof b.content === 'string' ? b.content : '';
}

export function validateSummary(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  rewritten: number;
} {
  const findings: ValidatorFinding[] = [];
  let rewritten = 0;
  const intro = blockText(draft, 'intro');
  let summary = blockText(draft, 'summary');
  const blocks = [...(draft.blocks || [])];
  const summaryIdx = blocks.findIndex((b) => b.type === 'summary');

  if (summaryIdx < 0 || !summary) {
    return {
      draft,
      rewritten: 0,
      result: {
        category: 'summary_quality',
        status: 'WARNING',
        score: 50,
        findings: [{ code: 'missing_summary', message: 'No summary block', severity: 'warn' }],
      },
    };
  }

  if (intro && similarityScore(intro, summary) >= 0.7) {
    findings.push({
      code: 'summary_repeats_intro',
      message: 'Summary too similar to intro',
      severity: 'warn',
    });
    // Keep unique summary sentences; drop intro clones
    const introSent = splitSentences(intro);
    const kept = splitSentences(summary).filter(
      (s) => !introSent.some((i) => similarityScore(i, s) >= 0.75)
    );
    summary =
      kept.join(' ') ||
      'Recap: housing and essentials drive most of the gap. Decide your rent band first, then size food and transport so a contingency line still fits.';
    rewritten += 1;
  }

  const hasRecap = /\b(recap|overall|in short|key (?:point|takeaway)|to summarise|to summarize|across)\b/i.test(
    summary
  );
  const hasDecision =
    /\b(decide|choose|prefer|better|should|trade-?off|if you|pick)\b/i.test(summary);
  const hasAction =
    /\b(next|start|check|compare|build|write|collect|confirm|plan)\b/i.test(summary);

  if (!hasRecap || !hasDecision || !hasAction) {
    findings.push({
      code: 'summary_missing_elements',
      message: 'Summary needs recap + decision guidance + reader action',
      severity: 'warn',
    });
    const addonParts: string[] = [];
    if (!hasRecap) addonParts.push('Recap: the largest cost swings usually sit in housing and daily essentials.');
    if (!hasDecision)
      addonParts.push('Decide which constraint matters most for you — rent, commute, or cash buffer — before locking a neighbourhood.');
    if (!hasAction)
      addonParts.push('Next step: collect two local quotes for your biggest cost line and revise the monthly total.');
    summary = `${summary.trim()} ${addonParts.join(' ')}`.trim();
    rewritten += 1;
  }

  // Avoid identical fingerprint to intro after rewrite
  if (intro && fingerprint(intro) === fingerprint(summary)) {
    summary = `${summary} Use that revised total as your go / no-go check.`;
    rewritten += 1;
  }

  blocks[summaryIdx] = {
    ...blocks[summaryIdx],
    type: 'summary',
    content: summary.replace(/\s+/g, ' ').trim(),
  };

  const finalSim = intro ? similarityScore(intro, summary) : 0;
  const residual = finalSim >= 0.7;
  if (residual) {
    findings.push({
      code: 'summary_still_mirrors_intro',
      message: 'Summary still mirrors intro',
      severity: 'warn',
    });
  }

  const score = residual ? 55 : Math.max(70, 100 - findings.length * 8);
  return {
    draft: { ...draft, blocks },
    rewritten,
    result: {
      category: 'summary_quality',
      status: statusFromScore(score, false, findings.length > 0),
      score,
      findings,
      rewritten,
    },
  };
}
