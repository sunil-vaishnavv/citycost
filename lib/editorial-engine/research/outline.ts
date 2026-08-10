import type { OutlineSection } from './schema.js';

function h2(id: string, heading: string, purpose: string, children?: OutlineSection[]): OutlineSection {
  return { id, heading, level: 2, purpose, children: children || [], required_elements: ['paragraphs'] };
}

function h3(id: string, heading: string, purpose: string): OutlineSection {
  return { id, heading, level: 3, purpose, required_elements: ['paragraphs'] };
}

/**
 * Complete Writer outline — Writer must follow this, not invent its own.
 */
export function buildResearchOutline(opts: {
  contentType: string;
  primaryEntity: string;
  isComparison: boolean;
  placeA?: string;
  placeB?: string;
}): { outline: OutlineSection[]; required_h2: string[]; required_h3: string[]; flat: string[] } {
  const { contentType, primaryEntity, isComparison, placeA, placeB } = opts;
  const a = placeA || primaryEntity;
  const b = placeB || '';

  const outline: OutlineSection[] = [
    h2('introduction', 'Introduction', 'Frame the reader decision and what this guide covers'),
    h2('who-should-read', 'Who should read this', 'Clarify personas and situations this article serves'),
  ];

  if (isComparison && b) {
    outline.push(
      h2('quick-comparison', 'Quick comparison', `Snapshot of ${a} vs ${b} for skimmers`, [
        h3('quick-winner-signals', 'At-a-glance decision signals', 'Summarize relative cost posture without inventing numbers'),
      ]),
      h2('cost-comparison', 'Cost comparison', 'Side-by-side living-cost categories', [
        h3('cost-table', 'Category cost table', 'Present a structured comparison table using known CityCost signals only'),
      ])
    );
  } else {
    outline.push(
      h2('cost-overview', 'Cost of living overview', `Explain what drives costs in ${a}`, [
        h3('monthly-budget-shape', 'What a monthly budget usually includes', 'List major cost buckets readers must plan for'),
      ])
    );
  }

  outline.push(
    h2('housing', 'Housing', 'Rent, deposits, neighbourhood trade-offs', [
      h3('housing-types', 'Housing types and typical trade-offs', 'Studio vs family housing vs shared living'),
    ]),
    h2('food', 'Food', 'Groceries vs dining out budgeting'),
    h2('transport', 'Transport', 'Public transit, commuting, car ownership costs'),
    h2('healthcare', 'Healthcare', 'System basics and cost planning disclaimers'),
    h2('education', 'Education', 'Schooling/university cost considerations when relevant'),
    h2('salary', 'Salary and purchasing power', 'How earnings interact with local costs'),
    h2('taxes', 'Taxes and take-home pay', 'High-level framing only — no personalized tax advice'),
    h2('lifestyle', 'Lifestyle', 'Everyday quality-of-life costs beyond rent'),
    h2('pros', 'Pros', `Advantages of choosing ${isComparison && b ? `${a} / ${b}` : a}`),
    h2('cons', 'Cons', 'Honest downsides and cost traps'),
    h2('summary', 'Summary', 'Decision checklist and next steps on CityCost'),
    h2('faq', 'FAQ', 'Answer the highest-intent searcher questions')
  );

  // Content-type accents
  if (contentType.includes('student')) {
    outline.splice(4, 0, h2('student-budget', 'Student budget realities', 'Tuition-adjacent living costs and part-time work constraints'));
  }
  if (contentType.includes('remote') || contentType.includes('nomad')) {
    outline.splice(4, 0, h2('remote-work', 'Remote work costs', 'Coworking, connectivity, visa friction'));
  }
  if (contentType.includes('retirement')) {
    outline.splice(4, 0, h2('retirement-costs', 'Retirement cost planning', 'Healthcare-heavy budgeting and pace of spending'));
  }
  if (contentType.includes('visa') || contentType.includes('moving')) {
    outline.splice(3, 0, h2('moving-costs', 'Moving and setup costs', 'First-month cash needs and visa-related expenses'));
  }
  if (contentType.includes('rent')) {
    outline.splice(3, 0, h2('rent-deep-dive', 'Rent deep dive', 'Lease norms, deposits, and neighbourhood price bands'));
  }
  if (contentType.includes('salary')) {
    outline.splice(3, 0, h2('salary-bands', 'Salary context', 'How wages relate to housing and everyday costs'));
  }

  const required_h2 = outline.map((s) => s.heading);
  const required_h3: string[] = [];
  for (const s of outline) {
    for (const child of s.children || []) required_h3.push(child.heading);
  }

  const flat = outline.flatMap((s) => {
    const lines = [`${s.heading}: ${s.purpose}`];
    for (const c of s.children || []) lines.push(`  - ${c.heading}: ${c.purpose}`);
    return lines;
  });

  return { outline, required_h2, required_h3, flat };
}

export function buildRequiredFaq(searcherQuestions: string[]): string[] {
  return searcherQuestions.slice(0, 10);
}

export function buildRequiredTables(isComparison: boolean, primaryEntity: string): string[] {
  const tables = [
    `Monthly cost buckets for ${primaryEntity}`,
    'Housing cost components (rent, utilities, internet)',
  ];
  if (isComparison) {
    tables.unshift('Side-by-side cost category comparison table');
    tables.push('Who each city fits best (persona matrix)');
  }
  return tables;
}

export function buildRequiredComparisonBlocks(
  isComparison: boolean,
  placeA?: string,
  placeB?: string
): string[] {
  if (!isComparison || !placeA || !placeB) {
    return ['Optional: compare against 1–2 related CityCost pages for context'];
  }
  return [
    `${placeA} vs ${placeB} overall affordability block`,
    'Housing comparison block',
    'Everyday spending comparison block',
    'Best-fit persona comparison block',
  ];
}

export function buildRequiredCalculators(): string[] {
  return [
    'CityCost Cost of Living Calculator (/)',
    'Related city pages for index verification',
    'Related comparison pages for side-by-side checks',
  ];
}
