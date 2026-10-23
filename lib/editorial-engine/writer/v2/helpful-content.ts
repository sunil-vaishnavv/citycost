/**
 * Editorial Helpful Content Engine — each body section must include at least ONE
 * practical upgrade: checklist, decision tip, common mistake, money-saving tip,
 * real scenario, trade-off, local insight, example, questions to ask, or warning.
 * Action-oriented; never invents facts — parameterized by guide + entities.
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import { mintBlockId, isProtectedBlock } from './block-integrity.js';
import type { GuideId } from './types.js';
import { draftSectionChunks, type SectionChunk } from './section-chunks.js';
import { sectionHasExample } from './example-engine.js';
import { sectionHasDecisionGuidance } from './decision-support-engine.js';

export type HelpfulElement =
  | 'checklist'
  | 'decision_tip'
  | 'common_mistake'
  | 'money_saving'
  | 'real_scenario'
  | 'trade_off'
  | 'local_insight'
  | 'example'
  | 'questions_to_ask'
  | 'warning';

export interface HelpfulEntityContext {
  country?: string;
  city?: string;
  city_b?: string;
}

export interface HelpfulContentReport {
  helpful_tips_added: number;
  sections_upgraded: string[];
  helpful_score_before: number;
  helpful_score_after: number;
}

export const DEFINITION_ONLY_RE =
  /^(?:[A-Z][^.!?]*\b(?:is|are|refers to|means|can be defined as)\b[^.!?]*\.\s*){1,}$/;

const ELEMENT_PATTERNS: Array<{ element: HelpfulElement; re: RegExp }> = [
  {
    element: 'checklist',
    re: /\b(checklist|tick off|make sure you|confirm whether|verify that|deposit months|before you (?:sign|commit|move|relocate)|rule of thumb|step-by-step|actionable step)\b/i,
  },
  {
    element: 'decision_tip',
    re: /\b(decision(?: tip| guidance)?|so what|what (?:you|to) should do|decide (?:whether|between|which)|next step|before you (?:commit|sign|move|relocate)|who should (?:choose|pick|rent|move)|non-negotiables?|must-haves?|shortlist|prioritize|run the numbers|stress-test|hold lifestyle constant|like-for-like|apples-to-apples|budget difference|net take-home|purchasing power gap)\b/i,
  },
  {
    element: 'common_mistake',
    re: /\b(common mistake|avoid assuming|do not assume|people often|trap is|pitfall|frequently overlooked|easy to forget)\b/i,
  },
  {
    element: 'money_saving',
    re: /\b(save money|money-saving|cheaper if|cut (?:the )?cost|lower (?:your )?spend|cost lever|reduce (?:your )?expenses|stretch your budget|budget-friendly)\b/i,
  },
  {
    element: 'real_scenario',
    re: /\b(scenario|real-world|what a real person|for example|imagine you|case study|for instance|typical (?:household|renter|family|earner|couple|single)|monthly budget of|break-even)\b/i,
  },
  {
    element: 'trade_off',
    re: /\b(trade-?off|tradeoff|weigh(?:ing)? (?:the|between|both)|compromise|give up|offset(?:ting)?|lifestyle premium|commute penalty|space (?:versus|vs) location|price differential|cost spread)\b/i,
  },
  {
    element: 'local_insight',
    re: /\b(locally|local(?:s|ly)?|in practice|on the ground|neighbourhood|neighborhood|local quote|local market norms?|on-the-ground)\b/i,
  },
  {
    element: 'example',
    re: /\b(for example|example:|practical (?:move|example|check)|for instance|sample budget|illustration)\b/i,
  },
  {
    element: 'questions_to_ask',
    re: /\b(ask(?:ing)? (?:whether|if|about)|questions? to ask|get in writing|confirm with (?:agent|landlord|employer))\b/i,
  },
  {
    element: 'warning',
    re: /\b(warning|watch out|risk|careful|do not sign|red flag|hidden cost|surprise expense|data gap|limitations?)\b/i,
  },
];

export function detectHelpfulElements(text: string): HelpfulElement[] {
  const found: HelpfulElement[] = [];
  for (const { element, re } of ELEMENT_PATTERNS) {
    if (re.test(text)) found.push(element);
  }
  if (sectionHasExample(text) && !found.includes('example')) found.push('example');
  if (sectionHasDecisionGuidance(text) && !found.includes('decision_tip')) found.push('decision_tip');
  return found;
}

export function sectionHasPracticalAdvice(text: string): boolean {
  return detectHelpfulElements(text).length > 0;
}

export function sectionIsDefinitionOnly(text: string): boolean {
  const t = text.trim();
  if (t.split(/\s+/).length < 30) return false;
  if (DEFINITION_ONLY_RE.test(t)) return true;
  // Long encyclopedic prose with no action signals
  if (!sectionHasPracticalAdvice(t) && /\b(is a|are a|refers to|defined as|consists of)\b/i.test(t)) {
    return true;
  }
  return false;
}

interface HelpfulTemplate {
  element: HelpfulElement;
  blockType: 'tip' | 'warning' | 'list';
  heading: string;
  build: (ctx: { place: string; placeB?: string; guideId: GuideId }) => string | string[];
}

function placeOf(ctx: HelpfulEntityContext): { place: string; placeB?: string } {
  return {
    place: ctx.city?.trim() || ctx.country?.trim() || 'your destination',
    placeB: ctx.city_b?.trim() || undefined,
  };
}

/** Rotating upgrades keyed by guide — reusable, not article-specific. */
function templatesForGuide(guideId: GuideId): HelpfulTemplate[] {
  const base: HelpfulTemplate[] = [
    {
      element: 'checklist',
      blockType: 'list',
      heading: 'Practical checklist',
      build: ({ place }) => [
        `Confirm the largest cost line for ${place} with a local quote`,
        'Separate move-in cash from monthly ongoing spend',
        'Add a contingency buffer before you commit',
      ],
    },
    {
      element: 'common_mistake',
      blockType: 'warning',
      heading: 'Common mistake',
      build: ({ place }) =>
        `Common mistake in ${place}: treating a citywide average as your personal budget. Your neighbourhood, commute, and household size move the number more than the headline index.`,
    },
    {
      element: 'money_saving',
      blockType: 'tip',
      heading: 'Money-saving tip',
      build: ({ place }) =>
        `Money-saving tip for ${place}: cut discretionary dining and rides first when quotes overrun — freezing lifestyle spend protects rent and healthcare lines.`,
    },
    {
      element: 'questions_to_ask',
      blockType: 'list',
      heading: 'Questions to ask',
      build: ({ place }) => [
        `What is included in the quoted rent or fee in ${place}?`,
        'When is the deposit returned, and what deductions are typical?',
        'Can I see one recent utility or maintenance bill?',
      ],
    },
    {
      element: 'trade_off',
      blockType: 'tip',
      heading: 'Trade-off',
      build: ({ place, placeB }) =>
        `Trade-off: a cheaper area in ${place}${placeB ? ` (or versus ${placeB})` : ''} often costs more in commute time and weekday meals — price both before calling it a win.`,
    },
    {
      element: 'local_insight',
      blockType: 'tip',
      heading: 'Local insight',
      build: ({ place }) =>
        `Local insight: in ${place}, first-month costs usually exceed steady-state months until banking, SIM, and kitchen routines are in place — fund that gap explicitly.`,
    },
    {
      element: 'real_scenario',
      blockType: 'tip',
      heading: 'Real scenario',
      build: ({ place }) =>
        `Real scenario: you arrive in ${place} with only index averages. By day three you need temporary housing, a local SIM, and groceries — those lines decide whether the first week stays calm.`,
    },
    {
      element: 'warning',
      blockType: 'warning',
      heading: 'Watch out',
      build: ({ place }) =>
        `Warning for ${place}: do not sign or transfer a deposit until deposit months, notice period, and what is included are confirmed in writing.`,
    },
  ];

  // Guide-flavoured extras
  const extras: Partial<Record<GuideId, HelpfulTemplate[]>> = {
    comparison: [
      {
        element: 'trade_off',
        blockType: 'tip',
        heading: 'Comparison trade-off',
        build: ({ place, placeB }) =>
          `Trade-off between ${place}${placeB ? ` and ${placeB}` : ' both places'}: hold lifestyle constant and convert to one currency after tax — then decide on housing + tax drag first.`,
      },
      {
        element: 'checklist',
        blockType: 'list',
        heading: 'Comparison decision criteria',
        build: ({ place, placeB }) => [
          `Hold lifestyle constant between ${place}${placeB ? ` and ${placeB}` : ' both places'} before comparing final residuals`,
          'Weigh the net after-tax take-home residual against local rent differential',
          'Define non-negotiable commuting tolerance before signing any long lease',
        ],
      },
      {
        element: 'decision_tip',
        blockType: 'tip',
        heading: 'Actionable next steps',
        build: ({ place, placeB }) =>
          `Decision tip: compare like-for-like lifestyle between ${place}${placeB ? ` and ${placeB}` : ' the two destinations'}. Run a stress-test budget that factors in a 10% rental overrun and local transit caps before making an irreversible relocation commitment.`,
      },
      {
        element: 'warning',
        blockType: 'warning',
        heading: 'Data gap and local limitations',
        build: ({ place, placeB }) =>
          `Transparent limitation: published cost indices for ${place}${placeB ? ` and ${placeB}` : ''} reflect citywide averages. Actual expenses vary widely by neighbourhood, lease duration, and energy efficiency — always verify one recent utility bill and local rent quote on the ground.`,
      },
      {
        element: 'money_saving',
        blockType: 'tip',
        heading: 'Relocation cost levers',
        build: ({ place, placeB }) =>
          `Money-saving lever: when choosing between ${place}${placeB ? ` and ${placeB}` : ' both cities'}, outer-ring suburbs with direct rail transit often reduce monthly housing spend significantly without adding excessive commute penalty.`,
      },
    ],
    salary: [
      {
        element: 'money_saving',
        blockType: 'tip',
        heading: 'Take-home tip',
        build: ({ place }) =>
          `Money-saving framing for ${place}: negotiate start date or remote days only after the take-home residual clears a realistic rent band.`,
      },
    ],
    rent: [
      {
        element: 'checklist',
        blockType: 'list',
        heading: 'Rent checklist',
        build: ({ place }) => [
          `Deposit months required in ${place}`,
          'Broker/agency fee payer and amount',
          'Utilities included vs metered',
        ],
      },
    ],
    visa: [
      {
        element: 'checklist',
        blockType: 'list',
        heading: 'Visa cash checklist',
        build: ({ place }) => [
          `Application and biometrics fees for ${place}`,
          'Proof-of-funds timing versus appointment date',
          'Buffer for delayed paperwork',
        ],
      },
    ],
  };

  return [...(extras[guideId] || []), ...base];
}

export function scoreHelpfulDraft(draft: WriterDraftPayload): {
  score: number;
  sections: number;
  withAdvice: number;
  definitionOnly: number;
  missingAdviceRatio: number;
  definitionOnlyRatio: number;
} {
  const chunks = draftSectionChunks(draft);
  const sections = chunks.length || 1;
  let withAdvice = 0;
  let definitionOnly = 0;
  for (const c of chunks) {
    if (sectionHasPracticalAdvice(c.text)) withAdvice += 1;
    if (sectionIsDefinitionOnly(c.text)) definitionOnly += 1;
  }
  const missingAdviceRatio = chunks.length ? (chunks.length - withAdvice) / chunks.length : 0;
  const definitionOnlyRatio = chunks.length ? definitionOnly / chunks.length : 0;
  const score = Math.round(
    Math.max(
      0,
      100 -
        missingAdviceRatio * 100 * 0.5 -
        definitionOnlyRatio * 100 * 0.5 -
        (withAdvice === 0 ? 20 : 0)
    )
  );
  return {
    score,
    sections: chunks.length,
    withAdvice,
    definitionOnly,
    missingAdviceRatio,
    definitionOnlyRatio,
  };
}

function insertAfterIndex(blocks: DraftBlock[], index: number, block: DraftBlock): DraftBlock[] {
  if (index < 0) return [...blocks, block];
  return [...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)];
}

function sectionEndIndex(blocks: DraftBlock[], chunk: SectionChunk): number {
  if (chunk.headingId) {
    const hIdx = blocks.findIndex((b) => b.id === chunk.headingId);
    if (hIdx >= 0) {
      let end = hIdx;
      for (let i = hIdx + 1; i < blocks.length; i++) {
        const b = blocks[i];
        if (!b || isProtectedBlock(b) || b.type === 'heading') break;
        end = i;
      }
      return end;
    }
  }
  return chunk.endIndex;
}

/**
 * Ensure every thin/definition-only body section gets at least one helpful element.
 */
export function applyHelpfulContent(input: {
  draft: WriterDraftPayload;
  guideId: GuideId;
  entities?: HelpfulEntityContext;
}): { draft: WriterDraftPayload; report: HelpfulContentReport } {
  const before = scoreHelpfulDraft(input.draft);
  const blocks = [...(input.draft.blocks || [])];
  const place = placeOf(input.entities || {});
  const templates = templatesForGuide(input.guideId);
  let tipIdx = 0;
  const sections_upgraded: string[] = [];
  let helpful_tips_added = 0;

  const chunks = draftSectionChunks({ ...input.draft, blocks });
  const ordered = [...chunks].sort((a, b) => b.startIndex - a.startIndex);

  for (const chunk of ordered) {
    const elements = detectHelpfulElements(chunk.text);
    const needs =
      elements.length === 0 || sectionIsDefinitionOnly(chunk.text) || chunk.text.split(/\s+/).length < 40;
    if (!needs && elements.length > 0) continue;

    const template = templates[tipIdx % templates.length];
    tipIdx += 1;
    const built = template.build({ ...place, guideId: input.guideId });
    const block: DraftBlock = {
      id: mintBlockId('help'),
      type: template.blockType,
      heading: template.heading,
      content: built,
    };
    const end = sectionEndIndex(blocks, chunk);
    const next = insertAfterIndex(blocks, end, block);
    blocks.length = 0;
    blocks.push(...next);
    helpful_tips_added += 1;
    sections_upgraded.push(chunk.heading);
  }

  // Bounded guarantee: if any body section still lacks practical advice, upgrade it directly
  const residualChunks = draftSectionChunks({ ...input.draft, blocks });
  for (const chunk of residualChunks) {
    if (!sectionHasPracticalAdvice(chunk.text)) {
      const template = templates[tipIdx % templates.length];
      tipIdx += 1;
      const built = template.build({ ...place, guideId: input.guideId });
      const block: DraftBlock = {
        id: mintBlockId('help'),
        type: template.blockType,
        heading: template.heading,
        content: built,
      };
      const end = sectionEndIndex(blocks, chunk);
      const next = insertAfterIndex(blocks, end, block);
      blocks.length = 0;
      blocks.push(...next);
      helpful_tips_added += 1;
      sections_upgraded.push(chunk.heading);
    }
  }

  const draft = { ...input.draft, blocks };
  const after = scoreHelpfulDraft(draft);
  return {
    draft,
    report: {
      helpful_tips_added,
      sections_upgraded,
      helpful_score_before: before.score,
      helpful_score_after: after.score,
    },
  };
}
