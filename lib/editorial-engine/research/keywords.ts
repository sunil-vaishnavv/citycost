import type { EditorialTopic } from '../types.js';
import type { StructuredContextPack } from '../writer/context-pack.js';
import type { ResearchKeywords } from './schema.js';

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const s = String(raw || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function strRef(refs: Record<string, unknown>, key: string): string | null {
  const v = refs[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function strList(refs: Record<string, unknown>, key: string): string[] {
  const v = refs[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && Boolean(x.trim()));
}

/**
 * Keyword extraction from topic strategy refs + CityCost entities.
 */
export function extractResearchKeywords(
  topic: EditorialTopic,
  ctx: StructuredContextPack,
  primaryEntity: string,
  secondaryEntities: string[]
): ResearchKeywords {
  const refs = ctx.topic.source_refs;
  const fromStrategy = strRef(refs, 'primary_keyword');
  const secondaryFromStrategy = strList(refs, 'secondary_keywords');

  let primary =
    fromStrategy ||
    (ctx.comparison
      ? `${String(ctx.comparison.cityA)} vs ${String(ctx.comparison.cityB)} cost of living`
      : ctx.city
        ? `cost of living in ${ctx.city.city}`
        : ctx.country
          ? `cost of living in ${ctx.country.name}`
          : topic.title.toLowerCase().replace(/:/g, '').slice(0, 80));

  primary = primary.toLowerCase();

  const placeA = ctx.comparison
    ? String(ctx.comparison.cityA)
    : ctx.city
      ? String(ctx.city.city)
      : ctx.country
        ? String(ctx.country.name)
        : primaryEntity;
  const placeB = ctx.comparison ? String(ctx.comparison.cityB) : '';

  const secondary = uniq([
    ...secondaryFromStrategy,
    `${placeA} living costs`,
    `${placeA} rent`,
    `${placeA} monthly budget`,
    placeB ? `${placeA} vs ${placeB}` : '',
    placeB ? `${placeB} cost of living` : '',
    ctx.country ? `${ctx.country.name} expenses` : '',
    'expat cost of living',
    'relocation budget',
    ...secondaryEntities.slice(0, 4).map((e) => `${e} cost of living`.toLowerCase()),
  ]).slice(0, 16);

  const long_tail = uniq([
    `is ${placeA} expensive to live in`,
    `monthly cost of living in ${placeA}`,
    `average rent in ${placeA}`,
    `groceries cost in ${placeA}`,
    placeB ? `is ${placeA} cheaper than ${placeB}` : `cheapest areas in ${placeA}`,
    placeB ? `${placeA} or ${placeB} for expats` : `cost of living ${placeA} for expats`,
    `student budget ${placeA}`,
    `family cost of living ${placeA}`,
    `salary needed to live in ${placeA}`,
    `hidden costs of living in ${placeA}`,
  ]).slice(0, 16);

  const question_keywords = uniq([
    `how much does it cost to live in ${placeA}`,
    `what is the average rent in ${placeA}`,
    placeB ? `which is cheaper ${placeA} or ${placeB}` : `is ${placeA} affordable`,
    `can students afford ${placeA}`,
    `is ${placeA} good for remote workers`,
    `how much salary do I need in ${placeA}`,
    `what are transportation costs in ${placeA}`,
    `is healthcare expensive in ${placeA}`,
  ]).slice(0, 16);

  const semantic = uniq([
    'cost of living',
    'monthly budget',
    'rent prices',
    'housing costs',
    'groceries',
    'dining out',
    'public transport',
    'healthcare costs',
    'purchasing power',
    'relocation',
    'expat expenses',
    'quality of life',
    'salary vs cost of living',
    primary,
    placeA.toLowerCase(),
    placeB ? placeB.toLowerCase() : '',
    ...secondary.slice(0, 6),
  ]).slice(0, 28);

  const lsi = uniq([
    'affordability',
    'cost index',
    'CPI',
    'rent index',
    'utilities',
    'internet costs',
    'childcare',
    'commute',
    'neighbourhoods',
    'lifestyle trade-offs',
    'budgeting',
    'disposable income',
    'cost comparison',
    'living expenses',
    'day-to-day costs',
    topic.content_type.replace(/_/g, ' '),
  ]).slice(0, 20);

  return {
    primary_keyword: primary,
    secondary_keywords: secondary,
    long_tail_keywords: long_tail,
    question_keywords,
    semantic_keywords: semantic,
    lsi_keywords: lsi,
  };
}
