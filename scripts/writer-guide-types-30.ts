/**
 * Regression: 10 country + 10 city + 10 comparison synth drafts.
 * Run: npx tsx scripts/writer-guide-types-30.ts
 */

import { synthesizeDraftFromResearch } from '../lib/editorial-engine/writer/research-synth.js';
import { runWriterSelfReview } from '../lib/editorial-engine/writer/self-review.js';
import { normalizeGuideFamily } from '../lib/editorial-engine/writer/guide-contracts.js';
import { draftBodyText } from '../lib/editorial-engine/reviewer/text-utils.js';
import type { ResearchPack } from '../lib/editorial-engine/research/schema.js';

const COUNTRIES: Array<{ country: string; cities: string[] }> = [
  { country: 'India', cities: ['Delhi', 'Mumbai', 'Bangalore', 'Hyderabad', 'Chennai', 'Pune'] },
  { country: 'Australia', cities: ['Sydney', 'Melbourne', 'Brisbane', 'Adelaide', 'Perth'] },
  { country: 'Canada', cities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa'] },
  { country: 'Germany', cities: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne'] },
  { country: 'Japan', cities: ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya', 'Fukuoka'] },
  { country: 'Spain', cities: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao'] },
  { country: 'France', cities: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice'] },
  { country: 'Italy', cities: ['Rome', 'Milan', 'Naples', 'Turin', 'Florence'] },
  { country: 'Mexico', cities: ['Mexico City', 'Guadalajara', 'Monterrey', 'Puebla', 'Tijuana'] },
  { country: 'Brazil', cities: ['Sao Paulo', 'Rio de Janeiro', 'Brasilia', 'Salvador', 'Curitiba'] },
];

function basePack(opts: {
  id: number;
  title: string;
  content_type: string;
  country: string;
  cities: string[];
  primary: string;
}): ResearchPack {
  const countrySlug = opts.country.toLowerCase().replace(/\s+/g, '-');
  return {
    schema_version: '3.0.0',
    topic: {
      id: opts.id,
      title: opts.title,
      content_type: opts.content_type,
      slug: `t-${opts.id}`,
      priority_score: 88,
    },
    intent: opts.content_type === 'comparison_guide' ? 'commercial_investigation' : 'informational',
    search_intent: 'informational',
    persona: 'relocators',
    reader_persona: 'relocators',
    primary_keyword: `${opts.primary} cost of living`.toLowerCase(),
    target_keyword: `${opts.primary} cost of living`.toLowerCase(),
    secondary_keywords: ['rent', 'monthly budget'],
    long_tail_keywords: [],
    question_keywords: [],
    semantic_keywords: ['housing', 'transport', 'salary'],
    lsi_keywords: [],
    article_angle: `Practical ${opts.primary} budgeting`,
    searcher_questions: [],
    search_questions: [],
    user_pain_points: ['deposits', 'commute', 'healthcare eligibility'],
    decision_criteria: ['rent stretch', 'commute', 'healthcare'],
    common_mistakes: ['ignoring utilities', 'tourist-week budgets'],
    supporting_facts: [
      `Planning signals for ${opts.country}: housing usually dominates the monthly stack.`,
      `Regional spreads inside ${opts.country} can exceed the gap between two nearby cities.`,
    ],
    required_statistics: [],
    known_data_gaps: [],
    facts_must_not_invent: ['exact street rents'],
    disclaimer_requirements: [],
    related_cities: opts.cities.map((c) => ({
      href: `/city/${c.toLowerCase().replace(/\s+/g, '-')}`,
      label: c,
    })),
    related_countries: [{ href: `/country/${countrySlug}`, label: opts.country }],
    related_comparison_pages:
      opts.content_type === 'comparison_guide' && opts.cities.length >= 2
        ? [
            {
              href: `/compare/${opts.cities[0]!.toLowerCase().replace(/\s+/g, '-')}-vs-${opts.cities[1]!.toLowerCase().replace(/\s+/g, '-')}`,
              label: `${opts.cities[0]} vs ${opts.cities[1]}`,
            },
          ]
        : [],
    internal_link_candidates: [],
    content_cluster: null,
    parent_pillar: null,
    child_articles: [],
    entities: {
      cities: opts.cities,
      countries: [opts.country],
      currencies: [],
      transportation: ['metro', 'bus'],
      universities: [],
      neighbourhoods: opts.content_type === 'city_guide' ? ['Central', 'Outer'] : [],
      government_programs: [],
      visa_names: [],
      healthcare_systems: ['public system'],
      other: [],
    },
    primary_entity: opts.primary,
    secondary_entities: opts.cities.slice(0, 3),
    required_h2: [
      'Introduction',
      'Who should read this',
      'Cost of living overview',
      'Housing',
      'Food',
      'Transport',
      'Healthcare',
      'Salary and purchasing power',
      'Pros',
      'Cons',
      ...(opts.content_type === 'comparison_guide' ? ['City comparison'] : []),
      'Summary',
      'FAQ',
    ],
    required_h3: [],
    required_faq: [
      `What is the real cost of living in ${opts.primary}?`,
      `What is the average rent in ${opts.primary}?`,
      `How much money do I need per month in ${opts.primary}?`,
      `Are groceries expensive in ${opts.primary}?`,
      `How much is public transport in ${opts.primary}?`,
      `Is healthcare expensive in ${opts.primary}?`,
    ],
    required_tables: ['Monthly cost buckets'],
    required_comparison_blocks:
      opts.content_type === 'comparison_guide' ? [`${opts.cities[0]} vs ${opts.cities[1]}`] : [],
    eeat_opportunities: [],
  } as ResearchPack;
}

function buildPacks(): ResearchPack[] {
  const packs: ResearchPack[] = [];
  let id = 1;
  for (const row of COUNTRIES) {
    packs.push(
      basePack({
        id: id++,
        title: `What It Really Costs to Live in ${row.country}`,
        content_type: 'country_guide',
        country: row.country,
        cities: row.cities,
        primary: row.country,
      })
    );
  }
  for (const row of COUNTRIES) {
    const city = row.cities[0]!;
    packs.push(
      basePack({
        id: id++,
        title: `Moving to ${city}: A Practical Monthly Budget`,
        content_type: 'city_guide',
        country: row.country,
        cities: row.cities.slice(0, 3),
        primary: city,
      })
    );
  }
  for (const row of COUNTRIES) {
    const a = row.cities[0]!;
    const b = row.cities[1]!;
    packs.push(
      basePack({
        id: id++,
        title: `${a} vs ${b}: Where Your Salary Goes Further`,
        content_type: 'comparison_guide',
        country: row.country,
        cities: [a, b, ...row.cities.slice(2, 4)],
        primary: `${a} vs ${b}`,
      })
    );
  }
  return packs;
}

function main() {
  const packs = buildPacks();
  const byFamily = { country: 0, city: 0, comparison: 0, supporting: 0 };
  let fails = 0;
  let humanSum = 0;
  const styleMarkers = { country: 0, city: 0, comparison: 0 };
  const issuesSamples: string[] = [];

  for (const research of packs) {
    // Fill internal links like research build would
    research.internal_link_candidates = [
      ...research.related_countries,
      ...research.related_cities,
      ...research.related_comparison_pages,
      { href: '/methodology', label: 'Methodology' },
      { href: '/data-sources', label: 'Data sources' },
    ];
    const family = normalizeGuideFamily(research.topic.content_type);
    byFamily[family] += 1;
    const raw = synthesizeDraftFromResearch(research as never, { targetWords: 2500 });
    const review = runWriterSelfReview(raw, research as never);
    humanSum += review.scores.human_writing;
    if (!review.ok) {
      fails += 1;
      issuesSamples.push(
        `${research.topic.content_type} · ${research.primary_entity}: ${review.issues.slice(0, 3).join(' | ')}`
      );
    }
    const body = draftBodyText(review.draft).toLowerCase();
    if (family === 'country') {
      if (/national|country-wide|regional|examples only|city examples|shortlist/.test(body)) {
        styleMarkers.country += 1;
      }
      const c0 = research.entities.cities[0]!.toLowerCase();
      const c1 = research.entities.cities[1]!.toLowerCase();
      const pair = `${c0} and ${c1}`;
      const pairHits = (body.match(new RegExp(pair.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [])
        .length;
      if (pairHits >= 6) {
        fails += 1;
        issuesSamples.push(`country pair-dominates: ${research.primary_entity} (${pairHits})`);
      }
    }
    if (family === 'city' && body.includes(String(research.primary_entity).toLowerCase())) {
      styleMarkers.city += 1;
    }
    if (family === 'comparison' && /hold lifestyle constant|vs |who should choose/.test(body)) {
      styleMarkers.comparison += 1;
    }
  }

  const avgHuman = Math.round(humanSum / packs.length);
  console.log('=== Writer guide-type regression (30) ===');
  console.log('Counts:', byFamily);
  console.log('Avg human writing:', avgHuman);
  console.log('Self-review failures:', fails);
  console.log('Style markers:', styleMarkers);
  if (issuesSamples.length) console.log('Sample issues:\n', issuesSamples.slice(0, 8).join('\n'));

  const ok =
    byFamily.country === 10 &&
    byFamily.city === 10 &&
    byFamily.comparison === 10 &&
    fails === 0 &&
    avgHuman >= 90 &&
    styleMarkers.country >= 8 &&
    styleMarkers.city >= 8 &&
    styleMarkers.comparison >= 6;

  if (!ok) {
    console.error('FAILED');
    process.exit(1);
  }
  console.log('PASSED');
}

main();
