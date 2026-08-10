/**
 * Cross-Section Similarity Checker — before save (and as CQ pass).
 * If section similarity exceeds threshold → rewrite THAT section with NEW value only.
 * Composes with Content Memory; preserves protected blocks via callers.
 */

import type { WriterDraftPayload } from '../draft-validate.js';
import { isProtectedBlock } from './block-integrity.js';
import {
  applyContentMemoryPass,
  buildMemoryFromDraft,
  diffSectionAgainstMemory,
  rewriteSectionForNewValue,
  type SectionMemoryDiff,
} from './content-memory.js';
import { draftSectionChunks } from './section-chunks.js';
import {
  SECTION_SIM_THRESHOLD,
  SENTENCE_SIM_THRESHOLD,
  similarityScore,
  splitSentences,
} from './content-quality/text-metrics.js';
import type { ValidatorFinding, ValidatorResult } from './content-quality/types.js';
import { statusFromScore } from './content-quality/score.js';

export const CROSS_SECTION_SIM_THRESHOLD = SECTION_SIM_THRESHOLD; // 0.6
export const CROSS_SECTION_SENTENCE_THRESHOLD = SENTENCE_SIM_THRESHOLD; // 0.8

export interface CrossSectionPair {
  a: string;
  b: string;
  score: number;
}

export interface CrossSectionSimilarityReport {
  pairs: CrossSectionPair[];
  diffs: SectionMemoryDiff[];
  sections_rewritten: number;
  max_similarity: number;
  ok: boolean;
}

function pairwiseSectionScores(draft: WriterDraftPayload): CrossSectionPair[] {
  const chunks = draftSectionChunks(draft);
  const pairs: CrossSectionPair[] = [];
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      const score = similarityScore(chunks[i].text, chunks[j].text);
      if (score >= CROSS_SECTION_SIM_THRESHOLD * 0.85) {
        pairs.push({
          a: chunks[i].heading,
          b: chunks[j].heading,
          score,
        });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

/**
 * Detect cross-section similarity; optionally repair by rewriting later sections.
 */
export function checkCrossSectionSimilarity(
  draft: WriterDraftPayload,
  opts?: { repair?: boolean }
): {
  draft: WriterDraftPayload;
  report: CrossSectionSimilarityReport;
  result: ValidatorResult;
} {
  const repair = opts?.repair !== false;
  let working = draft;
  let sections_rewritten = 0;
  let diffs: SectionMemoryDiff[] = [];

  if (repair) {
    const memPass = applyContentMemoryPass(working);
    working = memPass.draft;
    sections_rewritten = memPass.sectionsRewritten;
    diffs = memPass.diffs;

    // Second pass: pairwise — rewrite the later section of high-sim pairs
    const chunks = draftSectionChunks(working);
    const blocks = [...(working.blocks || [])];
    for (let i = 0; i < chunks.length; i++) {
      for (let j = i + 1; j < chunks.length; j++) {
        const score = similarityScore(chunks[i].text, chunks[j].text);
        if (score < CROSS_SECTION_SIM_THRESHOLD) continue;
        // Rewrite later section (j) relative to earlier blocks
        const mem = buildMemoryFromDraft({
          ...working,
          blocks: blocks.filter((_, idx) => {
            const b = blocks[idx];
            if (!b) return false;
            if (isProtectedBlock(b)) return true;
            return idx < chunks[j].startIndex;
          }),
        });

        for (const id of chunks[j].bodyIds) {
          const idx = blocks.findIndex((b) => b.id === id);
          if (idx < 0) continue;
          const b = blocks[idx];
          if (!b || typeof b.content !== 'string' || isProtectedBlock(b)) continue;
          const diff = diffSectionAgainstMemory(mem, chunks[j].heading, b.content, {
            sectionSimThreshold: CROSS_SECTION_SIM_THRESHOLD,
            sentenceSimThreshold: CROSS_SECTION_SENTENCE_THRESHOLD,
          });
          // Force rewrite when pair score is high even if sentence-level missed
          if (!diff.needsRewrite && score >= CROSS_SECTION_SIM_THRESHOLD) {
            diff.needsRewrite = true;
            const priorSents = splitSentences(chunks[i].text);
            for (const s of splitSentences(b.content)) {
              if (
                priorSents.some(
                  (p) => similarityScore(p, s) >= CROSS_SECTION_SENTENCE_THRESHOLD * 0.9
                )
              ) {
                diff.repeatedSentences.push(s);
              }
            }
          }
          if (!diff.needsRewrite && !diff.repeatedSentences.length) continue;
          const rewritten = rewriteSectionForNewValue(b.content, diff, mem);
          if (rewritten !== b.content) {
            blocks[idx] = { ...b, content: rewritten };
            sections_rewritten += 1;
          }
        }
      }
    }
    working = { ...working, blocks };

    // Drop near-duplicate sentences within FAQ answers vs body (reference OK, full re-explain not)
    working = dedupeFaqAgainstBody(working);
  }

  const pairs = pairwiseSectionScores(working);
  const max_similarity = pairs.length ? pairs[0].score : 0;
  const residualHigh = pairs.filter((p) => p.score >= CROSS_SECTION_SIM_THRESHOLD);
  const findings: ValidatorFinding[] = [];

  for (const p of residualHigh.slice(0, 8)) {
    findings.push({
      code: 'cross_section_similarity',
      message: `Sections "${p.a}" ↔ "${p.b}" similarity ${p.score.toFixed(2)}`,
      severity: residualHigh.length > 0 && !repair ? 'error' : 'warn',
    });
  }
  for (const d of diffs.filter((x) => x.needsRewrite).slice(0, 6)) {
    findings.push({
      code: 'memory_rewrite',
      message: `Section "${d.heading}" rewritten (prior sim ${d.similarityToPrior.toFixed(2)})`,
      severity: 'info',
    });
  }

  // Soft fail only if residual still very high after repair
  const hardResidual = pairs.filter((p) => p.score >= 0.85);
  const ok = hardResidual.length === 0;
  const score = ok
    ? Math.max(70, 100 - residualHigh.length * 8 - sections_rewritten * 2)
    : Math.max(0, 40 - hardResidual.length * 10);

  const report: CrossSectionSimilarityReport = {
    pairs,
    diffs,
    sections_rewritten,
    max_similarity,
    ok,
  };

  return {
    draft: working,
    report,
    result: {
      category: 'cross_section_similarity',
      status: ok ? statusFromScore(score, false, residualHigh.length > 0) : 'FAIL',
      score: ok ? Math.max(score, 75) : score,
      findings: ok
        ? findings
        : [
            ...findings,
            {
              code: 'residual_cross_section_dupes',
              message: `${hardResidual.length} section pair(s) still ≥ 0.85 similar`,
              severity: 'error',
            },
          ],
      rewritten: sections_rewritten,
    },
  };
}

function dedupeFaqAgainstBody(draft: WriterDraftPayload): WriterDraftPayload {
  const bodyText = draftSectionChunks(draft)
    .map((c) => c.text)
    .join('\n');
  const bodySents = splitSentences(bodyText);
  const blocks = (draft.blocks || []).map((b) => {
    if (b.type !== 'faq' || !Array.isArray(b.content)) return b;
    const next = b.content.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const o = { ...(item as Record<string, unknown>) };
      const a = typeof o.a === 'string' ? o.a : typeof o.answer === 'string' ? (o.answer as string) : '';
      if (!a) return o;
      const kept = splitSentences(a).filter(
        (s) => !bodySents.some((bs) => similarityScore(s, bs) >= 0.88)
      );
      if (kept.length === splitSentences(a).length) return o;
      const rebuilt =
        kept.join(' ') ||
        `${a.split(/\s+/).slice(0, 12).join(' ')} Confirm a local quote and decide your buffer before you commit.`;
      if ('a' in o) o.a = rebuilt;
      else o.answer = rebuilt;
      return o;
    });
    return { ...b, content: next };
  });
  return { ...draft, blocks };
}

/** Format for orchestrator debug. */
export function formatCrossSectionDebug(report: CrossSectionSimilarityReport): string {
  return [
    `max_sim=${report.max_similarity.toFixed(2)}`,
    `pairs=${report.pairs.length}`,
    `rewritten=${report.sections_rewritten}`,
    `ok=${report.ok ? 'yes' : 'no'}`,
  ].join(';');
}
