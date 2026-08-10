/**
 * Entity SEO map — extracted from research + draft + CityCost catalog context.
 */

import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { ResearchPack } from '../writer/research-engine.js';
import type { StructuredContextPack } from '../writer/context-pack.js';
import { draftPlainText } from '../reviewer/text-utils.js';

export interface EntityMap {
  primary_entity: string;
  secondary_entities: string[];
  related_cities: Array<{ slug: string; label: string; href: string }>;
  related_countries: Array<{ slug: string; label: string; href: string }>;
  related_comparisons: Array<{ slug: string; label: string; href: string }>;
  related_cost_categories: string[];
  semantic_keywords: string[];
  target_keyword: string;
}

const COST_CATEGORIES = [
  'rent',
  'housing',
  'groceries',
  'restaurants',
  'transport',
  'utilities',
  'purchasing power',
  'salary',
  'healthcare',
  'childcare',
  'internet',
  'entertainment',
];

export function extractEntityMap(input: {
  draft: WriterDraftPayload;
  research: ResearchPack | null;
  context: StructuredContextPack | null;
}): EntityMap {
  const { draft, research, context } = input;
  const text = draftPlainText(draft).toLowerCase();

  const cityName = context?.city ? String(context.city.city || '') : '';
  const cityCountry = context?.city ? String(context.city.country || '') : '';
  const countryName = context?.country ? String(context.country.name || '') : '';
  const cmpA = context?.comparison ? String(context.comparison.cityA || '') : '';
  const cmpB = context?.comparison ? String(context.comparison.cityB || '') : '';

  const primary_entity =
    research?.primary_entity ||
    (cityName ? `${cityName}${cityCountry ? `, ${cityCountry}` : ''}` : null) ||
    (countryName || null) ||
    (cmpA && cmpB ? `${cmpA} vs ${cmpB}` : null) ||
    draft.seo_title.split(/[:|-]/)[0]?.trim() ||
    'Cost of living';

  const secondary = new Set<string>(research?.secondary_entities || []);
  if (cityCountry) secondary.add(cityCountry);
  for (const c of context?.related_cities || []) secondary.add(c.label);
  for (const c of context?.related_countries || []) secondary.add(c.label);

  const related_cost_categories = COST_CATEGORIES.filter(
    (cat) => text.includes(cat) || (research?.semantic_keywords || []).some((k) => k.includes(cat))
  );

  return {
    primary_entity: String(primary_entity),
    secondary_entities: [...secondary].filter(Boolean).slice(0, 16),
    related_cities: (context?.related_cities || []).slice(0, 12),
    related_countries: (context?.related_countries || []).slice(0, 8),
    related_comparisons: (context?.related_comparisons || []).slice(0, 12),
    related_cost_categories:
      related_cost_categories.length > 0
        ? related_cost_categories
        : ['rent', 'groceries', 'transport', 'purchasing power'],
    semantic_keywords: research?.semantic_keywords || [],
    target_keyword: research?.target_keyword || draft.seo_title.toLowerCase(),
  };
}
