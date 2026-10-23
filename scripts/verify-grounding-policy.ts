/**
 * Google Search Grounding — deterministic tests (MOCKED provider responses).
 *
 * These tests prove wiring, error handling, policy enforcement and fail-closed
 * behaviour. They DO NOT prove live Google grounding works — that is only shown
 * by `npx tsx scripts/verify-rag-live.ts` with a real key.
 *
 * Usage: npx tsx scripts/verify-grounding-policy.ts
 */
import assert from 'node:assert/strict';
import {
  classifyGroundingError,
  groundingArticlePolicy,
  groundingRequestConfig,
  GroundingRequiredError,
  resolveGeminiApiKey,
  retrieveGroundedCityCostData,
  type GroundedModelResponse,
} from '../lib/editorial-engine/rag/index.js';
import { buildGroundedResearchPackAsync } from '../lib/editorial-engine/research/build.js';
import { buildStructuredContext } from '../lib/editorial-engine/writer/context-pack.js';
import { buildFactsDigest } from '../lib/editorial-engine/writer/v2/prompt-sanitizer.js';
import type { EditorialTopic } from '../lib/editorial-engine/types.js';

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const ENV_KEYS = ['GEMINI_API_KEY', 'GROUNDING_ARTICLE_USE', 'EDITORIAL_REQUIRE_GROUNDING'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function setEnv(vals: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    const v = k in vals ? vals[k] : saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/';
function sydneyResponse(): GroundedModelResponse {
  const header = 'Sydney figures:\n';
  const lines = [
    'In Sydney, the median weekly rent for a unit was A$750 in the June 2026 quarter.',
    'An Opal adult weekly travel cap in Sydney is A$50 as of July 2026.',
  ];
  let text = header;
  const supports: NonNullable<NonNullable<GroundedModelResponse['candidates']>[0]['groundingMetadata']>['groundingSupports'] = [];
  lines.forEach((l, i) => {
    const line = `${i + 1}. ${l}`;
    const start = Buffer.byteLength(text, 'utf8') + 3;
    const end = Buffer.byteLength(text + line, 'utf8');
    text += `${line}\n`;
    supports!.push({ segment: { startIndex: start, endIndex: end, text: l }, groundingChunkIndices: [i] });
  });
  return {
    text,
    candidates: [
      {
        finishReason: 'STOP',
        groundingMetadata: {
          webSearchQueries: ['sydney median rent 2026', 'opal weekly cap 2026'],
          searchEntryPoint: { renderedContent: '<div class="chips">…</div>' },
          groundingChunks: [
            { web: { uri: `${REDIRECT}a`, title: 'example-housing.gov.au' } },
            { web: { uri: `${REDIRECT}b`, title: 'example-transport.nsw.gov.au' } },
          ],
          groundingSupports: supports,
        },
      },
    ],
  };
}

function sydneyTopic(title = 'Sydney Cost of Living 2026: Rent and Transport'): EditorialTopic {
  const now = new Date();
  return {
    id: 0,
    title,
    cluster_id: null,
    content_type: 'city_guide',
    source_refs_json: { city_slug: 'sydney-new-south-wales-australia', primary_keyword: 'sydney cost of living' },
    priority_score: 80,
    status: 'approved',
    topic_hash: 't',
    rationale_json: [],
    locked: false,
    locked_at: null,
    locked_reason: null,
    created_at: now,
    updated_at: now,
  } as unknown as EditorialTopic;
}

async function main() {
  console.log('verify-grounding-policy (MOCKED provider — not proof of live grounding)');

  await test('grounding tool is attached to the provider request config', () => {
    assert.deepEqual(groundingRequestConfig(), { tools: [{ googleSearch: {} }] });
  });

  await test('missing / placeholder API key → unavailable (missing_key), no provider call', async () => {
    for (const key of [undefined, 'your_gemini_api_key', '  ']) {
      setEnv({ GEMINI_API_KEY: key });
      assert.equal(resolveGeminiApiKey(), null);
      const r = await retrieveGroundedCityCostData({ targetCity: 'Sydney' });
      assert.equal(r.status, 'unavailable');
      assert.equal(r.error_category, 'missing_key');
      assert.equal(r.facts.length + r.sources.length, 0);
      assert.equal(r.trace?.status, 'unavailable');
    }
    setEnv({});
  });

  await test('successful grounded response → normalized sources + evidence + trace', async () => {
    let seenPrompt = '';
    const r = await retrieveGroundedCityCostData({
      targetCity: 'Sydney',
      includeDisplay: true,
      generate: async ({ prompt }) => {
        seenPrompt = prompt;
        return sydneyResponse();
      },
    });
    assert.match(seenPrompt, /Sydney/, 'topic reached provider prompt');
    assert.equal(r.status, 'live');
    assert.deepEqual(r.sources.map((s) => s.domain), ['example-housing.gov.au', 'example-transport.nsw.gov.au']);
    assert.equal(r.facts.length, 2);
    assert.equal(r.trace?.grounding_chunks, 2);
    assert.equal(r.trace?.web_search_queries, 2);
    assert.equal(r.trace?.facts, 2);
    assert.ok(r.display?.search_entry_point_html, 'search suggestions available for display');
    const traceJson = JSON.stringify(r.trace);
    assert.ok(!traceJson.includes('Research current'), 'trace carries no prompt text');
  });

  await test('provider errors are classified honestly (model, rate limit, quota, auth, timeout)', async () => {
    const cases: Array<[string, string]> = [
      ['404 models/gemini-x is not found for API version v1beta', 'unsupported_model'],
      ['[429 Too Many Requests] RESOURCE_EXHAUSTED', 'quota_exhausted'],
      ['429 Too Many Requests - please slow down', 'rate_limited'],
      ['Quota exceeded for quota metric generate_requests', 'quota_exhausted'],
      ['API key not valid. Please pass a valid API key.', 'auth'],
      ['Request timed out after 30000ms', 'timeout'],
      ['fetch failed: ENOTFOUND generativelanguage.googleapis.com', 'network'],
    ];
    for (const [msg, cat] of cases) {
      assert.equal(classifyGroundingError(msg), cat, msg);
      const r = await retrieveGroundedCityCostData({
        targetCity: 'Sydney',
        generate: async () => {
          throw new Error(msg);
        },
      });
      assert.equal(r.status, 'error');
      assert.equal(r.error_category, cat);
      assert.equal(r.facts.length, 0);
    }
  });

  await test('response without grounding metadata is discarded (not treated as research)', async () => {
    const r = await retrieveGroundedCityCostData({
      targetCity: 'Sydney',
      generate: async () => ({ text: '1. Sydney rent is A$750 per week.\n', candidates: [{ finishReason: 'STOP' }] }),
    });
    assert.equal(r.status, 'no_evidence');
    assert.equal(r.error_category, 'metadata_missing');
    assert.equal(r.facts.length, 0);
  });

  await test('blocked request (safety) is surfaced, not retried silently', async () => {
    const r = await retrieveGroundedCityCostData({
      targetCity: 'Sydney',
      generate: async () => ({ text: '', promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }),
    });
    assert.equal(r.status, 'error');
    assert.equal(r.error_category, 'blocked_request');
  });

  const topic = sydneyTopic();
  const ctx = buildStructuredContext(topic);

  await test('policy default: article use BLOCKED — no provider call, nothing persisted, labelled', async () => {
    setEnv({ GROUNDING_ARTICLE_USE: undefined, GEMINI_API_KEY: 'AIzaFAKEKEYFORTESTS000000000000000000000' });
    assert.equal(groundingArticlePolicy().permitted, false);
    let called = false;
    const pack = await buildGroundedResearchPackAsync(topic, ctx, undefined, undefined, async () => {
      called = true;
      return sydneyResponse();
    });
    assert.equal(called, false, 'provider not called when policy blocks article use');
    assert.equal(pack.research_status, 'grounding_blocked');
    assert.equal(pack.grounding_sources, undefined);
    assert.equal(pack.grounded_facts, undefined);
    assert.ok(pack.known_data_gaps.some((g) => /not used for articles/.test(g)));
    assert.ok(!buildFactsDigest(pack).includes('[^'), 'writer digest carries no external citations');
    setEnv({});
  });

  await test('fail closed: required grounding + blocked/unavailable → GroundingRequiredError', async () => {
    setEnv({ EDITORIAL_REQUIRE_GROUNDING: 'true', GROUNDING_ARTICLE_USE: undefined });
    await assert.rejects(() => buildGroundedResearchPackAsync(topic, ctx), (e: unknown) => {
      assert.ok(e instanceof GroundingRequiredError);
      assert.equal((e as GroundingRequiredError).status, 'grounding_blocked');
      return true;
    });
    setEnv({ EDITORIAL_REQUIRE_GROUNDING: 'true', GROUNDING_ARTICLE_USE: 'google_written_permission', GEMINI_API_KEY: undefined });
    await assert.rejects(() => buildGroundedResearchPackAsync(topic, ctx), (e: unknown) => {
      assert.equal((e as GroundingRequiredError).status, 'grounding_unavailable');
      return true;
    });
    setEnv({});
  });

  await test('permitted (attested) + grounded → evidence reaches ResearchPack and writer digest', async () => {
    setEnv({ GROUNDING_ARTICLE_USE: 'google_written_permission', GEMINI_API_KEY: 'AIzaFAKEKEYFORTESTS000000000000000000000' });
    const pack = await buildGroundedResearchPackAsync(topic, ctx, undefined, undefined, async () => sydneyResponse());
    assert.equal(pack.research_status, 'grounding_verified');
    assert.equal(pack.grounded_facts?.length, 2);
    const digest = buildFactsDigest(pack);
    assert.ok(digest.includes('A$750'), 'grounded figure in writer digest');
    assert.ok(digest.includes('[^1]'), 'citation reference in writer digest');
    setEnv({});
  });

  await test('permitted + provider failure → no silent substitution, pack says grounding_unavailable', async () => {
    setEnv({ GROUNDING_ARTICLE_USE: 'google_written_permission', GEMINI_API_KEY: 'AIzaFAKEKEYFORTESTS000000000000000000000' });
    const pack = await buildGroundedResearchPackAsync(topic, ctx, undefined, undefined, async () => {
      throw new Error('[429 Too Many Requests] RESOURCE_EXHAUSTED');
    });
    assert.equal(pack.research_status, 'grounding_unavailable');
    assert.equal(pack.grounded_facts, undefined);
    assert.ok(!pack.supporting_facts.some((f) => /^\[\^\d+\]/.test(f)));
    setEnv({});
  });

  await test('QA label in topic title never reaches the grounding prompt', async () => {
    setEnv({ GROUNDING_ARTICLE_USE: 'google_written_permission', GEMINI_API_KEY: 'AIzaFAKEKEYFORTESTS000000000000000000000' });
    let prompt = '';
    const qaTopic = sydneyTopic('Sydney Cost of Living 2026: Post-Fix Verification (0865)');
    await buildGroundedResearchPackAsync(qaTopic, buildStructuredContext(qaTopic), undefined, undefined, async (req) => {
      prompt = req.prompt;
      return sydneyResponse();
    });
    assert.ok(prompt.includes('Sydney Cost of Living 2026'));
    assert.ok(!/Post-Fix|0865/.test(prompt), 'internal label stripped');
    setEnv({});
  });

  console.log(`\n${passed} passed (mocked — live grounding status is reported by verify-rag-live.ts)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
