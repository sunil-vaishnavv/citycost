/**
 * Offline verification of dedicated FAQ generator (deterministic path).
 * Run: npx tsx scripts/verify-faq-dedicated.ts
 */

import { buildDeterministicFaqItems } from '../lib/editorial-engine/faq/faq-deterministic.js';
import { validateFaqItems, BANNED_FAQ_PHRASES } from '../lib/editorial-engine/faq/faq-validator.js';
import type { ResearchPack } from '../lib/editorial-engine/research/schema.js';

function mockResearch(): ResearchPack {
  return {
    schema_version: '3.0.0',
    topic: {
      id: 1,
      title: 'What It Really Costs to Live in Australia',
      content_type: 'country_guide',
      slug: 'australia-cost-of-living',
      priority_score: 88,
    },
    intent: 'informational',
    search_intent: 'informational',
    persona: 'relocators',
    reader_persona: 'relocators',
    primary_keyword: 'cost of living in australia',
    target_keyword: 'cost of living in australia',
    secondary_keywords: ['australia rent', 'australia monthly budget'],
    long_tail_keywords: [],
    question_keywords: [],
    semantic_keywords: [],
    lsi_keywords: [],
    article_angle: 'Practical costs by city',
    searcher_questions: [],
    search_questions: [],
    user_pain_points: [],
    decision_criteria: ['rent', 'salary stretch', 'healthcare'],
    common_mistakes: [],
    supporting_facts: [],
    required_statistics: [],
    known_data_gaps: [],
    facts_must_not_invent: [],
    disclaimer_requirements: [],
    related_cities: [
      { href: '/city/sydney-new-south-wales-australia', label: 'Sydney' },
      { href: '/city/melbourne-victoria-australia', label: 'Melbourne' },
      { href: '/city/brisbane-queensland-australia', label: 'Brisbane' },
      { href: '/city/adelaide-south-australia-australia', label: 'Adelaide' },
    ],
    related_countries: [],
    related_comparison_pages: [],
    internal_link_candidates: [
      { href: '/city/sydney-new-south-wales-australia', label: 'Sydney' },
      { href: '/city/melbourne-victoria-australia', label: 'Melbourne' },
      { href: '/methodology', label: 'Methodology' },
    ],
    content_cluster: null,
    parent_pillar: null,
    child_articles: [],
    entities: {
      cities: ['Sydney', 'Melbourne', 'Brisbane', 'Adelaide', 'Perth'],
      countries: ['Australia'],
      currencies: ['AUD'],
      transportation: [],
      universities: [],
      neighbourhoods: [],
      government_programs: [],
      visa_names: [],
      healthcare_systems: ['Medicare'],
      other: [],
    },
    primary_entity: 'Australia',
    secondary_entities: ['Sydney', 'Melbourne'],
    required_h2: [],
    required_h3: [],
    required_faq: [
      'What is the real cost of living in Australia?',
      'What is the average rent in Australia?',
      'How much money do I need per month in Australia?',
      'Are groceries expensive in Australia?',
      'How much is public transport in Australia?',
      'Is healthcare expensive in Australia?',
      'Can students afford Australia?',
      'Is it worth moving to Australia for a higher salary?',
      'Which Australian city is cheapest for renters?',
      'Why does cost of living vary so much across Australia?',
    ],
    required_tables: [],
    required_comparison_blocks: [],
    required_calculators: [],
    outline: [],
    recommended_outline: [],
    eeat_opportunities: [],
    writer_contract: {
      sole_source: 'research_pack',
      must_follow_outline: true,
      must_use_pack_intent: true,
      must_not_invent_entities: true,
      must_not_invent_statistics: true,
      must_not_guess_intent: true,
      must_answer_searcher_questions: true,
      required_faq_count_min: 6,
      required_h2_count_min: 4,
    },
    validation: {
      ok: true,
      missing_fields: [],
      warnings: [],
      checked_at: new Date().toISOString(),
      schema_version: '3.0.0',
    },
  } as ResearchPack;
}

/** Extra questions to reach 20 answers for variation test */
const EXTRA = [
  'What salary do I need to live comfortably in Australia?',
  'Are utilities expensive in Australia?',
  'How much should I save before moving to Australia?',
  'Do taxes make Australia expensive for workers?',
  'Is Australia safe and does that affect living costs?',
  'What is a realistic student monthly budget in Australia?',
  'Can remote workers afford coastal cities in Australia?',
  'How do Adelaide costs compare with Sydney?',
  'What first-month costs should I expect in Australia?',
  'Is Perth cheaper than Melbourne for families?',
];

function main() {
  const research = mockResearch();
  const questions = [...research.required_faq, ...EXTRA].slice(0, 20);
  const items = buildDeterministicFaqItems(
    { ...research, required_faq: questions },
    questions
  );

  const validation = validateFaqItems(items);
  const openers = items.map((i) => i.a.split(/(?<=[.!?])\s+/)[0] || '');
  const uniqueOpeners = new Set(openers.map((o) => o.toLowerCase().slice(0, 48)));

  console.log('=== Dedicated FAQ verification (deterministic) ===\n');
  console.log(`Count: ${items.length}`);
  console.log(`Unique first sentences: ${uniqueOpeners.size}/${items.length}`);
  console.log(`Validation ok: ${validation.ok}`);
  console.log('Scores:', validation.scores);
  if (validation.issues.length) {
    console.log(
      'Issues:',
      validation.issues.slice(0, 15).map((i) => `${i.code}: ${i.message}`)
    );
  }

  let banned = 0;
  for (const item of items) {
    const lower = item.a.toLowerCase();
    for (const ban of BANNED_FAQ_PHRASES) {
      if (lower.includes(ban)) {
        banned += 1;
        console.log(`BANNED in "${item.q}": ${ban}`);
      }
    }
  }
  console.log(`Banned phrase hits: ${banned}`);

  console.log('\n--- 20 FAQ answers ---\n');
  items.forEach((item, i) => {
    const words = item.a.split(/\s+/).filter(Boolean).length;
    console.log(`${i + 1}. Q: ${item.q}`);
    console.log(`   A (${words}w): ${item.a}\n`);
  });

  // Compare against old synth-style garbage
  const oldSample =
    'Budget Australia as a worksheet: rent or mortgage, groceries, commute, healthcare buffer, and setup fees. Indexed averages for Australia: rent high. When you choose, weigh rent. Cross-check /city/sydney and /data-sources before you finalize numbers.';
  console.log('--- Before (legacy synth style) ---');
  console.log(oldSample);
  console.log('\n--- After (dedicated #2 rent) ---');
  console.log(items[1]?.a);

  if (!validation.ok || banned > 0 || uniqueOpeners.size < items.length) {
    process.exitCode = 1;
  }
}

main();
