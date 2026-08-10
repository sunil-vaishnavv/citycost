/**
 * Guide-specific section writers — NEVER shared across guides.
 * Each writer id is `${guide}.${section}` with unique voice/rules.
 */

import type {
  EditorialPlan,
  GuideId,
  GuideSpecificSectionWriter,
  OutlineSection,
  SectionKey,
} from '../types.js';

/** Per-guide behavioural DNA for a section key — unique, not shared objects. */
type SectionDna = {
  voice: string;
  rules: string[];
  anti: string[];
};

const GUIDE_SECTION_DNA: Record<GuideId, Partial<Record<SectionKey, SectionDna>>> = {
  country: {
    housing: {
      voice: 'National housing analyst — cities only as examples',
      rules: ['Describe country-wide rent patterns', 'Contrast metro vs smaller cities', 'No two-city duel thesis'],
      anti: ['A vs B apartment showdown', 'Single-neighbourhood deep dive as the whole section'],
    },
    food: {
      voice: 'National food-cost guide',
      rules: ['Regional grocery/dining spreads', 'Use country dietary patterns when known'],
      anti: ['One restaurant district as the country'],
    },
    transport: {
      voice: 'National mobility patterns',
      rules: ['Transit vs car by region type', 'Intercity vs local costs'],
      anti: ['Only one metro line map'],
    },
    healthcare: {
      voice: 'Country health-system cost guide',
      rules: ['Eligibility humility', 'Public vs private framing without inventing fees'],
      anti: ['Clinic-by-clinic reviews'],
    },
    salary: {
      voice: 'National earnings and PPP',
      rules: ['Purchasing power vs headline wages', 'Regional wage gaps when evidenced'],
      anti: ['One employer salary table invented'],
    },
    education: {
      voice: 'National education cost notes',
      rules: ['Public vs private schooling cost drivers', 'Uncertainty if fees unknown'],
      anti: ['Fake tuition tables'],
    },
    tax: {
      voice: 'Country tax drag for movers',
      rules: ['Categories not legal advice', 'How tax affects take-home'],
      anti: ['Precise invented rates'],
    },
    regional: {
      voice: 'Regional COL cartographer',
      rules: ['Name region types', 'Explain why costs diverge'],
      anti: ['Identical paragraphs per region'],
    },
    major_cities: {
      voice: 'City examples for a country guide',
      rules: ['3–6 cities as illustrations', 'Never crown a single city as the article subject'],
      anti: ['Turning into a city guide'],
    },
    budget: {
      voice: 'Country monthly stack builder',
      rules: ['Lean vs comfortable bands', 'State assumptions'],
      anti: ['Copy-paste city budget as national truth'],
    },
    who_should: {
      voice: 'Country fit advisor',
      rules: ['Persona-conditioned fit', 'Honest mismatches'],
      anti: ['Everyone should move here'],
    },
    overview: {
      voice: 'National opener',
      rules: ['Country as subject', 'Preview regional spread'],
      anti: ['Two-city comparison lead'],
    },
    remote: {
      voice: 'Country remote-work fit',
      rules: ['Connectivity and visa runway at country level'],
      anti: ['Coworking venue lists as facts without evidence'],
    },
    visa: {
      voice: 'Country residency cost notes',
      rules: ['Pathway categories only with evidence', 'No legal guarantees'],
      anti: ['Guaranteed approval language'],
    },
    summary: {
      voice: 'Country closing advisor',
      rules: ['Who the country suits', 'City-type shortlist not a duel'],
      anti: ['Repeat the introduction'],
    },
    faq: {
      voice: 'Country FAQ specialist',
      rules: ['Direct answers', 'No body paragraph reuse'],
      anti: ['Identical FAQ stems across articles'],
    },
  },
  city: {
    housing: {
      voice: 'City housing local',
      rules: ['Neighbourhoods, deposits, utilities for THIS city', 'One city subject'],
      anti: ['National housing lecture'],
    },
    neighbourhoods: {
      voice: 'Neighbourhood cost scout',
      rules: ['Where costs concentrate', 'Commute trade-offs'],
      anti: ['Tourism brochure'],
    },
    food: {
      voice: 'City food budgeter',
      rules: ['Local grocery/dining habits', 'Concrete levers'],
      anti: ['Generic world-food essay'],
    },
    commute: {
      voice: 'City commute coach',
      rules: ['Modes that matter here', 'Time vs money'],
      anti: ['National highway policy'],
    },
    transport: {
      voice: 'City transport costs',
      rules: ['Local tickets and car necessity'],
      anti: ['Intercountry flight focus'],
    },
    healthcare: {
      voice: 'City healthcare access',
      rules: ['Local access patterns', 'Buffers'],
      anti: ['Invented clinic prices'],
    },
    schools: {
      voice: 'City family schooling costs',
      rules: ['Only if relevant', 'Uncertainty when fees unknown'],
      anti: ['Fake school rankings'],
    },
    safety: {
      voice: 'City livability notes',
      rules: ['Practical, non-sensational', 'No invented crime stats'],
      anti: ['Fearmongering'],
    },
    salary: {
      voice: 'City affordability',
      rules: ['Local PPP vs rent'],
      anti: ['Country GDP lecture'],
    },
    lifestyle: {
      voice: 'City lifestyle spend',
      rules: ['Discretionary drivers in this city'],
      anti: ['Generic influencer itinerary'],
    },
    budget: {
      voice: 'City monthly budget',
      rules: ['One city stack', 'State household assumptions'],
      anti: ['Two-city merge'],
    },
    overview: {
      voice: 'City opener',
      rules: ['Hook on this city only'],
      anti: ['Country panorama lead'],
    },
    summary: {
      voice: 'City closer',
      rules: ['Stay/leave recommendation for this city'],
      anti: ['Intro reprise'],
    },
    faq: {
      voice: 'City FAQ',
      rules: ['Local questions', 'Unique wording'],
      anti: ['Country FAQ clones'],
    },
  },
  comparison: {
    housing: {
      voice: 'Side-by-side housing analyst',
      rules: ['A vs B rent stretch', 'Same lifestyle assumptions'],
      anti: ['Single-city essay'],
    },
    salary: {
      voice: 'Side-by-side earnings',
      rules: ['PPP both sides', 'Net pay humility'],
      anti: ['One-sided salary cheerleading'],
    },
    food: {
      voice: 'Food A vs B',
      rules: ['Groceries and dining both sides'],
      anti: ['Recipe blog tone'],
    },
    transport: {
      voice: 'Transport A vs B',
      rules: ['Commute cost/time both sides'],
      anti: ['Ignoring one side'],
    },
    healthcare: {
      voice: 'Healthcare A vs B',
      rules: ['Access comparison without invented fees'],
      anti: ['Medical advice'],
    },
    lifestyle: {
      voice: 'Lifestyle A vs B',
      rules: ['Everyday discretionary contrasts'],
      anti: ['Travelogue'],
    },
    pros: {
      voice: 'Pros counsel',
      rules: ['Pros per side', 'Evidence-tied'],
      anti: ['Symmetric filler lists'],
    },
    cons: {
      voice: 'Cons counsel',
      rules: ['Real frictions', 'Asymmetric OK'],
      anti: ['Fake balance'],
    },
    recommendation: {
      voice: 'Decision advisor',
      rules: ['Who should pick which', 'Persona-aware'],
      anti: ['Everyone wins equally'],
    },
    overview: {
      voice: 'Comparison frame',
      rules: ['State criteria', 'Name both places'],
      anti: ['Single-place intro'],
    },
    summary: {
      voice: 'Comparison closer',
      rules: ['Decision recap', 'No intro copy'],
      anti: ['New unrelated cities'],
    },
    faq: {
      voice: 'Comparison FAQ',
      rules: ['Pair-specific questions'],
      anti: ['Generic COL FAQ'],
    },
  },
  salary: {
    overview: { voice: 'Compensation guide opener', rules: ['Pay and take-home frame'], anti: ['Tourism lead'] },
    salary: { voice: 'Pay-band analyst', rules: ['PPP and bands with evidence only'], anti: ['Invented offers'] },
    tax: { voice: 'Net-pay tax lens', rules: ['Categories affecting take-home'], anti: ['Legal advice'] },
    housing: { voice: 'Rent-vs-salary', rules: ['How rent consumes pay'], anti: ['Full city guide'] },
    budget: { voice: 'Salary-led budget', rules: ['Stack from net pay'], anti: ['Ignore taxes'] },
    lifestyle: { voice: 'Post-fixed-cost lifestyle', rules: ['Discretionary after housing'], anti: ['Luxury flex without numbers'] },
    who_should: { voice: 'Pay-market fit', rules: ['Who thrives here financially'], anti: ['Universal recommend'] },
    summary: { voice: 'Salary closer', rules: ['Net-pay takeaway'], anti: ['Intro echo'] },
    faq: { voice: 'Salary FAQ', rules: ['Compensation questions'], anti: ['Visa FAQ clone'] },
  },
  rent: {
    overview: { voice: 'Rental market opener', rules: ['Lease reality first'], anti: ['Salary essay'] },
    housing: { voice: 'Rent deep-dive', rules: ['Deposits, norms, unit types'], anti: ['Fake listings'] },
    neighbourhoods: { voice: 'Rent map by area', rules: ['Spreads by district type'], anti: ['Empty name-drops'] },
    utilities: { voice: 'Extras beyond rent', rules: ['Utilities and fees'], anti: ['Invented tariffs'] },
    budget: { voice: 'Housing-led budget', rules: ['Rent as anchor line'], anti: ['Ignore deposits'] },
    who_should: { voice: 'Renter fit', rules: ['Who should target which band'], anti: ['One-size lease'] },
    summary: { voice: 'Rent closer', rules: ['Lease next steps'], anti: ['Intro repeat'] },
    faq: { voice: 'Rent FAQ', rules: ['Deposit/lease questions'], anti: ['Food FAQ'] },
  },
  food: {
    overview: { voice: 'Food-cost opener', rules: ['Basket framing'], anti: ['Housing lead'] },
    food: { voice: 'Grocery and dining specialist', rules: ['Markets vs restaurants', 'Levers to cut spend'], anti: ['Recipes as filler'] },
    budget: { voice: 'Food budget builder', rules: ['Monthly food bands'], anti: ['Unstated household size'] },
    lifestyle: { voice: 'Eating-habit costs', rules: ['Habit levers'], anti: ['Moralizing diet'] },
    who_should: { voice: 'Who feels food inflation', rules: ['Persona food pressure'], anti: ['Everyone identical'] },
    summary: { voice: 'Food closer', rules: ['Actionable food takeaway'], anti: ['Intro echo'] },
    faq: { voice: 'Food FAQ', rules: ['Grocery/dining questions'], anti: ['Visa questions'] },
  },
  healthcare: {
    overview: { voice: 'Healthcare opener', rules: ['Access before prices'], anti: ['Invented premiums'] },
    healthcare: { voice: 'System access guide', rules: ['Public vs private patterns', 'Uncertainty when fees unknown'], anti: ['Diagnosis advice'] },
    budget: { voice: 'Healthcare buffer planner', rules: ['Buffer lines in monthly plan'], anti: ['Fake insurance quotes'] },
    who_should: { voice: 'Who needs larger buffers', rules: ['Families/retirees etc.'], anti: ['Scare tactics'] },
    summary: { voice: 'Healthcare closer', rules: ['Buffer takeaway'], anti: ['Intro repeat'] },
    faq: { voice: 'Healthcare FAQ', rules: ['Access questions'], anti: ['Rent FAQ'] },
  },
  student: {
    overview: { voice: 'Student COL opener', rules: ['Campus-year frame'], anti: ['Executive relocator tone'] },
    housing: { voice: 'Student housing', rules: ['Shared/near-campus patterns'], anti: ['Luxury penthouse focus'] },
    education: { voice: 'Study cost guide', rules: ['Study-related cost drivers', 'No fake tuition'], anti: ['Invented fees'] },
    food: { voice: 'Student food budget', rules: ['Cheap filling patterns'], anti: ['Fine dining'] },
    transport: { voice: 'Student transit', rules: ['Passes and bikes'], anti: ['Company car'] },
    visa: { voice: 'Student visa notes', rules: ['Work-limit humility'], anti: ['Guarantees'] },
    budget: { voice: 'Student monthly stack', rules: ['Lean academic-year budget'], anti: ['Family 3BR stack'] },
    summary: { voice: 'Student closer', rules: ['Year-one plan'], anti: ['Intro echo'] },
    faq: { voice: 'Student FAQ', rules: ['Campus cost questions'], anti: ['Investor FAQ'] },
  },
  visa: {
    overview: { voice: 'Visa cost opener', rules: ['Pathway framing', 'Not legal advice'], anti: ['Tourism listicle'] },
    visa: { voice: 'Permit pathway guide', rules: ['Fee categories with evidence only'], anti: ['Guaranteed approval'] },
    housing: { voice: 'Housing on a visa clock', rules: ['Flexible leases'], anti: ['30-year mortgage pitch'] },
    budget: { voice: 'Landing-month costs', rules: ['First-quarter stack'], anti: ['Ignore application costs'] },
    who_should: { voice: 'Pathway fit', rules: ['Which reader → which path type'], anti: ['One path for all'] },
    summary: { voice: 'Visa closer', rules: ['Document next steps'], anti: ['Intro repeat'] },
    faq: { voice: 'Visa FAQ', rules: ['Pathway questions'], anti: ['Food FAQ'] },
  },
  moving: {
    overview: { voice: 'Relocation opener', rules: ['Move phases'], anti: ['Static city essay'] },
    housing: { voice: 'First housing decisions', rules: ['Temporary vs longer lease'], anti: ['Ignore deposits'] },
    budget: { voice: 'Move-month budget', rules: ['One-time + monthly'], anti: ['Steady-state only'] },
    transport: { voice: 'Arrival transport setup', rules: ['First-week mobility'], anti: ['Airline reviews only'] },
    healthcare: { voice: 'Arrival healthcare setup', rules: ['Registration buffers'], anti: ['Invented clinics'] },
    visa: { voice: 'Move documents', rules: ['Timeline cost categories'], anti: ['Legal guarantees'] },
    who_should: { voice: 'Relocation persona checklist', rules: ['Different checklists by persona'], anti: ['Identical lists'] },
    summary: { voice: 'Moving closer', rules: ['Ordered next steps'], anti: ['Intro echo'] },
    faq: { voice: 'Moving FAQ', rules: ['Logistics questions'], anti: ['Salary FAQ clone'] },
  },
  retirement: {
    overview: { voice: 'Retirement COL opener', rules: ['Pace and healthcare first'], anti: ['Nightlife lead'] },
    healthcare: { voice: 'Retiree healthcare', rules: ['Longer-stay access'], anti: ['Invented premiums'] },
    housing: { voice: 'Retiree housing', rules: ['Accessibility and predictability'], anti: ['Party-hostel tips'] },
    lifestyle: { voice: 'Retirement lifestyle spend', rules: ['Discretionary calm costs'], anti: ['Hustle culture'] },
    budget: { voice: 'Retirement monthly stack', rules: ['Predictable lines'], anti: ['Variable founder burn'] },
    safety: { voice: 'Retiree livability', rules: ['Practical safety notes'], anti: ['Sensationalism'] },
    summary: { voice: 'Retirement closer', rules: ['Stay recommendation'], anti: ['Intro repeat'] },
    faq: { voice: 'Retirement FAQ', rules: ['Healthcare/housing questions'], anti: ['Student FAQ'] },
  },
  budget: {
    overview: { voice: 'Budget-frame opener', rules: ['Line-item mindset'], anti: ['Vague vibes'] },
    housing: { voice: 'Budget housing line', rules: ['Rent as % framing with evidence'], anti: ['Ignore utilities'] },
    food: { voice: 'Budget food line', rules: ['Grocery vs dining split'], anti: ['No household size'] },
    transport: { voice: 'Budget transport line', rules: ['Pass vs car'], anti: ['Ignore distance'] },
    utilities: { voice: 'Budget utilities', rules: ['Power/water/internet'], anti: ['Fake tariffs'] },
    budget: { voice: 'Full budget composer', rules: ['Multiple scenarios'], anti: ['Single unexplained total'] },
    who_should: { voice: 'Scenario advisor', rules: ['Lean vs comfortable'], anti: ['One number for all'] },
    summary: { voice: 'Budget closer', rules: ['Which scenario to start with'], anti: ['Intro echo'] },
    faq: { voice: 'Budget FAQ', rules: ['Line-item questions'], anti: ['Visa FAQ'] },
  },
  remote: {
    overview: { voice: 'Remote COL opener', rules: ['Income currency vs local costs'], anti: ['Tourist checklist only'] },
    remote: { voice: 'Remote setup guide', rules: ['Connectivity, workspace, timezone'], anti: ['Fake speed tests'] },
    housing: { voice: 'Remote-friendly housing', rules: ['Desk space and quiet'], anti: ['Ignore internet'] },
    visa: { voice: 'Stay-length constraints', rules: ['Visa runway humility'], anti: ['Guarantees'] },
    salary: { voice: 'Arbitrage framing', rules: ['Foreign income vs local CPI'], anti: ['Invented FX gains'] },
    budget: { voice: 'Remote monthly stack', rules: ['Include coworking/internet lines when relevant'], anti: ['Ignore workspace'] },
    summary: { voice: 'Remote closer', rules: ['Stay/base recommendation'], anti: ['Intro echo'] },
    faq: { voice: 'Remote FAQ', rules: ['Nomad/remote questions'], anti: ['School FAQ'] },
  },
  travel: {
    overview: { voice: 'Trip cost opener', rules: ['Daily burn framing'], anti: ['Emigration essay'] },
    housing: { voice: 'Stay options', rules: ['Nightly bands with evidence humility'], anti: ['Fake hotel quotes'] },
    food: { voice: 'Travel food costs', rules: ['Street vs sit-down'], anti: ['Cookbook'] },
    transport: { voice: 'Getting around', rules: ['Local transit for visitors'], anti: ['Ignore luggage reality'] },
    culture: { voice: 'Experience costs', rules: ['Pacing and paid attractions humility'], anti: ['Invented ticket prices'] },
    budget: { voice: 'Daily/weekly burn', rules: ['Clear assumptions'], anti: ['Monthly expat stack only'] },
    summary: { voice: 'Travel closer', rules: ['Trip budget takeaway'], anti: ['Intro echo'] },
    faq: { voice: 'Travel FAQ', rules: ['Short-stay questions'], anti: ['Tax FAQ'] },
  },
  tax: {
    overview: { voice: 'Tax opener', rules: ['Not legal advice', 'Take-home focus'], anti: ['Tourism'] },
    tax: { voice: 'Tax category guide', rules: ['Categories movers feel', 'Evidence only'], anti: ['Invented rates'] },
    salary: { voice: 'Net pay implications', rules: ['Link tax to salary stretch'], anti: ['Gross-only cheerleading'] },
    budget: { voice: 'After-tax budget', rules: ['Budget from net'], anti: ['Ignore withholding'] },
    who_should: { voice: 'Who must model tax', rules: ['Founders/freelancers/employees'], anti: ['Everyone identical'] },
    summary: { voice: 'Tax closer', rules: ['Model net pay next'], anti: ['Intro echo'] },
    faq: { voice: 'Tax FAQ', rules: ['Take-home questions'], anti: ['Food FAQ'] },
  },
};

function defaultDna(guide: GuideId, key: SectionKey): SectionDna {
  return {
    voice: `${guide} ${key} specialist`,
    rules: [`Write as a ${guide}-guide ${key} section`, 'Use only provided facts', 'No template hooks'],
    anti: ['Cross-guide homogenization', 'Prompt instruction language'],
  };
}

export function getGuideSectionWriter(
  guideId: GuideId,
  sectionKey: SectionKey
): GuideSpecificSectionWriter {
  const dna = GUIDE_SECTION_DNA[guideId]?.[sectionKey] || defaultDna(guideId, sectionKey);
  const id = `${guideId}.${sectionKey}`;
  return {
    id,
    guide_id: guideId,
    section_key: sectionKey,
    label: `${guideId} / ${sectionKey}`,
    voice: dna.voice,
    writing_rules: dna.rules,
    anti_patterns: dna.anti,
    buildBrief({ plan, section, factsDigest, priorDigests }) {
      return [
        `GUIDE_SPECIFIC_WRITER=${id}`,
        `VOICE: ${dna.voice}`,
        `HEADING: ${section.heading}`,
        `EVIDENCE_MODE: ${section.evidence_mode}`,
        `WORDS: ${section.min_words}-${section.max_words}`,
        `READER: ${plan.persona.label} — ${plan.persona.advice_angle}`,
        `STYLE: ${plan.style.label}`,
        `PURPOSE: ${plan.purpose}`,
        `RULES:\n${dna.rules.map((r) => `- ${r}`).join('\n')}`,
        `ANTI_PATTERNS:\n${dna.anti.map((r) => `- ${r}`).join('\n')}`,
        `STYLE_CONSTRAINTS:\n${plan.style.constraints.map((c) => `- ${c}`).join('\n')}`,
        `FORBIDDEN:\n${plan.forbidden_behaviours.map((f) => `- ${f}`).join('\n')}`,
        priorDigests.length
          ? `PRIOR_SECTION_DIGESTS (do not repeat):\n${priorDigests.slice(-3).join('\n---\n')}`
          : '',
        `FACTS:\n${factsDigest.slice(0, 8000)}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  };
}

export function listGuideSectionWriterIds(guideId: GuideId): string[] {
  const keys = Object.keys(GUIDE_SECTION_DNA[guideId] || {}) as SectionKey[];
  return keys.map((k) => `${guideId}.${k}`);
}

export function assertGuideSpecificWriter(
  writer: GuideSpecificSectionWriter,
  guideId: GuideId,
  section: OutlineSection
): void {
  if (writer.guide_id !== guideId) {
    throw new Error(`Section writer guide mismatch: ${writer.id} for ${guideId}`);
  }
  if (writer.section_key !== section.key && section.key !== 'intro') {
    // intro may map to overview writer
    if (!(section.key === 'overview' && writer.section_key === 'overview')) {
      if (writer.section_key !== section.key) {
        throw new Error(`Section writer key mismatch: ${writer.id} vs ${section.key}`);
      }
    }
  }
  if (!writer.id.startsWith(`${guideId}.`)) {
    throw new Error(`Cross-guide writer forbidden: ${writer.id}`);
  }
}

export type { EditorialPlan };
