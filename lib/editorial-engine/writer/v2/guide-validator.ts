/**
 * Guide Behaviour Validator — reject wrong-family structures.
 */

import type { EditorialPlan, WriterDraftPayload } from './types.js';
import { draftBodyText } from '../../reviewer/text-utils.js';

export function validateGuideBehaviour(
  draft: WriterDraftPayload,
  plan: EditorialPlan
): string[] {
  const issues: string[] = [];
  const headings = (draft.blocks || [])
    .filter((b) => b.type === 'heading' || b.heading)
    .map((b) => String(b.heading || b.content || '').toLowerCase());
  const body = draftBodyText(draft).toLowerCase();
  const hjoin = headings.join(' | ');

  const hasVs = /\bvs\.?\b|versus|compared to/.test(hjoin) || /\bvs\.?\b/.test(body);
  const cityCount = (body.match(/\b(in|to|for)\s+[A-Z][a-z]+/g) || []).length;

  switch (plan.guide_id) {
    case 'country':
      if (hasVs && /housing comparison|salary comparison/.test(hjoin)) {
        issues.push('country_behaves_like_comparison');
      }
      if (!/region|national|country|cities as|major cities/.test(hjoin + body.slice(0, 800))) {
        issues.push('country_missing_national_framing');
      }
      break;
    case 'city':
      if (/regional differences|nationwide|across the country/.test(hjoin)) {
        issues.push('city_behaves_like_country');
      }
      if (hasVs && plan.entities.city_b) {
        /* ok brief contrast */
      } else if ((body.match(/\bvs\.?\b/g) || []).length >= 4) {
        issues.push('city_behaves_like_comparison');
      }
      break;
    case 'comparison':
      if (!hasVs && !/comparison|pros|cons|recommend/.test(hjoin)) {
        issues.push('comparison_missing_pair_structure');
      }
      if (!/pros|cons|recommend|who should/.test(hjoin)) {
        issues.push('comparison_missing_decision_sections');
      }
      break;
    case 'salary':
      if (/regional differences|neighbourhoods|visa pathways/.test(hjoin) && !/salary|pay|wage|tax/.test(hjoin)) {
        issues.push('salary_behaves_like_country');
      }
      break;
    case 'food':
      if (/deposit|lease|1-bedroom rent/.test(hjoin) && !/food|grocer|dining/.test(hjoin)) {
        issues.push('food_behaves_like_rent');
      }
      break;
    case 'visa':
      if (/neighbourhoods|schools|nightlife/.test(hjoin) && !/visa|permit|residency/.test(hjoin)) {
        issues.push('visa_behaves_like_city');
      }
      break;
    case 'moving':
      if (/housing comparison|salary comparison/.test(hjoin)) {
        issues.push('moving_behaves_like_comparison');
      }
      break;
    default:
      break;
  }

  void cityCount;
  return issues;
}
