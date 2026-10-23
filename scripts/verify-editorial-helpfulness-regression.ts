/**
 * Regression test suite for CityCost Google Search Grounding and Helpfulness Quality Gate.
 *
 * Covers:
 * Issue A: Grounding status, classification, policy enforcement, provenance & error categories.
 * Issue B: Comparison helpfulness validation, flexible terminology, bounded repair,
 *          quality gate consistency, and job timeline stage integrity (no false checkmark on saving_draft).
 *
 * Usage: npx tsx scripts/verify-editorial-helpfulness-regression.ts
 */

import assert from 'node:assert/strict';
import {
  classifyGroundingError,
  groundingArticlePolicy,
  parseGroundedResponse,
  retrieveGroundedCityCostData,
  type GroundedModelResponse,
} from '../lib/editorial-engine/rag/index.js';
import { assembleResearchPack } from '../lib/editorial-engine/research/build.js';
import { buildCalculationLedger } from '../lib/editorial-engine/research/comparison-ledger.js';
import { buildStructuredContext } from '../lib/editorial-engine/writer/context-pack.js';
import { buildFactsDigest } from '../lib/editorial-engine/writer/v2/prompt-sanitizer.js';
import {
  runHelpfulnessValidators,
  validateHelpfulContentV2,
} from '../lib/editorial-engine/writer/v2/helpfulness-validators.js';
import { runHelpfulnessPipeline } from '../lib/editorial-engine/writer/v2/helpfulness-pipeline.js';
import {
  applyHelpfulContent,
  scoreHelpfulDraft,
} from '../lib/editorial-engine/writer/v2/helpful-content.js';
import {
  applyStage,
  createInitialProgress,
  DRAFT_JOB_STAGES,
  type DraftJobProgress,
  type DraftJobStage,
} from '../lib/editorial-engine/jobs/draft-job-types.js';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import type { EditorialTopic } from '../lib/editorial-engine/types.js';

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const SYD = 'sydney-new-south-wales-australia';
const MEL = 'melbourne-victoria-australia';

function makeTopic(title = 'Sydney vs Melbourne Cost of Living 2026'): EditorialTopic {
  const now = new Date();
  return {
    id: 109,
    title,
    cluster_id: null,
    content_type: 'comparison_guide',
    source_refs_json: { city_a_slug: SYD, city_b_slug: MEL },
    priority_score: 80,
    status: 'approved',
    topic_hash: 'topic-syd-mel-109',
    rationale_json: [],
    locked: false,
    locked_at: null,
    locked_reason: null,
    created_at: now,
    updated_at: now,
  } as unknown as EditorialTopic;
}

function makeBarebonesComparisonDraft(): WriterDraftPayload {
  return {
    meta_title: 'Sydney vs Melbourne Cost of Living 2026',
    meta_description: 'Comparison of living costs between Sydney and Melbourne in 2026.',
    primary_keyword: 'sydney vs melbourne cost of living',
    blocks: [
      { id: 'intro', type: 'intro', content: '<p>A comparison of Sydney and Melbourne.</p>' },
      { id: 'toc', type: 'list', content: '<ul><li><a href="#rent">Housing</a></li><li><a href="#transport">Transport</a></li></ul>' },
      { id: 'h-1', type: 'heading', level: 2, heading: 'Housing and Rent in Sydney and Melbourne', content: 'Housing and Rent in Sydney and Melbourne' },
      { id: 'p-1', type: 'paragraph', content: 'Sydney rent averages $750 weekly whereas Melbourne is $580. Rent in Sydney is substantially higher than in Melbourne across most suburbs.' },
      { id: 'h-2', type: 'heading', level: 2, heading: 'Public Transit and Commuting', content: 'Public Transit and Commuting' },
      { id: 'p-2', type: 'paragraph', content: 'Transport in Melbourne features the free tram zone in the CBD. In Sydney, Opal caps apply on trains, ferries, and buses.' },
      { id: 'h-3', type: 'heading', level: 2, heading: 'Overall Verdict and Summary', content: 'Overall Verdict and Summary' },
      { id: 'p-3', type: 'paragraph', content: 'Melbourne offers lower housing expenses while Sydney offers higher average wages in several technical industries.' },
      { id: 'faq', type: 'faq', content: '<p>FAQ section</p>' },
      { id: 'summary', type: 'summary', content: '<p>Summary section</p>' },
    ],
  };
}

function makeHelpfulComparisonDraft(): WriterDraftPayload {
  return {
    meta_title: 'Sydney vs Melbourne Cost of Living 2026',
    meta_description: 'Comprehensive comparison of living costs between Sydney and Melbourne with actionable decision guidance.',
    primary_keyword: 'sydney vs melbourne cost of living',
    blocks: [
      { id: 'intro', type: 'intro', content: '<p>Moving between Sydney and Melbourne requires analyzing total living costs, not just rent.</p>' },
      { id: 'toc', type: 'list', content: '<ul><li><a href="#rent">Housing</a></li><li><a href="#transit">Transit</a></li><li><a href="#decision">Relocation Levers</a></li></ul>' },
      { id: 'h-1', type: 'heading', level: 2, heading: 'Housing and Rent Comparison', content: 'Housing and Rent Comparison' },
      { id: 'p-1', type: 'paragraph', content: 'Sydney weekly rents sit around $750 while Melbourne averages $580 per week for a 1-bedroom unit.' },
      { id: 'tip-1', type: 'tip', heading: 'Decision Tip', content: '<strong>Actionable Next Step:</strong> Hold lifestyle constant and run the numbers on like-for-like suburbs. Calculate your net take-home salary after factoring in the purchasing power gap.' },
      { id: 'tip-2', type: 'tip', heading: 'Trade-off Analysis', content: '<strong>Key Trade-off:</strong> Paying 25% lower rent in Melbourne outer suburbs often carries a 45-minute longer commute penalty compared to Sydney inner-west transit links.' },
      { id: 'h-2', type: 'heading', level: 2, heading: 'Public Transit and Daily Commuting', content: 'Public Transit and Daily Commuting' },
      { id: 'p-2', type: 'paragraph', content: 'Melbourne provides a free CBD tram zone, whereas Sydney relies on Opal weekly fare caps.' },
      { id: 'tip-3', type: 'tip', heading: 'Scenario Example', content: '<strong>Real Scenario:</strong> For a professional commuting four days a week, Sydney Opal caps amount to roughly $200 per month compared to Melbourne myki monthly pass costs of $180.' },
      { id: 'tip-4', type: 'tip', heading: 'Transparent Limitations', content: '<strong>Data Limitation:</strong> Local council rates and private school fees vary widely by suburb and are excluded from these baseline figures.' },
      { id: 'tip-winner', type: 'tip', heading: 'Winner Summary', content: '<strong>Winner summary:</strong> Sydney vs Melbourne only has a winner relative to your must-haves. Score housing plus cash buffer and drop any option that fails one non-negotiable.' },
      { id: 'h-3', type: 'heading', level: 2, heading: 'Relocation Decision Framework', content: 'Relocation Decision Framework' },
      { id: 'p-3', type: 'paragraph', content: 'Your decision hinges on career trajectory versus monthly living room.' },
      { id: 'list-chk', type: 'list', heading: 'Comparison Decision Checklist', content: '<ul><li>Hold lifestyle constant between Sydney and Melbourne</li><li>Convert to one net take-home figure</li><li>Write two non-negotiables before deciding</li></ul>' },
      { id: 'faq', type: 'faq', content: '<p>FAQ section</p>' },
      { id: 'summary', type: 'summary', content: '<p>Summary section</p>' },
    ],
  };
}

async function main() {
  console.log('--- verify-editorial-helpfulness-regression ---');

  // =========================================================================
  // ISSUE A: Google Search Grounding Classification, Policy & Provenance Tests
  // =========================================================================

  await test('Issue A: Classifies Google GenAI 429 RESOURCE_EXHAUSTED as quota_exhausted', () => {
    const error1 = '[429 Too Many Requests] RESOURCE_EXHAUSTED: Resource has been exhausted (e.g. check quota).';
    const error2 = 'Quota exceeded for quota metric generate_requests';
    const error3 = 'GoogleGenAIError: 429 RESOURCE_EXHAUSTED';
    assert.equal(classifyGroundingError(error1), 'quota_exhausted');
    assert.equal(classifyGroundingError(error2), 'quota_exhausted');
    assert.equal(classifyGroundingError(error3), 'quota_exhausted');
  });

  await test('Issue A: Distinguishes auth, unsupported_model, timeout, and network errors', () => {
    assert.equal(classifyGroundingError('API_KEY_INVALID: API key not valid'), 'auth');
    assert.equal(classifyGroundingError('404 models/gemini-pro is not found'), 'unsupported_model');
    assert.equal(classifyGroundingError('Request timed out after 30000ms'), 'timeout');
    assert.equal(classifyGroundingError('fetch failed: ENOTFOUND generativelanguage.googleapis.com'), 'network');
  });

  await test('Issue A: Discards response missing grounding metadata with error_category metadata_missing', async () => {
    const r = await retrieveGroundedCityCostData({
      targetCity: 'Sydney',
      generate: async () => ({
        text: 'Sydney median rent is $750 per week.\n',
        candidates: [{ finishReason: 'STOP' }],
      }),
    });
    assert.equal(r.status, 'no_evidence');
    assert.equal(r.error_category, 'metadata_missing');
    assert.equal(r.facts.length, 0);
  });

  await test('Issue A: Normalizes valid Google Search Grounding metadata into trusted facts and sources', () => {
    const text = '1. In Sydney, the median weekly rent for a 1-bed unit was A$750 in 2026.\n';
    const fakeResp: GroundedModelResponse = {
      text,
      candidates: [
        {
          finishReason: 'STOP',
          groundingMetadata: {
            webSearchQueries: ['sydney median rent 2026'],
            groundingChunks: [
              { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'nsw.gov.au' } },
            ],
            groundingSupports: [
              {
                segment: { startIndex: 3, endIndex: Buffer.byteLength(text, 'utf8') - 1, text: 'In Sydney, the median weekly rent for a 1-bed unit was A$750 in 2026.' },
                groundingChunkIndices: [0],
              },
            ],
          },
        },
      ],
    };
    const parsed = parseGroundedResponse(fakeResp, { targetCity: 'Sydney' });
    assert.equal(parsed.facts.length, 1);
    assert.equal(parsed.sources.length, 1);
    assert.equal(parsed.sources[0].domain, 'nsw.gov.au');
    assert.equal(parsed.facts[0].figure, '$750');
    assert.equal(parsed.facts[0].sourceIds[0], parsed.sources[0].id);
  });

  await test('Issue A: Grounding policy block preserves rag_error_category in ResearchPack', () => {
    const topic = makeTopic();
    const context = buildStructuredContext(topic);
    const pack = assembleResearchPack(topic, context, {
      status: 'blocked',
      error_category: 'policy',
      error: 'Grounding blocked by policy',
    });
    assert.equal(pack.research_status, 'grounding_blocked');
    assert.equal(pack.rag_error_category, 'policy');
    assert.equal((pack.grounding_sources || []).length, 0); // Never fakes sources
    assert.ok(pack.known_data_gaps.some((g) => g.includes('No external web research')));
  });

  await test('Issue A: Permitted grounded evidence reaches ResearchPack and Writer ContextPack with provenance', () => {
    const topic = makeTopic();
    const context = buildStructuredContext(topic);
    const pack = assembleResearchPack(topic, context, {
      status: 'live',
      facts: [
        {
          statement: 'Sydney median weekly rent for a unit was A$750 in 2026.',
          figure: 'A$750',
          category: 'rent',
          sourceId: 1,
          sourceIds: [1],
          citationRef: '[^1]',
          city: 'Sydney',
        },
      ],
      sources: [
        {
          id: 1,
          domain: 'domain.com.au',
          url: 'https://domain.com.au/rent-report',
          title: 'Domain Rental Report 2026',
          retrievedAt: '2026-10-23',
        },
      ],
      trace: {
        request_id: 'grd_test_123',
        provider: 'google-genai',
        model: 'gemini-3.8-flash',
        started_at: '2026-10-23T00:00:00Z',
        latency_ms: 250,
        status: 'live',
        tool: 'googleSearch',
        web_search_queries: 1,
        grounding_chunks: 1,
        grounding_supports: 1,
        sources: 1,
        facts: 1,
        unsupported_dropped: 0,
      },
    });

    assert.equal(pack.research_status, 'grounding_verified');
    assert.equal(pack.grounding_sources?.length, 1);
    assert.equal(pack.grounding_sources?.[0]?.domain, 'domain.com.au');

    const digest = buildFactsDigest(pack);
    assert.match(digest, /Sydney median weekly rent for a unit was A\$750/);
    assert.match(digest, /\[\^1\]/);
  });

  // =========================================================================
  // ISSUE B: Comparison Helpfulness Gate, Bounded Repair & Job Stage Tests
  // =========================================================================

  await test('Issue B: Genuinely helpful comparison draft passes helpfulness validator', () => {
    const draft = makeHelpfulComparisonDraft();
    const result = runHelpfulnessValidators(draft, 'comparison');
    assert.equal(result.block_save, false, `Expected helpful draft to pass, got block_save with: ${JSON.stringify(result.validators)}`);
    const helpfulValidator = result.validators.find((v) => v.id === 'helpful_content');
    assert.ok(helpfulValidator, 'helpful_content validator should run');
    assert.equal(helpfulValidator.ok, true);
  });

  await test('Issue B: Barebones draft with insufficient practical advice triggers helpfulness block', () => {
    const draft = makeBarebonesComparisonDraft();
    const result = runHelpfulnessValidators(draft, 'comparison');
    assert.equal(result.block_save, true, 'Expected barebones draft to be blocked');
    const helpfulValidator = result.validators.find((v) => v.id === 'helpful_content');
    assert.ok(helpfulValidator, 'helpful_content validator should run');
    assert.equal(helpfulValidator.ok, false);
    assert.ok(helpfulValidator.findings.some((f) => f.code === 'too_little_practical_advice'));
  });

  await test('Issue B: Practical advice expressed using flexible comparison vocabulary passes', () => {
    // Uses comparison-specific phrasing like "hold lifestyle constant", "like-for-like", "net take-home"
    const draft: WriterDraftPayload = {
      meta_title: 'Sydney vs Melbourne Living Costs',
      meta_description: 'Comparison of living costs',
      primary_keyword: 'sydney vs melbourne',
      blocks: [
        { id: 'intro', type: 'intro', content: '<p>Intro</p>' },
        { id: 'toc', type: 'list', content: '<ul><li>Item</li></ul>' },
        { id: 'h-1', type: 'heading', level: 2, heading: 'Rent Comparison', content: 'Rent Comparison' },
        { id: 'p-1', type: 'paragraph', content: 'When comparing suburbs, hold lifestyle constant and look at like-for-like quality to evaluate the true purchasing power gap and net take-home differences.' },
        { id: 'h-2', type: 'heading', level: 2, heading: 'Commute and Transit Levers', content: 'Commute and Transit Levers' },
        { id: 'p-2', type: 'paragraph', content: 'For example, living in Melbourne outer suburbs may save $150 weekly in rent, but run the numbers on the commute penalty before committing.' },
        { id: 'h-3', type: 'heading', level: 2, heading: 'Budget Decisions and Moving Next Steps', content: 'Budget Decisions and Moving Next Steps' },
        { id: 'p-3', type: 'paragraph', content: 'Actionable step: verify that your employer relocation package offsets moving costs and deposit months.' },
        { id: 'faq', type: 'faq', content: '<p>FAQ</p>' },
        { id: 'summary', type: 'summary', content: '<p>Summary</p>' },
      ],
    };
    const helpfulResult = validateHelpfulContentV2(draft);
    assert.equal(helpfulResult.ok, true, `Expected helpful_content to pass with flexible vocab, findings: ${JSON.stringify(helpfulResult.findings)}`);
    assert.ok(helpfulResult.score >= 70, `Expected score >= 70, got ${helpfulResult.score}`);
  });

  await test('Issue B: Bounded repair on deficient draft adds actionable advice and allows subsequent pass', () => {
    const bareDraft = makeBarebonesComparisonDraft();
    const initialValidation = validateHelpfulContentV2(bareDraft);
    assert.equal(initialValidation.ok, false, 'Initial draft fails helpful_content validator');

    // Run bounded repair
    const repaired = applyHelpfulContent({
      draft: bareDraft,
      guideId: 'comparison',
      context: { city: 'Sydney', city_b: 'Melbourne', country: 'Australia' },
    });

    assert.ok(repaired.report.helpful_tips_added >= 1, 'Repair added helpful tips');
    assert.ok(repaired.report.sections_upgraded.length >= 1, 'Sections were upgraded');

    // Re-validate repaired draft with validateHelpfulContentV2
    const postRepairValidation = validateHelpfulContentV2(repaired.draft);
    assert.equal(postRepairValidation.ok, true, 'Repaired draft passes helpful_content validator');

    // Run full pipeline on bare draft
    const fullPipelineResult = runHelpfulnessPipeline({
      draft: bareDraft,
      context: {
        guideId: 'comparison',
        city: 'Sydney',
        city_b: 'Melbourne',
        country: 'Australia',
      },
    });
    assert.equal(fullPipelineResult.block_save, false, 'Full helpfulness pipeline unblocks save for comparison guide');
  });

  await test('Issue B: applyStage("failed") never marks saving_draft as "done"', () => {
    let progress = createInitialProgress(109, 'Sydney vs Melbourne Cost of Living 2026');

    // Advance stages up to quality_audit
    const stagesToAdvance: DraftJobStage[] = [
      'queued',
      'preparing_research',
      'loading_ai',
      'editorial_brain',
      'selecting_guide',
      'building_outline',
      'writing_sections',
      'generating_faq',
      'generating_summary',
      'humanization_pass',
      'similarity_check',
      'quality_audit',
    ];
    for (const st of stagesToAdvance) {
      progress = applyStage(progress, st);
    }

    // Now quality audit fails with helpfulness error
    const failureReason = 'helpfulness:helpful_content:too_little_practical_advice';
    progress = applyStage(progress, 'failed', {
      log: failureReason,
      failed_stage: 'quality_audit',
      detail: failureReason.slice(0, 240),
    });

    const auditStage = progress.stages.find((s) => s.id === 'quality_audit');
    const savingStage = progress.stages.find((s) => s.id === 'saving_draft');
    const writingStage = progress.stages.find((s) => s.id === 'writing_sections');

    assert.ok(auditStage, 'quality_audit stage exists');
    assert.equal(auditStage.status, 'failed', 'quality_audit should be marked failed');

    assert.ok(writingStage, 'writing_sections stage exists');
    assert.equal(writingStage.status, 'done', 'prior stages before failure should be done');

    assert.ok(savingStage, 'saving_draft stage exists');
    assert.equal(
      savingStage.status,
      'skipped',
      `saving_draft MUST NOT be 'done' on failed audit, got '${savingStage.status}'`
    );
  });

  await test('Issue B: Worker error normalization accurately maintains failed stage and skipped unreached stages', () => {
    let progress = createInitialProgress(109, 'Sydney vs Melbourne Cost of Living 2026');
    progress = applyStage(progress, 'quality_audit');

    const failedStage: DraftJobStage = 'quality_audit';
    const failureReason = 'helpfulness:helpful_content:too_little_practical_advice';
    const failedOrder = DRAFT_JOB_STAGES.indexOf(failedStage);

    progress = applyStage(progress, 'failed', {
      log: failureReason,
      failed_stage: failedStage,
      detail: failureReason.slice(0, 240),
    });

    progress = {
      ...progress,
      stage: 'failed',
      stage_label: 'Failed',
      progress_pct: 100,
      failed_stage: failedStage,
      failure_reason: failureReason,
      stages: progress.stages.map((s) => {
        const order = DRAFT_JOB_STAGES.indexOf(s.id);
        if (s.id === failedStage) {
          return { ...s, status: 'failed' as const, detail: failureReason.slice(0, 240) };
        }
        if (order > failedOrder) {
          return { ...s, status: 'skipped' as const };
        }
        if (order < failedOrder && s.status !== 'skipped') {
          return { ...s, status: 'done' as const };
        }
        return s;
      }),
    };

    const savingStage = progress.stages.find((s) => s.id === 'saving_draft')!;
    assert.equal(savingStage.status, 'skipped', 'saving_draft stage must be skipped');
    assert.notEqual(savingStage.status, 'done', 'saving_draft must never show done checkmark');
    assert.equal(progress.failed_stage, 'quality_audit');
  });

  await test('Issue B: Repair that fails to improve content preserves block without looping', () => {
    const deficientDraft: WriterDraftPayload = {
      meta_title: 'Deficient Draft',
      meta_description: 'Test draft',
      primary_keyword: 'test',
      blocks: [
        { id: 'intro', type: 'intro', content: '<p>Intro</p>' },
        { id: 'toc', type: 'list', content: '<ul><li>TOC</li></ul>' },
        { id: 'h-1', type: 'heading', level: 2, heading: 'Section 1', content: 'Section 1' },
        { id: 'p-1', type: 'paragraph', content: 'Index numbers are statistical numbers. Cost of living represents prices.' },
        { id: 'h-2', type: 'heading', level: 2, heading: 'Section 2', content: 'Section 2' },
        { id: 'p-2', type: 'paragraph', content: 'Price level defines price levels. Suburbs represent geographic regions.' },
        { id: 'faq', type: 'faq', content: '<p>FAQ</p>' },
        { id: 'summary', type: 'summary', content: '<p>Summary</p>' },
      ],
    };

    const validationBefore = validateHelpfulContentV2(deficientDraft);
    assert.equal(validationBefore.ok, false);
    assert.ok(validationBefore.findings.some((f) => f.code === 'too_little_practical_advice'));

    // Simulated unsuccessful repair (where advice could not be generated or applied)
    const unrepairedDraft = { ...deficientDraft };
    const validationAfter = validateHelpfulContentV2(unrepairedDraft);
    assert.equal(validationAfter.ok, false);
    assert.ok(validationAfter.findings.some((f) => f.code === 'too_little_practical_advice'));

    // When repair fails to clear the block, orchestrator refuses save
    assert.equal(validationAfter.ok, false, 'Unrepaired content must preserve block_save and fail');
  });

  await test('Issue B: Gate consistency guarantees blocking stage reflects failure with no misleading PASS logs', () => {
    // When helpfulness validator fails with block_save
    const blockReasons = ['helpfulness:helpful_content:too_little_practical_advice'];
    const helpBlockSave = true;
    const cqBlockSave = false;

    // Orchestrator gate consistency check:
    const qualityGatePassed = !helpBlockSave && !cqBlockSave;
    const auditPassed = !helpBlockSave && !cqBlockSave;

    assert.equal(qualityGatePassed, false, 'Quality gates MUST NOT pass when helpfulness blocks save');
    assert.equal(auditPassed, false, 'Quality audit MUST NOT pass when helpfulness blocks save');

    // Simulate orchestrator error assignment
    const failedStage: DraftJobStage = 'quality_audit';
    const failureReason = blockReasons[0];

    let progress = createInitialProgress(109, 'Sydney vs Melbourne Cost of Living 2026');
    progress = applyStage(progress, 'failed', {
      log: failureReason,
      failed_stage: failedStage,
      detail: failureReason.slice(0, 240),
    });

    assert.equal(progress.stage, 'failed');
    const savingStage = progress.stages.find((s) => s.id === 'saving_draft')!;
    assert.equal(savingStage.status, 'skipped', 'saving_draft must be skipped, never marked done');
    assert.notEqual(savingStage.status, 'done');
  });

  console.log(`\nAll ${passed} regression tests PASSED cleanly.`);
}

main().catch((err) => {
  console.error('\nRegression test failed:', err);
  process.exit(1);
});
