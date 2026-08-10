/**
 * Regression: "indexed averages" must never enter Writer prompts or survive repair.
 * Run: npx tsx scripts/writer-v2-leakage-regression.ts
 */
import assert from 'node:assert/strict';
import { buildStructuredContext } from '../lib/editorial-engine/writer/context-pack.js';
import { buildResearchPack } from '../lib/editorial-engine/writer/research-engine.js';
import {
  buildFactsDigest,
  sanitizePromptText,
} from '../lib/editorial-engine/writer/v2/prompt-sanitizer.js';
import { detectPromptLeakage } from '../lib/editorial-engine/writer/prompt-leakage.js';
import { repairPromptLeakage } from '../lib/editorial-engine/writer/v2/leakage-repair.js';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';

type FakeTopic = {
  id: number;
  title: string;
  content_type: string;
  priority_score: number;
  cluster_id: number | null;
  source_refs_json: Record<string, unknown>;
  status: string;
};

const FIXTURES: Array<{ label: string; topic: FakeTopic }> = [
  {
    label: 'country',
    topic: {
      id: 1,
      title: 'Planning a Move to India? A Clear Cost of Living Breakdown',
      content_type: 'country_guide',
      priority_score: 80,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { country_slug: 'india', country: 'India' },
    },
  },
  {
    label: 'city',
    topic: {
      id: 2,
      title: 'Cost of Living in Mumbai',
      content_type: 'city_guide',
      priority_score: 70,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { city_slug: 'mumbai-maharashtra-india' },
    },
  },
  {
    label: 'comparison',
    topic: {
      id: 3,
      title: 'Berlin vs Lisbon Cost of Living',
      content_type: 'comparison_guide',
      priority_score: 70,
      cluster_id: null,
      status: 'approved',
      source_refs_json: {
        cities: ['Berlin', 'Lisbon'],
        comparison_slug: 'berlin-vs-lisbon',
      },
    },
  },
  {
    label: 'salary',
    topic: {
      id: 4,
      title: 'Average Salary in India',
      content_type: 'salary_guide',
      priority_score: 60,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { country_slug: 'india', hub_id: 'salary' },
    },
  },
  {
    label: 'rent',
    topic: {
      id: 5,
      title: 'Rent Guide for India',
      content_type: 'rent_guide',
      priority_score: 60,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { country_slug: 'india', hub_id: 'rent' },
    },
  },
  {
    label: 'student',
    topic: {
      id: 6,
      title: 'Student Budget in India',
      content_type: 'student_guide',
      priority_score: 55,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { country_slug: 'india', persona: 'student' },
    },
  },
  {
    label: 'visa',
    topic: {
      id: 7,
      title: 'Visa Costs for India',
      content_type: 'visa_guide',
      priority_score: 55,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { country_slug: 'india', hub_id: 'visa' },
    },
  },
  {
    label: 'moving',
    topic: {
      id: 8,
      title: 'Moving to India Checklist',
      content_type: 'moving_guide',
      priority_score: 55,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { country_slug: 'india' },
    },
  },
  {
    label: 'food',
    topic: {
      id: 9,
      title: 'Food Costs in India',
      content_type: 'food_guide',
      priority_score: 50,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { country_slug: 'india', hub_id: 'food' },
    },
  },
  {
    label: 'healthcare',
    topic: {
      id: 10,
      title: 'Healthcare Costs in India',
      content_type: 'healthcare_guide',
      priority_score: 50,
      cluster_id: null,
      status: 'approved',
      source_refs_json: { country_slug: 'india', hub_id: 'healthcare' },
    },
  },
];

const BANNED = [
  'indexed averages',
  'search intent',
  'required_h2',
  'editorial angle',
  'citycost angle',
  'cross-check',
  'research notes',
  'writer_contract',
  'facts_must_not_invent',
];

console.log('=== Prompt build leakage regression ===\n');

for (const fixture of FIXTURES) {
  const ctx = buildStructuredContext(fixture.topic as never);
  const research = buildResearchPack(fixture.topic as never, ctx);
  const digest = buildFactsDigest(research);
  const lower = digest.toLowerCase();

  for (const ban of BANNED) {
    assert.equal(
      lower.includes(ban),
      false,
      `[${fixture.label}] facts digest contains banned "${ban}"\nDIGEST:\n${digest.slice(0, 500)}`
    );
  }

  // Simulate section prompt
  const sectionPrompt = sanitizePromptText(
    `FACTS:\n${digest}\nREADER: General\nPURPOSE: guide`
  ).text.toLowerCase();
  for (const ban of BANNED) {
    assert.equal(
      sectionPrompt.includes(ban),
      false,
      `[${fixture.label}] section prompt contains "${ban}"`
    );
  }

  // known_facts must not use old label
  for (const fact of ctx.known_facts || []) {
    assert.equal(
      /indexed averages/i.test(fact),
      false,
      `[${fixture.label}] known_facts still uses Indexed averages: ${fact}`
    );
  }

  console.log(`OK  ${fixture.label.padEnd(12)} digest_chars=${digest.length}`);
}

// Repair path: leaked draft → clean
const leaked: WriterDraftPayload = {
  seo_title: 'India guide',
  meta_title: 'India guide',
  meta_description: 'Cost of living guide for India with practical budgeting notes.',
  excerpt: 'Practical budgeting for a move to India.',
  blocks: [
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Indexed averages for India show housing pressure in big cities, so build a rent-first budget before you commit.',
    },
    {
      id: 'p2',
      type: 'paragraph',
      content:
        'Food and transport usually come next. Cross-check neighbourhood quotes before you finalize a monthly total.',
    },
  ],
};

assert.ok(detectPromptLeakage(leaked.blocks[0].content as string).includes('indexed averages'));

const repaired = await repairPromptLeakage({
  draft: leaked,
  complete: async () =>
    JSON.stringify({
      content:
        'India cost indices put housing first in large cities, so start with rent and deposits before locking a monthly plan.',
    }),
});

assert.equal(repaired.report.before_hits.includes('indexed averages'), true);
assert.equal(
  detectPromptLeakage(
    repaired.draft.blocks.map((b) => (typeof b.content === 'string' ? b.content : '')).join(' ')
  ).includes('indexed averages'),
  false,
  'indexed averages must be gone after repair'
);

console.log('\nOK  leakage repair removed "indexed averages"');
console.log('\nAll leakage regression fixtures passed.');
