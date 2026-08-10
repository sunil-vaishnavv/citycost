/**
 * Regression: synthesize 20 distinct drafts and verify no shared AI template fingerprints.
 * Run: npx tsx scripts/writer-uniqueness-20.ts
 */

import { synthesizeDraftFromResearch } from '../lib/editorial-engine/writer/research-synth.js';
import {
  paragraphFingerprints,
  runWriterSelfReview,
} from '../lib/editorial-engine/writer/self-review.js';
import { WRITER_ONCE_PHRASES } from '../lib/editorial-engine/writer/section-strategies.js';
import { draftBodyText } from '../lib/editorial-engine/reviewer/text-utils.js';
import type { ResearchPack } from '../lib/editorial-engine/research/schema.js';

const CITIES: Array<[string, string, string]> = [
  ['Sydney', 'Melbourne', 'Australia'],
  ['Toronto', 'Vancouver', 'Canada'],
  ['Berlin', 'Munich', 'Germany'],
  ['Lisbon', 'Porto', 'Portugal'],
  ['Tokyo', 'Osaka', 'Japan'],
  ['Auckland', 'Wellington', 'New Zealand'],
  ['Dublin', 'Cork', 'Ireland'],
  ['Amsterdam', 'Rotterdam', 'Netherlands'],
  ['Barcelona', 'Madrid', 'Spain'],
  ['Singapore', 'Kuala Lumpur', 'Singapore'],
  ['Seoul', 'Busan', 'South Korea'],
  ['Paris', 'Lyon', 'France'],
  ['Chicago', 'Austin', 'United States'],
  ['Mexico City', 'Guadalajara', 'Mexico'],
  ['Bangkok', 'Chiang Mai', 'Thailand'],
  ['Dubai', 'Abu Dhabi', 'United Arab Emirates'],
  ['Stockholm', 'Gothenburg', 'Sweden'],
  ['Prague', 'Brno', 'Czechia'],
  ['Warsaw', 'Krakow', 'Poland'],
  ['Cape Town', 'Johannesburg', 'South Africa'],
];

function mockResearch(a: string, b: string, country: string, i: number): ResearchPack {
  const title =
    i % 3 === 0
      ? `What It Really Costs to Live in ${country}`
      : i % 3 === 1
        ? `${a} vs ${b}: Where Your Salary Goes Further`
        : `Moving to ${a}: A Practical Monthly Budget`;
  return {
    schema_version: '3.0.0',
    topic: {
      id: i + 1,
      title,
      content_type: i % 2 === 0 ? 'country_guide' : 'city_comparison',
      slug: `topic-${i + 1}`,
      priority_score: 80,
    },
    intent: 'informational',
    search_intent: 'informational',
    persona: 'relocators',
    reader_persona: 'relocators',
    primary_keyword: `cost of living ${a}`.toLowerCase(),
    target_keyword: `cost of living ${a}`.toLowerCase(),
    secondary_keywords: [`${a} rent`, `${b} budget`],
    long_tail_keywords: [],
    question_keywords: [],
    semantic_keywords: ['housing', 'transport', 'salary'],
    lsi_keywords: [],
    article_angle: `Practical ${a}/${b} budgeting for relocators`,
    searcher_questions: [],
    search_questions: [],
    user_pain_points: [
      `deposits in ${a}`,
      `commute from outer ${b}`,
      `healthcare eligibility surprises`,
    ],
    decision_criteria: ['rent stretch', 'commute time', 'healthcare buffer'],
    common_mistakes: [`ignoring agency fees in ${a}`, `comparing tourist weeks to resident months`],
    supporting_facts: [
      `Planning signals for ${country}: rent often dominates the monthly stack in ${a}.`,
      `${b} can feel cheaper on food but lose on commute depending on job location.`,
    ],
    required_statistics: [],
    known_data_gaps: [],
    facts_must_not_invent: ['exact street rents', 'personal tax outcomes'],
    disclaimer_requirements: [],
    related_cities: [
      { href: `/city/${a.toLowerCase().replace(/\s+/g, '-')}`, label: a },
      { href: `/city/${b.toLowerCase().replace(/\s+/g, '-')}`, label: b },
    ],
    related_countries: [],
    related_comparison_pages: [],
    internal_link_candidates: [
      { href: `/city/${a.toLowerCase().replace(/\s+/g, '-')}`, label: a },
      { href: `/city/${b.toLowerCase().replace(/\s+/g, '-')}`, label: b },
      { href: '/methodology', label: 'Methodology' },
    ],
    content_cluster: null,
    parent_pillar: null,
    child_articles: [],
    entities: {
      cities: [a, b],
      countries: [country],
      currencies: [],
      transportation: ['metro', 'bus'],
      universities: [],
      neighbourhoods: [`Central ${a}`, `Outer ${b}`],
      government_programs: [],
      visa_names: [],
      healthcare_systems: ['public system'],
      other: [],
    },
    primary_entity: i % 3 === 0 ? country : a,
    secondary_entities: [b],
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
      `What is the real cost of living in ${a}?`,
      `What is the average rent in ${a}?`,
      `How much money do I need per month in ${a}?`,
      `Are groceries expensive in ${a}?`,
      `How much is public transport in ${a}?`,
      `Is healthcare expensive in ${a}?`,
      `Can students afford ${a}?`,
      `${a} or ${b} — which is cheaper?`,
    ],
    required_tables: ['Monthly cost buckets'],
    required_comparison_blocks: i % 2 === 1 ? [`${a} vs ${b}`] : [],
    eeat_opportunities: [],
  } as ResearchPack;
}

const bannedOpeners = [
  'cross-check',
  'when in doubt',
  'before you finalize',
  'indexed averages',
  'the practical answer',
  'budget as a worksheet',
];

function main() {
  const drafts = CITIES.map(([a, b, c], i) => {
    const research = mockResearch(a, b, c, i);
    const raw = synthesizeDraftFromResearch(research as never, { targetWords: 2600 });
    const review = runWriterSelfReview(raw, research as never);
    return { a, b, c, research, draft: review.draft, review };
  });

  const allFingerprints = new Map<string, string[]>();
  const openerCounts = new Map<string, number>();
  const endingCounts = new Map<string, number>();
  const phraseHits = new Map<string, number>();
  let reviewFails = 0;
  let humanSum = 0;
  let helpfulSum = 0;

  for (const row of drafts) {
    humanSum += row.review.scores.human_writing;
    helpfulSum += row.review.scores.helpful_content;
    if (!row.review.ok) reviewFails += 1;

    const body = draftBodyText(row.draft).toLowerCase();
    for (const p of [...WRITER_ONCE_PHRASES, ...bannedOpeners]) {
      const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const n = (body.match(re) || []).length;
      if (n > 0) phraseHits.set(p, (phraseHits.get(p) || 0) + n);
    }

    for (const fp of paragraphFingerprints(row.draft)) {
      const list = allFingerprints.get(fp) || [];
      list.push(`${row.a}/${row.b}`);
      allFingerprints.set(fp, list);
    }

    for (const b of row.draft.blocks || []) {
      if (!['paragraph', 'intro', 'summary'].includes(b.type)) continue;
      const text = typeof b.content === 'string' ? b.content : '';
      if (text.split(/\s+/).length < 20) continue;
      const first = text
        .trim()
        .split(/[.!?]/)[0]
        ?.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .slice(0, 6)
        .join(' ');
      const parts = text.trim().split(/(?<=[.!?])\s+/);
      const last = (parts[parts.length - 1] || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .slice(0, 6)
        .join(' ');
      if (first) openerCounts.set(first, (openerCounts.get(first) || 0) + 1);
      if (last) endingCounts.set(last, (endingCounts.get(last) || 0) + 1);
    }
  }

  const sharedParas = [...allFingerprints.entries()].filter(([, v]) => v.length >= 2);
  // With ~5–8 variants × 20 articles, allow mild reuse; flag heavy template reuse.
  const sharedOpeners = [...openerCounts.entries()].filter(([, n]) => n >= 8);
  const sharedEndings = [...endingCounts.entries()].filter(([, n]) => n >= 20);
  const overusedPhrases = [...phraseHits.entries()].filter(([, n]) => n > 20);

  const avgHuman = Math.round(humanSum / drafts.length);
  const avgHelpful = Math.round(helpfulSum / drafts.length);

  console.log('=== Writer uniqueness report (20 synth drafts) ===');
  console.log(`Articles: ${drafts.length}`);
  console.log(`Avg human writing: ${avgHuman}`);
  console.log(`Avg helpful content: ${avgHelpful}`);
  console.log(`Self-review failures: ${reviewFails}`);
  console.log(`Shared paragraph fingerprints (≥2 articles): ${sharedParas.length}`);
  console.log(`Shared openers (≥8 uses corpus-wide): ${sharedOpeners.length}`);
  console.log(`Shared endings (≥20 uses corpus-wide): ${sharedEndings.length}`);
  for (const row of drafts.filter((d) => !d.review.ok)) {
    console.log(`FAIL ${row.a}:`, row.review.scores, row.review.issues.slice(0, 8));
  }
  console.log(`Overused once-phrases (corpus >20): ${overusedPhrases.length}`);
  if (sharedParas.length) {
    console.log('Sample shared paras:', sharedParas.slice(0, 3).map(([k, v]) => ({ k: k.slice(0, 80), v })));
  }
  if (sharedOpeners.length) {
    console.log('Sample shared openers:', sharedOpeners.slice(0, 8));
  }
  if (overusedPhrases.length) {
    console.log('Overused phrases:', overusedPhrases);
  }
  for (const row of drafts.slice(0, 3)) {
    console.log(
      `Sample ${row.a}: human=${row.review.scores.human_writing} helpful=${row.review.scores.helpful_content} ok=${row.review.ok} issues=${row.review.issues.length}`
    );
    if (row.review.issues.length) console.log('  ', row.review.issues.slice(0, 5));
  }

  const ok =
    reviewFails === 0 &&
    sharedParas.length === 0 &&
    sharedOpeners.length === 0 &&
    sharedEndings.length <= 12 &&
    overusedPhrases.length === 0 &&
    avgHuman >= 90 &&
    avgHelpful >= 90;

  if (!ok) {
    console.error('FAILED uniqueness / quality gates');
    process.exit(1);
  }
  console.log('PASSED');
}

main();
