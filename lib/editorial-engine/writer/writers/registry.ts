/**
 * Dedicated Writer registry — every content type has its own strategy.
 * Never share one master writing strategy across types.
 */

import type { DedicatedWriter, WriterId } from './types.js';

const SHARED_VOICE =
  'Relocation consultant + financial planner. Practical, specific, human. Never ChatGPT brochure tone.';

function w(
  partial: Omit<DedicatedWriter, 'voice'> & { voice?: string }
): DedicatedWriter {
  return { voice: SHARED_VOICE, ...partial };
}

export const WRITERS: Record<WriterId, DedicatedWriter> = {
  country_guide: w({
    id: 'country_guide',
    label: 'Country Guide Writer',
    purpose: 'Teach users about living costs across an entire country',
    structure: [
      'Country overview',
      'Regional differences',
      'Major cities as examples',
      'Typical monthly budgets',
      'Cost categories',
      'Who should move',
      'Pros',
      'Cons',
      'Summary recommendation',
    ],
    focus_lines: ['national housing patterns', 'regional spreads', 'country healthcare access', 'typical monthly stack'],
    section_bias: {
      intro: 'National hook — not a two-city duel',
      housing: 'Country-wide rent patterns; cities only as examples',
      food: 'National grocery/dining habits and regional food cost gaps',
      transport: 'National transit vs car realities by region type',
      healthcare: 'Country system + eligibility warnings',
      salary: 'National purchasing-power framing',
      pros: 'Country-level advantages',
      cons: 'Country-level frictions',
      summary: 'Who the country suits + city-type shortlist',
    },
    do: [
      'Lead with the country',
      'Name 3–6 cities as examples only',
      'Explain metro vs smaller-city spreads',
    ],
    dont: [
      'Focus on one city',
      'Compare only two cities as the thesis',
      'Use hold-lifestyle-constant comparison cadence throughout',
    ],
    summary_brief:
      'Recommend who should move to this country, which cost lines to lock first, and which city types to shortlist — never crown two cities.',
    system_rules: [
      'GUIDE=COUNTRY. Cities are examples only.',
      'Never make the article about City A vs City B.',
    ],
  }),

  city_guide: w({
    id: 'city_guide',
    label: 'City Guide Writer',
    purpose: 'Help users move to ONE city',
    structure: [
      'City hook',
      'Housing & neighbourhoods',
      'Commute',
      'Food',
      'Lifestyle',
      'Healthcare',
      'Schools (if relevant)',
      'Monthly budget',
      'Local advice',
      'Summary',
    ],
    focus_lines: ['neighbourhoods', 'lease reality', 'commute', 'local food habits', 'city healthcare access'],
    section_bias: {
      intro: 'Hook around THIS city only',
      housing: 'Neighbourhoods, deposits, utilities in this city',
      food: 'Local grocery and dining habits',
      transport: 'This city commute choices',
      healthcare: 'Local access and buffers',
      salary: 'Affordability in this city',
      pros: 'Why people stay here',
      cons: 'Local frictions',
      summary: 'City-specific recommendation',
    },
    do: ['Keep every section about one city', 'Name neighbourhoods when known'],
    dont: ['Turn the page into a multi-city comparison', 'Wander into national overview'],
    summary_brief: 'Recommend whether this city fits the reader and list concrete next steps there.',
    system_rules: [
      'GUIDE=CITY. One city is the subject.',
      'Mention another city only for a brief cost contrast, never as co-equal focus.',
    ],
  }),

  comparison_guide: w({
    id: 'comparison_guide',
    label: 'Comparison Guide Writer',
    purpose: 'Compare two locations fairly',
    structure: [
      'Comparison frame',
      'Housing A vs B',
      'Food A vs B',
      'Transport A vs B',
      'Healthcare A vs B',
      'Salary A vs B',
      'Pros A',
      'Pros B / Cons framing',
      'Who should choose which',
    ],
    focus_lines: ['side-by-side rent stretch', 'daily costs both sides', 'persona-based recommendation'],
    section_bias: {
      intro: 'Frame the pair and the decision criteria',
      housing: 'A vs B housing',
      food: 'A vs B food',
      transport: 'A vs B commute',
      healthcare: 'A vs B coverage/cost feel',
      salary: 'A vs B stretch',
      pros: 'Strengths per side',
      cons: 'Weaknesses per side',
      summary: 'Who should choose A vs B',
    },
    do: ['Every major section compares both sides', 'Hold lifestyle constant', 'End with persona recommendation'],
    dont: ['National overview digressions', 'Declare a universal winner'],
    summary_brief: 'Say who should pick A and who should pick B based on clear criteria.',
    system_rules: [
      'GUIDE=COMPARISON. Keep both places in view in every major section.',
      'Recommendation must be persona-based, not absolute.',
    ],
  }),

  salary_guide: w({
    id: 'salary_guide',
    label: 'Salary Guide Writer',
    purpose: 'Explain income, tax feel, purchasing power, and savings room',
    structure: ['Income framing', 'Tax / take-home', 'Purchasing power', 'Housing share', 'Savings & lifestyle', 'Summary'],
    focus_lines: ['take-home pay', 'rent as share of income', 'savings rate', 'lifestyle trade-offs'],
    section_bias: {
      intro: 'Salary stretch is the question',
      housing: 'Housing as % of take-home',
      salary: 'Deep dive on offers vs real cash',
      summary: 'When an offer is workable',
    },
    do: ['Convert gross to monthly planning cash', 'Tie lifestyle to leftover after rent'],
    dont: ['Invent exact tax rates', 'Wander into full country tourism'],
    summary_brief: 'State what salary band feels workable after housing and buffers.',
    system_rules: ['GUIDE=SALARY. Income and purchasing power lead every section.'],
  }),

  rent_guide: w({
    id: 'rent_guide',
    label: 'Rent Guide Writer',
    purpose: 'Housing-only practical guide',
    structure: ['Rental market', 'Deposits & fees', 'Utilities', 'Neighbourhoods', 'Lease tips', 'Summary'],
    focus_lines: ['listing vs move-in cost', 'deposits', 'utilities', 'lease length', 'neighbourhood trade-offs'],
    section_bias: {
      intro: 'Rent is the swing factor',
      housing: 'Deep practical lease advice',
      summary: 'How to lock a defensible rent range',
    },
    do: ['Stay on housing mechanics', 'Warn about fees and inclusions'],
    dont: ['Pad with unrelated food/transport essays'],
    summary_brief: 'Recommend how to shortlist neighbourhoods and verify total move-in cash.',
    system_rules: ['GUIDE=RENT. Housing only — other categories stay brief context.'],
  }),

  food_guide: w({
    id: 'food_guide',
    label: 'Food Guide Writer',
    purpose: 'Grocery habits, dining out, and monthly food budgets',
    structure: ['Food cost overview', 'Groceries', 'Dining out', 'Regional differences', 'Budget tips', 'Summary'],
    focus_lines: ['grocery basket', 'dining frequency', 'imports vs local', 'weekly receipt method'],
    section_bias: {
      intro: 'Food is a habit line',
      food: 'Deep habit-based budgeting',
      summary: 'How to set a food allowance',
    },
    do: ['Separate groceries from dining out', 'Use habit examples'],
    dont: ['Lecture nutrition', 'Force housing essays'],
    summary_brief: 'Recommend a practical food budgeting method for relocators.',
    system_rules: ['GUIDE=FOOD. Habits and budgets, not restaurant reviews.'],
  }),

  healthcare_guide: w({
    id: 'healthcare_guide',
    label: 'Healthcare Guide Writer',
    purpose: 'Public vs private, insurance, emergency costs',
    structure: ['System overview', 'Eligibility', 'Insurance', 'Routine vs emergency', 'Budget buffer', 'Summary'],
    focus_lines: ['eligibility', 'premiums', 'GP visit planning', 'emergency buffer'],
    section_bias: {
      intro: 'Coverage depends on status',
      healthcare: 'Warnings and planning buffers',
      summary: 'What to confirm before you move',
    },
    do: ['Warn against assuming free care', 'Separate routine and emergency cash'],
    dont: ['Give medical or legal advice'],
    summary_brief: 'List what to verify with insurers/official sources before relocating.',
    system_rules: ['GUIDE=HEALTHCARE. Planning warnings over slogans.'],
  }),

  transportation_guide: w({
    id: 'transportation_guide',
    label: 'Transport Guide Writer',
    purpose: 'Public transport, car ownership, commuting decisions',
    structure: ['Commute reality', 'Transit options', 'Car ownership stack', 'Pass vs pay-as-you-go', 'Summary'],
    focus_lines: ['commute pattern', 'pass pricing', 'parking/insurance', 'location trade-offs'],
    section_bias: {
      intro: 'Transport is a location decision',
      transport: 'Decision guidance car vs transit',
      summary: 'How to choose for the first 90 days',
    },
    do: ['Tie advice to job/campus location', 'Include full car stack'],
    dont: ['Generic transit praise'],
    summary_brief: 'Recommend a 30-day transit test before buying annual/car commitments.',
    system_rules: ['GUIDE=TRANSPORT. Decision guidance, not route lists.'],
  }),

  student_guide: w({
    id: 'student_guide',
    label: 'Student Guide Writer',
    purpose: 'Student expenses, housing near campus, transport, budgets',
    structure: [
      'Student cost overview',
      'Accommodation',
      'Food',
      'Transport',
      'Tuition vs living',
      'Scholarships / work hours (practical)',
      'Summary',
    ],
    focus_lines: ['shared housing', 'campus commute', 'living costs separate from tuition', 'part-time work realism'],
    section_bias: {
      intro: 'Student cash-flow reality',
      housing: 'Near campus vs cheaper farther flats',
      education: 'Tuition separate from living',
      summary: 'Monthly student stack recommendation',
    },
    do: ['Split tuition from living costs', 'Be honest about work-hour limits'],
    dont: ['Promise visas or scholarships'],
    summary_brief: 'Recommend a realistic student monthly stack and housing approach.',
    system_rules: ['GUIDE=STUDENT. Campus living costs lead.'],
  }),

  visa_guide: w({
    id: 'visa_guide',
    label: 'Visa Guide Writer',
    purpose: 'Visa path costs, documentation, settlement budget',
    structure: ['Pathway overview', 'Fees & proof of funds', 'Timeline cash impact', 'Settlement costs', 'Summary'],
    focus_lines: ['application fees', 'proof-of-funds', 'timing vs lease', 'first-month settlement'],
    section_bias: {
      intro: 'Legal path timing drives money timing',
      visa: 'Fees and documentation (non-legal)',
      moving: 'Settlement cash pile',
      summary: 'What to budget before you sign a lease',
    },
    do: ['Point to official sources', 'Separate immigration fees from living costs'],
    dont: ['Promise approvals', 'Invent fee schedules'],
    summary_brief: 'Recommend cash timing: fees, proof-of-funds, then housing deposits.',
    system_rules: ['GUIDE=VISA. Non-legal practical budgeting only.'],
  }),

  retirement_guide: w({
    id: 'retirement_guide',
    label: 'Retirement Guide Writer',
    purpose: 'Retirement living costs, healthcare, pace of life money',
    structure: ['Retirement cost overview', 'Housing', 'Healthcare', 'Daily living', 'Who it suits', 'Summary'],
    focus_lines: ['fixed income stretch', 'healthcare buffers', 'quieter lifestyle costs'],
    section_bias: {
      intro: 'Fixed-income realism',
      healthcare: 'Critical for retirees',
      summary: 'Who should retire here financially',
    },
    do: ['Stress healthcare and housing stability'],
    dont: ['Youth/nightlife framing'],
    summary_brief: 'Recommend whether fixed-income relocators can make the numbers work.',
    system_rules: ['GUIDE=RETIREMENT. Stability and healthcare first.'],
  }),

  moving_guide: w({
    id: 'moving_guide',
    label: 'Moving Guide Writer',
    purpose: 'First-month checklist and relocation cash',
    structure: ['Move timeline', 'Landing costs', 'Deposits', 'Setup buys', 'First 30 days', 'Summary'],
    focus_lines: ['temporary stay', 'deposits', 'setup fees', 'contingency'],
    section_bias: {
      intro: 'Moving is a cash event',
      moving: 'Hands-on checklist',
      summary: 'First-month cash recommendation',
    },
    do: ['Separate setup cash from monthly rent', 'Sequence timing'],
    dont: ['Repeat full COL encyclopedia'],
    summary_brief: 'Recommend a first-month cash pile and what to delay buying.',
    system_rules: ['GUIDE=MOVING. First-month logistics and cash.'],
  }),

  remote_worker_guide: w({
    id: 'remote_worker_guide',
    label: 'Remote Work Guide Writer',
    purpose: 'Remote-worker cost of living and workspace trade-offs',
    structure: ['Remote budget frame', 'Housing for WFH', 'Coworking/internet', 'Lifestyle', 'Summary'],
    focus_lines: ['internet reliability', 'desk days vs commute', 'housing that fits remote work'],
    section_bias: {
      intro: 'Remote income meets local prices',
      housing: 'WFH space vs location',
      summary: 'When remote relocation makes financial sense',
    },
    do: ['Factor home workspace and internet', 'Compare after-rent remote stretch'],
    dont: ['Digital nomad clichés'],
    summary_brief: 'Recommend housing/internet priorities for remote relocators.',
    system_rules: ['GUIDE=REMOTE. Work-from-home cost reality.'],
  }),

  budget_guide: w({
    id: 'budget_guide',
    label: 'Budget Guide Writer',
    purpose: 'Build a defensible monthly budget worksheet',
    structure: ['Budget framework', 'Fixed vs variable', 'Category deep dives', 'Buffers', 'Summary'],
    focus_lines: ['worksheet method', 'buffers', 'category caps'],
    section_bias: {
      intro: 'Budget as a decision tool',
      overview: 'Lines and ownership',
      summary: 'How to close the month',
    },
    do: ['Give a clear worksheet structure', 'Prioritize housing first'],
    dont: ['Vague lifestyle essays'],
    summary_brief: 'Recommend a simple monthly worksheet the reader can fill this week.',
    system_rules: ['GUIDE=BUDGET. Worksheet clarity over narrative filler.'],
  }),

  tax_guide: w({
    id: 'tax_guide',
    label: 'Tax Guide Writer',
    purpose: 'How tax changes take-home feel for relocators',
    structure: ['Gross vs net', 'Status differences', 'Living cost interaction', 'Summary'],
    focus_lines: ['take-home', 'mandatory contributions', 'offer comparison'],
    section_bias: {
      intro: 'Gross is not spendable',
      tax: 'Practical non-legal framing',
      salary: 'Net pay vs lifestyle',
      summary: 'Compare offers on take-home',
    },
    do: ['Keep non-legal', 'Push readers to verify with advisers'],
    dont: ['Cite invented rates as fact'],
    summary_brief: 'Recommend comparing relocation offers on estimated take-home, not gross.',
    system_rules: ['GUIDE=TAX. Practical take-home framing only.'],
  }),

  general_guide: w({
    id: 'general_guide',
    label: 'General Guide Writer',
    purpose: 'Practical cost-of-living guidance when no specialist type matches',
    structure: ['Overview', 'Key cost lines', 'Who it helps', 'Summary'],
    focus_lines: ['housing', 'food', 'transport', 'buffers'],
    section_bias: {
      intro: 'Clear decision frame',
      summary: 'Actionable next steps',
    },
    do: ['Stay practical', 'Vary section objectives'],
    dont: ['Reuse country/comparison templates blindly'],
    summary_brief: 'Recommend concrete next budgeting actions.',
    system_rules: ['GUIDE=GENERAL. Practical COL guidance.'],
  }),
};
