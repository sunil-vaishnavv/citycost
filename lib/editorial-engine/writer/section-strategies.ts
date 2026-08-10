/**
 * Section-aware writing intelligence — each H2 gets its own strategy.
 * Used by Writer prompts (not a shared prose template).
 */

export type SectionKind =
  | 'intro'
  | 'housing'
  | 'food'
  | 'transport'
  | 'healthcare'
  | 'salary'
  | 'tax'
  | 'education'
  | 'visa'
  | 'moving'
  | 'lifestyle'
  | 'pros'
  | 'cons'
  | 'comparison'
  | 'overview'
  | 'who'
  | 'summary'
  | 'faq'
  | 'generic';

export interface SectionStrategy {
  kind: SectionKind;
  purpose: string;
  tone: string;
  structure: string[];
  do: string[];
  dont: string[];
  depth: 'light' | 'practical' | 'deep';
}

export function sectionKind(heading: string): SectionKind {
  const h = heading.toLowerCase();
  if (/introduction|intro\b|^why (read|this)/.test(h)) return 'intro';
  if (/who should|audience|reader|is this for/.test(h)) return 'who';
  if (/overview|cost of living overview|monthly budget|what it costs/.test(h)) return 'overview';
  if (/hous|rent|apart|neighbour|neighbor|lease|accommodation/.test(h)) return 'housing';
  if (/food|groc|dining|restaurant|eat|supermarket/.test(h)) return 'food';
  if (/transport|commute|metro|transit|car |taxi|bus /.test(h)) return 'transport';
  if (/health|insur|medical|doctor|medicare/.test(h)) return 'healthcare';
  if (/salary|wage|purchasing|income|pay\b|earn/.test(h)) return 'salary';
  if (/\btax/.test(h)) return 'tax';
  if (/educat|student|school|universit|campus/.test(h)) return 'education';
  if (/visa|residence|immigra|permit/.test(h)) return 'visa';
  if (/mov(e|ing)|relocat|first.?month|checklist|setup/.test(h)) return 'moving';
  if (/lifestyle|quality of life|culture|safety|family/.test(h)) return 'lifestyle';
  if (/^pros?\b|advantages|benefits/.test(h)) return 'pros';
  if (/^cons?\b|drawback|downside|challenges|risks/.test(h)) return 'cons';
  if (/compar|vs\.|versus|which city|trade-?off/.test(h)) return 'comparison';
  if (/^faq$|frequently asked/.test(h)) return 'faq';
  if (/summary|conclusion|next step|key takeaway/.test(h)) return 'summary';
  return 'generic';
}

const STRATEGIES: Record<SectionKind, Omit<SectionStrategy, 'kind'>> = {
  intro: {
    purpose: 'Hook the reader, set context, set expectations for the guide',
    tone: 'Direct, confident relocation advisor — not a brochure',
    structure: ['hook observation', 'who this helps', 'what the guide will clarify'],
    do: ['Open with a concrete tension (rent vs lifestyle, city vs country average)', 'Promise practical outcomes'],
    dont: ['Start with "In this guide…"', 'Dump statistics', 'Force a CityCost CTA'],
    depth: 'light',
  },
  who: {
    purpose: 'Filter audiences and set different success criteria',
    tone: 'Candid consultant sorting who should / should not proceed',
    structure: ['audience segments', 'what each must stress-test', 'who should wait'],
    do: ['Name students / remote workers / families with different constraints'],
    dont: ['Generic "everyone can benefit"', 'Repeat intro hook'],
    depth: 'practical',
  },
  overview: {
    purpose: 'Frame the monthly cost picture without a national-average lie',
    tone: 'Clear financial planner',
    structure: ['what drives totals', 'city vs country reality', 'how to read the rest'],
    do: ['Emphasize housing as the swing factor', 'Tell reader to pick a city early'],
    dont: ['Recite every category already covered later'],
    depth: 'practical',
  },
  housing: {
    purpose: 'Practical rent / lease trade-offs',
    tone: 'Someone who has negotiated leases',
    structure: ['what rent really includes', 'neighbourhood trade-offs', 'lease gotchas', 'decision tip'],
    do: ['Talk fees, bond, commute vs rent', 'Compare inner vs outer honestly'],
    dont: ['End every para with a CityCost link', 'Use "indexed averages"'],
    depth: 'deep',
  },
  food: {
    purpose: 'Budgeting examples and lifestyle food choices',
    tone: 'Practical local resident',
    structure: ['home cooking vs dining out', 'what inflates the bill', 'a simple tracking tip'],
    do: ['Give habit-based examples', 'Mention imported vs local briefly'],
    dont: ['Lecture nutrition', 'Repeat housing advice'],
    depth: 'practical',
  },
  transport: {
    purpose: 'Help the reader choose car vs transit',
    tone: 'Decision guide',
    structure: ['when transit wins', 'when a car is forced', 'how to test for a month'],
    do: ['Tie advice to job/campus location'],
    dont: ['Generic "public transport is great"'],
    depth: 'practical',
  },
  healthcare: {
    purpose: 'Warnings and planning buffers',
    tone: 'Cautious planner',
    structure: ['coverage depends on status', 'what surprises people', 'buffer tip'],
    do: ['Warn against assuming free care', 'Suggest pricing a GP visit'],
    dont: ['Medical legal advice', 'Force links every sentence'],
    depth: 'practical',
  },
  salary: {
    purpose: 'Affordability after rent',
    tone: 'Financial planner',
    structure: ['gross vs after-rent', 'city stretch differences', 'how to test an offer'],
    do: ['Convert offers to monthly after-rent cash'],
    dont: ['Invent salary figures'],
    depth: 'deep',
  },
  tax: {
    purpose: 'How tax changes take-home feel',
    tone: 'Straight talk',
    structure: ['net pay matters', 'status differences', 'compare offers on take-home'],
    do: ['Keep it non-legal and practical'],
    dont: ['Cite made-up rates'],
    depth: 'light',
  },
  education: {
    purpose: 'Student / family education cost lens',
    tone: 'Advisor',
    structure: ['housing near campus', 'fees vs living', 'work-hour reality'],
    do: ['Separate tuition from living costs'],
    dont: ['Repeat generic COL overview'],
    depth: 'practical',
  },
  visa: {
    purpose: 'Eligibility / timing constraints that affect money',
    tone: 'Immigration-aware advisor (not a lawyer)',
    structure: ['pathway depends on status', 'fees and proof-of-funds', 'budget timing'],
    do: ['Tell reader to confirm official rules'],
    dont: ['Promise visas', 'Copy research persona fields'],
    depth: 'practical',
  },
  moving: {
    purpose: 'First-month checklist and cash reserves',
    tone: 'Hands-on relocator',
    structure: ['landing costs', 'setup items', 'what to delay buying'],
    do: ['Separate deposit cash from monthly budget'],
    dont: ['Repeat every earlier section'],
    depth: 'practical',
  },
  lifestyle: {
    purpose: 'Quality-of-life trade-offs that cost money',
    tone: 'Local resident honesty',
    structure: ['what people pay for', 'what they cut', 'fit check'],
    do: ['Name trade-offs (space vs nightlife, etc.)'],
    dont: ['Tourism brochure tone'],
    depth: 'light',
  },
  pros: {
    purpose: 'Strengths only — no fake balance',
    tone: 'Clear and specific',
    structure: ['3–5 concrete strengths with why they matter'],
    do: ['Stay positive and specific to place'],
    dont: ['Slip cons into pros', 'End with CTA boilerplate'],
    depth: 'light',
  },
  cons: {
    purpose: 'Weaknesses only — honest friction',
    tone: 'Candid',
    structure: ['3–5 concrete frictions with who they hurt'],
    do: ['Be specific (housing pressure, distances, fees)'],
    dont: ['Soft-pedal with "but overall amazing"'],
    depth: 'light',
  },
  comparison: {
    purpose: 'Help choose between places',
    tone: 'Comparative advisor',
    structure: ['criteria', 'how cities diverge', 'how to decide'],
    do: ['Hold lifestyle constant when comparing'],
    dont: ['Declare a universal winner'],
    depth: 'deep',
  },
  summary: {
    purpose: 'Actionable conclusion — not a repeat of the intro',
    tone: 'Closing brief from a consultant',
    structure: ['3 concrete next actions', 'what to decide this week'],
    do: ['New wording only', 'Forward-looking steps'],
    dont: ['Restate the introduction', 'Stack multiple CTAs'],
    depth: 'light',
  },
  faq: {
    purpose: 'Direct answers to search questions (prefer dedicated FAQ module)',
    tone: 'Q&A expert',
    structure: ['answer first', 'short why', 'one tip'],
    do: ['Unique openings per answer'],
    dont: ['Copy body paragraphs'],
    depth: 'practical',
  },
  generic: {
    purpose: 'Advance the reader decision for this heading',
    tone: 'Expert, varied',
    structure: ['claim', 'reasoning', 'reader action'],
    do: ['Stay tied to monthly cash impact'],
    dont: ['Reuse housing/food boilerplate'],
    depth: 'practical',
  },
};

export function strategyForHeading(heading: string): SectionStrategy {
  const kind = sectionKind(heading);
  return { kind, ...STRATEGIES[kind] };
}

export function strategiesForHeadings(headings: string[]): Array<SectionStrategy & { heading: string }> {
  return headings.map((heading) => ({ heading, ...strategyForHeading(heading) }));
}

/** Phrases that may appear at most once per article (self-review enforces). */
export const WRITER_ONCE_PHRASES = [
  'cross-check',
  'when in doubt',
  'before you finalize',
  'indexed averages',
  'the practical answer',
  'budget as a worksheet',
  'use relative indexes',
  'compare two citycost pages',
  'keep a contingency',
  'if quotes disagree',
  'public averages are planning ranges',
  'widen the contingency',
  'country signals for',
];

export const WRITER_HARD_BAN_PHRASES = [
  'delve into',
  'tapestry',
  'cornerstone',
  'paramount',
  'navigating the',
  'in conclusion',
  'furthermore',
  'moreover',
  'it is important to note',
  'in today\'s world',
];
