/**
 * Selftest: body-only near-duplicate detector + decision gates (no live AI).
 *
 * Cases:
 * 1) Country guide vs country guide — shared headings/TOC/FAQ, different body → PASS
 * 2) City / comparison guides — same pattern → PASS
 * 3) Regenerated article (~0.92 body overlap) → Warning only
 * 4) Near-identical copied body (>=0.95) → Manual Review
 * 5) Legacy 0.833 similarity must NOT force needs_manual_review
 */
import {
  detectDuplicates,
  DUPLICATE_CRITICAL_THRESHOLD,
  DUPLICATE_WARNING_THRESHOLD,
  resolveCriticalThreshold,
  type DuplicateDetectorResult,
} from '../lib/editorial-engine/reviewer/duplicate-detector.ts';
import { assembleQualityReport } from '../lib/editorial-engine/reviewer/quality-report.ts';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.ts';
import type { RuleValidatorResult } from '../lib/editorial-engine/reviewer/rule-validator.ts';
import type { AiReviewerResult } from '../lib/editorial-engine/reviewer/ai-reviewer.ts';

function guideDraft(opts: {
  title: string;
  country: string;
  housing: string;
  transport: string;
  food: string;
}): WriterDraftPayload {
  return {
    seo_title: opts.title,
    meta_title: opts.title,
    meta_description: `Cost of living guide for ${opts.country}.`,
    excerpt: `Overview of living costs in ${opts.country}.`,
    blocks: [
      {
        id: 'intro',
        type: 'intro',
        content: `${opts.country} attracts movers for its lifestyle and relative affordability. This guide covers rent, transport, and daily costs with practical ranges.`,
      },
      { id: 'h1', type: 'heading', heading: 'Housing costs', content: 'Housing costs' },
      { id: 'p1', type: 'paragraph', content: opts.housing },
      { id: 'h2', type: 'heading', heading: 'Transport', content: 'Transport' },
      { id: 'p2', type: 'paragraph', content: opts.transport },
      { id: 'h3', type: 'heading', heading: 'Food and groceries', content: 'Food and groceries' },
      { id: 'p3', type: 'paragraph', content: opts.food },
      {
        id: 'toc',
        type: 'list',
        heading: 'Table of Contents',
        content: ['Housing costs', 'Transport', 'Food and groceries', 'FAQ'],
      },
      {
        id: 'faq',
        type: 'faq',
        content: [
          { q: 'Is housing expensive?', a: `Housing in ${opts.country} varies by city and neighborhood.` },
          { q: 'How much for transport?', a: `Monthly passes are common in major ${opts.country} cities.` },
        ],
      },
      {
        id: 'cta',
        type: 'paragraph',
        content: 'Compare cost of living now with our free calculator.',
      },
      {
        id: 'sum',
        type: 'summary',
        content: `Compare rent first when budgeting a move to ${opts.country}, then transport and groceries.`,
      },
    ],
  };
}

const emptyRules: RuleValidatorResult = {
  passed: true,
  score: 85,
  critical_fail: false,
  findings: [],
  failed_rules: [],
  auto_fixable: [],
  warnings: [],
  seo_pass: true,
};

const passAi: AiReviewerResult = {
  passed: true,
  score: 82,
  scores: {
    readability: 78,
    eeat: 75,
    search_intent: 80,
    human_writing: 76,
    helpful_content: 79,
  },
  issues: [],
  rewrite_required: false,
  summary: 'ok',
  raw: {},
};

const softScores = {
  score: 80,
  findings: [] as string[],
};

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function runPair(
  label: string,
  a: WriterDraftPayload,
  b: WriterDraftPayload,
  contentType: string
): DuplicateDetectorResult {
  const result = detectDuplicates({
    draft: a,
    articleId: 1,
    threshold: DUPLICATE_CRITICAL_THRESHOLD,
    contentType,
    candidates: [
      {
        id: 2,
        slug: 'other-guide',
        seo_title: b.seo_title,
        excerpt: b.excerpt,
        draft_json: b,
        content_type: contentType,
      },
    ],
  });
  console.log(
    JSON.stringify(
      {
        case: label,
        decision: result.decision,
        max_similarity: result.max_similarity,
        is_duplicate: result.is_duplicate,
        is_warning: result.is_warning,
        matching_sections: result.matching_sections,
        matched: result.matched_article,
      },
      null,
      2
    )
  );
  return result;
}

function main() {
  assert(resolveCriticalThreshold(0.82) === DUPLICATE_CRITICAL_THRESHOLD, 'legacy 0.82 must clamp to 0.95');
  assert(resolveCriticalThreshold(0.93) === 0.93, 'custom critical above warning must keep');
  assert(DUPLICATE_WARNING_THRESHOLD === 0.9, 'warning threshold');

  // 1) Country guides — shared structure, different body
  const chile = guideDraft({
    title: 'Chile Cost of Living & Rent Guide',
    country: 'Chile',
    housing:
      'In Santiago, one-bedroom apartments in Providencia often run higher than neighborhoods farther from the metro. Expect larger deposits outside furnished tourist flats, and utilities climb in winter when heating is needed in southern cities.',
    transport:
      'Santiago metro and buses cover most commuting needs; intercity buses connect Valparaíso and regional hubs affordably. Ride-hail is widely available but adds up for daily use compared with a monthly transit pass.',
    food: 'Local markets keep produce affordable; imported goods and dining in Las Condes cost more. A single person cooking at home can keep groceries moderate while eating out regularly raises the monthly food line quickly.',
  });
  const peru = guideDraft({
    title: 'Peru Cost of Living & Rent Guide',
    country: 'Peru',
    housing:
      'Lima districts like Miraflores command premium rents versus inland cities. Contracts often ask for guarantees through local banks, and older buildings may lack consistent hot water, so factor building age into total housing cost.',
    transport:
      'Lima traffic stretches commute times; the Metropolitano and expanding metro help some corridors. Long-distance buses remain the practical choice for Cusco or Arequipa trips when flights are not necessary.',
    food: 'Peruvian markets offer excellent value for staples and seafood on the coast. Tourist restaurant strips inflate meal costs, while neighborhood menus del día keep weekday lunches inexpensive for residents.',
  });
  const country = runPair('country_guide_shared_headings', chile, peru, 'country_guide');
  assert(country.decision === 'pass', `country guides should PASS, got ${country.decision} (${country.max_similarity})`);
  assert(country.max_similarity < DUPLICATE_WARNING_THRESHOLD, 'country similarity must be below warning');

  // 2) City / comparison — shared headings, different prose
  const cityA = guideDraft({
    title: 'Berlin Cost of Living Guide',
    country: 'Berlin',
    housing:
      'Berlin rents vary sharply between Prenzlauer Berg and outer boroughs. Warmmiete includes heating in many listings, and competition for unfurnished flats remains intense for newcomers without Schufa history.',
    transport:
      'A monthly AB ticket covers U-Bahn, S-Bahn, and buses for most residents. Cycling infrastructure is strong, cutting everyday transport spend versus owning a car inside the ring.',
    food: 'Discounters keep grocery baskets reasonable; specialty stores and weekend brunch inflate spending. International products cost more than regional German brands in typical weekly shops.',
  });
  const cityB = guideDraft({
    title: 'Dublin Cost of Living Guide',
    country: 'Dublin',
    housing:
      'Dublin city-centre and docklands rents sit among Europe’s highest for similar space. Many listings are furnished; deposits and agency fees raise move-in cash needs beyond the first month’s rent.',
    transport:
      'Leap cards simplify buses and Luas; delays in peak traffic make time a hidden cost. Regional rail helps some suburbs but last-mile gaps still push households toward cars or taxis.',
    food: 'Grocery prices run higher than many EU peers, especially dairy and eating out. Cooking most meals and avoiding city-centre cafes is the usual way locals control the food category.',
  });
  const city = runPair('city_guide_shared_headings', cityA, cityB, 'city_guide');
  assert(city.decision === 'pass', `city guides should PASS, got ${city.decision}`);

  const compA: WriterDraftPayload = {
    ...cityA,
    seo_title: 'Berlin vs Lisbon Cost of Living',
    blocks: cityA.blocks,
  };
  const compB: WriterDraftPayload = {
    ...cityB,
    seo_title: 'Dublin vs Lisbon Cost of Living',
    blocks: cityB.blocks,
  };
  const comparison = runPair('comparison_guide_shared_headings', compA, compB, 'comparison_guide');
  assert(comparison.decision === 'pass', `comparison guides should PASS, got ${comparison.decision}`);

  // Controlled multi-paragraph drafts for precise overlap bands
  function parasDraft(title: string, paragraphs: string[]): WriterDraftPayload {
    const blocks: WriterDraftPayload['blocks'] = [
      { id: 'h0', type: 'heading', heading: 'Housing', content: 'Housing' },
    ];
    paragraphs.forEach((p, i) => {
      if (i === 6) blocks.push({ id: 'ht', type: 'heading', heading: 'Transport', content: 'Transport' });
      if (i === 12) blocks.push({ id: 'hf', type: 'heading', heading: 'Food', content: 'Food' });
      blocks.push({ id: `p${i}`, type: 'paragraph', content: p });
    });
    blocks.push({
      id: 'toc',
      type: 'list',
      heading: 'Table of Contents',
      content: ['Housing', 'Transport', 'Food'],
    });
    return {
      seo_title: title,
      meta_title: title,
      meta_description: 'meta ignored for similarity',
      excerpt: 'excerpt ignored',
      blocks,
    };
  }

  const sharedParas = Array.from({ length: 18 }, (_, i) =>
    `Body paragraph number ${i + 1} explains practical cost details for residents with enough unique wording to exceed the minimum length filter used by the detector.`
  );

  // 3) Regenerated — ~17/18 shared → warning band (~0.90–0.95)
  const regenParasA = [...sharedParas];
  const regenParasB = [
    ...sharedParas.slice(0, 17),
    'Completely different closing guidance about seasonal budgeting quirks unique to this regeneration pass and not present in the original article body at all.',
  ];
  const regen = runPair(
    'regenerated_high_overlap',
    parasDraft('Rent Guide Original', regenParasA),
    parasDraft('Rent Guide Refresh Title', regenParasB),
    'rent_guide'
  );
  assert(regen.decision === 'warning', `regenerated should be warning, got ${regen.decision} (${regen.max_similarity})`);
  assert(!regen.is_duplicate, 'regenerated must not be critical duplicate');
  assert(
    regen.max_similarity >= DUPLICATE_WARNING_THRESHOLD &&
      regen.max_similarity < DUPLICATE_CRITICAL_THRESHOLD,
    `regen similarity ${regen.max_similarity} not in warning band`
  );

  // 4) Near-identical body → manual_review
  const clones = runPair(
    'near_identical_body',
    parasDraft('Clone Guide One', sharedParas),
    parasDraft('Clone Guide Two Completely Different Title', [...sharedParas]),
    'rent_guide'
  );
  assert(clones.decision === 'manual_review', `clones should manual_review, got ${clones.decision} (${clones.max_similarity})`);
  assert(clones.is_duplicate, 'clones must set is_duplicate');
  assert(clones.max_similarity >= DUPLICATE_CRITICAL_THRESHOLD, 'clone similarity must be >= 0.95');

  // 5) Decision assembly: 0.833 must NOT force manual review
  const fake833: DuplicateDetectorResult = {
    is_duplicate: false,
    is_warning: false,
    decision: 'pass',
    max_similarity: 0.833,
    similarity_pct: 83.3,
    uniqueness_score: 16.7,
    threshold: DUPLICATE_CRITICAL_THRESHOLD,
    warning_threshold: DUPLICATE_WARNING_THRESHOLD,
    matches: [
      {
        article_id: 9,
        slug: 'other',
        title: 'Other',
        similarity: 0.833,
        title_similarity: 0,
        matching_sections: ['Housing costs'],
      },
    ],
    matched_article: { id: 9, title: 'Other', slug: 'other' },
    matching_sections: ['Housing costs'],
  };
  const report833 = assembleQualityReport({
    ai: passAi,
    rules: emptyRules,
    duplicate: fake833,
    readability: softScores,
    eeat: softScores,
    search_intent: softScores,
    human_writing: softScores,
    helpful_content: softScores,
    quality_threshold: 75,
    engine_version: 'test',
  });
  assert(report833.decision !== 'manual_review', '0.833 must not be manual_review');
  assert(!report833.critical_fail, '0.833 must not critical_fail');

  const fake92: DuplicateDetectorResult = {
    ...fake833,
    max_similarity: 0.92,
    similarity_pct: 92,
    decision: 'warning',
    is_warning: true,
    is_duplicate: false,
  };
  const report92 = assembleQualityReport({
    ai: passAi,
    rules: emptyRules,
    duplicate: fake92,
    readability: softScores,
    eeat: softScores,
    search_intent: softScores,
    human_writing: softScores,
    helpful_content: softScores,
    quality_threshold: 75,
    engine_version: 'test',
  });
  assert(report92.decision !== 'manual_review', '0.92 warning must not be manual_review');
  assert(!report92.critical_fail, '0.92 must not critical_fail');

  const fake96: DuplicateDetectorResult = {
    ...fake833,
    max_similarity: 0.96,
    similarity_pct: 96,
    decision: 'manual_review',
    is_warning: false,
    is_duplicate: true,
  };
  const report96 = assembleQualityReport({
    ai: passAi,
    rules: emptyRules,
    duplicate: fake96,
    readability: softScores,
    eeat: softScores,
    search_intent: softScores,
    human_writing: softScores,
    helpful_content: softScores,
    quality_threshold: 75,
    engine_version: 'test',
  });
  assert(report96.decision === 'manual_review', '0.96 must be manual_review');
  assert(report96.critical_fail, '0.96 must critical_fail');

  console.log(
    JSON.stringify(
      {
        ok: true,
        thresholds: {
          warning: DUPLICATE_WARNING_THRESHOLD,
          critical: DUPLICATE_CRITICAL_THRESHOLD,
        },
        country_sim: country.max_similarity,
        city_sim: city.max_similarity,
        comparison_sim: comparison.max_similarity,
        regen_sim: regen.max_similarity,
        regen_decision: regen.decision,
        clone_sim: clones.max_similarity,
        decision_833: report833.decision,
        decision_92: report92.decision,
        decision_96: report96.decision,
      },
      null,
      2
    )
  );
}

main();
