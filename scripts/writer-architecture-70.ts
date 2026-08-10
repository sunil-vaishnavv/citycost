/**
 * Writer Architecture v4 regression:
 * 10 each of country, city, comparison, salary, rent, student, visa.
 * Run: npx tsx scripts/writer-architecture-70.ts
 */

import { synthesizeDraftFromResearch } from '../lib/editorial-engine/writer/research-synth.js';
import { applySummaryWriter } from '../lib/editorial-engine/writer/summary-writer.js';
import { runWriterSelfReview } from '../lib/editorial-engine/writer/self-review.js';
import { routeWriter, listRegisteredWriters } from '../lib/editorial-engine/writer/router.js';
import { detectPromptLeakage } from '../lib/editorial-engine/writer/prompt-leakage.js';
import { draftBodyText } from '../lib/editorial-engine/reviewer/text-utils.js';
import { buildDeterministicFaqItems } from '../lib/editorial-engine/faq/faq-deterministic.js';
import { toFaqBlock } from '../lib/editorial-engine/faq/faq-apply.js';
import { replaceFaqInDraft } from '../lib/editorial-engine/faq/faq-apply.js';
import type { ResearchPack } from '../lib/editorial-engine/research/schema.js';

const TYPES = [
  'country_guide',
  'city_guide',
  'comparison_guide',
  'salary_guide',
  'rent_guide',
  'student_guide',
  'visa_guide',
] as const;

const PLACES = [
  { country: 'India', cities: ['Delhi', 'Mumbai', 'Bangalore', 'Hyderabad', 'Chennai'] },
  { country: 'Germany', cities: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne'] },
  { country: 'Canada', cities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa'] },
  { country: 'Australia', cities: ['Sydney', 'Melbourne', 'Brisbane', 'Adelaide', 'Perth'] },
  { country: 'Japan', cities: ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya', 'Fukuoka'] },
  { country: 'Spain', cities: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao'] },
  { country: 'France', cities: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice'] },
  { country: 'Italy', cities: ['Rome', 'Milan', 'Naples', 'Turin', 'Florence'] },
  { country: 'Mexico', cities: ['Mexico City', 'Guadalajara', 'Monterrey', 'Puebla'] },
  { country: 'Brazil', cities: ['Sao Paulo', 'Rio de Janeiro', 'Brasilia', 'Salvador'] },
];

function packFor(
  id: number,
  content_type: string,
  place: (typeof PLACES)[0]
): ResearchPack {
  const cities = place.cities;
  const primary =
    content_type === 'country_guide'
      ? place.country
      : content_type === 'comparison_guide'
        ? `${cities[0]} vs ${cities[1]}`
        : cities[0]!;
  const title =
    content_type === 'country_guide'
      ? `Cost of Living in ${place.country}`
      : content_type === 'comparison_guide'
        ? `${cities[0]} vs ${cities[1]} Cost of Living`
        : content_type === 'city_guide'
          ? `Living in ${cities[0]} Cost Guide`
          : `${place.country} ${content_type.replace(/_/g, ' ')}`;

  return {
    schema_version: '3.0.0',
    topic: {
      id,
      title,
      content_type,
      slug: `t-${id}`,
      priority_score: 90,
    },
    intent: content_type === 'comparison_guide' ? 'commercial_investigation' : 'informational',
    search_intent: 'informational',
    persona: 'relocators',
    reader_persona: 'relocators',
    primary_keyword: `${primary} cost of living`.toLowerCase(),
    target_keyword: `${primary} cost of living`.toLowerCase(),
    secondary_keywords: ['rent', 'budget'],
    long_tail_keywords: [],
    question_keywords: [],
    semantic_keywords: ['housing', 'salary'],
    lsi_keywords: [],
    article_angle: `${primary} practical budgeting`,
    searcher_questions: [],
    search_questions: [],
    user_pain_points: ['deposits', 'healthcare'],
    decision_criteria: ['rent stretch', 'commute'],
    common_mistakes: ['ignoring utilities'],
    supporting_facts: [`Planning signals for ${place.country}: housing dominates.`],
    required_statistics: [],
    known_data_gaps: [],
    facts_must_not_invent: [],
    disclaimer_requirements: [],
    related_cities: cities.map((c) => ({
      href: `/city/${c.toLowerCase().replace(/\s+/g, '-')}`,
      label: c,
    })),
    related_countries: [
      { href: `/country/${place.country.toLowerCase().replace(/\s+/g, '-')}`, label: place.country },
    ],
    related_comparison_pages:
      content_type === 'comparison_guide'
        ? [
            {
              href: `/compare/${cities[0]!.toLowerCase().replace(/\s+/g, '-')}-vs-${cities[1]!.toLowerCase().replace(/\s+/g, '-')}`,
              label: `${cities[0]} vs ${cities[1]}`,
            },
          ]
        : [],
    internal_link_candidates: [],
    content_cluster: null,
    parent_pillar: null,
    child_articles: [],
    entities: {
      cities,
      countries: [place.country],
      currencies: [],
      transportation: ['metro'],
      universities: [],
      neighbourhoods: content_type === 'city_guide' ? ['Central', 'Outer'] : [],
      government_programs: [],
      visa_names: content_type === 'visa_guide' ? ['work visa'] : [],
      healthcare_systems: ['public'],
      other: [],
    },
    primary_entity: primary,
    secondary_entities: cities.slice(0, 3),
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
      'Summary',
      'FAQ',
    ],
    required_h3: [],
    required_faq: [
      `What is the real cost of living in ${primary}?`,
      `What is the average rent in ${primary}?`,
      `How much money do I need per month in ${primary}?`,
      `Are groceries expensive in ${primary}?`,
      `Is healthcare expensive in ${primary}?`,
      `Can students afford ${primary}?`,
    ],
    required_tables: ['Monthly cost buckets'],
    required_comparison_blocks:
      content_type === 'comparison_guide' ? [`${cities[0]} vs ${cities[1]}`] : [],
    eeat_opportunities: [],
  } as ResearchPack;
}

function main() {
  const registered = listRegisteredWriters().map((w) => w.id);
  console.log('Registered writers:', registered.length, registered.join(', '));

  let id = 1;
  const rows: Array<{
    type: string;
    writer: string;
    ok: boolean;
    human: number;
    leakage: number;
  }> = [];
  const failSamples: string[] = [];

  for (const type of TYPES) {
    for (let i = 0; i < 10; i++) {
      const place = PLACES[i]!;
      const research = packFor(id++, type, place);
      research.internal_link_candidates = [
        ...research.related_countries,
        ...research.related_cities,
        ...research.related_comparison_pages,
        { href: '/methodology', label: 'Methodology' },
      ];
      const routed = routeWriter(type);
      let draft = synthesizeDraftFromResearch(research as never, { targetWords: 2400 });
      const faqs = buildDeterministicFaqItems(research as never, research.required_faq);
      draft = replaceFaqInDraft(draft, toFaqBlock(faqs));
      draft = applySummaryWriter(draft, research as never);
      const review = runWriterSelfReview(draft, research as never);
      const body = draftBodyText(review.draft);
      const leakage = detectPromptLeakage(body).length;
      rows.push({
        type,
        writer: routed.writer.id,
        ok: review.ok && leakage === 0,
        human: review.scores.human_writing,
        leakage,
      });
      if (!review.ok || leakage) {
        failSamples.push(
          `${type}/${place.country}: ok=${review.ok} leak=${leakage} :: ${review.issues
            .filter((x) => !x.startsWith('writer:'))
            .slice(0, 3)
            .join(' | ')}`
        );
      }
    }
  }

  const byType = Object.fromEntries(
    TYPES.map((t) => {
      const subset = rows.filter((r) => r.type === t);
      return [
        t,
        {
          n: subset.length,
          writer: subset[0]?.writer,
          fails: subset.filter((r) => !r.ok).length,
          avgHuman: Math.round(subset.reduce((s, r) => s + r.human, 0) / subset.length),
        },
      ];
    })
  );

  const fails = rows.filter((r) => !r.ok).length;
  const avgHuman = Math.round(rows.reduce((s, r) => s + r.human, 0) / rows.length);
  const distinctWriters = new Set(rows.map((r) => r.writer)).size;

  console.log('=== Writer architecture regression (70) ===');
  console.log(JSON.stringify(byType, null, 2));
  console.log({ total: rows.length, fails, avgHuman, distinctWriters });
  if (failSamples.length) console.log('Samples:\n' + failSamples.slice(0, 12).join('\n'));

  const ok =
    rows.length === 70 &&
    fails === 0 &&
    avgHuman >= 90 &&
    distinctWriters >= 7 &&
    TYPES.every((t) => byType[t].writer !== 'general_guide' || t === 'general_guide');

  if (!ok) {
    console.error('FAILED');
    process.exit(1);
  }
  console.log('PASSED');
}

main();
