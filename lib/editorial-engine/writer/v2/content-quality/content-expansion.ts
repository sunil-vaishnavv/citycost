/**
 * Content expansion — meaningful only. Never repeat-to-pad word count.
 */

import { countDraftWords, type DraftBlock, type WriterDraftPayload } from '../../draft-validate.js';
import { mintBlockId } from '../block-integrity.js';
import { fingerprint, similarityScore } from './text-metrics.js';
import type { GuideId } from '../types.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';

const FAKE_EXPAND_MARKERS = [
  /re-?run the three-line budget after collecting/i,
  /revisit the worksheet after you collect local quotes/i,
  /reflects the neighbourhood you will actually live in, not a citywide average/i,
];

function detectFakeExpansion(text: string): boolean {
  if (FAKE_EXPAND_MARKERS.some((re) => re.test(text))) return true;
  // Same sentence repeated 3+ times
  const parts = text.split(/(?<=[.!?])\s+/).map((s) => fingerprint(s)).filter((s) => s.length > 40);
  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p, (counts.get(p) || 0) + 1);
  for (const n of counts.values()) if (n >= 3) return true;
  return false;
}

function stripFakeExpansion(blocks: DraftBlock[]): { blocks: DraftBlock[]; stripped: number } {
  let stripped = 0;
  const next = blocks.map((b) => {
    if (typeof b.content !== 'string') return b;
    if (!detectFakeExpansion(b.content)) return b;
    const sentences = b.content.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];
    const seen = new Set<string>();
    for (const s of sentences) {
      const fp = fingerprint(s);
      if (FAKE_EXPAND_MARKERS.some((re) => re.test(s))) {
        stripped += 1;
        continue;
      }
      if (seen.has(fp)) {
        stripped += 1;
        continue;
      }
      seen.add(fp);
      kept.push(s);
    }
    return { ...b, content: kept.join(' ').trim() };
  }).filter((b) => (typeof b.content === 'string' ? b.content.length > 20 : true));
  return { blocks: next, stripped };
}

function meaningfulAddition(guideId: GuideId, country?: string, city?: string): DraftBlock {
  const place = city || country || 'your destination';
  const byGuide: Partial<Record<GuideId, string>> = {
    country: `Decision guide for ${place}: list three regions, estimate housing + food + transport for each, then choose the region where the residual still covers healthcare and a 10% contingency before you commit to a lease.`,
    city: `City-specific tip for ${place}: gather two rent quotes in different neighbourhoods, add commute time as a cost, and reject any total that only works if dining and transport stay unrealistically low.`,
    comparison: `Comparison checklist: hold lifestyle constant across both places, convert to one currency, and pick the winner on housing + tax drag first — then use food and transport only as tie-breakers.`,
    salary: `Salary decision tip: convert offers to monthly take-home, subtract a realistic rent band, and only treat the remainder as discretionary once healthcare and tax withholdings are accounted for.`,
    rent: `Rent practical check: confirm deposit months, agency fees, and whether utilities are included. Build a first-month cash need separate from the ongoing monthly rent line.`,
    student: `Student budget example: tuition (if any) + shared housing + groceries + transport pass. Keep a small emergency line for visa or registration fees that hit early in the term.`,
    visa: `Visa action step: map application fees, biometrics, and proof-of-funds requirements onto a calendar so cash buffers arrive before appointment dates — not after.`,
    moving: `Moving-week checklist: temporary housing, SIM/setup fees, and two weeks of groceries before your first local paycheck or transfer clears.`,
    healthcare: `Healthcare planning: price a basic GP visit and one common prescription equivalent, then decide whether private cover is needed for the first six months.`,
    food: `Food budget example: mix grocery staples with two eating-out meals per week, then stress-test what happens if eating-out doubles during the first month.`,
    travel: `Travel cost tip: separate trip transport from local daily spend so a cheap flight does not hide expensive airport transfers and tourist-area meals.`,
    budget: `Budget worksheet: fixed (rent/utilities), flexible (food/transport), and discretionary. Freeze discretionary first when quotes overrun.`,
    remote: `Remote-work setup: confirm reliable coworking or home internet cost and whether your tax residency assumptions still hold after 90/180 days.`,
    retirement: `Retirement pacing: model healthcare and housing as non-negotiable, then set lifestyle spend at a level that survives a 15% currency or inflation swing.`,
  };
  const content =
    byGuide[guideId] ||
    `Practical next step for ${place}: write down housing, essentials, and a contingency line, then collect one local quote for the largest line before treating averages as a plan.`;
  return {
    id: mintBlockId('cq-example'),
    type: 'tip',
    heading: 'Decision tip',
    content,
  };
}

function hasDecisionValue(draft: WriterDraftPayload): boolean {
  const text = (draft.blocks || [])
    .map((b) => (typeof b.content === 'string' ? b.content : ''))
    .join(' ')
    .toLowerCase();
  const signals = [
    /you should|decide|compare|checklist|example|budget|tip|when to|how to|next step|practical/,
    /deposit|contingency|take-home|neighbourhood|neighborhood|quote/,
  ];
  return signals.filter((re) => re.test(text)).length >= 2;
}

function insertBeforeFaq(blocks: DraftBlock[], extra: DraftBlock[]): DraftBlock[] {
  const faqIdx = blocks.findIndex((b) => b.type === 'faq');
  if (faqIdx >= 0) return [...blocks.slice(0, faqIdx), ...extra, ...blocks.slice(faqIdx)];
  return [...blocks, ...extra];
}

export function expandContentMeaningfully(input: {
  draft: WriterDraftPayload;
  guideId: GuideId;
  country?: string;
  city?: string;
  articleMinWords?: number;
}): {
  draft: WriterDraftPayload;
  result: ValidatorResult;
  examples_added: number;
  expansion_words_added: number;
} {
  const findings: ValidatorFinding[] = [];
  let blocks = [...(input.draft.blocks || [])];
  const stripped = stripFakeExpansion(blocks);
  blocks = stripped.blocks;
  if (stripped.stripped) {
    findings.push({
      code: 'fake_expansion_removed',
      message: `Removed ${stripped.stripped} fake expansion fragment(s)`,
      severity: 'warn',
    });
  }

  let draft: WriterDraftPayload = { ...input.draft, blocks };
  let examples_added = 0;
  let expansion_words_added = 0;
  const beforeWords = countDraftWords(draft);
  const min = input.articleMinWords ?? 0;

  // Only expand when short AND lacking decision value — never pad by repetition
  const needsValue = !hasDecisionValue(draft);
  const needsWords = min > 0 && beforeWords < min * 0.85;

  if (needsValue || (needsWords && beforeWords < 1200)) {
    const tip = meaningfulAddition(input.guideId, input.country, input.city);
    // Avoid adding a near-duplicate tip
    const existingTips = blocks
      .filter((b) => b.type === 'tip' || b.type === 'paragraph')
      .map((b) => (typeof b.content === 'string' ? b.content : ''));
    const dup = existingTips.some((t) => similarityScore(t, tip.content as string) >= 0.7);
    if (!dup) {
      blocks = insertBeforeFaq(blocks, [tip]);
      examples_added = 1;
      draft = { ...draft, blocks };
      expansion_words_added = Math.max(0, countDraftWords(draft) - beforeWords);
      findings.push({
        code: 'meaningful_example_added',
        message: 'Added decision/example guidance (not filler)',
        severity: 'info',
      });
    }
  } else if (min > 0 && beforeWords < min) {
    findings.push({
      code: 'skip_pad',
      message: `Article has enough value (${beforeWords} words); skipped fake word-count padding`,
      severity: 'info',
    });
  }

  // Fail if fake expansion patterns still present
  const residualFake = (draft.blocks || []).some(
    (b) => typeof b.content === 'string' && detectFakeExpansion(b.content)
  );
  const score = residualFake ? 30 : Math.max(70, 100 - stripped.stripped * 5);
  return {
    draft,
    examples_added,
    expansion_words_added,
    result: {
      category: 'content_expansion',
      status: residualFake ? 'FAIL' : statusFromScore(score, false, stripped.stripped > 0),
      score,
      findings: residualFake
        ? [
            ...findings,
            {
              code: 'fake_expansion_residual',
              message: 'Fake word-count expansion patterns remain',
              severity: 'error',
            },
          ]
        : findings,
    },
  };
}

/** Detect fake expansion patterns (for regression assertions). */
export function hasFakeExpansionPattern(draft: WriterDraftPayload): boolean {
  return (draft.blocks || []).some((b) => typeof b.content === 'string' && detectFakeExpansion(b.content));
}
