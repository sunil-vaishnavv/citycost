/**
 * Dynamic Outline Generator — guide-owned section pools, instance-adaptive outlines.
 */

import { personaSectionBoost } from '../persona/engine.js';
import type {
  EditorialPlan,
  GuideId,
  OutlineSection,
  PersonaProfile,
  SectionKey,
  StyleProfile,
} from '../types.js';

type Seed = {
  key: SectionKey;
  heading: string;
  base_priority: number;
  min_words: number;
  max_words: number;
  spine?: boolean;
};

const SEEDS: Record<GuideId, Seed[]> = {
  country: [
    { key: 'overview', heading: 'National cost of living overview', base_priority: 1, min_words: 180, max_words: 320, spine: true },
    { key: 'regional', heading: 'Regional cost differences', base_priority: 0.95, min_words: 160, max_words: 280, spine: true },
    { key: 'major_cities', heading: 'Major cities as cost examples', base_priority: 0.9, min_words: 160, max_words: 280, spine: true },
    { key: 'housing', heading: 'Housing and rent patterns nationwide', base_priority: 0.92, min_words: 160, max_words: 280 },
    { key: 'food', heading: 'Groceries and dining across the country', base_priority: 0.75, min_words: 120, max_words: 220 },
    { key: 'transport', heading: 'Transport and car dependence by region', base_priority: 0.7, min_words: 120, max_words: 220 },
    { key: 'healthcare', heading: 'Healthcare access and cost buffers', base_priority: 0.8, min_words: 140, max_words: 240 },
    { key: 'education', heading: 'Education cost considerations', base_priority: 0.55, min_words: 100, max_words: 200 },
    { key: 'tax', heading: 'Tax and take-home considerations', base_priority: 0.6, min_words: 100, max_words: 200 },
    { key: 'visa', heading: 'Visa and residency cost notes', base_priority: 0.5, min_words: 100, max_words: 180 },
    { key: 'salary', heading: 'Salaries and purchasing power', base_priority: 0.85, min_words: 140, max_words: 240 },
    { key: 'budget', heading: 'Typical monthly budget examples', base_priority: 0.88, min_words: 150, max_words: 260, spine: true },
    { key: 'remote', heading: 'Remote work fit', base_priority: 0.45, min_words: 100, max_words: 180 },
    { key: 'who_should', heading: 'Who should consider moving here', base_priority: 0.85, min_words: 120, max_words: 220, spine: true },
    { key: 'summary', heading: 'Summary and next steps', base_priority: 1, min_words: 100, max_words: 180, spine: true },
  ],
  city: [
    { key: 'overview', heading: 'City cost of living snapshot', base_priority: 1, min_words: 160, max_words: 280, spine: true },
    { key: 'neighbourhoods', heading: 'Neighbourhoods and where costs concentrate', base_priority: 0.95, min_words: 160, max_words: 280, spine: true },
    { key: 'housing', heading: 'Housing, deposits, and utilities', base_priority: 0.95, min_words: 160, max_words: 280, spine: true },
    { key: 'commute', heading: 'Commute and daily transport', base_priority: 0.85, min_words: 120, max_words: 220 },
    { key: 'food', heading: 'Groceries and eating out', base_priority: 0.8, min_words: 120, max_words: 220 },
    { key: 'healthcare', heading: 'Healthcare access in the city', base_priority: 0.75, min_words: 120, max_words: 220 },
    { key: 'schools', heading: 'Schools and family costs', base_priority: 0.55, min_words: 100, max_words: 200 },
    { key: 'safety', heading: 'Safety and livability notes', base_priority: 0.5, min_words: 90, max_words: 180 },
    { key: 'salary', heading: 'Salaries and local purchasing power', base_priority: 0.85, min_words: 120, max_words: 220 },
    { key: 'lifestyle', heading: 'Lifestyle cost drivers', base_priority: 0.7, min_words: 100, max_words: 200 },
    { key: 'budget', heading: 'Typical monthly budget', base_priority: 0.9, min_words: 140, max_words: 240, spine: true },
    { key: 'summary', heading: 'Summary recommendation', base_priority: 1, min_words: 100, max_words: 180, spine: true },
  ],
  comparison: [
    { key: 'overview', heading: 'Comparison frame and decision criteria', base_priority: 1, min_words: 140, max_words: 240, spine: true },
    { key: 'housing', heading: 'Housing comparison', base_priority: 0.95, min_words: 150, max_words: 260, spine: true },
    { key: 'salary', heading: 'Salary and purchasing power comparison', base_priority: 0.9, min_words: 140, max_words: 240, spine: true },
    { key: 'food', heading: 'Food and groceries comparison', base_priority: 0.8, min_words: 120, max_words: 220 },
    { key: 'transport', heading: 'Transport comparison', base_priority: 0.8, min_words: 120, max_words: 220 },
    { key: 'healthcare', heading: 'Healthcare comparison', base_priority: 0.75, min_words: 120, max_words: 220 },
    { key: 'lifestyle', heading: 'Lifestyle and everyday costs', base_priority: 0.65, min_words: 100, max_words: 200 },
    { key: 'pros', heading: 'Pros by side', base_priority: 0.85, min_words: 120, max_words: 220, spine: true },
    { key: 'cons', heading: 'Cons and frictions', base_priority: 0.85, min_words: 120, max_words: 220, spine: true },
    { key: 'recommendation', heading: 'Who should choose which', base_priority: 1, min_words: 140, max_words: 240, spine: true },
    { key: 'summary', heading: 'Summary', base_priority: 0.9, min_words: 90, max_words: 160, spine: true },
  ],
  salary: [
    { key: 'overview', heading: 'Salary and take-home overview', base_priority: 1, min_words: 160, max_words: 280, spine: true },
    { key: 'salary', heading: 'Pay bands and purchasing power', base_priority: 1, min_words: 160, max_words: 280, spine: true },
    { key: 'tax', heading: 'Tax drag and net pay', base_priority: 0.9, min_words: 140, max_words: 240, spine: true },
    { key: 'housing', heading: 'How rent consumes salary', base_priority: 0.85, min_words: 140, max_words: 240 },
    { key: 'budget', heading: 'Salary-based monthly budget', base_priority: 0.9, min_words: 140, max_words: 240, spine: true },
    { key: 'lifestyle', heading: 'Lifestyle stretch after fixed costs', base_priority: 0.7, min_words: 100, max_words: 200 },
    { key: 'who_should', heading: 'Who this pay market suits', base_priority: 0.8, min_words: 120, max_words: 200 },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  rent: [
    { key: 'overview', heading: 'Rental market overview', base_priority: 1, min_words: 150, max_words: 260, spine: true },
    { key: 'housing', heading: 'Rent levels, deposits, and lease norms', base_priority: 1, min_words: 180, max_words: 300, spine: true },
    { key: 'neighbourhoods', heading: 'Neighbourhood rent spreads', base_priority: 0.9, min_words: 140, max_words: 240 },
    { key: 'utilities', heading: 'Utilities and extra housing costs', base_priority: 0.8, min_words: 120, max_words: 200 },
    { key: 'budget', heading: 'Housing-led monthly budget', base_priority: 0.85, min_words: 130, max_words: 220, spine: true },
    { key: 'who_should', heading: 'Who should rent where', base_priority: 0.75, min_words: 110, max_words: 200 },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  food: [
    { key: 'overview', heading: 'Food cost overview', base_priority: 1, min_words: 140, max_words: 240, spine: true },
    { key: 'food', heading: 'Groceries, markets, and dining patterns', base_priority: 1, min_words: 180, max_words: 300, spine: true },
    { key: 'budget', heading: 'Monthly food budget examples', base_priority: 0.9, min_words: 130, max_words: 220, spine: true },
    { key: 'lifestyle', heading: 'Eating habits and cost levers', base_priority: 0.75, min_words: 110, max_words: 200 },
    { key: 'who_should', heading: 'Who will feel food costs most', base_priority: 0.7, min_words: 100, max_words: 180 },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  healthcare: [
    { key: 'overview', heading: 'Healthcare cost and access overview', base_priority: 1, min_words: 150, max_words: 260, spine: true },
    { key: 'healthcare', heading: 'Public vs private access patterns', base_priority: 1, min_words: 180, max_words: 300, spine: true },
    { key: 'budget', heading: 'Healthcare buffers in a monthly plan', base_priority: 0.85, min_words: 120, max_words: 220, spine: true },
    { key: 'who_should', heading: 'Who needs larger healthcare buffers', base_priority: 0.8, min_words: 110, max_words: 200 },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  student: [
    { key: 'overview', heading: 'Student cost of living overview', base_priority: 1, min_words: 150, max_words: 260, spine: true },
    { key: 'housing', heading: 'Student housing options', base_priority: 0.95, min_words: 150, max_words: 260, spine: true },
    { key: 'education', heading: 'Study-related costs', base_priority: 0.9, min_words: 130, max_words: 220, spine: true },
    { key: 'food', heading: 'Student food budget', base_priority: 0.8, min_words: 110, max_words: 200 },
    { key: 'transport', heading: 'Getting around on a student budget', base_priority: 0.75, min_words: 100, max_words: 180 },
    { key: 'visa', heading: 'Visa and work-limit notes', base_priority: 0.7, min_words: 100, max_words: 180 },
    { key: 'budget', heading: 'Monthly student budget', base_priority: 0.95, min_words: 140, max_words: 240, spine: true },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  visa: [
    { key: 'overview', heading: 'Visa pathways and cost framing', base_priority: 1, min_words: 150, max_words: 260, spine: true },
    { key: 'visa', heading: 'Permit types and typical fee categories', base_priority: 1, min_words: 180, max_words: 300, spine: true },
    { key: 'housing', heading: 'Housing while on a visa clock', base_priority: 0.75, min_words: 120, max_words: 200 },
    { key: 'budget', heading: 'Landing-month and first-quarter costs', base_priority: 0.85, min_words: 130, max_words: 220, spine: true },
    { key: 'who_should', heading: 'Which pathway fits whom', base_priority: 0.85, min_words: 120, max_words: 200, spine: true },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  moving: [
    { key: 'overview', heading: 'Moving cost overview', base_priority: 1, min_words: 150, max_words: 260, spine: true },
    { key: 'housing', heading: 'First housing decisions', base_priority: 0.9, min_words: 140, max_words: 240, spine: true },
    { key: 'budget', heading: 'Move-month and settling budget', base_priority: 0.95, min_words: 150, max_words: 260, spine: true },
    { key: 'transport', heading: 'Getting set up for daily transport', base_priority: 0.7, min_words: 100, max_words: 180 },
    { key: 'healthcare', heading: 'Healthcare setup on arrival', base_priority: 0.7, min_words: 100, max_words: 180 },
    { key: 'visa', heading: 'Documents and timeline costs', base_priority: 0.75, min_words: 110, max_words: 200 },
    { key: 'who_should', heading: 'Relocation checklist by persona', base_priority: 0.85, min_words: 120, max_words: 220, spine: true },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  retirement: [
    { key: 'overview', heading: 'Retirement living-cost overview', base_priority: 1, min_words: 150, max_words: 260, spine: true },
    { key: 'healthcare', heading: 'Healthcare for longer stays', base_priority: 1, min_words: 160, max_words: 280, spine: true },
    { key: 'housing', heading: 'Housing for retirees', base_priority: 0.9, min_words: 140, max_words: 240, spine: true },
    { key: 'lifestyle', heading: 'Pace of life and discretionary spend', base_priority: 0.8, min_words: 120, max_words: 200 },
    { key: 'budget', heading: 'Retirement monthly budget', base_priority: 0.95, min_words: 140, max_words: 240, spine: true },
    { key: 'safety', heading: 'Safety and accessibility notes', base_priority: 0.65, min_words: 90, max_words: 180 },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  budget: [
    { key: 'overview', heading: 'Budgeting frame for this market', base_priority: 1, min_words: 140, max_words: 240, spine: true },
    { key: 'housing', heading: 'Housing line items', base_priority: 0.9, min_words: 130, max_words: 220 },
    { key: 'food', heading: 'Food line items', base_priority: 0.85, min_words: 120, max_words: 200 },
    { key: 'transport', heading: 'Transport line items', base_priority: 0.8, min_words: 110, max_words: 190 },
    { key: 'utilities', heading: 'Utilities and subscriptions', base_priority: 0.75, min_words: 100, max_words: 180 },
    { key: 'budget', heading: 'Full monthly budget examples', base_priority: 1, min_words: 160, max_words: 280, spine: true },
    { key: 'who_should', heading: 'Budget scenarios by lifestyle', base_priority: 0.8, min_words: 120, max_words: 200 },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  remote: [
    { key: 'overview', heading: 'Remote-work cost overview', base_priority: 1, min_words: 140, max_words: 240, spine: true },
    { key: 'remote', heading: 'Connectivity, workspace, and timezone fit', base_priority: 1, min_words: 160, max_words: 280, spine: true },
    { key: 'housing', heading: 'Housing that supports remote work', base_priority: 0.9, min_words: 140, max_words: 240 },
    { key: 'visa', heading: 'Visa and stay-length constraints', base_priority: 0.8, min_words: 120, max_words: 200 },
    { key: 'salary', heading: 'Income currency vs local costs', base_priority: 0.85, min_words: 130, max_words: 220 },
    { key: 'budget', heading: 'Remote monthly budget', base_priority: 0.9, min_words: 130, max_words: 220, spine: true },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  travel: [
    { key: 'overview', heading: 'Trip cost overview', base_priority: 1, min_words: 130, max_words: 220, spine: true },
    { key: 'housing', heading: 'Stay options and nightly costs', base_priority: 0.9, min_words: 130, max_words: 220, spine: true },
    { key: 'food', heading: 'Food costs while travelling', base_priority: 0.85, min_words: 120, max_words: 200 },
    { key: 'transport', heading: 'Getting around', base_priority: 0.85, min_words: 120, max_words: 200 },
    { key: 'culture', heading: 'Experience costs and pacing', base_priority: 0.7, min_words: 100, max_words: 180 },
    { key: 'budget', heading: 'Daily and weekly burn rates', base_priority: 0.95, min_words: 140, max_words: 240, spine: true },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
  tax: [
    { key: 'overview', heading: 'Tax and take-home overview', base_priority: 1, min_words: 150, max_words: 260, spine: true },
    { key: 'tax', heading: 'Tax categories that affect movers', base_priority: 1, min_words: 180, max_words: 300, spine: true },
    { key: 'salary', heading: 'Net pay implications', base_priority: 0.9, min_words: 140, max_words: 240, spine: true },
    { key: 'budget', heading: 'Budgeting after tax', base_priority: 0.85, min_words: 120, max_words: 220 },
    { key: 'who_should', heading: 'Who should model tax carefully', base_priority: 0.8, min_words: 110, max_words: 200 },
    { key: 'summary', heading: 'Summary', base_priority: 1, min_words: 90, max_words: 160, spine: true },
  ],
};

function evidenceScore(key: SectionKey, researchText: string): number {
  const t = researchText.toLowerCase();
  const map: Partial<Record<SectionKey, RegExp[]>> = {
    housing: [/rent|housing|apartment|lease|deposit/],
    food: [/food|grocer|restaurant|dining|meal/],
    transport: [/transport|transit|commute|metro|bus|taxi/],
    healthcare: [/health|hospital|insurance|clinic/],
    salary: [/salary|wage|income|purchasing power|ppp/],
    education: [/school|tuition|university|education/],
    tax: [/tax|vat|income tax|withholding/],
    visa: [/visa|permit|immigration|residency/],
    neighbourhoods: [/neighbourhood|neighborhood|district|suburb/],
    utilities: [/utilities|electricity|water|internet/],
    safety: [/safety|crime|secure/],
    remote: [/remote|internet|cowork|timezone/],
    regional: [/region|provincial|state|coastal|inland/],
    major_cities: [/city|cities|metro/],
  };
  const rules = map[key];
  if (!rules) return 0.55;
  let hits = 0;
  for (const re of rules) if (re.test(t)) hits += 1;
  return Math.min(1, 0.35 + hits * 0.25);
}

function topicBoost(key: SectionKey, topicBlob: string): number {
  const t = topicBlob.toLowerCase();
  if (key === 'visa' && /visa|permit/.test(t)) return 1.35;
  if (key === 'tax' && /tax/.test(t)) return 1.35;
  if (key === 'education' && /school|student|famil/.test(t)) return 1.3;
  if (key === 'remote' && /remote|nomad/.test(t)) return 1.35;
  if (key === 'healthcare' && /health|retire/.test(t)) return 1.25;
  if (key === 'housing' && /rent|housing|apartment/.test(t)) return 1.3;
  if (key === 'food' && /food|grocer/.test(t)) return 1.3;
  if (key === 'salary' && /salary|wage/.test(t)) return 1.3;
  return 1;
}

export function generateDynamicOutline(input: {
  guide_id: GuideId;
  persona: PersonaProfile;
  style: StyleProfile;
  title: string;
  keyword?: string | null;
  researchDigest: string;
  depth: 'standard' | 'deep';
  entities?: EditorialPlan['entities'];
}): OutlineSection[] {
  const seeds = SEEDS[input.guide_id] || SEEDS.moving;
  const topicBlob = `${input.title} ${input.keyword || ''} ${input.entities?.country || ''} ${input.entities?.city || ''}`;
  const targetCount = input.depth === 'deep' ? 11 : 8;

  const scored = seeds.map((s) => {
    const ev = evidenceScore(s.key, input.researchDigest);
    const score =
      s.base_priority *
      personaSectionBoost(input.persona, s.key) *
      topicBoost(s.key, topicBlob) *
      (0.65 + ev * 0.35);
    let evidence_mode: OutlineSection['evidence_mode'] = 'full';
    if (ev < 0.35 && !s.spine) evidence_mode = 'omit';
    else if (ev < 0.5) evidence_mode = 'uncertainty';
    else if (ev < 0.65) evidence_mode = 'shrink';
    return { seed: s, score, ev, evidence_mode };
  });

  const spine = scored.filter((x) => x.seed.spine && x.evidence_mode !== 'omit');
  const rest = scored
    .filter((x) => !x.seed.spine && x.evidence_mode !== 'omit')
    .sort((a, b) => b.score - a.score);

  const chosen = [...spine, ...rest].sort((a, b) => b.score - a.score);
  const limited: typeof chosen = [];
  const seen = new Set<SectionKey>();
  for (const row of chosen) {
    if (seen.has(row.seed.key)) continue;
    seen.add(row.seed.key);
    limited.push(row);
    if (limited.length >= targetCount) break;
  }

  // Ensure summary spine present
  if (!limited.some((x) => x.seed.key === 'summary')) {
    const sum = scored.find((x) => x.seed.key === 'summary');
    if (sum) limited.push(sum);
  }

  return limited
    .sort((a, b) => {
      // Keep summary last
      if (a.seed.key === 'summary') return 1;
      if (b.seed.key === 'summary') return -1;
      return b.score - a.score;
    })
    .map((row) => {
      const shrink = row.evidence_mode === 'shrink' || row.evidence_mode === 'uncertainty';
      return {
        key: row.seed.key,
        heading: adaptHeading(row.seed.heading, input),
        priority: row.score,
        min_words: shrink ? Math.round(row.seed.min_words * 0.7) : row.seed.min_words,
        max_words: shrink ? Math.round(row.seed.max_words * 0.75) : row.seed.max_words,
        evidence_mode: row.evidence_mode,
        brief: `${row.seed.heading}. Style=${input.style.label}. Persona=${input.persona.label}. Evidence=${row.evidence_mode}.`,
      };
    });
}

function adaptHeading(base: string, input: { entities?: EditorialPlan['entities']; title: string }): string {
  const country = input.entities?.country;
  const city = input.entities?.city;
  const cityB = input.entities?.city_b;
  if (city && cityB && /comparison/i.test(base)) return `${base} (${city} vs ${cityB})`;
  if (city && /city|neighbourhood|housing|commute|budget/i.test(base)) {
    return base.replace(/\bthe city\b/i, city).includes(city) ? base : `${base} in ${city}`;
  }
  if (country && /national|country|nationwide|regional/i.test(base)) {
    return base.includes(country) ? base : `${base} in ${country}`;
  }
  return base;
}
