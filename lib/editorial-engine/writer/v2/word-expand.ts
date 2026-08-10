/**
 * Word Expansion Engine — expand under-budget sections with useful content
 * (examples, advice, cost breakdowns, common mistakes). Not filler.
 */

import {
  countDraftWords,
  sanitizeBlocks,
  type DraftBlock,
  type WriterDraftPayload,
} from '../draft-validate.js';
import { mintBlockId } from './block-integrity.js';
import { sanitizePromptText } from './prompt-sanitizer.js';
import type { OutlineSection } from './types.js';

function wordsInBlocks(blocks: DraftBlock[]): number {
  return countDraftWords({
    seo_title: '',
    meta_title: '',
    meta_description: '',
    excerpt: '',
    blocks,
  });
}

function parseBlocksFromAi(text: string): DraftBlock[] {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    const parsed = JSON.parse(text.slice(start, end + 1)) as { blocks?: DraftBlock[] };
    return Array.isArray(parsed.blocks) ? parsed.blocks : [];
  } catch {
    return [];
  }
}

/** Expand a single section's blocks until min_words (max 2 AI attempts). */
export async function expandSectionToMin(input: {
  blocks: DraftBlock[];
  section: OutlineSection;
  min_words: number;
  factsDigest: string;
  guideId: string;
  readerLabel: string;
  complete: (system: string, user: string) => Promise<string>;
}): Promise<{ blocks: DraftBlock[]; actual: number; expansions: number }> {
  let blocks = [...input.blocks];
  let actual = wordsInBlocks(blocks);
  let expansions = 0;

  while (actual < input.min_words && expansions < 2) {
    expansions += 1;
    const need = input.min_words - actual + 40;
    const system = sanitizePromptText(
      [
        `Expand this ${input.guideId} section with ${need}+ useful words.`,
        'Add practical advice, cost breakdowns, examples, decision guidance, or common mistakes.',
        'Do NOT invent statistics. Do NOT add FAQ/summary. No filler or repetition.',
        'Return JSON {"blocks":[{"type":"paragraph","content":"..."}, ...]} — only NEW paragraphs to append.',
        `Reader=${input.readerLabel}. Heading=${input.section.heading}.`,
      ].join('\n')
    ).text;
    const user = sanitizePromptText(
      `NEED_WORDS=${need}\nFACTS=${input.factsDigest.slice(0, 3500)}\nEXISTING:\n${JSON.stringify(blocks).slice(0, 5000)}`
    ).text;
    try {
      const text = await input.complete(system, user);
      const extra = parseBlocksFromAi(text).filter(
        (b) => b.type !== 'faq' && b.type !== 'summary' && (typeof b.content === 'string' ? b.content.trim() : true)
      );
      if (extra.length) {
        const stamped = extra.map((b) => ({
          ...b,
          id: mintBlockId(b.type === 'heading' ? 'h' : 'exp'),
        }));
        blocks = sanitizeBlocks([...blocks, ...stamped]);
      } else {
        blocks = [...blocks, deterministicSectionPad(input.section, need, input.factsDigest)];
      }
    } catch {
      blocks = [...blocks, deterministicSectionPad(input.section, need, input.factsDigest)];
    }
    actual = wordsInBlocks(blocks);
  }

  if (actual < input.min_words) {
    blocks = [
      ...blocks,
      deterministicSectionPad(input.section, input.min_words - actual + 30, input.factsDigest),
    ];
    actual = wordsInBlocks(blocks);
  }

  return { blocks, actual, expansions };
}

function deterministicSectionPad(
  section: OutlineSection,
  needWords: number,
  factsDigest: string
): DraftBlock {
  const factBite = factsDigest
    .split('\n')
    .map((l) => l.replace(/^[-\s]+/, '').trim())
    .filter((l) => l.length > 20 && !/persona|intent|required/i.test(l))
    .slice(0, 3)
    .join(' ');
  const chunks: string[] = [];
  chunks.push(
    `When planning ${section.heading.toLowerCase()}, treat published figures as baselines and build a short worksheet: fixed costs, variable costs, and a contingency line for setup fees.`
  );
  chunks.push(
    `Practical checks that usually matter: compare two neighbourhood quotes, note deposit and agency fees, and stress-test the monthly total against take-home pay rather than headline averages alone.`
  );
  chunks.push(
    `Common mistakes include ignoring commute time costs, underestimating deposits, and assuming one month of data represents a full year. Keep a buffer for seasonal swings and one-off setup expenses.`
  );
  if (factBite) {
    chunks.push(`Context from available CityCost figures: ${factBite}`);
  }
  chunks.push(
    `Decision tip: lock the housing or primary fixed cost first, then size food, transport, and lifestyle lines so the remaining budget still covers healthcare buffers and unexpected fees.`
  );
  // One-shot meaningful pad only — never repeat sentences to hit a word count.
  // Content Quality Engine owns further expansion when needed.
  void needWords;
  const content = chunks.join(' ');
  return {
    id: mintBlockId(`expand-${section.key}`),
    type: 'paragraph',
    heading: undefined,
    content,
  };
}

export interface SectionActual {
  key: string;
  heading: string;
  target: number;
  min: number;
  actual: number;
  expansions: number;
}

/**
 * Optional AI expansion for under-budget drafts — at most one meaningful pass.
 * Does NOT repeat text to hit a word count. Content Quality Engine owns
 * post-similarity expansion and fake-pad removal.
 *
 * @deprecated Prefer Content Quality Engine `content-expansion` for publish path.
 */
export async function ensureDraftMeetsMinWords(input: {
  draft: WriterDraftPayload;
  article_min: number;
  sectionActuals: SectionActual[];
  factsDigest: string;
  guideId: string;
  readerLabel: string;
  outlineHeadings: string[];
  complete: (system: string, user: string) => Promise<string>;
}): Promise<{
  draft: WriterDraftPayload;
  final_words: number;
  expansion_rounds: number;
  debug: string;
}> {
  let draft = { ...input.draft, blocks: [...(input.draft.blocks || [])] };
  let words = countDraftWords(draft);
  const debugParts: string[] = [
    `start=${words}`,
    `min=${input.article_min}`,
    'mode=meaningful_only',
    ...input.sectionActuals.map(
      (s) => `${s.key}:target=${s.target};actual=${s.actual};exp=${s.expansions}`
    ),
  ];

  // Single AI attempt only when severely short — never loop/pad-repeat
  let expansion_rounds = 0;
  if (words < Math.min(input.article_min, 1200)) {
    expansion_rounds = 1;
    const need = Math.min(220, Math.max(80, input.article_min - words));
    const weakest = [...input.sectionActuals]
      .filter((s) => s.key !== 'faq' && s.key !== 'summary')
      .sort((a, b) => a.actual / Math.max(1, a.target) - b.actual / Math.max(1, b.target))
      .slice(0, 3);
    const focus =
      weakest.map((w) => w.heading || w.key).join('; ') ||
      input.outlineHeadings.slice(0, 4).join('; ');

    const system = sanitizePromptText(
      [
        `Add one useful ${input.guideId}-guide block (~${need} words).`,
        'Add practical advice, examples, cost breakdowns, or decision guidance.',
        'Do NOT repeat existing paragraphs. Do NOT pad with filler.',
        'Return JSON {"blocks":[{"type":"paragraph","content":"..."}]}',
        `Prefer: ${focus}. Reader=${input.readerLabel}`,
      ].join('\n')
    ).text;
    const user = sanitizePromptText(
      `NEED≈${need}\nFACTS=${input.factsDigest.slice(0, 3500)}\nHEADINGS=${input.outlineHeadings.join('; ')}`
    ).text;

    try {
      const text = await input.complete(system, user);
      const extra = parseBlocksFromAi(text).filter((b) => b.type !== 'faq' && b.type !== 'summary');
      if (extra.length) {
        const stamped = extra.map((b) => ({
          ...b,
          id: mintBlockId(b.type === 'heading' ? 'h' : 'exp'),
        }));
        draft.blocks = insertBeforeFaq(draft.blocks, stamped);
        draft = { ...draft, blocks: sanitizeBlocks(draft.blocks) };
      } else {
        draft.blocks = insertBeforeFaq(draft.blocks, [
          deterministicArticlePad(need, input.factsDigest, focus),
        ]);
      }
    } catch {
      draft.blocks = insertBeforeFaq(draft.blocks, [
        deterministicArticlePad(need, input.factsDigest, focus),
      ]);
    }
    words = countDraftWords(draft);
    debugParts.push(`round1=${words}`);
  } else {
    debugParts.push('skip_pad=value_sufficient_or_cq_owns');
  }

  return {
    draft,
    final_words: words,
    expansion_rounds,
    debug: debugParts.join('|'),
  };
}

function insertBeforeFaq(blocks: DraftBlock[], extra: DraftBlock[]): DraftBlock[] {
  const faqIdx = blocks.findIndex((b) => b.type === 'faq');
  if (faqIdx >= 0) {
    return [...blocks.slice(0, faqIdx), ...extra, ...blocks.slice(faqIdx)];
  }
  return [...blocks, ...extra];
}

function deterministicArticlePad(
  needWords: number,
  factsDigest: string,
  focus: string
): DraftBlock {
  const facts = factsDigest
    .split('\n')
    .map((l) => l.replace(/^[-\s]+/, '').trim())
    .filter((l) => /\d/.test(l) || /Index|Currency|Place|Cities/i.test(l))
    .slice(0, 4)
    .join(' ');
  const paras = [
    `To close gaps around ${focus || 'monthly costs'}, rebuild the budget as three lines: housing, essentials (food, transport, utilities), and lifestyle. Confirm each line with at least one local quote before you treat the total as reliable.`,
    `Useful expansions usually come from decision guidance: what changes if rent is 20% higher than expected, how a longer commute trades money for time, and which deposits or agency fees hit in month one versus month two.`,
    `Common mistakes to avoid: using a single citywide average for a specific neighbourhood, forgetting healthcare buffers, and planning food from restaurant prices instead of a mixed grocery-and-dining pattern.`,
    facts
      ? `Keep these available figures in view while you revise: ${facts}`
      : 'Where numeric figures are thin, widen contingency rather than inventing precision.',
    `Next step: pick one housing scenario and one essentials scenario, then write the lifestyle line last so discretionary spend absorbs the remaining room instead of breaking the rent commitment.`,
  ];
  // Never repeat a filler sentence to manufacture word count.
  void needWords;
  return {
    id: mintBlockId('word-pad'),
    type: 'paragraph',
    content: paras.join(' '),
  };
}
