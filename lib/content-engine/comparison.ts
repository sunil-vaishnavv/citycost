/**
 * Comparison document composer — indices in, structured narrative out.
 */

import type { CompareKnowledge, ContentBlock, CompareContentDocument, FaqItem, InternalLink } from './types.js';
import { generateCompareFaqs } from './faq.js';
import { blockWords, pickVariant } from './templates.js';
import { buildComparisonDecision } from '../comparison-decision.js';

export function composeCompareDocument(
  k: CompareKnowledge,
  metaBase: { data_version: string; generated_at: string }
): Omit<CompareContentDocument, 'meta'> & { faqs: FaqItem[]; links: InternalLink[] } {
  const a = k.cityA;
  const b = k.cityB;
  const cheaper = k.cpiA <= k.cpiB ? a : b;
  const dearer = k.cpiA <= k.cpiB ? b : a;
  const diff = Math.abs(((k.cpiB - k.cpiA) / Math.max(k.cpiA, 1)) * 100);
  const rentWinner = k.rentA <= k.rentB ? a : b;
  const ppWinner = k.ppA >= k.ppB ? a : b;
  const seed = k.slug;

  const decision = buildComparisonDecision(
    {
      name: a,
      cpi: k.cpiA,
      rent: k.rentA,
      groceries: k.groceriesA ?? 0,
      restaurants: k.restaurantsA ?? 0,
      purchasingPower: k.ppA,
      exchangeRate: k.exchangeRateA,
      rent1br: k.rent1brA,
      utilities: k.utilitiesA,
      internet: k.internetA,
      transport: k.transportA,
      salary: k.salaryA,
    },
    {
      name: b,
      cpi: k.cpiB,
      rent: k.rentB,
      groceries: k.groceriesB ?? 0,
      restaurants: k.restaurantsB ?? 0,
      purchasingPower: k.ppB,
      exchangeRate: k.exchangeRateB,
      rent1br: k.rent1brB,
      utilities: k.utilitiesB,
      internet: k.internetB,
      transport: k.transportB,
      salary: k.salaryB,
    }
  );

  const executive_summary = pickVariant(seed + '|exec', [
    `Executive summary: ${cheaper} leads on CPI (${Math.min(k.cpiA, k.cpiB)} vs ${Math.max(k.cpiA, k.cpiB)}, NYC=100), ${rentWinner} leads on rent index, and ${ppWinner} leads on purchasing power. Validate neighbourhood rents before relocating — city-wide winners can reverse at district scale.`,
    `Takeaway for ${a} vs ${b}: everyday costs favor ${cheaper} (~${diff.toFixed(0)}% CPI gap), housing index favors ${rentWinner}, wage stretch favors ${ppWinner}. Use category winners, not a single headline, when the binding constraint is rent or income.`,
  ]);

  const detailed = pickVariant(seed + '|det', [
    `Detailed breakdown uses only paired indices: CPI ${k.cpiA}/${k.cpiB}, rent ${k.rentA}/${k.rentB}, purchasing power ${k.ppA}/${k.ppB}. Category winners can diverge — a city may win rent while losing CPI. No GDP, climate, or industry claims are invented for either city.`,
    `${a} versus ${b} is not a single number. With a ${diff.toFixed(0)}% CPI spread, groceries and services tend to move with ${cheaper}, while housing follows ${rentWinner}'s rent index. Purchasing power (${k.ppA} vs ${k.ppB}) decides whether local wages offset local prices.`,
  ]);

  const monthly = decision.monthly.summary;
  const annual = `Annualizing the CPI gap (~${diff.toFixed(0)}%) is illustrative only — convert using your actual basket. Housing dominates most household budgets and may dominate annual outcomes more than CPI alone. Revisit the comparison if either city's rent or salary data version changes.`;

  const students = `Students: prioritize ${rentWinner} for housing index, then map campus transport. Shared flats and dorms can erase city-wide gaps that look decisive on a 1BR centre reference.`;
  const families = `Families: model 2–3BR rents, schooling, and commute time; purchasing power currently favors ${ppWinner}. Verified education and healthcare ratings are not attached — omit rather than invent.`;
  const professionals = `Professionals: weight industry clusters and after-tax offers over raw CPI — ${dearer} may still win if compensation covers the premium. Compare offers in the same currency before trusting index gaps.`;
  const remote_workers = `Remote workers: living in ${cheaper} while billing higher-wage markets can help if visas and connectivity are solid. Those legal and infrastructure factors are not verified facts on this page.`;
  const retirees = `Retirees on fixed income usually prefer ${cheaper} on CPI unless healthcare access (not verified here) requires ${dearer}. Stress-test rent index ${Math.min(k.rentA, k.rentB)} vs ${Math.max(k.rentA, k.rentB)} against pension cashflow.`;

  const who_benefits = `Who benefits: budget-driven households and students often lean ${cheaper}/${rentWinner}; high earners tied to ${dearer}'s labour market may stay put if pay offsets CPI. Remote workers sensitive to rent should start with ${rentWinner}.`;

  const pros = {
    cityA: [
      k.cpiA <= k.cpiB ? `${a}: lower CPI in this pair` : `${a}: higher CPI / denser premium market signal`,
      k.rentA <= k.rentB ? `${a}: lower rent index` : `${a}: higher rent index`,
      k.ppA >= k.ppB ? `${a}: stronger purchasing power` : `${a}: weaker purchasing power vs ${b}`,
    ],
    cityB: [
      k.cpiB <= k.cpiA ? `${b}: lower CPI in this pair` : `${b}: higher CPI / denser premium market signal`,
      k.rentB <= k.rentA ? `${b}: lower rent index` : `${b}: higher rent index`,
      k.ppB >= k.ppA ? `${b}: stronger purchasing power` : `${b}: weaker purchasing power vs ${a}`,
    ],
  };

  const cons = {
    cityA: [
      k.cpiA > k.cpiB ? `${a}: higher everyday cost index` : `${a}: may offer fewer premium-market amenities`,
      k.rentA > k.rentB ? `${a}: higher rent index` : `${a}: bargains may sit outside preferred districts`,
    ],
    cityB: [
      k.cpiB > k.cpiA ? `${b}: higher everyday cost index` : `${b}: may offer fewer premium-market amenities`,
      k.rentB > k.rentA ? `${b}: higher rent index` : `${b}: bargains may sit outside preferred districts`,
    ],
  };

  const decision_summary =
    decision.overall_winner.reason ||
    `Decision summary: choose ${cheaper} to minimize everyday CPI, ${rentWinner} if housing is binding, and re-check offers if your income is locked to ${dearer}.`;

  const categoryBullets = decision.category_winners.map(
    (w) => `${w.category}: ${w.winner}${w.gapPct ? ` (${w.gapPct}% gap)` : ''}`
  );

  const blocks: ContentBlock[] = [
    { id: 'executive_summary', title: 'Executive Summary', paragraphs: [executive_summary], words: blockWords([executive_summary]) },
    {
      id: 'overall_winner',
      title: 'Overall Cost Winner',
      paragraphs: [
        `${decision.overall_winner.city} wins on overall cost (CPI gap ~${decision.overall_winner.costDifferencePct}%).`,
        decision.overall_winner.reason,
      ],
      words: blockWords([decision.overall_winner.reason]),
    },
    {
      id: 'monthly_difference',
      title: 'Monthly Cost Difference',
      paragraphs: [decision.monthly.summary],
      words: blockWords([decision.monthly.summary]),
    },
    {
      id: 'category_winners',
      title: 'Category Winners',
      paragraphs: ['Winners derived only from paired indices and basket prices:'],
      bullets: categoryBullets.length
        ? categoryBullets
        : [
            `Overall CPI: ${cheaper}`,
            `Rent index: ${rentWinner}`,
            `Purchasing power: ${ppWinner}`,
          ],
      words: 40,
    },
    ...(decision.biggest_difference
      ? [
          {
            id: 'biggest_difference',
            title: 'Biggest Difference',
            paragraphs: [
              `${decision.biggest_difference.category}: ${decision.biggest_difference.winner} leads with a ${decision.biggest_difference.gapPct}% gap. ${decision.biggest_difference.note}`,
            ],
            words: 30,
          } satisfies ContentBlock,
        ]
      : []),
    {
      id: 'best_for',
      title: 'Quick Decision',
      paragraphs: ['Best-fit city by persona using available metrics only:'],
      bullets: decision.best_for.map((x) => `${x.persona}: ${x.city} — ${x.reason}`),
      words: 50,
    },
    {
      id: 'key_takeaways',
      title: 'Key Takeaways',
      paragraphs: ['Key takeaways from measurable gaps:'],
      bullets: decision.key_takeaways,
      words: blockWords(decision.key_takeaways),
    },
    { id: 'detailed_breakdown', title: 'Detailed Breakdown', paragraphs: [detailed], words: blockWords([detailed]) },
    { id: 'monthly_savings', title: 'Monthly Savings', paragraphs: [monthly], words: blockWords([monthly]) },
    { id: 'annual_savings', title: 'Annual Savings', paragraphs: [annual], words: blockWords([annual]) },
    { id: 'who_benefits', title: 'Who Benefits', paragraphs: [who_benefits], words: blockWords([who_benefits]) },
    {
      id: 'personas',
      title: 'Students, Families, Professionals, Remote Workers, Retirees',
      paragraphs: [students, families, professionals, remote_workers, retirees],
      words: blockWords([students, families, professionals, remote_workers, retirees]),
    },
    {
      id: 'pros',
      title: 'Pros',
      paragraphs: [`Pros for each city in ${a} vs ${b}:`],
      bullets: [...pros.cityA, ...pros.cityB],
      words: 50,
    },
    {
      id: 'cons',
      title: 'Cons',
      paragraphs: [`Cons for each city in ${a} vs ${b}:`],
      bullets: [...cons.cityA, ...cons.cityB],
      words: 45,
    },
    { id: 'decision_summary', title: 'Decision Summary', paragraphs: [decision_summary], words: blockWords([decision_summary]) },
  ];

  const faqs = generateCompareFaqs(k);
  const links: InternalLink[] = [
    { label: a, href: `/city/${k.pageSlugA}`, rel: 'related' },
    { label: b, href: `/city/${k.pageSlugB}`, rel: 'related' },
  ];
  if (k.countrySlugA) links.push({ label: 'Country A', href: `/country/${k.countrySlugA}`, rel: 'country' });
  if (k.countrySlugB && k.countrySlugB !== k.countrySlugA) {
    links.push({ label: 'Country B', href: `/country/${k.countrySlugB}`, rel: 'country' });
  }

  const word_count = blocks.reduce((s, b) => s + (b.words || 0), 0) + blockWords(faqs.map((f) => f.q + ' ' + f.a));

  return {
    knowledge: k,
    blocks,
    faqs,
    links,
    enrichment: {
      executive_summary,
      category_winners: decision.category_winners.map((w) => ({
        category: w.category,
        winner: w.winner,
        note: w.note,
        gapPct: w.gapPct,
      })),
      monthly_savings: monthly,
      annual_savings: annual,
      cost_difference_pct: decision.overall_winner.costDifferencePct || Math.round(diff),
      who_benefits,
      students,
      families,
      professionals,
      remote_workers,
      retirees,
      pros,
      cons,
      decision_summary,
      overall_winner: decision.overall_winner,
      monthly_difference: decision.monthly,
      biggest_difference: decision.biggest_difference,
      best_for: decision.best_for,
      key_takeaways: decision.key_takeaways,
    },
    word_count,
  };
}
