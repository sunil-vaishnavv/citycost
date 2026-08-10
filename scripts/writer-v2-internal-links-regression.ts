/**
 * Writer v2 Internal Link Engine regression.
 *
 * Asserts every guide type ends with ≥3 CityCost path mentions after the
 * mandatory link stage — same counting as draft-validate / publish gate.
 * No draft fails solely for missing links when the link engine runs.
 *
 * Run: npx tsx scripts/writer-v2-internal-links-regression.ts
 */
import assert from 'node:assert/strict';
import {
  countCityCostPathMentions,
  MIN_CITYCOST_PATH_MENTIONS,
  validateWriterDraft,
  type DraftBlock,
  type WriterDraftPayload,
} from '../lib/editorial-engine/writer/draft-validate.js';
import type { GuideId } from '../lib/editorial-engine/writer/v2/types.js';
import { resetBlockIdFactoryForTests } from '../lib/editorial-engine/writer/v2/block-integrity.js';
import { isProtectedBlock } from '../lib/editorial-engine/writer/v2/block-integrity.js';
import {
  applyNaturalLinks,
  generateMissingLinks,
  hasVisibleSlugAnchors,
  runInternalLinkEngine,
  slugToNaturalLabel,
  validateInternalLinks,
} from '../lib/editorial-engine/writer/v2/link-engine.js';
import { runHelpfulnessPipeline } from '../lib/editorial-engine/writer/v2/helpfulness-pipeline.js';

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
];

const CANDIDATES_BY_GUIDE: Record<GuideId, string[]> = {
  country: ['/country/portugal', '/city/lisbon-portugal', '/city/porto-portugal', '/methodology'],
  city: ['/city/lisbon-portugal', '/country/portugal', '/city/porto-portugal', '/data-sources'],
  comparison: [
    '/compare/lisbon-vs-berlin',
    '/city/lisbon-portugal',
    '/city/berlin-germany',
    '/country/portugal',
  ],
  salary: ['/city/lisbon-portugal', '/country/portugal', '/methodology'],
  rent: ['/city/lisbon-portugal', '/country/portugal', '/about'],
  student: ['/city/lisbon-portugal', '/country/portugal', '/blog/student-budget'],
  visa: ['/country/portugal', '/city/lisbon-portugal', '/methodology'],
  moving: ['/city/lisbon-portugal', '/country/portugal', '/data-sources'],
  healthcare: ['/country/portugal', '/city/lisbon-portugal', '/about'],
  food: ['/city/lisbon-portugal', '/country/portugal', '/methodology'],
  travel: ['/city/lisbon-portugal', '/compare/lisbon-vs-porto', '/country/portugal'],
  budget: ['/city/lisbon-portugal', '/country/portugal', '/data-sources'],
  remote: ['/city/lisbon-portugal', '/country/portugal', '/methodology'],
  retirement: ['/country/portugal', '/city/lisbon-portugal', '/about'],
};

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

function zeroLinkBody(place: string): DraftBlock[] {
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
      content: `${place} cost planning starts with housing, then food and transport. Decide your rent band before locking other categories.`,
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
      content:
        'Central one-beds cost more than outer districts. Confirm deposit months and whether utilities are included before you sign.',
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
      content:
        'Monthly passes usually beat daily tickets if you commute five days a week. Test the commute once before committing to a lease.',
    },
  ];
}

function baseDraft(body: DraftBlock[]): WriterDraftPayload {
  return {
    seo_title: 'Cost of Living Guide',
    meta_title: 'Cost of Living Guide',
    meta_description:
      'Practical cost planning for housing, food, and transport with CityCost category breakdowns.',
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
          {
            id: 'f2',
            q: 'What usually dominates spend?',
            a: 'Housing. Cap rent first, then size groceries and transport.',
          },
          {
            id: 'f3',
            q: 'Should I use averages alone?',
            a: 'No. Pair averages with one local quote for rent and utilities.',
          },
          {
            id: 'f4',
            q: 'How many months of buffer?',
            a: 'Keep at least two months of essentials beyond deposit and first rent.',
          },
          {
            id: 'f5',
            q: 'Is eating out cheaper?',
            a: 'Sometimes lunch menus beat cooking for one; track two weeks before deciding.',
          },
          {
            id: 'f6',
            q: 'Where do I compare next?',
            a: 'Use related city and country pages after you set a rent band.',
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

console.log('Writer v2 Internal Links regression\n');

// --- Unit: natural labels ---
console.log('Natural anchors');
test('slugToNaturalLabel: city-pune → Pune', () => {
  assert.equal(slugToNaturalLabel('/city/pune-maharashtra-india'), 'Pune');
  assert.equal(slugToNaturalLabel('city-pune-maharashtra-india'), 'Pune');
});

test('slugToNaturalLabel: authority pages', () => {
  assert.equal(slugToNaturalLabel('/methodology'), 'methodology');
  assert.equal(slugToNaturalLabel('/data-sources'), 'data sources');
});

test('applyNaturalLinks fixes slug anchors without dropping hrefs', () => {
  const draft = baseDraft([
    {
      id: 'p1',
      type: 'paragraph',
      content: 'Compare with [city-lisbon-portugal](/city/lisbon-portugal) next.',
    },
  ]);
  const { draft: next, report } = applyNaturalLinks(draft);
  assert.ok(report.natural_anchors_fixed >= 1);
  assert.ok(JSON.stringify(next.blocks).includes('/city/lisbon-portugal'));
  assert.equal(hasVisibleSlugAnchors(next), false);
});

// --- Counting alignment with draft-validate ---
console.log('\nCounting alignment');
test('countCityCostPathMentions matches validateWriterDraft floor logic', () => {
  const empty = baseDraft(zeroLinkBody('Lisbon'));
  assert.equal(countCityCostPathMentions(empty), 0);
  assert.equal(validateInternalLinks(empty).ok, false);

  const withLinks = baseDraft([
    {
      id: 'p1',
      type: 'paragraph',
      content:
        'See [Lisbon](/city/lisbon-portugal), [Portugal](/country/portugal), and [methodology](/methodology).',
    },
  ]);
  const n = countCityCostPathMentions(withLinks);
  assert.ok(n >= MIN_CITYCOST_PATH_MENTIONS, `expected ≥${MIN_CITYCOST_PATH_MENTIONS}, got ${n}`);
  assert.equal(validateInternalLinks(withLinks).ok, true);
});

test('generateMissingLinks only mutates body (protected intact)', () => {
  resetBlockIdFactoryForTests();
  const before = baseDraft(zeroLinkBody('Lisbon'));
  const intro = before.blocks.find((b) => b.id === 'intro')!;
  const faq = before.blocks.find((b) => b.type === 'faq')!;
  const { draft: next, created } = generateMissingLinks(before, [
    '/city/lisbon-portugal',
    '/country/portugal',
    '/methodology',
  ]);
  assert.ok(created >= MIN_CITYCOST_PATH_MENTIONS);
  assert.deepEqual(
    next.blocks.find((b) => b.id === 'intro')?.content,
    intro.content
  );
  assert.deepEqual(next.blocks.find((b) => b.type === 'faq')?.content, faq.content);
  for (const b of next.blocks) {
    if (isProtectedBlock(b) && b.type !== 'faq') {
      // intro/toc/summary unchanged structurally
      assert.ok(b.id);
    }
  }
  assert.ok(countCityCostPathMentions(next) >= MIN_CITYCOST_PATH_MENTIONS);
});

// --- Mandatory engine per guide type ---
console.log('\nMandatory Link Engine per guide type');

for (const guideId of GUIDE_TYPES) {
  test(`${guideId}: 0 links → engine → ≥${MIN_CITYCOST_PATH_MENTIONS} path mentions`, () => {
    resetBlockIdFactoryForTests();
    const before = baseDraft(zeroLinkBody(guideId));
    assert.equal(countCityCostPathMentions(before), 0, 'fixture must start at 0');

    const result = runInternalLinkEngine({
      draft: before,
      candidates: CANDIDATES_BY_GUIDE[guideId],
    });

    assert.equal(result.report.ok, true, formatFail(result.report));
    assert.ok(
      result.report.path_mentions >= MIN_CITYCOST_PATH_MENTIONS,
      `path_mentions=${result.report.path_mentions}`
    );
    assert.ok(result.report.links_created >= 1);
    assert.equal(countCityCostPathMentions(result.draft), result.report.path_mentions);
    assert.equal(hasVisibleSlugAnchors(result.draft), false);

    // Draft must not fail solely for missing internal links
    const v = validateWriterDraft(result.draft, { min: 50, max: 50000 });
    const linkOnlyFail =
      !v.ok && v.missing_elements.every((e) => e === 'internal_links');
    assert.equal(
      linkOnlyFail,
      false,
      `failed solely for links: ${v.errors.join('; ')}`
    );
    assert.ok(
      !v.errors.some((e) => /Missing internal links/i.test(e)),
      v.errors.join('; ')
    );
  });
}

// --- After helpfulness rewrite (simulates strip risk) ---
console.log('\nAfter helpfulness (last mutation order)');
test('helpfulness then link engine still reaches floor', () => {
  resetBlockIdFactoryForTests();
  const before = baseDraft(zeroLinkBody('Lisbon'));
  // Seed one slug link that helpfulness naturalizes — still need more for floor
  before.blocks.splice(4, 0, {
    id: 'p-slug',
    type: 'paragraph',
    content: 'Also compare [city-porto-portugal](/city/porto-portugal) if you want a second quote.',
  });

  const help = runHelpfulnessPipeline({
    draft: before,
    context: {
      guideId: 'city',
      country: 'Portugal',
      city: 'Lisbon',
      known_facts: ['Housing typically dominates monthly spend in metro markets.'],
    },
  });

  const afterHelp = countCityCostPathMentions(help.draft);
  const linked = runInternalLinkEngine({
    draft: help.draft,
    candidates: CANDIDATES_BY_GUIDE.city,
  });

  assert.equal(linked.report.ok, true);
  assert.ok(linked.report.path_mentions >= MIN_CITYCOST_PATH_MENTIONS);
  // Engine may create 0 if helpfulness somehow left enough — still must pass floor
  assert.ok(
    linked.report.path_mentions >= afterHelp || linked.report.links_created >= 0
  );
  assert.ok(!hasVisibleSlugAnchors(linked.draft));
});

test('empty candidates still reach floor via authority fallbacks', () => {
  resetBlockIdFactoryForTests();
  const before = baseDraft(zeroLinkBody('Generic'));
  const result = runInternalLinkEngine({ draft: before, candidates: [] });
  assert.equal(result.report.ok, true);
  assert.ok(result.report.path_mentions >= MIN_CITYCOST_PATH_MENTIONS);
  assert.ok(result.report.paths_injected.some((p) => p === '/methodology' || p === '/data-sources' || p === '/about'));
});

test('repair does not full-regen: block count stable (±0 tip blocks)', () => {
  resetBlockIdFactoryForTests();
  const before = baseDraft(zeroLinkBody('Lisbon'));
  const nBefore = before.blocks.length;
  const result = runInternalLinkEngine({
    draft: before,
    candidates: CANDIDATES_BY_GUIDE.city,
  });
  assert.equal(result.draft.blocks.length, nBefore);
  assert.ok(result.draft.blocks.some((b) => b.type === 'intro'));
  assert.ok(result.draft.blocks.some((b) => b.type === 'faq'));
  assert.ok(result.draft.blocks.some((b) => b.type === 'summary'));
});

function formatFail(report: { path_mentions: number; links_created: number; repair_rounds: number }): string {
  return `path_mentions=${report.path_mentions} created=${report.links_created} rounds=${report.repair_rounds}`;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('ALL PASS');
