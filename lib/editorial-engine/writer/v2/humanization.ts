/**
 * Humanization Pass 1 & 2 — body blocks only; protected structure restored via integrity merge.
 * Upgraded: AI Phrase Blacklist, sentence/paragraph rhythm, natural transitions,
 * guide-specific tone, no repeated paragraph structure.
 */

import type { EditorialPlan, GuideId, WriterDraftPayload } from './types.js';
import { sanitizePromptText } from './prompt-sanitizer.js';
import { draftBodyText } from '../../reviewer/text-utils.js';
import { sanitizeBlocks } from '../draft-validate.js';
import {
  ensureDraftIntegrity,
  isProtectedBlock,
  mergeWithProtected,
  snapshotProtected,
  splitProtectedBlocks,
} from './block-integrity.js';
import {
  applyAiPhraseBlacklist,
  detectAiPhrases,
  diversifyParagraphOpenings,
  guideToneHint,
  varySentenceRhythm,
} from './ai-phrase-blacklist.js';

export interface HumanizeReport {
  phrases_removed: number;
  rhythm_adjusted: number;
  openings_diversified: number;
  residual_phrases: string[];
}

/** Deterministic humanization — blacklist + rhythm + opening diversity. */
export function humanizeDeterministic(
  draft: WriterDraftPayload,
  guideId?: GuideId
): WriterDraftPayload {
  return humanizeDeterministicWithReport(draft, guideId).draft;
}

export function humanizeDeterministicWithReport(
  draft: WriterDraftPayload,
  _guideId?: GuideId
): { draft: WriterDraftPayload; report: HumanizeReport } {
  let phrases_removed = 0;
  let rhythm_adjusted = 0;
  const paraTexts: string[] = [];
  const paraIndexes: number[] = [];

  const blocks = (draft.blocks || []).map((b, i) => {
    if (typeof b.content !== 'string') return b;
    if (isProtectedBlock(b) && b.type !== 'intro' && b.type !== 'summary') return b;

    let content = b.content;
    const bl = applyAiPhraseBlacklist(content);
    if (bl.hits.length) {
      phrases_removed += bl.hits.length;
      content = bl.text;
    }

    if (b.type === 'paragraph' || b.type === 'tip' || b.type === 'intro' || b.type === 'summary') {
      const rhythm = varySentenceRhythm(content);
      if (rhythm.changed) {
        content = rhythm.text;
        rhythm_adjusted += 1;
      }
      if (b.type === 'paragraph' || b.type === 'tip') {
        paraIndexes.push(i);
        paraTexts.push(content);
      }
    }

    content = content.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
    return { ...b, content };
  });

  // Diversify repeated paragraph openings across body
  const diversified = diversifyParagraphOpenings(paraTexts);
  if (diversified.changed) {
    for (let k = 0; k < paraIndexes.length; k++) {
      const idx = paraIndexes[k];
      const b = blocks[idx];
      if (b && typeof b.content === 'string' && diversified.paragraphs[k] !== b.content) {
        blocks[idx] = { ...b, content: diversified.paragraphs[k] };
      }
    }
  }

  const blob = blocks.map((b) => (typeof b.content === 'string' ? b.content : '')).join('\n');
  const residual_phrases = detectAiPhrases(blob);

  return {
    draft: { ...draft, blocks },
    report: {
      phrases_removed,
      rhythm_adjusted,
      openings_diversified: diversified.changed,
      residual_phrases,
    },
  };
}

/** Human writing detector — residual AI phrases after repair → FAIL. */
export function detectHumanWritingIssues(draft: WriterDraftPayload): {
  ok: boolean;
  residual: string[];
  score: number;
} {
  const blob = (draft.blocks || [])
    .map((b) => (typeof b.content === 'string' ? b.content : ''))
    .join('\n');
  const residual = detectAiPhrases(blob);
  const ok = residual.length === 0;
  return {
    ok,
    residual,
    score: ok ? 100 : Math.max(0, 40 - residual.length * 8),
  };
}

export async function humanizeWithAi(input: {
  draft: WriterDraftPayload;
  plan: EditorialPlan;
  pass: 1 | 2;
  complete: (system: string, user: string) => Promise<string>;
}): Promise<WriterDraftPayload> {
  const base = humanizeDeterministic(input.draft, input.plan.guide_id);
  const snap = snapshotProtected(base.blocks || []);
  const { body } = splitProtectedBlocks(base.blocks || []);
  const bodyDraft = { ...base, blocks: body };
  const bodyText = draftBodyText(bodyDraft).slice(0, 9000);
  const tone = guideToneHint(input.plan.guide_id);
  const system = sanitizePromptText(
    [
      `You are a humanization editor for CityCost ${input.plan.guide_id} guides (pass ${input.pass}).`,
      `Tone: ${tone}.`,
      'Rewrite ONLY to remove robotic rhythm, AI clichés, and mechanical transitions.',
      'Vary sentence length. Use occasional short sentences and natural transitions.',
      'Avoid openings like "When evaluating", "It is important to", "A common mistake", "Ultimately".',
      'Keep all facts/numbers unchanged. Do not add new statistics.',
      `Reader: ${input.plan.persona.label}. Style: ${input.plan.style.label}.`,
      'Rewrite ONLY body blocks (paragraph/heading/list/tip).',
      'Do NOT include intro, table of contents, faq, or summary blocks.',
      'Do NOT invent block ids that look like b-1, b-2 — omit ids.',
      'Return JSON {"blocks":[{"type":"paragraph","content":"..."}, ...]} with headings as {"type":"heading","heading":"...","content":"..."}.',
    ].join('\n')
  ).text;
  const user = sanitizePromptText(
    `PASS=${input.pass}\nPURPOSE=${input.plan.purpose}\nGUIDE=${input.plan.guide_id}\n\nDRAFT BODY:\n${bodyText}`
  ).text;

  try {
    const text = await input.complete(system, user);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) return base;
    const parsed = JSON.parse(text.slice(start, end + 1)) as WriterDraftPayload;
    if (!Array.isArray(parsed.blocks) || parsed.blocks.length < 3) return base;
    const newBody = sanitizeBlocks(parsed.blocks).filter((b) => !isProtectedBlock(b));
    const merged = mergeWithProtected(newBody, snap);
    const ensured = ensureDraftIntegrity({ ...base, blocks: merged }, snap);
    // Always re-run deterministic blacklist after AI humanize
    return humanizeDeterministic(
      {
        ...base,
        blocks: ensured.draft.blocks,
        seo_title: base.seo_title,
        meta_title: base.meta_title,
        meta_description: base.meta_description,
        excerpt: base.excerpt,
      },
      input.plan.guide_id
    );
  } catch {
    return base;
  }
}
