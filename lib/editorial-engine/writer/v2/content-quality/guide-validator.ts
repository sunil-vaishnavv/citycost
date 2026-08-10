/**
 * Guide behaviour validator — reject mixed guide-type behaviour.
 */

import type { GuideId, WriterDraftPayload } from '../types.js';
import { draftBodyText } from '../../../reviewer/text-utils.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';

function headingsOf(draft: WriterDraftPayload): string {
  return (draft.blocks || [])
    .filter((b) => b.type === 'heading' || b.heading)
    .map((b) => String(b.heading || '').toLowerCase())
    .join(' | ');
}

const GUIDE_EXPECTATIONS: Record<
  GuideId,
  { require?: RegExp; forbid?: RegExp; code: string }
> = {
  country: {
    require: /region|national|country|major cities|cities across|nationwide/i,
    forbid: /\bhousing comparison\b|\bsalary comparison\b/i,
    code: 'country_guide',
  },
  city: {
    require: /neighbourhood|neighborhood|district|commute|local|in-city/i,
    forbid: /\bnationwide\b|\bacross the country\b|\bregional differences across\b/i,
    code: 'city_guide',
  },
  comparison: {
    require: /\bvs\.?\b|versus|pros|cons|recommend|who should/i,
    code: 'comparison_guide',
  },
  salary: {
    require: /salary|wage|pay|take-home|income|compensation/i,
    forbid: /\bvisa pathways\b|\bnightlife districts\b/i,
    code: 'salary_guide',
  },
  rent: {
    require: /rent|lease|deposit|landlord|1-bed|studio|housing cost/i,
    forbid: /\bvisa stamp\b|\btuition fees\b/i,
    code: 'rent_guide',
  },
  student: {
    require: /student|campus|tuition|shared housing|semester/i,
    code: 'student_guide',
  },
  visa: {
    require: /visa|permit|residency|immigration|biometric/i,
    forbid: /\bnightlife\b|\bschool catchment\b/i,
    code: 'visa_guide',
  },
  moving: {
    require: /moving|relocation|ship|temporary housing|first (?:week|month)/i,
    code: 'moving_guide',
  },
  healthcare: {
    require: /health|clinic|insurance|gp|hospital|prescription/i,
    code: 'healthcare_guide',
  },
  food: {
    require: /food|groc|dining|restaurant|meal|market/i,
    forbid: /\b1-bedroom rent\b|\blease deposit\b/i,
    code: 'food_guide',
  },
  travel: {
    require: /travel|trip|flight|hotel|itinerary|tourist/i,
    code: 'travel_guide',
  },
  budget: {
    require: /budget|worksheet|monthly total|allocate|cost line/i,
    code: 'budget_guide',
  },
  remote: {
    require: /remote|cowork|timezone|nomad|work from/i,
    code: 'remote_guide',
  },
  retirement: {
    require: /retire|pension|healthcare|fixed income|later life/i,
    code: 'retirement_guide',
  },
  tax: {
    require: /tax|withholding|filing|residency for tax/i,
    code: 'tax_guide',
  },
};

export function validateGuideType(
  draft: WriterDraftPayload,
  guideId: GuideId
): ValidatorResult {
  const findings: ValidatorFinding[] = [];
  const h = headingsOf(draft);
  const body = draftBodyText(draft);
  const blob = `${h}\n${body}`;
  const spec = GUIDE_EXPECTATIONS[guideId];

  if (spec?.require && !spec.require.test(blob)) {
    findings.push({
      code: `${spec.code}_missing_signals`,
      message: `Draft lacks expected ${guideId} guide signals`,
      severity: 'error',
    });
  }
  if (spec?.forbid && spec.forbid.test(h)) {
    findings.push({
      code: `${spec.code}_mixed_behaviour`,
      message: `Draft headings look like a different guide family`,
      severity: 'error',
    });
  }

  // Cross-type clashes
  const vsCount = (blob.match(/\bvs\.?\b/gi) || []).length;
  if (guideId === 'country' && vsCount >= 5) {
    findings.push({
      code: 'country_behaves_like_comparison',
      message: 'Country guide overuses comparison framing',
      severity: 'error',
    });
  }
  if (guideId === 'food' && /deposit|lease agreement|1-bedroom rent/i.test(h) && !/food|groc|dining/i.test(h)) {
    findings.push({
      code: 'food_behaves_like_rent',
      message: 'Food guide behaves like rent guide',
      severity: 'error',
    });
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const score = errors ? Math.max(0, 40 - errors * 15) : 100;
  return {
    category: 'guide_mismatch',
    status: errors ? 'FAIL' : 'PASS',
    score,
    findings,
  };
}
