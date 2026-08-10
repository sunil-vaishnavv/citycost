/**
 * Section Writers — each section kind has an independent objective.
 * Combined with Dedicated Writer bias; never one shared section template.
 */

import { sectionKind, type SectionKind } from './section-strategies.js';
import type { DedicatedWriter } from './writers/types.js';

export interface SectionWriter {
  kind: SectionKind;
  objective: string;
  deliver: string[];
  avoid: string[];
}

const BASE: Record<SectionKind, Omit<SectionWriter, 'kind'>> = {
  intro: {
    objective: 'Hook + context + expectation',
    deliver: ['Concrete tension', 'Who this helps', 'What the reader will decide'],
    avoid: ['In this guide…', 'Dumping statistics', 'Prompt meta'],
  },
  who: {
    objective: 'Audience filter',
    deliver: ['Who should continue', 'Who should wait', 'Different success criteria'],
    avoid: ['Everyone can benefit'],
  },
  overview: {
    objective: 'Monthly cost picture',
    deliver: ['What drives totals', 'How to read the rest'],
    avoid: ['Repeating every later section'],
  },
  housing: {
    objective: 'Practical rent / lease advice',
    deliver: ['Rent vs move-in', 'Utilities/inclusions', 'Lease tips', 'Neighbourhood trade-offs'],
    avoid: ['Generic COL overview', 'Forced CityCost CTA'],
  },
  food: {
    objective: 'Budget examples from habits',
    deliver: ['Groceries vs dining', 'Lifestyle differences', 'Simple tracking tip'],
    avoid: ['Nutrition lectures', 'Housing advice'],
  },
  transport: {
    objective: 'Decision guidance car vs transit',
    deliver: ['When transit wins', 'When car is forced', 'How to test a month'],
    avoid: ['Generic public transport is great slogans'],
  },
  healthcare: {
    objective: 'Warnings and planning buffers',
    deliver: ['Eligibility depends on status', 'Routine vs emergency', 'Buffer tip'],
    avoid: ['Medical legal advice'],
  },
  salary: {
    objective: 'Affordability after rent',
    deliver: ['Take-home framing', 'Housing share', 'How to test an offer'],
    avoid: ['Invented salary figures'],
  },
  tax: {
    objective: 'Take-home impact',
    deliver: ['Gross ≠ spendable', 'Status differences'],
    avoid: ['Invented tax rates as facts'],
  },
  education: {
    objective: 'Student / family education lens',
    deliver: ['Housing near campus', 'Fees vs living'],
    avoid: ['Generic COL dump'],
  },
  visa: {
    objective: 'Path timing and cash',
    deliver: ['Fees', 'Proof-of-funds', 'Lease timing'],
    avoid: ['Promising visas'],
  },
  moving: {
    objective: 'First-month checklist',
    deliver: ['Landing costs', 'Setup items', 'What to delay'],
    avoid: ['Repeating whole article'],
  },
  lifestyle: {
    objective: 'Quality-of-life money trade-offs',
    deliver: ['What people pay for', 'What they cut'],
    avoid: ['Tourism brochure'],
  },
  pros: {
    objective: 'Benefits only',
    deliver: ['3–5 concrete strengths'],
    avoid: ['Slipping cons into pros'],
  },
  cons: {
    objective: 'Risks only',
    deliver: ['3–5 concrete frictions'],
    avoid: ['But overall amazing'],
  },
  comparison: {
    objective: 'Side-by-side decision help',
    deliver: ['Criteria', 'How places diverge', 'How to decide'],
    avoid: ['Universal winner'],
  },
  summary: {
    objective: 'Recommendation',
    deliver: ['Summarize', 'Recommend', 'Who should move / choose'],
    avoid: ['Restating intro', 'Recycling mid-article advice'],
  },
  faq: {
    objective: 'Direct answers',
    deliver: ['Answer first', 'Short why', 'Practical tip'],
    avoid: ['Copying body paragraphs'],
  },
  generic: {
    objective: 'Advance the reader decision',
    deliver: ['Claim', 'Reasoning', 'Reader action'],
    avoid: ['Filler'],
  },
};

export function sectionWriterFor(heading: string, dedicated?: DedicatedWriter | null): SectionWriter {
  const kind = sectionKind(heading);
  const base = BASE[kind] || BASE.generic;
  const bias = dedicated?.section_bias?.[kind] || dedicated?.section_bias?.[heading.toLowerCase()];
  return {
    kind,
    objective: bias ? `${base.objective} · ${bias}` : base.objective,
    deliver: base.deliver,
    avoid: base.avoid,
  };
}

export function sectionWritersForHeadings(
  headings: string[],
  dedicated?: DedicatedWriter | null
): Array<SectionWriter & { heading: string }> {
  return headings.map((heading) => ({ heading, ...sectionWriterFor(heading, dedicated) }));
}
