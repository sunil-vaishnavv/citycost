/**
 * Decision Support Engine (Writer v2).
 * Distinct from `validation/decision-engine.ts` (review/ready decisions).
 * Every major body section ends with Decision Guidance: So what? / What should I do? / When does this matter?
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import { mintBlockId, isProtectedBlock } from './block-integrity.js';
import type { GuideId } from './types.js';
import { draftSectionChunks, type SectionChunk } from './section-chunks.js';

export interface DecisionEntityContext {
  country?: string;
  city?: string;
  city_b?: string;
}

export interface DecisionSupportReport {
  decision_blocks_added: number;
  sections_upgraded: string[];
}

export const DECISION_SIGNAL =
  /\b(so what|what (?:should|to) (?:you|i) do|when (?:this|it) matters|decision(?: guidance| tip)?|next step|you should|decide whether|before you (?:commit|sign|move))\b/i;

interface DecisionTemplate {
  headingHints: RegExp[];
  build: (ctx: { place: string; placeB?: string; guideId: GuideId }) => string;
}

function placeOf(ctx: DecisionEntityContext): { place: string; placeB?: string } {
  const place = ctx.city?.trim() || ctx.country?.trim() || 'your destination';
  const placeB = ctx.city_b?.trim() || undefined;
  return { place, placeB };
}

const SHARED_CLOSER = (place: string) =>
  `So what: treat averages as a planning baseline for ${place}, not a final number. What you should do: collect one local quote for the largest cost line, then decide with a contingency buffer. When this matters: before you sign a lease, accept an offer, or move money you cannot easily reverse.`;

const GUIDE_DECISION_REGISTRY: Record<GuideId, DecisionTemplate[]> = {
  country: [
    {
      headingHints: [/hous|rent|apart/i],
      build: ({ place }) =>
        `So what: housing usually decides whether ${place} is affordable for your household. What you should do: shortlist two regions and compare rent + deposit cash need before picking a city tier. When this matters: before you resign, ship belongings, or lock a long lease.`,
    },
    {
      headingHints: [/transport|transit|commut/i],
      build: ({ place }) =>
        `So what: transport cost in ${place} depends on corridor, not citywide averages. What you should do: time your real commute and price a monthly pass versus mixed rides. When this matters: when choosing a neighbourhood that looks cheap on rent alone.`,
    },
    {
      headingHints: [/.*/],
      build: ({ place }) => SHARED_CLOSER(place),
    },
  ],
  city: [
    {
      headingHints: [/neighbour|neighbor|area|district/i],
      build: ({ place }) =>
        `So what: neighbourhood choice in ${place} changes rent, commute, and weekend spend together. What you should do: visit at peak hour and reject any area that only works with perfect conditions. When this matters: before you pay a deposit.`,
    },
    {
      headingHints: [/.*/],
      build: ({ place }) => SHARED_CLOSER(place),
    },
  ],
  comparison: [
    {
      headingHints: [/pros|cons|should|recommend|who/i],
      build: ({ place, placeB }) =>
        `So what: a winner between ${place}${placeB ? ` and ${placeB}` : ' the two options'} only exists relative to your non-negotiables. What you should do: write two must-haves, score both places, and drop any option that fails one. When this matters: before you relocate or renegotiate pay.`,
    },
    {
      headingHints: [/.*/],
      build: ({ place, placeB }) =>
        `So what: compare like-for-like lifestyle in ${place}${placeB ? ` vs ${placeB}` : ''}, not tourist snapshots. What you should do: convert to one currency after tax and subtract realistic rent. When this matters: when an offer or lease decision is imminent.`,
    },
  ],
  salary: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: headline salary in ${place} is meaningless until take-home clears rent and essentials. What you should do: rebuild the budget from net pay, then stress-test a 10% rent overrun. When this matters: before you accept or decline an offer.`,
    },
  ],
  rent: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: move-in cash in ${place} is often 2–3× monthly rent once deposit and fees are included. What you should do: list deposit, broker, and first month as a separate cash need. When this matters: before you transfer funds or sign.`,
    },
  ],
  student: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: student budgets in ${place} break on housing and early admin fees, not coffee. What you should do: fund shared housing + transport pass + an emergency line before term starts. When this matters: when visa or registration deadlines approach.`,
    },
  ],
  visa: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: visa timing for ${place} can force expensive temporary housing if cash arrives late. What you should do: map fees and proof-of-funds to appointment dates. When this matters: 4–8 weeks before biometrics or entry.`,
    },
  ],
  moving: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: the first two weeks in ${place} cost more than steady-state months. What you should do: pre-fund temporary housing, SIM, and groceries until local banking works. When this matters: the week before departure.`,
    },
  ],
  healthcare: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: healthcare access in ${place} can erase a cheap rent advantage after one unexpected visit. What you should do: price a GP visit and decide on private cover for month one. When this matters: before you cancel existing insurance.`,
    },
  ],
  food: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: food spend in ${place} spikes when you have no kitchen routine yet. What you should do: set a grocery baseline plus a capped eating-out line for week one. When this matters: as soon as you arrive.`,
    },
  ],
  travel: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: trip transport to ${place} is not the same as daily living cost. What you should do: split flight/transfer from local daily spend before comparing destinations. When this matters: when booking and when setting a trip budget.`,
    },
  ],
  budget: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: a budget for ${place} fails when fixed costs overrun and discretionary is not frozen first. What you should do: separate fixed / flexible / discretionary and cut discretionary under stress. When this matters: every time a quote exceeds the plan.`,
    },
  ],
  remote: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: remote life in ${place} depends on internet reliability and tax-day counts as much as rent. What you should do: confirm connectivity and residency assumptions before a long stay. When this matters: before you pass 90/180 days.`,
    },
  ],
  retirement: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: retirement affordability in ${place} hinges on healthcare and housing staying stable. What you should do: model those as non-negotiable, then size lifestyle to survive a currency swing. When this matters: before you commit to a long lease or sell a home base.`,
    },
  ],
  tax: [
    {
      headingHints: [/.*/],
      build: ({ place }) =>
        `So what: tax drag in ${place} can flip a “higher salary” decision. What you should do: budget from estimated net, not gross. When this matters: before you accept an offer or change residency.`,
    },
  ],
};

export function sectionHasDecisionGuidance(text: string): boolean {
  return DECISION_SIGNAL.test(text);
}

function pickDecision(
  guideId: GuideId,
  chunk: SectionChunk,
  ctx: DecisionEntityContext
): string {
  const { place, placeB } = placeOf(ctx);
  const registry = GUIDE_DECISION_REGISTRY[guideId] || GUIDE_DECISION_REGISTRY.country;
  const hit =
    registry.find((t) => t.headingHints.some((re) => re.test(chunk.heading))) ||
    registry[registry.length - 1];
  return hit.build({ place, placeB, guideId });
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
 * Append Decision Guidance tips to major body sections that lack them.
 */
export function applyDecisionSupport(input: {
  draft: WriterDraftPayload;
  guideId: GuideId;
  entities?: DecisionEntityContext;
}): { draft: WriterDraftPayload; report: DecisionSupportReport } {
  const blocks = [...(input.draft.blocks || [])];
  const chunks = draftSectionChunks({ ...input.draft, blocks });
  const sections_upgraded: string[] = [];
  let decision_blocks_added = 0;

  const ordered = [...chunks].sort((a, b) => b.startIndex - a.startIndex);
  for (const chunk of ordered) {
    if (sectionHasDecisionGuidance(chunk.text)) continue;
    if (chunk.text.split(/\s+/).length < 25) continue;

    const content = pickDecision(input.guideId, chunk, input.entities || {});
    const tip: DraftBlock = {
      id: mintBlockId('dec'),
      type: 'tip',
      heading: 'Decision guidance',
      content,
    };
    const end = sectionEndIndex(blocks, chunk);
    const next = insertAfterIndex(blocks, end, tip);
    blocks.length = 0;
    blocks.push(...next);
    decision_blocks_added += 1;
    sections_upgraded.push(chunk.heading);
  }

  return {
    draft: { ...input.draft, blocks },
    report: { decision_blocks_added, sections_upgraded },
  };
}

export function draftHasDecisionGuidance(draft: WriterDraftPayload): boolean {
  const chunks = draftSectionChunks(draft);
  if (!chunks.length) {
    // Fall back to whole-draft scan
    const blob = (draft.blocks || [])
      .map((b) => (typeof b.content === 'string' ? b.content : ''))
      .join(' ');
    return sectionHasDecisionGuidance(blob);
  }
  return chunks.some((c) => sectionHasDecisionGuidance(c.text));
}
