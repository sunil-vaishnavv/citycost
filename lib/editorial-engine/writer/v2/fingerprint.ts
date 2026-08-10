/**
 * AI Fingerprint Detector — reject repetitive AI patterns inside a draft.
 */

import type { WriterDraftPayload } from './types.js';
import { draftBodyText } from '../../reviewer/text-utils.js';
import { detectPromptLeakage } from '../prompt-leakage.js';

const TRANSITIONS = [
  /when it comes to/i,
  /it(?:'s| is) important to note/i,
  /in conclusion,/i,
  /moreover,/i,
  /furthermore,/i,
  /that being said,/i,
];

export function detectFingerprints(draft: WriterDraftPayload): string[] {
  const issues: string[] = [];
  const body = draftBodyText(draft);

  for (const phrase of detectPromptLeakage(body)) {
    issues.push(`prompt_leakage:${phrase}`);
  }

  const paras = (draft.blocks || [])
    .filter((b) => b.type === 'paragraph' && typeof b.content === 'string')
    .map((b) => String(b.content));
  const openings = paras.map((p) => p.slice(0, 40).toLowerCase());
  const openingSet = new Set(openings);
  if (openings.length >= 4 && openingSet.size < openings.length * 0.7) {
    issues.push('repeated_section_openings');
  }

  let transitionHits = 0;
  for (const re of TRANSITIONS) {
    const m = body.match(new RegExp(re.source, 'gi'));
    transitionHits += m?.length || 0;
  }
  if (transitionHits >= 4) issues.push('repeated_transitions');

  const citycostAnchors = (body.match(/citycost\.online\/[a-z0-9\-\/]+/gi) || []).map((x) =>
    x.toLowerCase()
  );
  if (citycostAnchors.length >= 3) {
    const uniq = new Set(citycostAnchors);
    // OK to repeat paths; flag identical surrounding boilerplate via "visit our" spam
    if ((body.match(/visit (?:our|the) (?:guide|page|comparison)/gi) || []).length >= 3) {
      issues.push('repeated_internal_link_wording');
    }
    void uniq;
  }

  const sentences = body.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 5);
  const lens = sentences.map((s) => s.split(/\s+/).length);
  if (lens.length > 12) {
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length;
    if (variance < 6) issues.push('repeated_rhythm');
  }

  const planning = (body.match(/before you (?:move|finalize|decide)|make sure to research/gi) || [])
    .length;
  if (planning >= 3) issues.push('repeated_planning_advice');

  return issues;
}
