/**
 * Writer Quality Audit — final critical gates before save.
 */

import { detectFingerprints } from './fingerprint.js';
import { validateGuideBehaviour } from './guide-validator.js';
import { promptLeakageIssues } from '../prompt-leakage.js';
import { countDraftWords } from '../draft-validate.js';
import type {
  EditorialPlan,
  KnowledgeGapReport,
  QualityAuditReport,
  SimilarityLayerResult,
  WriterDraftPayload,
} from './types.js';

export function runQualityAudit(input: {
  draft: WriterDraftPayload;
  plan: EditorialPlan;
  similarity: SimilarityLayerResult[];
  knowledge_gaps: KnowledgeGapReport[];
  section_writer_ids: string[];
  /** Align with settings.article_length_min when provided */
  min_words?: number;
}): QualityAuditReport {
  const { draft, plan, similarity, knowledge_gaps, section_writer_ids } = input;
  const critical: string[] = [];
  const soft: string[] = [];
  const minWords = input.min_words ?? 2200;

  const words = countDraftWords(draft);
  // Hard floor only for extremely short drafts; target min is enforced via expand-before-save
  if (words < 900) critical.push(`word_count_low:${words}`);
  else if (words < minWords) soft.push(`word_count_below_target:${words}<${minWords}`);

  const leakage = promptLeakageIssues(draft);
  if (leakage.length) critical.push(...leakage.map((x) => `leakage:${x}`));

  const fingerprints = detectFingerprints(draft);
  const hardFp = fingerprints.filter((f) => f.startsWith('prompt_leakage'));
  const softFp = fingerprints.filter((f) => !f.startsWith('prompt_leakage'));
  if (hardFp.length) critical.push(...hardFp);
  if (softFp.length) soft.push(...softFp);

  const behaviour = validateGuideBehaviour(draft, plan);
  if (behaviour.length) critical.push(...behaviour);

  for (const s of similarity) {
    if (!s.breached) continue;
    // Soft while library is building — still recorded for observability
    soft.push(`similarity_${s.layer}:${s.score}`);
  }

  const inventedRisk = knowledge_gaps.filter((g) => g.action === 'omit').length;
  if (inventedRisk > Math.ceil(plan.outline.length * 0.5)) {
    soft.push('many_sections_omitted_thin_research');
  }

  for (const id of section_writer_ids) {
    if (!id.startsWith(`${plan.guide_id}.`)) {
      critical.push(`cross_guide_section_writer:${id}`);
    }
  }

  const hasFaq = (draft.blocks || []).some((b) => b.type === 'faq');
  const hasSummary = (draft.blocks || []).some((b) => b.type === 'summary');
  if (!hasFaq) critical.push('missing_faq');
  if (!hasSummary) critical.push('missing_summary');

  const scores = {
    words,
    similarity_max: Math.max(0, ...similarity.map((s) => s.score)),
    fingerprint_issues: fingerprints.length,
    leakage: leakage.length,
    behaviour_issues: behaviour.length,
  };

  return {
    ok: critical.length === 0,
    critical,
    soft,
    scores,
    knowledge_gaps,
    similarity,
  };
}
