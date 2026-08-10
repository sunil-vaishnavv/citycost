/**
 * Persona Engine — rich persona catalog influencing tone, advice, priorities, FAQ, summary.
 */

import type { PersonaId, PersonaProfile, SectionKey } from '../types.js';

const CATALOG: Record<PersonaId, Omit<PersonaProfile, 'confidence'>> = {
  young_professional: {
    id: 'young_professional',
    label: 'Young Professional',
    tone: 'Direct, career-aware, rent-and-commute focused',
    example_bias: 'studio/1BR, transit passes, after-tax salary stretch',
    advice_angle: 'Optimize housing near work and build a 3-line monthly budget',
    section_priority: { housing: 1.3, salary: 1.25, transport: 1.2, lifestyle: 1.1 },
    faq_framing: 'Answer as advice for someone starting a first relocation for work',
    summary_stance: 'Recommend a practical first-year plan',
  },
  married_couple: {
    id: 'married_couple',
    label: 'Married Couple',
    tone: 'Balanced, household-budget aware',
    example_bias: '1–2BR rent, dual income, shared utilities',
    advice_angle: 'Trade-offs between neighbourhood amenity and commute for two people',
    section_priority: { housing: 1.25, budget: 1.2, lifestyle: 1.15, healthcare: 1.1 },
    faq_framing: 'Frame answers for a two-adult household',
    summary_stance: 'Recommend whether the market works for a dual-income pair',
  },
  family_with_children: {
    id: 'family_with_children',
    label: 'Family with Children',
    tone: 'Cautious, school-and-safety aware',
    example_bias: '2–3BR, schools, paediatric access, family neighbourhoods',
    advice_angle: 'Prioritise schools, healthcare buffer, and stable lease terms',
    section_priority: { schools: 1.4, education: 1.35, safety: 1.3, housing: 1.25, healthcare: 1.2 },
    faq_framing: 'Answer for parents relocating with children',
    summary_stance: 'Recommend only if schooling and housing buffers look workable',
  },
  digital_nomad: {
    id: 'digital_nomad',
    label: 'Digital Nomad',
    tone: 'Flexible, connectivity-first',
    example_bias: 'short leases, cafes/co-working, visa length, FX',
    advice_angle: 'Visa runway, internet reliability, and month-to-month housing',
    section_priority: { visa: 1.35, remote: 1.3, lifestyle: 1.2, housing: 1.15 },
    faq_framing: 'Answer for location-independent workers on temporary stays',
    summary_stance: 'Recommend stay length and neighbourhood types for nomads',
  },
  remote_worker: {
    id: 'remote_worker',
    label: 'Remote Worker',
    tone: 'Practical, timezone and workspace aware',
    example_bias: 'home office space, reliable power/internet, salary arbitrage',
    advice_angle: 'Housing that supports deep work plus cost vs home-country salary',
    section_priority: { remote: 1.4, housing: 1.2, salary: 1.25, lifestyle: 1.1 },
    faq_framing: 'Answer for full-time remote employees relocating',
    summary_stance: 'Recommend if remote setup and cost base align',
  },
  retired_couple: {
    id: 'retired_couple',
    label: 'Retired Couple',
    tone: 'Calm, healthcare-and-pace focused',
    example_bias: 'healthcare access, walkability, quieter neighbourhoods',
    advice_angle: 'Healthcare buffers and predictable monthly costs over career clustering',
    section_priority: { healthcare: 1.45, lifestyle: 1.2, budget: 1.2, safety: 1.15 },
    faq_framing: 'Answer for retirees planning a longer stay',
    summary_stance: 'Recommend based on healthcare and cost predictability',
  },
  budget_traveller: {
    id: 'budget_traveller',
    label: 'Budget Traveller',
    tone: 'Frugal, trade-off explicit',
    example_bias: 'hostels/shared flats, street food, transit',
    advice_angle: 'Cut housing and food first without unsafe shortcuts',
    section_priority: { budget: 1.4, food: 1.25, housing: 1.2, transport: 1.15 },
    faq_framing: 'Answer for cost-minimising travellers',
    summary_stance: 'Give a lean monthly stack',
  },
  luxury_traveller: {
    id: 'luxury_traveller',
    label: 'Luxury Traveller',
    tone: 'Selective, quality-over-price',
    example_bias: 'prime districts, private healthcare, dining',
    advice_angle: 'Premium neighbourhoods and service quality, with clear premiums',
    section_priority: { lifestyle: 1.3, housing: 1.25, healthcare: 1.15, food: 1.15 },
    faq_framing: 'Answer for high-budget stays',
    summary_stance: 'Recommend premium districts and expected premiums',
  },
  international_student: {
    id: 'international_student',
    label: 'International Student',
    tone: 'Clear, campus-and-visa aware',
    example_bias: 'shared housing, transit student passes, visa work limits',
    advice_angle: 'Near-campus housing and realistic part-time income assumptions',
    section_priority: { education: 1.4, housing: 1.25, visa: 1.3, transport: 1.15, food: 1.1 },
    faq_framing: 'Answer for students arriving from abroad',
    summary_stance: 'Recommend a student-year budget and housing pattern',
  },
  indian_student: {
    id: 'indian_student',
    label: 'Indian Student',
    tone: 'Practical, FX and shared-housing aware',
    example_bias: 'INR budgeting, shared flats, Indian grocery options',
    advice_angle: 'Convert costs to familiar monthly INR planning bands where helpful',
    section_priority: { education: 1.35, housing: 1.3, food: 1.2, visa: 1.25 },
    faq_framing: 'Answer with Indian student cost context in mind',
    summary_stance: 'Give an India-student-oriented monthly plan',
  },
  us_student: {
    id: 'us_student',
    label: 'US Student',
    tone: 'Straightforward, USD comparison friendly',
    example_bias: 'on/off campus, health insurance, meal plans',
    advice_angle: 'Compare to US campus cost mental models without inventing fees',
    section_priority: { education: 1.35, healthcare: 1.25, housing: 1.25, food: 1.1 },
    faq_framing: 'Answer for US students abroad or relocating for study',
    summary_stance: 'Recommend a semester/year cost frame',
  },
  eu_student: {
    id: 'eu_student',
    label: 'EU Student',
    tone: 'Mobility and residency aware',
    example_bias: 'EU mobility rules, public transit, shared flats',
    advice_angle: 'Residency/visa nuance and public-system access',
    section_priority: { visa: 1.3, education: 1.3, transport: 1.2, housing: 1.2 },
    faq_framing: 'Answer for EU students moving across borders',
    summary_stance: 'Recommend with mobility and public-cost framing',
  },
  investor: {
    id: 'investor',
    label: 'Investor',
    tone: 'Analytical, yield-and-risk aware',
    example_bias: 'rent yields, tax friction, liquidity',
    advice_angle: 'Separate living costs from investment thesis; no invented yields',
    section_priority: { tax: 1.35, housing: 1.25, salary: 1.1, overview: 1.15 },
    faq_framing: 'Answer for readers evaluating a market financially',
    summary_stance: 'Separate personal COL from investment caution',
  },
  entrepreneur: {
    id: 'entrepreneur',
    label: 'Entrepreneur',
    tone: 'Opportunity-aware, operational',
    example_bias: 'setup costs, talent pools, coworking, tax residency',
    advice_angle: 'Operating costs and talent access alongside personal COL',
    section_priority: { tax: 1.25, remote: 1.2, salary: 1.2, lifestyle: 1.1 },
    faq_framing: 'Answer for founders relocating operations or themselves',
    summary_stance: 'Recommend if ops + personal costs look viable',
  },
  backpacker: {
    id: 'backpacker',
    label: 'Backpacker',
    tone: 'Lean, short-stay',
    example_bias: 'hostels, night buses, street food',
    advice_angle: 'Daily burn rate and short-stay housing',
    section_priority: { budget: 1.4, transport: 1.25, food: 1.25, housing: 1.1 },
    faq_framing: 'Answer for short multi-city trips',
    summary_stance: 'Give a daily/weekly burn estimate framing',
  },
  job_seeker: {
    id: 'job_seeker',
    label: 'Job Seeker',
    tone: 'Cautious runway planning',
    example_bias: 'runway months, cheaper districts, interview transport',
    advice_angle: 'Preserve runway; avoid long leases until offer is firm',
    section_priority: { salary: 1.35, housing: 1.25, budget: 1.3, transport: 1.1 },
    faq_framing: 'Answer for people relocating before or while job hunting',
    summary_stance: 'Stress runway and flexible housing',
  },
  freelancer: {
    id: 'freelancer',
    label: 'Freelancer',
    tone: 'Variable-income aware',
    example_bias: 'tax residency, irregular income buffers, workspace',
    advice_angle: 'Build buffers for feast/famine months',
    section_priority: { tax: 1.3, salary: 1.25, remote: 1.2, housing: 1.15 },
    faq_framing: 'Answer for independent contractors',
    summary_stance: 'Recommend buffers and flexible cost base',
  },
  general: {
    id: 'general',
    label: 'General Reader',
    tone: 'Clear, practical, neutral',
    example_bias: 'median household patterns',
    advice_angle: 'Explain trade-offs without assuming one lifestyle',
    section_priority: {},
    faq_framing: 'Answer for a general relocating reader',
    summary_stance: 'Give a balanced recommendation',
  },
};

function scorePersona(text: string, id: PersonaId): number {
  const t = text.toLowerCase();
  const rules: Partial<Record<PersonaId, RegExp[]>> = {
    family_with_children: [/famil(y|ies)/, /children|kids|school/],
    retired_couple: [/retire|pension|senior/],
    digital_nomad: [/digital nomad|nomad/],
    remote_worker: [/remote work|work from home|wfh/],
    international_student: [/international student|study abroad/],
    indian_student: [/indian student|from india.*student/],
    us_student: [/us student|american student/],
    eu_student: [/eu student|erasmus/],
    young_professional: [/young professional|early career|graduate job/],
    married_couple: [/couple|married|partners relocating/],
    budget_traveller: [/budget travel|cheap travel|backpack.*budget/],
    luxury_traveller: [/luxury|premium travel|high.?end/],
    investor: [/investor|property yield|roi/],
    entrepreneur: [/founder|startup|entrepreneur/],
    backpacker: [/backpacker|hostel hop/],
    job_seeker: [/job seeker|looking for (a )?job|job hunt/],
    freelancer: [/freelancer|contractor|independent/],
  };
  const list = rules[id] || [];
  let s = 0;
  for (const re of list) if (re.test(t)) s += 1;
  return s;
}

export function detectPersona(input: {
  title?: string;
  persona?: string | null;
  content_type?: string | null;
  keyword?: string | null;
  angle?: string | null;
}): PersonaProfile {
  const blob = [input.title, input.persona, input.content_type, input.keyword, input.angle]
    .filter(Boolean)
    .join(' ');
  const explicit = String(input.persona || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');

  const alias: Record<string, PersonaId> = {
    student: 'international_student',
    family: 'family_with_children',
    expat: 'young_professional',
    retiree: 'retired_couple',
    retired: 'retired_couple',
    nomad: 'digital_nomad',
    remote: 'remote_worker',
  };

  if (explicit && (CATALOG[explicit as PersonaId] || alias[explicit])) {
    const id = (CATALOG[explicit as PersonaId] ? explicit : alias[explicit]) as PersonaId;
    return { ...CATALOG[id], confidence: 0.95 };
  }

  let best: PersonaId = 'general';
  let bestScore = 0;
  for (const id of Object.keys(CATALOG) as PersonaId[]) {
    if (id === 'general') continue;
    const s = scorePersona(blob, id);
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  }

  if (/student/i.test(blob) && best === 'general') best = 'international_student';
  return { ...CATALOG[best], confidence: bestScore > 0 ? Math.min(0.9, 0.45 + bestScore * 0.2) : 0.4 };
}

export function listPersonas(): PersonaId[] {
  return Object.keys(CATALOG) as PersonaId[];
}

export function personaSectionBoost(persona: PersonaProfile, key: SectionKey): number {
  return persona.section_priority[key] ?? 1;
}
