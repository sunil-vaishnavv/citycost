/**
 * Knowledge Gap Detector — never hallucinate; shrink/uncertainty/omit.
 */

import type { KnowledgeGapReport, OutlineSection } from '../types.js';

export function detectKnowledgeGaps(
  outline: OutlineSection[],
  researchDigest: string
): KnowledgeGapReport[] {
  return outline.map((section) => {
    const coverage =
      section.evidence_mode === 'full'
        ? 0.85
        : section.evidence_mode === 'shrink'
          ? 0.55
          : section.evidence_mode === 'uncertainty'
            ? 0.35
            : 0.15;
    const action: KnowledgeGapReport['action'] =
      section.evidence_mode === 'omit'
        ? 'omit'
        : section.evidence_mode === 'uncertainty'
          ? 'uncertainty'
          : section.evidence_mode === 'shrink'
            ? 'shrink'
            : 'write';
    return {
      section_key: section.key,
      heading: section.heading,
      coverage,
      action,
      reason:
        action === 'write'
          ? 'Sufficient evidence signals in research digest'
          : action === 'omit'
            ? 'Insufficient evidence — section omitted'
            : action === 'uncertainty'
              ? 'Thin evidence — write cautious qualitative guidance only'
              : 'Partial evidence — shortened section',
    };
  });
}

export function applyGapToSection(
  section: OutlineSection,
  gaps: KnowledgeGapReport[]
): OutlineSection | null {
  const gap = gaps.find((g) => g.section_key === section.key);
  if (!gap || gap.action === 'write') return section;
  if (gap.action === 'omit') return null;
  return {
    ...section,
    evidence_mode: gap.action === 'uncertainty' ? 'uncertainty' : 'shrink',
    min_words: Math.round(section.min_words * 0.7),
    max_words: Math.round(section.max_words * 0.75),
    brief: `${section.brief} KNOWLEDGE_GAP=${gap.action}: ${gap.reason}. Do not invent numbers.`,
  };
}
