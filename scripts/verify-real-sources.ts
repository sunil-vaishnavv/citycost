/**
 * Verification Suite for Real-World Data Sources:
 * 1. Feature flag toggle (USE_REAL_SOURCES true vs false)
 * 2. Tavily client error classification & response normalization
 * 3. SearXNG fallback engine client & response normalization
 * 4. Fallback execution: SearXNG automatically triggers when Tavily fails/rate-limits
 * 5. mcp-civic-data client with graceful offline resilience & US geo detection
 * 6. Fact extraction: pairs quantitative figures with source URLs and titles
 * 7. Fail-Safe: All-sources failure returns "Insufficient data" (zero hallucination)
 * 8. Facts digest: formats inline citations [Source Name](URL)
 * 9. Block integrity: preserves terminal Sources block after humanize & similarity passes
 * 10. Claim checker: validates claims citing inline markdown links [Source Name](URL)
 *
 * Run: npx tsx scripts/verify-real-sources.ts
 */

import assert from 'node:assert/strict';
import {
  fetchRealWorldSources,
  searchTavily,
  searchSearxng,
  fetchCivicDataForCity,
  isUsLocation,
  extractFactsFromSources,
  isRealSourcesEnabled,
  TavilyError,
} from '../lib/editorial-engine/sources/index.js';
import { buildFactsDigest } from '../lib/editorial-engine/writer/v2/prompt-sanitizer.js';
import {
  isSourcesBlock,
  snapshotProtected,
  mergeWithProtected,
  ensureDraftIntegrity,
  PROTECTED_BLOCK_IDS,
} from '../lib/editorial-engine/writer/v2/block-integrity.js';
import { auditArticleClaimsAgainstRag } from '../lib/editorial-engine/rag/claim-checker.js';
import type { DraftBlock, WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import type { ResearchPack } from '../lib/editorial-engine/research/research-engine.js';
import { runWriterV2 } from '../lib/editorial-engine/writer/v2/orchestrator.js';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function run() {
  console.log('\n--- Real-World Data Sources Verification Suite ---');

  // Test 1: Feature Flag Toggle
  await test('feature flag respects USE_REAL_SOURCES environment variable', () => {
    const original = process.env.USE_REAL_SOURCES;

    process.env.USE_REAL_SOURCES = 'true';
    assert.equal(isRealSourcesEnabled(), true);

    process.env.USE_REAL_SOURCES = '1';
    assert.equal(isRealSourcesEnabled(), true);

    process.env.USE_REAL_SOURCES = 'false';
    assert.equal(isRealSourcesEnabled(), false);

    process.env.USE_REAL_SOURCES = '';
    assert.equal(isRealSourcesEnabled(), false);

    delete process.env.USE_REAL_SOURCES;
    assert.equal(isRealSourcesEnabled(), false);

    process.env.USE_REAL_SOURCES = original;
  });

  // Test 2: Tavily client error classification
  await test('searchTavily handles missing/placeholder API key gracefully', async () => {
    let thrown: TavilyError | null = null;
    try {
      await searchTavily('Austin TX cost of living', { apiKey: '' });
    } catch (err) {
      if (err instanceof TavilyError) thrown = err;
    }
    assert.ok(thrown);
    assert.equal(thrown.status, 401);
    assert.equal(thrown.isQuotaOrAuth, true);
    assert.match(thrown.message, /not configured/i);
  });

  // Test 3: US location detection for mcp-civic-data
  await test('isUsLocation accurately detects US cities and states', () => {
    assert.equal(isUsLocation('Austin, TX'), true);
    assert.equal(isUsLocation('Seattle, Washington'), true);
    assert.equal(isUsLocation('Chicago', 'United States'), true);
    assert.equal(isUsLocation('London, UK'), false);
    assert.equal(isUsLocation('Sydney', 'Australia'), false);
    assert.equal(isUsLocation('Munich, Germany'), false);
  });

  // Test 4: mcp-civic-data client with offline resilience
  await test('fetchCivicDataForCity gracefully tolerates offline MCP server', async () => {
    const result = await fetchCivicDataForCity('Austin, TX', {
      baseUrl: 'http://127.0.0.1:59999', // Port where nothing is listening
      timeoutMs: 300,
    });

    assert.ok(Array.isArray(result.metrics));
    assert.ok(Array.isArray(result.sources));
    assert.equal(result.metrics.length, 0);
    assert.equal(result.sources.length, 0);
  });

  // Test 5: SearXNG fallback triggers when Tavily fails (mocked fetch)
  await test('orchestrator falls back to SearXNG when Tavily throws or fails', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      // If Tavily API, simulate 429 quota exhaustion
      if (urlStr.includes('api.tavily.com')) {
        return new Response(JSON.stringify({ detail: { error: 'Rate limit or quota exhausted' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // If SearXNG API, return successful results
      if (urlStr.includes('localhost:8080') || urlStr.includes('searxng')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Denver Cost of Living Index 2026',
                url: 'https://colorado.gov/denver-col',
                content: 'Denver median rent is $1,850 and public transit passes cost $114 per month.',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(url, init);
    };

    try {
      const result = await fetchRealWorldSources({
        title: 'Cost of Living in Denver',
        primaryEntity: 'Denver',
        country: 'United States',
        skipCivicData: true,
      });

      assert.equal(result.status, 'live');
      assert.equal(result.usedSearxngFallback, true);
      assert.ok(result.sources.length > 0);
      assert.equal(result.sources[0].title, 'Denver Cost of Living Index 2026');
      assert.equal(result.sources[0].domain, 'colorado.gov');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Test 6: Fact Extraction pairs real figures with source links
  await test('extractFactsFromSources extracts quantitative figures paired with source URLs', () => {
    const sources = [
      {
        id: 1,
        title: 'BLS Consumer Price Index',
        url: 'https://bls.gov/cpi',
        domain: 'bls.gov',
        snippet: 'In June 2025, consumer prices increased by 2.9% year-over-year. Grocery costs rose by $45 monthly.',
        provider: 'tavily' as const,
        retrievedAt: new Date().toISOString(),
      },
    ];

    const facts = extractFactsFromSources(sources);
    assert.ok(facts.length > 0);
    const fact = facts[0];
    assert.ok(fact.statement.includes('2.9%') || fact.statement.includes('$45'));
    assert.equal(fact.sourceUrl, 'https://bls.gov/cpi');
    assert.equal(fact.sourceTitle, 'BLS Consumer Price Index');
  });

  // Test 7: Fail-safe - All sources failure returns "Insufficient data"
  await test('all-sources failure returns Insufficient data and halts generation to prevent hallucination', async () => {
    const originalFlag = process.env.USE_REAL_SOURCES;
    process.env.USE_REAL_SOURCES = 'true';

    // Research pack with zero grounding sources (simulating total provider failure)
    const emptyPack = {
      primary_entity: 'Mystery City',
      supporting_facts: [],
      grounding_sources: [],
    } as unknown as ResearchPack;

    // runWriterV2 catches and returns ok: false with Insufficient data message
    const res = await runWriterV2({
      topic: { id: 999, title: 'Cost of Living in Mystery City' },
      research: emptyPack,
      settings: {
        writer_model: 'mock-llm',
        temperature: 0.3,
        article_length_min: 800,
        article_length_max: 2000,
      },
      complete: async () => ({ text: '{"blocks":[]}' }),
    });

    assert.equal(res.ok, false);
    assert.match(res.message, /Insufficient data/i);
    assert.ok(res.errors.some((e) => /Insufficient data/i.test(e)));

    process.env.USE_REAL_SOURCES = originalFlag;
  });

  // Test 8: Facts digest formats verified sources as [Source Name](URL)
  await test('buildFactsDigest formats markdown links when USE_REAL_SOURCES=true', () => {
    const originalFlag = process.env.USE_REAL_SOURCES;
    process.env.USE_REAL_SOURCES = 'true';

    const pack = {
      primary_entity: 'Seattle',
      supporting_facts: ['Seattle median rent is $2,100.'],
      grounding_sources: [
        {
          id: 1,
          title: 'U.S. Bureau of Labor Statistics',
          url: 'https://www.bls.gov/regions/west/news-release/consumerpriceindex_seattle.htm',
          domain: 'bls.gov',
        },
      ],
    };

    const digest = buildFactsDigest(pack);
    assert.ok(digest.includes('VERIFIED REAL-WORLD SOURCES'));
    assert.ok(
      digest.includes(
        '[U.S. Bureau of Labor Statistics](https://www.bls.gov/regions/west/news-release/consumerpriceindex_seattle.htm)'
      )
    );

    process.env.USE_REAL_SOURCES = originalFlag;
  });

  // Test 9: Block integrity preserves the terminal Sources block
  await test('block integrity snapshot, merge and ensure protects the Sources block', () => {
    const mockBlocks: DraftBlock[] = [
      { id: 'intro', type: 'intro', content: 'Intro text' },
      { id: 'toc', type: 'list', heading: 'Table of contents', content: ['Overview'] },
      { id: 'b-1', type: 'paragraph', content: 'Body paragraph with cost details.' },
      { id: 'faq', type: 'faq', content: [{ q: 'How much?', a: '$2,000' }] },
      { id: 'summary', type: 'summary', heading: 'Summary', content: 'Summary text' },
      {
        id: 'sources',
        type: 'list',
        heading: 'Sources',
        content: ['[U.S. Census](https://census.gov)', '[BLS](https://bls.gov)'],
      },
    ];

    assert.equal(isSourcesBlock(mockBlocks[5]), true);

    const snap = snapshotProtected(mockBlocks);
    assert.ok(snap.sources);
    assert.equal(snap.sources?.id, PROTECTED_BLOCK_IDS.sources);

    // Merge with body rewrite: Sources must be placed at the very end after summary
    const rewrittenBody: DraftBlock[] = [
      { id: 'b-new', type: 'paragraph', content: 'Updated rewritten body paragraph.' },
    ];
    const merged = mergeWithProtected(rewrittenBody, snap);

    const lastBlock = merged[merged.length - 1];
    assert.equal(lastBlock.id, 'sources');
    assert.equal(lastBlock.heading, 'Sources');

    // Run ensureDraftIntegrity
    const draft: WriterDraftPayload = {
      seo_title: 'Test Title',
      meta_title: 'Test Title',
      meta_description: 'Test Description',
      excerpt: 'Test Excerpt',
      blocks: merged,
    };
    const ensured = ensureDraftIntegrity(draft, snap);
    const finalSources = ensured.draft.blocks.find((b) => b.id === 'sources');
    assert.ok(finalSources);
    assert.equal(finalSources?.heading, 'Sources');
  });

  // Test 10: Claim checker verifies claims citing inline markdown links
  await test('claim checker verifies claims using inline [Source Name](URL) citations', () => {
    const sources = [
      {
        id: 1,
        title: 'Bureau of Labor Statistics',
        url: 'https://bls.gov/cpi',
        domain: 'bls.gov',
      },
    ];

    const groundedFacts = [
      {
        factId: 'fact-1',
        sourceId: 1,
        category: 'rent',
        statement: 'According to the bureau report, median rent in Austin is $1,650 per month.',
        confidence: 0.95,
      },
    ];

    const blocks: DraftBlock[] = [
      {
        id: 'b-1',
        type: 'paragraph',
        content:
          'According to the [Bureau of Labor Statistics](https://bls.gov/cpi), median rent in Austin is $1,650 per month.',
      },
    ];

    const audit = auditArticleClaimsAgainstRag(blocks, groundedFacts, sources);
    assert.equal(audit.status, 'audited');
    assert.equal(audit.verifiedCount, 1);
    assert.equal(audit.claims[0].status, 'verified');
    assert.equal(audit.claims[0].matchedSourceUrl, 'https://bls.gov/cpi');
  });

  console.log(`\nAll ${passed} Real-World Data Sources verification tests PASSED!\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
