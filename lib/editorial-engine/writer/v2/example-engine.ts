/**
 * Real World Example Engine — inject practical, research-backed examples by guide type.
 * Never invents facts; templates are parameterized by entity context from the research pack.
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import { mintBlockId, isProtectedBlock } from './block-integrity.js';
import type { GuideId } from './types.js';
import { draftSectionChunks, lastBodyBlockIndex, type SectionChunk } from './section-chunks.js';

export interface ExampleEntityContext {
  country?: string;
  city?: string;
  city_b?: string;
  /** Free-form known facts / research snippets (optional) */
  known_facts?: string[];
}

export interface ExampleEngineReport {
  examples_added: number;
  sections_upgraded: string[];
  guide_id: GuideId;
}

export type ExampleKind =
  | 'payments'
  | 'deposit'
  | 'utilities'
  | 'internet'
  | 'housing'
  | 'sim'
  | 'transport'
  | 'city_tier'
  | 'neighbourhood'
  | 'commute'
  | 'metro'
  | 'parking'
  | 'groceries'
  | 'weekend'
  | 'earn_compare'
  | 'remote_compare'
  | 'children'
  | 'rent_tradeoff'
  | 'pros_cons'
  | 'salary_band'
  | 'disposable'
  | 'savings'
  | 'lease'
  | 'broker'
  | 'maintenance'
  | 'student_life'
  | 'visa_cash'
  | 'moving_week'
  | 'healthcare_visit'
  | 'food_mix'
  | 'travel_split'
  | 'budget_lines'
  | 'remote_setup'
  | 'retirement_pace';

interface ExampleTemplate {
  kind: ExampleKind;
  /** Section heading keywords that prefer this example */
  headingHints: RegExp[];
  /** Build prose from entity context — no invented numbers */
  build: (ctx: ResolvedPlace) => string;
}

interface ResolvedPlace {
  place: string;
  placeB?: string;
  country?: string;
  city?: string;
  factHint?: string;
}

function resolvePlace(ctx: ExampleEntityContext): ResolvedPlace {
  const city = ctx.city?.trim() || undefined;
  const country = ctx.country?.trim() || undefined;
  const place = city || country || 'your destination';
  const placeB = ctx.city_b?.trim() || undefined;
  const factHint = (ctx.known_facts || [])
    .map((f) => f.trim())
    .find((f) => f.length > 20 && f.length < 220);
  return { place, placeB, country, city, factHint };
}

function withFact(base: string, factHint?: string): string {
  if (!factHint) return base;
  // Attach research snippet as grounding — never invent a second number
  return `${base} Ground this against research notes: ${factHint.replace(/\s+/g, ' ').trim()}`;
}

/** Guide-type registries — reusable, not article-specific. */
const GUIDE_EXAMPLE_REGISTRY: Record<GuideId, ExampleTemplate[]> = {
  country: [
    {
      kind: 'payments',
      headingHints: [/overview|payment|bank|money|cost/i],
      build: (p) =>
        withFact(
          `Real-world example in ${p.place}: open a local bank or wallet account early, then pay rent and utilities with the payment method locals actually use day-to-day — card-only habits often fail for deposits and small vendors.`,
          p.factHint
        ),
    },
    {
      kind: 'deposit',
      headingHints: [/hous|rent|apart|accommod/i],
      build: (p) =>
        withFact(
          `Practical move in ${p.place}: treat the security deposit as a separate cash line from first-month rent, and confirm whether agency fees are due before keys are handed over.`,
          p.factHint
        ),
    },
    {
      kind: 'utilities',
      headingHints: [/utilit|electric|energy|power/i],
      build: (p) =>
        `What a real person does in ${p.place}: ask the landlord whether electricity and water are metered separately, then budget a first bill buffer until you see a full-cycle statement.`,
    },
    {
      kind: 'internet',
      headingHints: [/internet|connect|wifi|digital/i],
      build: (p) =>
        `Local setup in ${p.place}: compare a prepaid SIM hotspot for the first week against a home fibre install — remote workers usually need the install date before they cancel temporary data.`,
    },
    {
      kind: 'housing',
      headingHints: [/hous|apart|rent|live/i],
      build: (p) =>
        withFact(
          `Apartment hunt example for ${p.place}: shortlist two neighbourhoods at different price bands, visit at commute hour, and reject any listing that only works if you never cook or travel.`,
          p.factHint
        ),
    },
    {
      kind: 'sim',
      headingHints: [/phone|sim|mobile|connect/i],
      build: (p) =>
        `Day-one checklist in ${p.place}: buy a local SIM with passport ID, enable mobile payments if available, and keep your home number active until banking OTPs are migrated.`,
    },
    {
      kind: 'transport',
      headingHints: [/transport|transit|commut|travel/i],
      build: (p) =>
        `Transport reality in ${p.place}: price a monthly pass versus mixed rides for your actual commute corridor — citywide averages hide whether you live near a metro line or depend on taxis.`,
    },
    {
      kind: 'city_tier',
      headingHints: [/region|city|tier|where|major/i],
      build: (p) =>
        withFact(
          `City-tier contrast for ${p.country || p.place}: model the same household in a capital/metro market versus a smaller city — rent usually moves more than groceries, so the residual after housing is the real decision signal.`,
          p.factHint
        ),
    },
  ],
  city: [
    {
      kind: 'neighbourhood',
      headingHints: [/neighbour|neighbor|area|district|where/i],
      build: (p) =>
        withFact(
          `Neighbourhood example in ${p.place}: pick one central and one outer area, compare door-to-door commute plus grocery walkability, then choose the area where weeknight logistics still feel sane.`,
          p.factHint
        ),
    },
    {
      kind: 'commute',
      headingHints: [/commut|transport|travel|get around/i],
      build: (p) =>
        `Commute test in ${p.place}: time the peak trip from your shortlisted flat to work or coworking twice before signing — a cheap rent that adds an hour each way often costs more in meals and fatigue.`,
    },
    {
      kind: 'metro',
      headingHints: [/metro|transit|rail|bus|transport/i],
      build: (p) =>
        `Transit tip for ${p.place}: map whether your building sits inside a reliable metro/bus corridor; if not, add a monthly rideshare or parking line before calling the budget complete.`,
    },
    {
      kind: 'parking',
      headingHints: [/park|car|driv/i],
      build: (p) =>
        `Parking reality in ${p.place}: ask whether street parking is permit-only and whether the building includes a spot — car ownership can quietly double transport cost in dense districts.`,
    },
    {
      kind: 'groceries',
      headingHints: [/food|groc|market|eat/i],
      build: (p) =>
        `Grocery pattern in ${p.place}: split staples from a supermarket with one fresh market run per week, then stress-test the first month when jet-lag eating-out spikes.`,
    },
    {
      kind: 'weekend',
      headingHints: [/life|weekend|leisure|lifestyle|social/i],
      build: (p) =>
        `Weekend lifestyle check in ${p.place}: budget one paid outing and one free local routine (park, market, neighbourhood walk) so leisure does not silently eat the contingency line.`,
    },
  ],
  comparison: [
    {
      kind: 'earn_compare',
      headingHints: [/salary|earn|income|pay/i],
      build: (p) =>
        withFact(
          `Earn-X scenario: hold lifestyle constant, convert both offers to one currency after tax, then compare residual after a realistic rent band in ${p.place}${p.placeB ? ` versus ${p.placeB}` : ''}.`,
          p.factHint
        ),
    },
    {
      kind: 'remote_compare',
      headingHints: [/remote|work|digital|nomad/i],
      build: (p) =>
        `Remote trade-off: if income is location-independent, score ${p.place}${p.placeB ? ` and ${p.placeB}` : ''} on housing + internet reliability + time-zone friction — not on tourist-area café prices alone.`,
    },
    {
      kind: 'children',
      headingHints: [/famil|child|school|kid/i],
      build: (p) =>
        `Family comparison: add school fees or after-care and healthcare access before declaring a winner — child costs often erase a headline rent advantage between cities.`,
    },
    {
      kind: 'rent_tradeoff',
      headingHints: [/rent|hous|housing|accommod/i],
      build: (p) =>
        withFact(
          `Rent trade-off between ${p.place}${p.placeB ? ` and ${p.placeB}` : ' both places'}: compare like-for-like size and commute, then decide whether the cheaper lease still leaves room for a 10% contingency.`,
          p.factHint
        ),
    },
    {
      kind: 'pros_cons',
      headingHints: [/pros|cons|should|recommend|who/i],
      build: (p) =>
        `Decision framing: list two non-negotiables (e.g. commute under 40 minutes, or rent under a hard ceiling). Whichever of ${p.place}${p.placeB ? ` / ${p.placeB}` : ''} fails a non-negotiable is out — do not average them away.`,
    },
  ],
  salary: [
    {
      kind: 'salary_band',
      headingHints: [/salary|earn|wage|pay|income|entry|senior/i],
      build: (p) =>
        withFact(
          `Band example for ${p.place}: compare entry / mid / senior take-home after tax, then subtract a realistic rent band — only the remainder is truly available for lifestyle.`,
          p.factHint
        ),
    },
    {
      kind: 'disposable',
      headingHints: [/dispos|budget|spend|cost/i],
      build: (p) =>
        `Disposable-income check in ${p.place}: after rent, utilities, groceries, and transport, freeze discretionary spend until you have two local quotes confirming the essentials.`,
    },
    {
      kind: 'savings',
      headingHints: [/sav|invest|wealth|future/i],
      build: (p) =>
        `Savings reality: model a month where rent is 10% higher than the average — if savings drop to zero, the offer only works with a cheaper neighbourhood or a higher band.`,
    },
  ],
  rent: [
    {
      kind: 'deposit',
      headingHints: [/deposit|upfront|move|first/i],
      build: (p) =>
        withFact(
          `Deposit example in ${p.place}: cash-flow first month as rent + deposit + any broker fee, separate from the ongoing monthly rent line you will live on.`,
          p.factHint
        ),
    },
    {
      kind: 'lease',
      headingHints: [/lease|contract|term|agreement/i],
      build: (p) =>
        `Lease check: confirm notice period, renewal rules, and whether early exit forfeits the deposit — sign only after those three answers are in writing.`,
    },
    {
      kind: 'broker',
      headingHints: [/broker|agent|fee|agency/i],
      build: (p) =>
        `Broker tip for ${p.place}: ask who pays the agency fee and whether it is a percentage of annual rent — add it to move-in cash, not to the monthly budget spreadsheet.`,
    },
    {
      kind: 'maintenance',
      headingHints: [/maintain|society|hoa|building|amenit/i],
      build: (p) =>
        `Maintenance reality: confirm monthly building/society charges and what they cover (water, security, gym). A low headline rent with high maintenance is not a bargain.`,
    },
    {
      kind: 'utilities',
      headingHints: [/utilit|electric|water|gas|bill/i],
      build: (p) =>
        `Utilities check in ${p.place}: clarify what is included versus metered. Budget a buffer until you see one full billing cycle in that building.`,
    },
  ],
  student: [
    {
      kind: 'student_life',
      headingHints: [/student|campus|tuition|hous|budget|overview/i],
      build: (p) =>
        withFact(
          `Student scenario in ${p.place}: shared housing + groceries + transport pass + a small emergency line for registration or visa fees that hit early in term.`,
          p.factHint
        ),
    },
  ],
  visa: [
    {
      kind: 'visa_cash',
      headingHints: [/visa|permit|immig|document|cost|fee/i],
      build: (p) =>
        withFact(
          `Visa cash-flow example for ${p.place}: map application fees, biometrics, and proof-of-funds onto a calendar so buffers arrive before appointment dates — not after.`,
          p.factHint
        ),
    },
  ],
  moving: [
    {
      kind: 'moving_week',
      headingHints: [/mov|arriv|first|setup|week|checklist/i],
      build: (p) =>
        withFact(
          `Moving-week example for ${p.place}: temporary housing, local SIM, and two weeks of groceries before the first paycheck or transfer clears.`,
          p.factHint
        ),
    },
  ],
  healthcare: [
    {
      kind: 'healthcare_visit',
      headingHints: [/health|clinic|doctor|insur|care/i],
      build: (p) =>
        withFact(
          `Healthcare scenario in ${p.place}: price a basic GP visit and one common prescription equivalent, then decide whether private cover is needed for the first six months.`,
          p.factHint
        ),
    },
  ],
  food: [
    {
      kind: 'food_mix',
      headingHints: [/food|groc|eat|restaurant|dining/i],
      build: (p) =>
        withFact(
          `Food budget example in ${p.place}: grocery staples plus two eating-out meals per week, then stress-test what happens if eating-out doubles in month one.`,
          p.factHint
        ),
    },
  ],
  travel: [
    {
      kind: 'travel_split',
      headingHints: [/travel|trip|flight|transport|overview/i],
      build: (p) =>
        withFact(
          `Travel cost split for ${p.place}: separate trip transport from local daily spend so a cheap flight does not hide expensive transfers and tourist-area meals.`,
          p.factHint
        ),
    },
  ],
  budget: [
    {
      kind: 'budget_lines',
      headingHints: [/budget|cost|overview|plan|worksheet/i],
      build: (p) =>
        withFact(
          `Budget worksheet for ${p.place}: fixed (rent/utilities), flexible (food/transport), discretionary. Freeze discretionary first when quotes overrun.`,
          p.factHint
        ),
    },
  ],
  remote: [
    {
      kind: 'remote_setup',
      headingHints: [/remote|work|internet|cowork|setup/i],
      build: (p) =>
        withFact(
          `Remote setup in ${p.place}: confirm reliable home internet or coworking cost, and whether tax-residency assumptions still hold after 90/180 days.`,
          p.factHint
        ),
    },
  ],
  retirement: [
    {
      kind: 'retirement_pace',
      headingHints: [/retir|pace|health|hous|budget|overview/i],
      build: (p) =>
        withFact(
          `Retirement pacing in ${p.place}: treat healthcare and housing as non-negotiable, then set lifestyle spend at a level that survives a currency or inflation swing.`,
          p.factHint
        ),
    },
  ],
  tax: [
    {
      kind: 'salary_band',
      headingHints: [/tax|withhold|income|salary/i],
      build: (p) =>
        withFact(
          `Tax planning example for ${p.place}: convert gross to estimated take-home, then rebuild the monthly budget from net — never from headline salary.`,
          p.factHint
        ),
    },
  ],
};

const EXAMPLE_SIGNAL =
  /\b(for example|real-world|example|practical (?:move|check|tip|example|pattern)|scenario|what a real person|day-one|checklist|stress-test|cash-flow|trade-off|commute test|transit tip|parking reality|grocery pattern|weekend lifestyle|band example|deposit example|lease check|broker tip|moving-week|visa cash-flow|healthcare scenario|food budget example|travel cost split|budget worksheet|remote setup|retirement pacing|apartment hunt|city-tier contrast|earn-x|family comparison|rent trade-off|decision framing|disposable-income|savings reality|student scenario)\b/i;

export function sectionHasExample(text: string): boolean {
  return EXAMPLE_SIGNAL.test(text);
}

function pickTemplate(
  guideId: GuideId,
  chunk: SectionChunk,
  used: Set<ExampleKind>
): ExampleTemplate | null {
  const registry = GUIDE_EXAMPLE_REGISTRY[guideId] || GUIDE_EXAMPLE_REGISTRY.country;
  const byHint = registry.find(
    (t) => !used.has(t.kind) && t.headingHints.some((re) => re.test(chunk.heading))
  );
  if (byHint) return byHint;
  return registry.find((t) => !used.has(t.kind)) || registry[0] || null;
}

function insertAfterIndex(blocks: DraftBlock[], index: number, block: DraftBlock): DraftBlock[] {
  if (index < 0) return [...blocks, block];
  return [...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)];
}

/**
 * Upgrade body sections missing practical examples.
 * Scoped to non-protected blocks; parameterized by guide + entities.
 */
export function applyRealWorldExamples(input: {
  draft: WriterDraftPayload;
  guideId: GuideId;
  entities?: ExampleEntityContext;
}): { draft: WriterDraftPayload; report: ExampleEngineReport } {
  const place = resolvePlace(input.entities || {});
  const blocks = [...(input.draft.blocks || [])];
  const chunks = draftSectionChunks({ ...input.draft, blocks });
  const used = new Set<ExampleKind>();
  const sections_upgraded: string[] = [];
  let examples_added = 0;

  // Work from end to start so insert indices stay valid
  const ordered = [...chunks].sort((a, b) => b.startIndex - a.startIndex);

  for (const chunk of ordered) {
    if (sectionHasExample(chunk.text)) continue;
    // Skip ultra-thin stubs
    if (chunk.text.split(/\s+/).length < 25) continue;

    const template = pickTemplate(input.guideId, chunk, used);
    if (!template) continue;
    used.add(template.kind);

    const content = `Real-world example — ${template.build(place)}`;
    const tip: DraftBlock = {
      id: mintBlockId('ex'),
      type: 'tip',
      heading: 'Real-world example',
      content,
    };

    const idx = lastBodyBlockIndex(blocks, chunk);
    // Re-find chunk end after prior inserts: use current ids
    let insertAt = idx;
    if (insertAt < 0) {
      // find heading id position
      const hIdx = blocks.findIndex((b) => b.id === chunk.headingId);
      insertAt = hIdx >= 0 ? hIdx : chunk.endIndex;
    }

    // After earlier end→start inserts, locate by heading id when possible
    if (chunk.headingId) {
      const hIdx = blocks.findIndex((b) => b.id === chunk.headingId);
      if (hIdx >= 0) {
        let end = hIdx;
        for (let i = hIdx + 1; i < blocks.length; i++) {
          const b = blocks[i];
          if (!b || isProtectedBlock(b) || b.type === 'heading') break;
          end = i;
        }
        insertAt = end;
      }
    }

    const next = insertAfterIndex(blocks, insertAt, tip);
    blocks.length = 0;
    blocks.push(...next);
    examples_added += 1;
    sections_upgraded.push(chunk.heading);
  }

  return {
    draft: { ...input.draft, blocks },
    report: {
      examples_added,
      sections_upgraded,
      guide_id: input.guideId,
    },
  };
}

export function listExampleKindsForGuide(guideId: GuideId): ExampleKind[] {
  return (GUIDE_EXAMPLE_REGISTRY[guideId] || []).map((t) => t.kind);
}
