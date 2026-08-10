import type { StructuredContextPack } from '../writer/context-pack.js';

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of items) {
    const s = q.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Generate 20–40 real searcher questions for the topic.
 */
export function buildSearcherQuestions(
  ctx: StructuredContextPack,
  primaryEntity: string,
  contentType: string
): string[] {
  const a = ctx.comparison
    ? String(ctx.comparison.cityA || primaryEntity)
    : ctx.city
      ? String(ctx.city.city)
      : ctx.country
        ? String(ctx.country.name)
        : primaryEntity;
  const b = ctx.comparison ? String(ctx.comparison.cityB || '') : '';
  const country =
    (ctx.city?.country && String(ctx.city.country)) ||
    (ctx.country?.name && String(ctx.country.name)) ||
    '';

  const qs: string[] = [];

  if (b) {
    qs.push(
      `Is ${a} cheaper than ${b}?`,
      `Is ${b} more expensive than ${a}?`,
      `Which city has better salaries: ${a} or ${b}?`,
      `Which is better for students: ${a} or ${b}?`,
      `Which is better for families: ${a} or ${b}?`,
      `Which is better for remote workers: ${a} or ${b}?`,
      `How do rent prices compare between ${a} and ${b}?`,
      `How do grocery costs compare in ${a} vs ${b}?`,
      `Is transportation cheaper in ${a} or ${b}?`,
      `Is healthcare more affordable in ${a} or ${b}?`,
      `What is the monthly cost difference between ${a} and ${b}?`,
      `Should I move to ${a} or ${b}?`,
      `Which city has a higher quality of life for the money?`,
      `Where does my salary go further: ${a} or ${b}?`,
      `Is ${a} safer than ${b}?`,
      `Which city is better for nightlife and lifestyle costs?`,
      `How long does it take to settle financially in ${a} vs ${b}?`,
      `What are the biggest cost differences between ${a} and ${b}?`
    );
  }

  qs.push(
    `What is the real cost of living in ${a}?`,
    `How much money do I need per month in ${a}?`,
    `What is the average rent in ${a}?`,
    `Are groceries expensive in ${a}?`,
    `How much is public transport in ${a}?`,
    `Is healthcare expensive in ${a}?`,
    `Can students afford ${a}?`,
    `Is ${a} good for digital nomads?`,
    `Is ${a} good for families?`,
    `Is ${a} good for retirees?`,
    `What salary do I need to live comfortably in ${a}?`,
    `What are hidden costs of living in ${a}?`,
    `Which neighbourhoods are affordable in ${a}?`,
    `Is ${a} getting more expensive?`,
    `How does ${a} compare to other major cities?`,
    `What should I budget for the first month in ${a}?`,
    `Are utilities expensive in ${a}?`,
    `How much do restaurants cost in ${a}?`,
    `Is it cheaper to live outside the centre of ${a}?`,
    `What costs surprise newcomers in ${a}?`
  );

  if (country) {
    qs.push(
      `How does ${a} compare to other cities in ${country}?`,
      `Is ${country} expensive for expats?`,
      `What visa costs should I expect for ${country}?`,
      `How do taxes affect take-home pay in ${country}?`
    );
  }

  if (contentType.includes('student')) {
    qs.push(
      `What is a realistic student budget in ${a}?`,
      `How much is student housing in ${a}?`,
      `Can I work part-time to cover living costs in ${a}?`
    );
  }
  if (contentType.includes('remote') || contentType.includes('nomad')) {
    qs.push(
      `Is coworking expensive in ${a}?`,
      `Is the internet reliable and affordable in ${a}?`,
      `Is there a digital nomad visa for living in ${a}?`
    );
  }
  if (contentType.includes('retirement')) {
    qs.push(
      `Is ${a} affordable on a pension?`,
      `How much should retirees budget for healthcare in ${a}?`
    );
  }
  if (contentType.includes('salary')) {
    qs.push(
      `What is the average salary in ${a}?`,
      `Does a typical salary cover rent in ${a}?`
    );
  }
  if (contentType.includes('rent')) {
    qs.push(
      `What is a fair rent for a 1-bedroom in ${a}?`,
      `Is renting or buying better from a cost perspective in ${a}?`
    );
  }
  if (contentType.includes('visa') || contentType.includes('moving')) {
    qs.push(
      `What are the upfront moving costs to ${a}?`,
      `How much should I save before relocating to ${a}?`
    );
  }

  return uniq(qs).slice(0, 40);
}

export function buildPainPoints(primaryEntity: string, isComparison: boolean): string[] {
  const base = [
    'Uncertainty about a realistic monthly budget before relocating',
    'Fear of underestimating rent and deposits',
    'Confusion between tourist prices and resident living costs',
    'Difficulty comparing salaries to local expenses',
    'Worry about healthcare and insurance surprises',
    'Not knowing which neighbourhoods fit their budget',
    'Information overload from outdated blog posts',
  ];
  if (isComparison) {
    base.unshift(
      `Hard to decide between two places without apples-to-apples cost signals for ${primaryEntity}`,
      'Conflicting advice from people who lived only one side of the comparison'
    );
  }
  return base.slice(0, 10);
}

export function buildDecisionCriteria(isComparison: boolean): string[] {
  const base = [
    'Total monthly housing cost (rent + utilities)',
    'Everyday spending (food, transport, phone/internet)',
    'Salary / purchasing power balance',
    'Healthcare access and expected out-of-pocket costs',
    'Commute time vs rent trade-off',
    'Lifestyle fit (walkability, culture, climate) relative to budget',
    'Upfront relocation and visa costs',
  ];
  if (isComparison) {
    base.unshift('Which city delivers more lifestyle per unit of spend');
  }
  return base.slice(0, 10);
}

export function buildCommonMistakes(primaryEntity: string): string[] {
  return [
    `Comparing only headline rent and ignoring deposits, agency fees, and furnishing for ${primaryEntity}`,
    'Using tourist restaurant prices as a grocery budget proxy',
    'Ignoring transport passes vs daily ticket maths',
    'Assuming salary bands transfer 1:1 after tax and currency effects',
    'Planning with outdated cost-of-living blog numbers',
    'Skipping healthcare/insurance line items in the monthly plan',
    'Choosing a neighbourhood from vibes alone without commute costs',
  ];
}
