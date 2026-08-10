/**
 * Editorial Brain — all writing decisions before prose generation.
 */

import { detectPersona } from './persona/engine.js';
import { selectStyle } from './style/library.js';
import { routeGuideId } from './guide-router.js';
import { generateDynamicOutline } from './outlines/dynamic-outline-generator.js';
import { buildFactsDigest } from './prompt-sanitizer.js';
import type { EditorialPlan, GuideId } from './types.js';

function detectIntent(blob: string): EditorialPlan['search_intent'] {
  const t = blob.toLowerCase();
  if (/best|vs|versus|compare|or not/.test(t)) return 'commercial';
  if (/apply|how to get visa|register/.test(t)) return 'transactional';
  if (/login|portal|official site/.test(t)) return 'navigational';
  return 'informational';
}

function extractEntities(topic: {
  title?: string;
  primary_entity?: string | null;
  secondary_entity?: string | null;
  country?: string | null;
  city_a?: string | null;
  city_b?: string | null;
}): EditorialPlan['entities'] {
  const title = topic.title || '';
  const vs = title.match(/(.+?)\s+vs\.?\s+(.+)/i);
  return {
    country: topic.country || undefined,
    city: topic.city_a || topic.primary_entity || vs?.[1]?.trim() || undefined,
    city_b: topic.city_b || topic.secondary_entity || vs?.[2]?.trim() || undefined,
  };
}

function forbiddenFor(guide: GuideId): string[] {
  const base = [
    'Do not invent statistics',
    'Do not paste prompt instructions into prose',
    'Do not reuse identical openings across sections',
  ];
  switch (guide) {
    case 'country':
      return [...base, 'Do not structure as City A vs City B', 'Cities are examples only'];
    case 'city':
      return [...base, 'Do not turn into a national overview', 'One city is the subject'];
    case 'comparison':
      return [...base, 'Do not write a single-city essay', 'Keep both sides visible'];
    case 'salary':
      return [...base, 'Do not expand into a full country tour'];
    case 'food':
      return [...base, 'Do not become a rent guide'];
    case 'visa':
      return [...base, 'Do not give legal guarantees', 'Do not become a generic country guide'];
    case 'moving':
      return [...base, 'Do not become a single static city lifestyle essay'];
    default:
      return base;
  }
}

export function buildEditorialPlan(input: {
  topic: {
    title: string;
    content_type?: string | null;
    persona?: string | null;
    primary_keyword?: string | null;
    angle?: string | null;
    primary_entity?: string | null;
    secondary_entity?: string | null;
    country?: string | null;
    city_a?: string | null;
    city_b?: string | null;
  };
  research: unknown;
  depth?: 'standard' | 'deep';
}): EditorialPlan {
  const topic = input.topic;
  const guide_id = routeGuideId(topic.content_type, topic.title);
  const persona = detectPersona({
    title: topic.title,
    persona: topic.persona,
    content_type: topic.content_type,
    keyword: topic.primary_keyword,
    angle: topic.angle,
  });
  const style = selectStyle({ guide_id, content_type: topic.content_type, persona_id: persona.id });
  const blob = `${topic.title} ${topic.primary_keyword || ''} ${topic.angle || ''}`;
  const search_intent = detectIntent(blob);
  const entities = extractEntities(topic);
  const researchDigest = buildFactsDigest(input.research);
  const depth = input.depth || 'standard';
  const outline = generateDynamicOutline({
    guide_id,
    persona,
    style,
    title: topic.title,
    keyword: topic.primary_keyword,
    researchDigest,
    depth,
    entities,
  });

  const purpose =
    guide_id === 'comparison'
      ? `Help the reader choose between ${entities.city || 'location A'} and ${entities.city_b || 'location B'} using cost trade-offs`
      : guide_id === 'country'
        ? `Help the reader understand living costs across ${entities.country || 'the country'} before picking a city type`
        : guide_id === 'city'
          ? `Help the reader decide whether ${entities.city || 'this city'} fits their budget and lifestyle`
          : `Help the reader make a practical cost decision for this ${guide_id} topic`;

  return {
    guide_id,
    content_type: String(topic.content_type || guide_id),
    persona,
    style,
    search_intent,
    purpose,
    depth,
    outline,
    forbidden_behaviours: forbiddenFor(guide_id),
    link_max: 12,
    entities,
  };
}
