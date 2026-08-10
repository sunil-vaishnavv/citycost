/**
 * Writer v2 Helpfulness regression — bad-draft fixtures → engine upgrades → validators.
 * Guide types: Country, City, Comparison, Salary, Rent, Student, Visa, Moving,
 * Healthcare, Food, Travel, Budget, Remote, Retirement.
 *
 * Run: npx tsx scripts/writer-v2-helpfulness-regression.ts
 */
import assert from 'node:assert/strict';
import type { DraftBlock, WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import type { GuideId } from '../lib/editorial-engine/writer/v2/types.js';
import { resetBlockIdFactoryForTests, snapshotProtected } from '../lib/editorial-engine/writer/v2/block-integrity.js';
import { isProtectedBlock } from '../lib/editorial-engine/writer/v2/block-integrity.js';
import { runHelpfulnessPipeline } from '../lib/editorial-engine/writer/v2/helpfulness-pipeline.js';
import { slugToNaturalLabel, hasVisibleSlugAnchors, applyNaturalLinks } from '../lib/editorial-engine/writer/v2/link-engine.js';
import { draftHasDecisionGuidance } from '../lib/editorial-engine/writer/v2/decision-support-engine.js';
import { scoreHelpfulDraft, sectionHasPracticalAdvice } from '../lib/editorial-engine/writer/v2/helpful-content.js';
import { sectionHasExample } from '../lib/editorial-engine/writer/v2/example-engine.js';
import {
  validateRealExamples,
  validateNaturalLinks,
  validateDecisionGuidance,
  validateHelpfulContentV2,
  runHelpfulnessValidators,
  MAX_NO_ADVICE_RATIO,
  MAX_DEFINITION_ONLY_RATIO,
} from '../lib/editorial-engine/writer/v2/helpfulness-validators.js';
import { draftSectionChunks } from '../lib/editorial-engine/writer/v2/section-chunks.js';
import { draftBodyText } from '../lib/editorial-engine/reviewer/text-utils.js';

const GUIDE_TYPES: GuideId[] = [
  'country',
  'city',
  'comparison',
  'salary',
  'rent',
  'student',
  'visa',
  'moving',
  'healthcare',
  'food',
  'travel',
  'budget',
  'remote',
  'retirement',
];

function baseDraft(body: DraftBlock[]): WriterDraftPayload {
  return {
    seo_title: 'Cost of Living Guide',
    meta_title: 'Cost of Living Guide',
    meta_description: 'Practical cost planning.',
    excerpt: 'Practical cost planning.',
    blocks: [
      {
        id: 'intro',
        type: 'intro',
        content:
          'This guide helps you plan monthly costs with housing, food, and transport as the main levers.',
      },
      {
        id: 'toc',
        type: 'list',
        heading: 'Table of contents',
        content: ['Overview', 'Housing', 'Transport', 'FAQ'],
      },
      ...body,
      {
        id: 'faq',
        type: 'faq',
        heading: 'FAQ',
        content: [
          {
            id: 'f1',
            q: 'How should I start budgeting?',
            a: 'Start with rent, then essentials. Confirm one local quote before you commit.',
          },
        ],
      },
      {
        id: 'summary',
        type: 'summary',
        content: 'Recap: housing usually dominates. Decide your rent band first.',
      },
    ],
  };
}

/** Intentionally bad: definition-only, slug anchors, no decision guidance. */
function badBody(placeLabel: string): DraftBlock[] {
  return [
    {
      id: 'h-overview',
      type: 'heading',
      heading: 'Overview',
      content: 'Overview',
    },
    {
      id: 'p-overview',
      type: 'paragraph',
      content: `Cost of living is a measure of how expensive it is to maintain a standard of living. Cost of living is defined as the amount required for basic goods and services. Cost of living refers to household expenditure patterns across categories.`,
    },
    {
      id: 'h-housing',
      type: 'heading',
      heading: 'Housing',
      content: 'Housing',
    },
    {
      id: 'p-housing',
      type: 'paragraph',
      content: `Housing is an important factor in any relocation. Housing is a category that includes rent and utilities. See [city-pune-maharashtra-india](/city/pune-maharashtra-india) and [country-india](/country/india) for more. Also visit city-lisbon-portugal for context on ${placeLabel}.`,
    },
    {
      id: 'h-transport',
      type: 'heading',
      heading: 'Transport',
      content: 'Transport',
    },
    {
      id: 'p-transport',
      type: 'paragraph',
      content: `Transport is the movement of people from one place to another. Transport is a key component of urban infrastructure. Transport refers to buses, trains, and roads in general terms.`,
    },
  ];
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

function assertProtectedIntact(before: WriterDraftPayload, after: WriterDraftPayload): void {
  const snap = snapshotProtected(before.blocks || []);
  const afterBlocks = after.blocks || [];
  assert.ok(
    afterBlocks.some((b) => b.type === 'intro' && b.id === 'intro'),
    'intro protected'
  );
  assert.ok(
    afterBlocks.some((b) => b.id === 'toc'),
    'toc protected'
  );
  assert.ok(
    afterBlocks.some((b) => b.type === 'faq' && b.id === 'faq'),
    'faq protected'
  );
  assert.ok(
    afterBlocks.some((b) => b.type === 'summary' && b.id === 'summary'),
    'summary protected'
  );
  const intro = afterBlocks.find((b) => b.id === 'intro');
  assert.equal(intro?.content, snap.intro?.content, 'intro content unchanged');
}

console.log('\n=== Writer v2 Helpfulness regression ===\n');

resetBlockIdFactoryForTests();

// --- Unit: slug → natural label ---
console.log('Link engine units');

test('slugToNaturalLabel: city-pune-maharashtra-india → Pune', () => {
  assert.equal(slugToNaturalLabel('city-pune-maharashtra-india'), 'Pune');
  assert.equal(slugToNaturalLabel('/city/pune-maharashtra-india'), 'Pune');
  assert.equal(slugToNaturalLabel('country-india'), 'India');
  assert.equal(slugToNaturalLabel('/country/india'), 'India');
  assert.equal(slugToNaturalLabel('berlin-vs-lisbon'), 'Berlin vs Lisbon');
});

test('applyNaturalLinks removes slug anchors from visible text', () => {
  const draft = baseDraft(badBody('Portugal'));
  assert.equal(hasVisibleSlugAnchors(draft), true);
  const { draft: fixed, report } = applyNaturalLinks(draft);
  assert.ok(report.natural_anchors_fixed > 0, 'should fix anchors');
  assert.equal(hasVisibleSlugAnchors(fixed), false);
  const body = draftBodyText(fixed);
  assert.ok(!/city-pune-maharashtra-india/i.test(body), 'no city slug');
  assert.ok(!/country-india/i.test(body), 'no country slug');
  assert.ok(/\bPune\b/.test(body) || /\[Pune\]/.test(body), 'natural Pune anchor');
});

// --- Validators reject bad drafts ---
console.log('\nValidators on bad drafts');

test('validators: bad draft fails decision + helpful + links', () => {
  const draft = baseDraft(badBody('Testland'));
  const links = validateNaturalLinks(draft);
  assert.equal(links.ok, false);
  const decision = validateDecisionGuidance(draft);
  assert.equal(decision.ok, false);
  const helpful = validateHelpfulContentV2(draft);
  assert.equal(helpful.ok, false);
  assert.ok(
    helpful.findings.some((f) => f.code === 'too_little_practical_advice' || f.code === 'too_many_definitions')
  );
});

// --- Full pipeline per guide type ---
console.log('\nPipeline per guide type');

for (const guideId of GUIDE_TYPES) {
  test(`${guideId}: upgrades bad draft → practical value + no slugs + decisions`, () => {
    resetBlockIdFactoryForTests();
    const before = baseDraft(badBody(guideId));
    const scoreBefore = scoreHelpfulDraft(before);

    // Confirm bad fixture traits
    assert.equal(hasVisibleSlugAnchors(before), true);
    assert.equal(draftHasDecisionGuidance(before), false);
    assert.ok(scoreBefore.missingAdviceRatio > MAX_NO_ADVICE_RATIO || scoreBefore.definitionOnlyRatio > 0);

    const entities =
      guideId === 'comparison'
        ? { country: 'Portugal', city: 'Lisbon', city_b: 'Berlin' }
        : guideId === 'city'
          ? { country: 'Portugal', city: 'Lisbon' }
          : { country: 'Portugal', city: guideId === 'country' ? undefined : 'Lisbon' };

    const result = runHelpfulnessPipeline({
      draft: before,
      context: {
        guideId,
        ...entities,
        known_facts: [
          'Housing typically dominates monthly spend in metro markets.',
          'Confirm deposit months and whether utilities are included.',
        ],
      },
    });

    const after = result.draft;
    assertProtectedIntact(before, after);

    // No slug anchors
    assert.equal(hasVisibleSlugAnchors(after), false, 'slug anchors remain');
    assert.equal(validateNaturalLinks(after).ok, true);

    // Decision guidance exists
    assert.equal(draftHasDecisionGuidance(after), true, 'missing decision guidance');
    assert.equal(validateDecisionGuidance(after).ok, true);

    // Examples exist (engine added tip blocks and/or detectable example prose)
    const chunks = draftSectionChunks(after);
    const withExample = chunks.filter((c) => sectionHasExample(c.text)).length;
    assert.ok(
      withExample > 0 || result.report.examples_added > 0,
      'no examples added'
    );
    assert.equal(validateRealExamples(after, guideId).ok, true);

    // Helpful score improves + thresholds
    const scoreAfter = scoreHelpfulDraft(after);
    assert.ok(
      scoreAfter.score > scoreBefore.score,
      `score did not improve ${scoreBefore.score} -> ${scoreAfter.score}`
    );
    assert.ok(
      scoreAfter.missingAdviceRatio <= MAX_NO_ADVICE_RATIO,
      `missing advice ratio ${scoreAfter.missingAdviceRatio}`
    );
    assert.ok(
      scoreAfter.definitionOnlyRatio <= MAX_DEFINITION_ONLY_RATIO,
      `definition-only ratio ${scoreAfter.definitionOnlyRatio}`
    );

    const helpfulVal = validateHelpfulContentV2(after);
    assert.equal(helpfulVal.ok, true, helpfulVal.findings.map((f) => f.code).join(','));

    // Pipeline should not block
    assert.equal(result.block_save, false, result.report.block_reasons.join('|'));

    // Debug counters present — decisions may already be embedded in examples
    assert.ok(result.report.examples_added >= 1 || withExample >= 1);
    assert.ok(
      result.report.decision_blocks_added >= 1 || draftHasDecisionGuidance(after),
      'no decision guidance added'
    );
    assert.ok(result.report.natural_anchors_fixed >= 1);
    assert.ok(result.report.sections_upgraded.length >= 1);

    // Practical advice in most sections
    const withAdvice = chunks.filter((c) => sectionHasPracticalAdvice(c.text)).length;
    assert.ok(withAdvice / Math.max(1, chunks.length) >= 0.7, 'too few practical sections');

    // Body still has non-protected content
    assert.ok((after.blocks || []).some((b) => !isProtectedBlock(b) && b.type === 'tip'));
  });
}

// --- Before vs after snapshot (country) ---
console.log('\nBefore vs after snapshot');

test('country before/after: encyclopedia → journalist practical', () => {
  resetBlockIdFactoryForTests();
  const before = baseDraft(badBody('Portugal'));
  const beforeText = draftBodyText(before);
  assert.ok(/is a measure of how expensive/i.test(beforeText));
  assert.ok(/city-pune-maharashtra-india/i.test(beforeText));

  const { draft: after, report } = runHelpfulnessPipeline({
    draft: before,
    context: {
      guideId: 'country',
      country: 'Portugal',
      known_facts: ['Metro rent usually moves more than groceries across city tiers.'],
    },
  });
  const afterText = draftBodyText(after);

  assert.ok(!/city-pune-maharashtra-india/i.test(afterText));
  assert.ok(/So what:/i.test(afterText) || /What you should do:/i.test(afterText));
  assert.ok(/Real-world example|Practical checklist|Common mistake|Money-saving|Decision guidance/i.test(afterText));
  assert.ok(report.helpful_score_after > report.helpful_score_before);

  // Validators all green
  const v = runHelpfulnessValidators(after, 'country');
  assert.equal(v.block_save, false, v.block_reasons.join('|'));
});

// --- Threshold constants documented ---
test('reject thresholds are 30% no-advice / 20% definition-only', () => {
  assert.equal(MAX_NO_ADVICE_RATIO, 0.3);
  assert.equal(MAX_DEFINITION_ONLY_RATIO, 0.2);
});

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
console.log('PASS');
