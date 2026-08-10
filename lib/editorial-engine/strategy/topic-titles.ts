import crypto from 'crypto';

/** Deterministic index from a stable seed (same topic → same title wording). */
export function titleVariantIndex(seed: string, modulo: number): number {
  if (modulo <= 1) return 0;
  const buf = crypto.createHash('sha256').update(seed.toLowerCase()).digest();
  return buf.readUInt32BE(0) % modulo;
}

function pick<T>(seed: string, variants: T[]): T {
  return variants[titleVariantIndex(seed, variants.length)]!;
}

/**
 * Human blog-style comparison titles — never the rigid
 * "X vs Y: Cost of Living Comparison Guide" template.
 */
export function comparisonBlogTitle(cityA: string, cityB: string, pairSlug: string): string {
  return pick(`comparison:${pairSlug}`, [
    `Is ${cityA} Cheaper Than ${cityB}? Rent, Food, and Daily Costs Compared`,
    `${cityA} or ${cityB}: Where Your Salary Actually Goes Further`,
    `Moving From ${cityB} to ${cityA}: What Changes in Your Monthly Budget`,
    `${cityA} vs ${cityB} Living Costs: A Practical Side-by-Side`,
    `Can You Live Better in ${cityA} Than in ${cityB} on the Same Income?`,
    `${cityA} and ${cityB} Compared: Housing, Groceries, and Lifestyle Spend`,
    `Choosing Between ${cityA} and ${cityB}: Cost of Living Trade-offs`,
    `How Far Does Money Go in ${cityA} Versus ${cityB}?`,
    `${cityA} Against ${cityB}: Real Costs for Renters and Relocators`,
    `Affordability Face-Off: ${cityA} Compared With ${cityB}`,
    `Before You Relocate: ${cityA} vs ${cityB} Expense Reality Check`,
    `Daily Life Costs in ${cityA} and ${cityB} — Who Wins on Value?`,
  ]);
}

export function countryBlogTitle(country: string, countrySlug: string): string {
  return pick(`country:${countrySlug}`, [
    `What It Really Costs to Live in ${country}`,
    `${country} Cost of Living Explained: Rent, Food, and Daily Expenses`,
    `Planning a Move to ${country}? A Clear Cost of Living Breakdown`,
    `How Expensive Is ${country}? A Practical Living-Cost Guide`,
    `Living in ${country}: Budgets, Housing, and Everyday Spending`,
    `${country} on a Real Budget: What Locals and Expats Actually Pay`,
    `Cost of Living in ${country}: Numbers That Matter Before You Move`,
    `Is ${country} Affordable? A Straight-Talk Cost Guide`,
  ]);
}

export function cityBlogTitle(city: string, country: string, citySlug: string): string {
  return pick(`city:${citySlug}`, [
    `What It Costs to Live in ${city}, ${country}`,
    `${city} Living Costs: Rent, Groceries, and Daily Expenses`,
    `Moving to ${city}? A Practical Cost of Living Guide`,
    `How Expensive Is ${city}? A Clear Budget Breakdown`,
    `${city}, ${country}: Real Monthly Costs for Newcomers`,
    `Can You Afford ${city}? Housing and Lifestyle Costs Explained`,
    `Living in ${city}: What Your Money Covers Month to Month`,
    `${city} Cost Guide: From Rent to Transport and Food`,
  ]);
}

export function supportingGuideBlogTitle(
  country: string,
  guideKind: string,
  countrySlug: string
): string {
  const seed = `support:${guideKind}:${countrySlug}`;
  const byKind: Record<string, string[]> = {
    salary: [
      `${country} Salaries vs Living Costs: What a Paycheck Really Buys`,
      `Working in ${country}: Average Wages and Buying Power`,
      `${country} Income Reality Check for Relocators`,
    ],
    taxes: [
      `${country} Taxes for Expats: What Relocation Really Costs`,
      `How Taxes Affect Your Budget When Moving to ${country}`,
      `${country} Tax Costs Explained for New Residents`,
    ],
    rent: [
      `Renting in ${country}: What Housing Really Costs by City`,
      `${country} Housing Costs: Apartments, Deposits, and Neighborhoods`,
      `How Much Is Rent in ${country}? A Practical Housing Guide`,
    ],
    food: [
      `Grocery and Dining Costs in ${country}: A Realistic Food Budget`,
      `What Food Costs in ${country} — Markets, Restaurants, and Staples`,
      `${country} Food Prices: Building a Monthly Meal Budget`,
    ],
    transportation: [
      `Getting Around ${country}: Transport Costs That Add Up`,
      `${country} Commute Costs: Transit, Fuel, and Daily Travel`,
      `How Much Transport Costs in ${country}`,
    ],
    healthcare: [
      `Healthcare Costs in ${country}: Care, Insurance, and Surprises`,
      `${country} Medical Costs for Expats and Long-Term Residents`,
      `What Healthcare Really Costs When You Live in ${country}`,
    ],
    student: [
      `Studying in ${country}: Student Living Costs Without the Guesswork`,
      `${country} Student Budget Guide: Housing, Food, and Fees`,
      `Can Students Afford ${country}? A Cost of Living Breakdown`,
    ],
    digital_nomad: [
      `${country} for Remote Workers: Costs, Visas, and Daily Reality`,
      `Digital Nomad Costs in ${country}: Coworking, Rent, and Lifestyle`,
      `Is ${country} Worth It for Remote Work? A Cost Guide`,
    ],
    retirement: [
      `Retiring in ${country}: Living Costs, Healthcare, and Budget Pace`,
      `${country} Retirement Costs: What Fixed Incomes Need to Cover`,
      `Is ${country} Affordable for Retirees? A Clear Cost Guide`,
    ],
    moving: [
      `Moving to ${country}: First-Month Costs and a Practical Checklist`,
      `${country} Relocation Budget: What to Expect Before You Land`,
      `How Much Does It Cost to Move to ${country}?`,
    ],
    budget: [
      `A Realistic Monthly Budget for Living in ${country}`,
      `${country} Living Expenses: Building a Month-by-Month Plan`,
      `How Much Do You Need Per Month in ${country}?`,
    ],
    visa: [
      `${country} Visa and Residence Costs: Fees That Affect Your Move`,
      `What Immigration Paperwork Costs in ${country}`,
      `${country} Entry and Residence Costs for Relocators`,
    ],
  };
  const variants = byKind[guideKind] || [
    `${country}: ${guideKind.replace(/_/g, ' ')} Cost Guide`,
    `Understanding ${guideKind.replace(/_/g, ' ')} Costs in ${country}`,
  ];
  return pick(seed, variants);
}

export function hubBlogTitle(label: string, hubId: string): string {
  return pick(`hub:${hubId}`, [
    `${label}: Cost of Living Ideas That Stay Useful Year Round`,
    `Planning as ${label}: Where Living Costs Matter Most`,
    `${label} Living Costs — A Practical Starting Hub`,
    `Cost Guides for ${label}: How to Compare Places Fairly`,
  ]);
}
