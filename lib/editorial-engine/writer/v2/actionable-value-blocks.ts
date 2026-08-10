/**
 * Actionable Value Blocks — every guide type gets decision-support blocks
 * (checklists, who should live here, deposit checklist, winner summary, timeline, etc.)
 * from a reusable registry. Composes with helpful-content + decision-support engines.
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import { mintBlockId } from './block-integrity.js';
import type { GuideId } from './types.js';
import { draftSectionChunks } from './section-chunks.js';
import { sectionHasDecisionGuidance } from './decision-support-engine.js';
import { detectHelpfulElements, sectionHasPracticalAdvice } from './helpful-content.js';

export type ValueBlockKind =
  | 'decision_checklist'
  | 'who_should'
  | 'deposit_checklist'
  | 'winner_summary'
  | 'timeline'
  | 'budget_split'
  | 'offer_checklist'
  | 'move_in_timeline'
  | 'cover_decision'
  | 'week_one_food'
  | 'trip_vs_living'
  | 'fixed_flexible_cut'
  | 'residency_days'
  | 'healthcare_stability'
  | 'visa_cash_timeline'
  | 'student_term_checklist';

export interface ValueBlockTemplate {
  kind: ValueBlockKind;
  blockType: 'list' | 'tip' | 'warning';
  heading: string;
  /** Detect if already present */
  detect: RegExp;
  build: (ctx: { place: string; placeB?: string }) => string | string[];
}

function placeOf(ctx: { country?: string; city?: string; city_b?: string }): {
  place: string;
  placeB?: string;
} {
  return {
    place: ctx.city?.trim() || ctx.country?.trim() || 'your destination',
    placeB: ctx.city_b?.trim() || undefined,
  };
}

/** Required actionable blocks per guide — reusable, entity-parameterized. */
export const GUIDE_VALUE_BLOCK_REGISTRY: Record<GuideId, ValueBlockTemplate[]> = {
  country: [
    {
      kind: 'decision_checklist',
      blockType: 'list',
      heading: 'Decision checklist',
      detect: /\bdecision checklist\b/i,
      build: ({ place }) => [
        `Pick two regions in ${place} and compare rent + deposit cash need`,
        'Convert essentials to one currency after tax assumptions',
        'Reject any plan without a contingency buffer',
      ],
    },
    {
      kind: 'who_should',
      blockType: 'tip',
      heading: 'Who this works for',
      detect: /\bwho (?:this|should) (?:works? for|live|move)\b/i,
      build: ({ place }) =>
        `Who should lean toward ${place}: households that can lock housing first and keep a cash buffer for regional swings. Who should pause: anyone treating a national average as a personal rent quote.`,
    },
  ],
  city: [
    {
      kind: 'decision_checklist',
      blockType: 'list',
      heading: 'Neighbourhood decision checklist',
      detect: /\b(?:neighbourhood|neighborhood|decision) checklist\b/i,
      build: ({ place }) => [
        `Visit the shortlist in ${place} at peak commute hour`,
        'Price rent + deposit + a realistic weekday food line together',
        'Drop any area that only works with perfect conditions',
      ],
    },
    {
      kind: 'who_should',
      blockType: 'tip',
      heading: 'Who should live here',
      detect: /\bwho should (?:live|move)\b/i,
      build: ({ place }) =>
        `Who should live in ${place}: people who can fund move-in cash and accept neighbourhood trade-offs on commute. Who should wait: anyone without a deposit buffer or a verified rent band.`,
    },
  ],
  comparison: [
    {
      kind: 'winner_summary',
      blockType: 'tip',
      heading: 'Winner summary',
      detect: /\bwinner summary\b|\bwho wins\b/i,
      build: ({ place, placeB }) =>
        `Winner summary: ${place}${placeB ? ` vs ${placeB}` : ' vs the alternative'} only has a winner relative to your must-haves. Score housing + tax drag + cash buffer; drop any option that fails one non-negotiable.`,
    },
    {
      kind: 'decision_checklist',
      blockType: 'list',
      heading: 'Comparison decision checklist',
      detect: /\bcomparison (?:decision )?checklist\b/i,
      build: ({ place, placeB }) => [
        `Hold lifestyle constant between ${place}${placeB ? ` and ${placeB}` : ' both places'}`,
        'Convert to one currency after tax',
        'Write two must-haves before picking a “winner”',
      ],
    },
  ],
  salary: [
    {
      kind: 'offer_checklist',
      blockType: 'list',
      heading: 'Offer checklist',
      detect: /\boffer checklist\b/i,
      build: ({ place }) => [
        `Rebuild take-home for ${place} from net, not gross`,
        'Subtract realistic rent + essentials',
        'Stress-test a 10% rent overrun before accepting',
      ],
    },
    {
      kind: 'budget_split',
      blockType: 'tip',
      heading: 'Residual check',
      detect: /\bresidual\b|\btake-?home\b/i,
      build: ({ place }) =>
        `So what for ${place}: headline salary is meaningless until residual clears rent. What you should do: decide only after the residual stress test. When this matters: before you accept or decline.`,
    },
  ],
  rent: [
    {
      kind: 'deposit_checklist',
      blockType: 'list',
      heading: 'Deposit checklist',
      detect: /\bdeposit checklist\b/i,
      build: ({ place }) => [
        `Deposit months required in ${place}`,
        'Broker/agency fee payer and amount',
        'What is included vs metered utilities',
        'Return conditions and typical deductions',
      ],
    },
    {
      kind: 'decision_checklist',
      blockType: 'list',
      heading: 'Before you sign',
      detect: /\bbefore you sign\b/i,
      build: ({ place }) => [
        `List move-in cash for ${place} as deposit + first month + fees`,
        'Get inclusions in writing',
        'Do not transfer funds until notice period is clear',
      ],
    },
  ],
  student: [
    {
      kind: 'student_term_checklist',
      blockType: 'list',
      heading: 'Term-start checklist',
      detect: /\bterm(?:-|\s)?start checklist\b/i,
      build: ({ place }) => [
        `Shared housing deposit for ${place}`,
        'Transport pass for the term',
        'Admin/registration fee buffer',
        'Emergency line before visa or enrolment deadlines',
      ],
    },
  ],
  visa: [
    {
      kind: 'visa_cash_timeline',
      blockType: 'list',
      heading: 'Visa cash timeline',
      detect: /\bvisa (?:cash )?timeline\b/i,
      build: ({ place }) => [
        `Map application fees for ${place} to appointment dates`,
        'Proof-of-funds ready before biometrics',
        'Temporary housing buffer if paperwork slips 2–4 weeks',
      ],
    },
  ],
  moving: [
    {
      kind: 'move_in_timeline',
      blockType: 'list',
      heading: 'First two weeks timeline',
      detect: /\bfirst (?:two )?weeks?\b|\bmove-?in timeline\b/i,
      build: ({ place }) => [
        `Pre-fund temporary housing for arrival in ${place}`,
        'Local SIM + groceries until banking works',
        'Separate move-in cash from steady-state monthly spend',
      ],
    },
  ],
  healthcare: [
    {
      kind: 'cover_decision',
      blockType: 'tip',
      heading: 'Cover decision',
      detect: /\bcover decision\b|\bprivate cover\b/i,
      build: ({ place }) =>
        `Cover decision for ${place}: price a GP visit, then decide on private cover for month one before you cancel existing insurance. So what: one unexpected visit can erase a cheap rent advantage.`,
    },
  ],
  food: [
    {
      kind: 'week_one_food',
      blockType: 'list',
      heading: 'Week-one food plan',
      detect: /\bweek-?one food\b/i,
      build: ({ place }) => [
        `Set a grocery baseline for ${place}`,
        'Cap eating-out for week one',
        'Prioritise kitchen setup to stop the spike',
      ],
    },
  ],
  travel: [
    {
      kind: 'trip_vs_living',
      blockType: 'tip',
      heading: 'Trip vs living cost',
      detect: /\btrip vs living\b|\bsplit flight\b/i,
      build: ({ place }) =>
        `Trip vs living cost for ${place}: split flight/transfer from local daily spend before comparing destinations. What you should do: budget them as separate lines when booking.`,
    },
  ],
  budget: [
    {
      kind: 'fixed_flexible_cut',
      blockType: 'list',
      heading: 'Cut-order checklist',
      detect: /\bcut-?order\b|\bfixed \/ flexible\b/i,
      build: ({ place }) => [
        `Separate fixed / flexible / discretionary for ${place}`,
        'Freeze discretionary first when quotes overrun',
        'Protect rent and healthcare lines',
      ],
    },
  ],
  remote: [
    {
      kind: 'residency_days',
      blockType: 'tip',
      heading: 'Residency-day check',
      detect: /\bresidency|90\/180|tax-day\b/i,
      build: ({ place }) =>
        `Residency-day check for ${place}: confirm internet reliability and day-count assumptions before a long stay. So what: connectivity and tax days can matter as much as rent.`,
    },
  ],
  retirement: [
    {
      kind: 'healthcare_stability',
      blockType: 'tip',
      heading: 'Stability checklist',
      detect: /\bstability checklist\b|\bhealthcare and housing\b/i,
      build: ({ place }) =>
        `Stability for ${place}: model healthcare and housing as non-negotiable, then size lifestyle to survive a currency swing. Decide before a long lease or selling a home base.`,
    },
  ],
  tax: [
    {
      kind: 'decision_checklist',
      blockType: 'list',
      heading: 'Net-pay checklist',
      detect: /\bnet-?pay checklist\b/i,
      build: ({ place }) => [
        `Budget ${place} from estimated net, not gross`,
        'Re-check residency triggers',
        'Decide before accepting an offer or changing base',
      ],
    },
  ],
};

export interface ActionableValueReport {
  blocks_added: number;
  kinds_added: ValueBlockKind[];
  missing_before: ValueBlockKind[];
}

function draftBlob(draft: WriterDraftPayload): string {
  return (draft.blocks || [])
    .map((b) => {
      const head = b.heading || '';
      if (typeof b.content === 'string') return `${head} ${b.content}`;
      if (Array.isArray(b.content)) {
        const items = b.content
          .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join(' ');
        return `${head} ${items}`;
      }
      return head;
    })
    .join('\n');
}

function insertBeforeFaq(blocks: DraftBlock[], block: DraftBlock): DraftBlock[] {
  const faqIdx = blocks.findIndex((b) => b.type === 'faq');
  if (faqIdx >= 0) return [...blocks.slice(0, faqIdx), block, ...blocks.slice(faqIdx)];
  const summaryIdx = blocks.findIndex((b) => b.type === 'summary');
  if (summaryIdx >= 0) return [...blocks.slice(0, summaryIdx), block, ...blocks.slice(summaryIdx)];
  return [...blocks, block];
}

/**
 * Ensure guide-required actionable value blocks exist. Idempotent via detect regexes.
 */
export function applyActionableValueBlocks(input: {
  draft: WriterDraftPayload;
  guideId: GuideId;
  entities?: { country?: string; city?: string; city_b?: string };
}): { draft: WriterDraftPayload; report: ActionableValueReport } {
  const templates = GUIDE_VALUE_BLOCK_REGISTRY[input.guideId] || GUIDE_VALUE_BLOCK_REGISTRY.country;
  const place = placeOf(input.entities || {});
  let blob = draftBlob(input.draft);
  const blocks = [...(input.draft.blocks || [])];
  const kinds_added: ValueBlockKind[] = [];
  const missing_before: ValueBlockKind[] = [];

  for (const t of templates) {
    if (t.detect.test(blob)) continue;
    missing_before.push(t.kind);
    const built = t.build(place);
    const block: DraftBlock = {
      id: mintBlockId('val'),
      type: t.blockType,
      heading: t.heading,
      content: built,
    };
    const next = insertBeforeFaq(blocks, block);
    blocks.length = 0;
    blocks.push(...next);
    kinds_added.push(t.kind);
    blob = draftBlob({ ...input.draft, blocks });
  }

  return {
    draft: { ...input.draft, blocks },
    report: {
      blocks_added: kinds_added.length,
      kinds_added,
      missing_before,
    },
  };
}

/**
 * Stronger helpfulness gate: require actionable value + decision support,
 * not explanation-only prose.
 */
export function validateActionableValue(draft: WriterDraftPayload, guideId: GuideId): {
  ok: boolean;
  missing: ValueBlockKind[];
  score: number;
  findings: Array<{ code: string; message: string; severity: 'error' | 'warn' }>;
} {
  const templates = GUIDE_VALUE_BLOCK_REGISTRY[guideId] || GUIDE_VALUE_BLOCK_REGISTRY.country;
  const blob = draftBlob(draft);
  const missing: ValueBlockKind[] = [];
  const findings: Array<{ code: string; message: string; severity: 'error' | 'warn' }> = [];

  for (const t of templates) {
    if (!t.detect.test(blob)) {
      // Also accept if heading text or helpful/decision signals cover intent
      const alt =
        (t.kind === 'decision_checklist' && /\bchecklist\b/i.test(blob) && sectionHasDecisionGuidance(blob)) ||
        (t.kind === 'who_should' && /\bwho should\b/i.test(blob)) ||
        (t.kind === 'winner_summary' && /\b(winner|must-have|score both)\b/i.test(blob));
      if (!alt) {
        missing.push(t.kind);
        findings.push({
          code: `missing_${t.kind}`,
          message: `Missing actionable block: ${t.heading}`,
          severity: 'error',
        });
      }
    }
  }

  // Definition-only sections still fail even if global blocks exist
  const chunks = draftSectionChunks(draft);
  let thin = 0;
  for (const c of chunks) {
    if (!sectionHasPracticalAdvice(c.text) && detectHelpfulElements(c.text).length === 0) {
      thin += 1;
    }
  }
  // Soften: if required guide blocks are present, only warn on thin sections
  // (helpfulness pipeline upgrades sections separately). Hard-fail only when
  // a majority of sections are empty of advice AND required blocks are missing.
  if (chunks.length >= 2 && thin / chunks.length > 0.3 && missing.length > 0) {
    findings.push({
      code: 'too_many_explanation_only',
      message: 'Too many sections lack actionable value',
      severity: 'error',
    });
  } else if (chunks.length >= 2 && thin / chunks.length > 0.5) {
    // Even with global blocks, majority thin sections → still an error
    // unless the draft blob itself has checklist/decision signals
    const hasGlobalAction =
      /\b(checklist|so what|what you should do|before you sign|who should)\b/i.test(blob);
    if (!hasGlobalAction) {
      findings.push({
        code: 'too_many_explanation_only',
        message: 'Too many sections lack actionable value',
        severity: 'error',
      });
    }
  }

  const ok =
    missing.length === 0 &&
    !findings.some((f) => f.severity === 'error' && f.code === 'too_many_explanation_only');
  const score = ok ? 100 : Math.max(0, 50 - missing.length * 15);
  return { ok, missing, score, findings };
}

/** Soft check used when blocks may sit under different headings. */
export function draftHasActionableValue(draft: WriterDraftPayload, guideId: GuideId): boolean {
  return validateActionableValue(draft, guideId).ok;
}
