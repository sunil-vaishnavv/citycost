/**
 * Writer v2 Quality Gates regression — Content Memory / Cross-section /
 * Human writing / Actionable value / Final Sanitizer.
 *
 * Fixtures: BAD drafts (repeated facts, AI phrases, definition-only,
 * broken punctuation/numbers) → gates repair → assert PASS.
 * Also dry-runs every guide type through the gate pipeline.
 *
 * Run: npx tsx scripts/writer-v2-quality-gates-regression.ts
 */
import assert from 'node:assert/strict';
import type { DraftBlock, WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import type { GuideId } from '../lib/editorial-engine/writer/v2/types.js';
import { resetBlockIdFactoryForTests } from '../lib/editorial-engine/writer/v2/block-integrity.js';
import {
  runPreSaveQualityGates,
  formatQualityGatesDebug,
} from '../lib/editorial-engine/writer/v2/quality-gates.js';
import { checkCrossSectionSimilarity } from '../lib/editorial-engine/writer/v2/cross-section-similarity.js';
import {
  detectHumanWritingIssues,
  humanizeDeterministic,
} from '../lib/editorial-engine/writer/v2/humanization.js';
import { detectAiPhrases } from '../lib/editorial-engine/writer/v2/ai-phrase-blacklist.js';
import {
  applyActionableValueBlocks,
  validateActionableValue,
  GUIDE_VALUE_BLOCK_REGISTRY,
} from '../lib/editorial-engine/writer/v2/actionable-value-blocks.js';
import {
  runFinalSanitizer,
  validateSentenceIntegrity,
  validateNumericSanity,
  validateFormatting,
  validateParagraphIntegrity,
} from '../lib/editorial-engine/writer/v2/final-sanitizer.js';
import { applyContentMemoryPass } from '../lib/editorial-engine/writer/v2/content-memory.js';
import { similarityScore } from '../lib/editorial-engine/writer/v2/content-quality/text-metrics.js';
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
            a: 'Yes — start with rent, then essentials. Confirm one local quote and decide your contingency before you commit.',
          },
        ],
      },
      {
        id: 'summary',
        type: 'summary',
        content:
          'Recap: housing usually dominates. Decide your rent band first, then size food and transport. Next step: collect two quotes and revise the total.',
      },
    ],
  };
}

const REPEATED_FACT =
  'The Cost Index is 45.2 and measures how expensive the city is relative to New York. Rent Index is 18.7 and represents typical apartment costs versus the baseline.';

function fixtureRepeatedFacts(): WriterDraftPayload {
  return baseDraft([
    {
      id: 'h1',
      type: 'heading',
      heading: 'Housing',
      content: 'Housing',
    },
    {
      id: 'p1',
      type: 'paragraph',
      content: `${REPEATED_FACT} When evaluating a lease, it is important to note the deposit months.`,
    },
    {
      id: 'h2',
      type: 'heading',
      heading: 'City Snapshot',
      content: 'City Snapshot',
    },
    {
      id: 'p2',
      type: 'paragraph',
      content: `${REPEATED_FACT} Ultimately, the same Cost Index is 45.2 explains affordability across the board.`,
    },
    {
      id: 'h3',
      type: 'heading',
      heading: 'Monthly Budget',
      content: 'Monthly Budget',
    },
    {
      id: 'p3',
      type: 'paragraph',
      content: `${REPEATED_FACT} A common mistake is treating the Rent Index is 18.7 as your personal rent quote.`,
    },
  ]);
}

function fixtureAiPhrases(): WriterDraftPayload {
  return baseDraft([
    {
      id: 'h1',
      type: 'heading',
      heading: 'Overview',
      content: 'Overview',
    },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'When evaluating the cost of living, it is important to note that navigating the landscape can feel complex. In today\'s world, you should leverage robust planning.',
    },
    {
      id: 'h2',
      type: 'heading',
      heading: 'Housing costs',
      content: 'Housing costs',
    },
    {
      id: 'p2',
      type: 'paragraph',
      content:
        'Additionally, when it comes to rent, a tapestry of fees appears. Ultimately, at the end of the day you need a buffer. In conclusion, dive deep into local quotes.',
    },
  ]);
}

function fixtureDefinitionOnly(): WriterDraftPayload {
  return baseDraft([
    {
      id: 'h1',
      type: 'heading',
      heading: 'What is cost of living',
      content: 'What is cost of living',
    },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Cost of living is a measure of how expensive it is to maintain a certain standard of living. It refers to housing, food, and transport averages published for cities.',
    },
    {
      id: 'h2',
      type: 'heading',
      heading: 'What is an index',
      content: 'What is an index',
    },
    {
      id: 'p2',
      type: 'paragraph',
      content:
        'An index is a relative score that can be defined as a comparison against a baseline city. It consists of category weights and published averages.',
    },
  ]);
}

function fixtureBrokenFormatting(): WriterDraftPayload {
  return baseDraft([
    {
      id: 'h1',
      type: 'heading',
      heading: 'Numbers',
      content: 'Numbers',
    },
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'Rent sits near USD USD 1200..50 and the Cost Index: . while growth hit 50000%. See <div>details</div> and [empty]() plus 12.34.56 as a broken figure. NaN appears if data is missing.',
    },
    {
      id: 'p-empty',
      type: 'paragraph',
      content: '   ',
    },
    {
      id: 'h1-dup',
      type: 'heading',
      heading: 'Numbers',
      content: 'Numbers',
    },
  ]);
}

function thinGuideBody(guideId: GuideId): DraftBlock[] {
  const place = guideId === 'comparison' ? 'City A' : 'the destination';
  return [
    {
      id: 'h1',
      type: 'heading',
      heading: `${guideId} overview`,
      content: `${guideId} overview`,
    },
    {
      id: 'p1',
      type: 'paragraph',
      content: `Planning costs in ${place} starts with housing, then food and transport. Confirm one local quote before you commit cash.`,
    },
    {
      id: 'h2',
      type: 'heading',
      heading: 'Practical next steps',
      content: 'Practical next steps',
    },
    {
      id: 'p2',
      type: 'paragraph',
      content: `So what: averages are a baseline for ${place}. What you should do: decide your rent band and buffer. When this matters: before you sign.`,
    },
  ];
}

function assertFourGates(label: string, draft: WriterDraftPayload, guideId: GuideId): void {
  const result = runPreSaveQualityGates({
    draft,
    guideId,
    country: 'Testland',
    city: 'Testville',
    city_b: guideId === 'comparison' ? 'Altville' : undefined,
  });

  assert.equal(
    result.report.ok,
    true,
    `${label}: quality gates should PASS — ${formatQualityGatesDebug(result.report)}`
  );
  assert.equal(result.report.block_save, false, `${label}: should not block save`);
  assert.ok(result.report.human_writing_ok, `${label}: human writing`);
  assert.ok(result.report.sanitizer.ok, `${label}: sanitizer`);
  assert.ok(result.report.helpful_ok, `${label}: helpful/actionable`);
  assert.ok(
    validateActionableValue(result.draft, guideId).ok,
    `${label}: actionable value blocks present`
  );

  const residualAi = detectAiPhrases(draftBodyText(result.draft));
  assert.equal(residualAi.length, 0, `${label}: residual AI phrases ${residualAi.join(',')}`);
}

console.log('=== Writer v2 Quality Gates regression ===\n');

// --- Gap 1: repeated facts ---
{
  resetBlockIdFactoryForTests();
  const bad = fixtureRepeatedFacts();
  const beforeSim = similarityScore(
    String(bad.blocks.find((b) => b.id === 'p1')?.content),
    String(bad.blocks.find((b) => b.id === 'p2')?.content)
  );
  assert.ok(beforeSim >= 0.6, `fixture should be highly similar before=${beforeSim}`);

  const mem = applyContentMemoryPass(bad);
  assert.ok(mem.sectionsRewritten >= 1, 'content memory should rewrite duplicate sections');

  const cross = checkCrossSectionSimilarity(bad, { repair: true });
  assert.ok(cross.report.sections_rewritten >= 1, 'cross-section should rewrite');
  assert.ok(cross.report.ok, `cross-section ok after repair: ${cross.report.max_similarity}`);

  assertFourGates('repeated_facts', bad, 'city');
  console.log('PASS  Gap1 repeated facts / content memory / cross-section');
}

// --- Gap 2: AI phrases / human writing ---
{
  resetBlockIdFactoryForTests();
  const bad = fixtureAiPhrases();
  const before = detectAiPhrases(draftBodyText(bad));
  assert.ok(before.length >= 3, `fixture should have AI phrases, got ${before.length}`);

  const fixed = humanizeDeterministic(bad, 'budget');
  const afterDetect = detectHumanWritingIssues(fixed);
  assert.ok(afterDetect.ok, `humanize should clear phrases: ${afterDetect.residual.join(',')}`);

  assertFourGates('ai_phrases', bad, 'budget');
  console.log('PASS  Gap2 human writing / AI phrase blacklist');
}

// --- Gap 3: definition-only → actionable value ---
{
  resetBlockIdFactoryForTests();
  const bad = fixtureDefinitionOnly();
  const before = validateActionableValue(bad, 'rent');
  assert.ok(!before.ok, 'definition-only fixture should fail actionable value');

  const applied = applyActionableValueBlocks({
    draft: bad,
    guideId: 'rent',
    entities: { city: 'Testville' },
  });
  assert.ok(applied.report.blocks_added >= 1, 'should add actionable blocks');
  assert.ok(validateActionableValue(applied.draft, 'rent').ok, 'after apply should pass');

  assertFourGates('definition_only', bad, 'rent');
  console.log('PASS  Gap3 actionable value / helpful content');
}

// --- Gap 4: broken formatting / numeric / sentence / paragraph ---
{
  resetBlockIdFactoryForTests();
  const bad = fixtureBrokenFormatting();

  const sent = validateSentenceIntegrity(bad);
  assert.ok(sent.result.repaired >= 1, 'sentence integrity should repair');

  const para = validateParagraphIntegrity(sent.draft);
  assert.ok(para.result.repaired >= 1, 'paragraph integrity should remove empty/dup headings');

  const num = validateNumericSanity(para.draft);
  assert.ok(num.result.repaired >= 1 || num.result.ok, 'numeric sanity should repair');

  const fmt = validateFormatting(num.draft);
  assert.ok(fmt.result.ok, 'formatting should pass after repair');

  const san = runFinalSanitizer(bad);
  assert.ok(san.report.ok, `final sanitizer ok: ${JSON.stringify(san.report)}`);
  const body = draftBodyText(san.draft);
  assert.ok(!/\bNaN\b/.test(body), 'NaN removed');
  assert.ok(!/<div>/i.test(body), 'HTML stripped');
  assert.ok(!/\.\./.test(body), 'double periods removed');

  assertFourGates('broken_formatting', bad, 'salary');
  console.log('PASS  Gap4 final sanitizer (sentence/paragraph/numeric/formatting)');
}

// --- All guide types dry-run through gate pipeline ---
{
  console.log('\n--- Guide type dry-runs ---');
  for (const guideId of GUIDE_TYPES) {
    resetBlockIdFactoryForTests();
    assert.ok(
      GUIDE_VALUE_BLOCK_REGISTRY[guideId]?.length,
      `${guideId} must have value block templates`
    );
    const draft = baseDraft(thinGuideBody(guideId));
    // Inject some AI phrases + light repetition to force repair path
    const blocks = [...(draft.blocks || [])];
    const pIdx = blocks.findIndex((b) => b.id === 'p1');
    if (pIdx >= 0 && typeof blocks[pIdx].content === 'string') {
      blocks[pIdx] = {
        ...blocks[pIdx],
        content: `When evaluating options, it is important to note that ${blocks[pIdx].content}`,
      };
    }
    const dirty: WriterDraftPayload = { ...draft, blocks };
    assertFourGates(`guide:${guideId}`, dirty, guideId);
    console.log(`PASS  guide:${guideId}`);
  }
}

console.log('\n=== ALL quality gate regressions PASS ===');
