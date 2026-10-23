/**
 * Server-side regression for the admin OOM fix (no DB / no AI calls).
 *
 * Covers: job payload compaction (large research pack, long article debug,
 * long logs), raw `view=full` passthrough, input immutability, bounded memory
 * across repeated jobs, per-topic enqueue single-flight, memory diagnostics.
 *
 * Usage: npx tsx scripts/verify-editorial-job-memory.ts
 *        node --expose-gc --import tsx scripts/verify-editorial-job-memory.ts  (adds heap assertion)
 */
import assert from 'node:assert/strict';
import {
  compactJobProgress,
  JOB_DETAIL_LOG_LIMIT,
  JOB_LIST_LOG_LIMIT,
  JOB_TEXT_LIMIT,
  parseJobView,
} from '../lib/editorial-engine/jobs/job-serialize.js';
import { createJobMemoryTracker, sampleMemory } from '../lib/editorial-engine/jobs/job-memory.js';
import {
  appendLog,
  applyStage,
  createInitialProgress,
} from '../lib/editorial-engine/jobs/draft-job-types.js';
import { enqueueDraftGenerate } from '../lib/editorial-engine/jobs/draft-generate-worker.js';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    });
}

/** A completed-job result_json shaped like production, with a large research pack + debug. */
function heavyProgress(opts: { packKb: number; logs: number; articleWords: number }) {
  let p = createInitialProgress({ topic_id: 42, topic_title: 'Berlin vs Munich: Cost of Living' });
  for (let i = 0; i < opts.logs; i++) p = appendLog(p, `Writing section ${i}: ${'detail '.repeat(30)}`);
  p = applyStage(p, 'completed', { log: 'Draft saved as article #77' });
  const article = Array.from({ length: opts.articleWords }, (_, i) => `word${i}`).join(' ');
  return {
    ...p,
    article_id: 77,
    stage: 'completed',
    stage_label: 'Completed',
    progress_pct: 100,
    checkpoint: 'completed_draft',
    failure_reason: undefined,
    metrics: { total_ms: 90000, tokens_in: 12000, tokens_out: 9000, model: 'm' },
    cache: {
      research_pack: {
        supporting_facts: Array.from({ length: 50 }, (_, i) => `[^${i}] fact`),
        blob: 'r'.repeat(opts.packKb * 1024),
        grounding_sources: Array.from({ length: 12 }, (_, i) => ({ id: i, url: `https://s/${i}`, snippet: 's'.repeat(400) })),
      },
      half_draft_blocks: [{ type: 'paragraph', content: article }],
      outline_headings: ['A', 'B'],
    },
    debug: {
      groq_model: 'm',
      tokens_in: 12000,
      tokens_out: 9000,
      final_word_count: opts.articleWords,
      research_pack_size_chars: opts.packKb * 1024,
      validation_failures: Array.from({ length: 30 }, (_, i) => `failure ${i} ${'z'.repeat(2000)}`),
      writer_v2: { passes: Array.from({ length: 80 }, () => ({ meta: 'm'.repeat(500) })), audit: { body: article } },
      before_score: 61,
    },
  } as unknown as Record<string, unknown>;
}

async function main() {
  console.log('verify-editorial-job-memory');

  await test('normal job: list/detail keep display fields, drop caches', () => {
    const raw = heavyProgress({ packKb: 20, logs: 30, articleWords: 1800 });
    for (const view of ['list', 'detail'] as const) {
      const out = compactJobProgress(raw, view);
      assert.equal(out.cache, undefined, 'cache stripped');
      assert.equal(out.article_id, 77);
      assert.equal(out.stage, 'completed');
      assert.equal(out.progress_pct, 100);
      assert.ok(Array.isArray(out.stages) && (out.stages as unknown[]).length > 5, 'timeline stages kept');
      assert.deepEqual(out.metrics, raw.metrics, 'metrics kept');
      const dbg = out.debug as Record<string, unknown>;
      assert.equal(dbg.before_score, 61, 'drawer before_score kept');
      assert.equal(dbg.writer_v2, undefined, 'writer debug dropped');
      assert.ok((dbg.validation_failures as string[]).length <= 5);
    }
  });

  await test('large research pack (5 MB) + long article: browser payload stays small', () => {
    const raw = heavyProgress({ packKb: 5 * 1024, logs: 200, articleWords: 12000 });
    const rawBytes = JSON.stringify(raw).length;
    const list = JSON.stringify(compactJobProgress(raw, 'list')).length;
    const detail = JSON.stringify(compactJobProgress(raw, 'detail')).length;
    assert.ok(rawBytes > 5_000_000, `fixture is large (${rawBytes})`);
    assert.ok(list < 20_000, `list payload ${list}B < 20KB`);
    assert.ok(detail < 60_000, `detail payload ${detail}B < 60KB`);
    console.log(`    raw=${(rawBytes / 1e6).toFixed(2)}MB list=${(list / 1e3).toFixed(1)}KB detail=${(detail / 1e3).toFixed(1)}KB`);
  });

  await test('logs bounded and long messages clipped', () => {
    const raw = heavyProgress({ packKb: 1, logs: 200, articleWords: 10 }) as Record<string, unknown>;
    (raw.logs as Array<{ message: string }>).push({ t: 'x', level: 'info', message: 'L'.repeat(50_000) } as never);
    const list = compactJobProgress(raw, 'list');
    const detail = compactJobProgress(raw, 'detail');
    assert.equal((list.logs as unknown[]).length, JOB_LIST_LOG_LIMIT);
    assert.equal((detail.logs as unknown[]).length, JOB_DETAIL_LOG_LIMIT);
    const last = (detail.logs as Array<{ message: string }>).at(-1)!;
    assert.ok(last.message.length <= JOB_TEXT_LIMIT + 1, 'message clipped');
  });

  await test('view=full is raw passthrough; compaction never mutates the DB row', () => {
    const raw = heavyProgress({ packKb: 2, logs: 120, articleWords: 50 });
    const snapshot = JSON.stringify(raw);
    assert.equal(compactJobProgress(raw, 'full'), raw);
    compactJobProgress(raw, 'list');
    compactJobProgress(raw, 'detail');
    assert.equal(JSON.stringify(raw), snapshot, 'input unchanged (retry cache preserved)');
    assert.equal(parseJobView('summary', 'detail'), 'list');
    assert.equal(parseJobView('', 'list'), 'list');
    assert.equal(parseJobView('FULL', 'list'), 'full');
    assert.equal(parseJobView('bogus', 'detail'), 'detail');
  });

  await test('failed job keeps failure reason / stage for the drawer', () => {
    const raw = {
      ...heavyProgress({ packKb: 1, logs: 5, articleWords: 10 }),
      stage: 'failed',
      failed_stage: 'quality_audit',
      failure_reason: 'Writer v2 quality gate failed: word_count_below_minimum:900<1200',
      error_category: 'quality_gate',
    };
    const out = compactJobProgress(raw, 'detail');
    assert.equal(out.failed_stage, 'quality_audit');
    assert.equal(out.error_category, 'quality_gate');
    assert.match(String(out.failure_reason), /word_count_below_minimum/);
  });

  await test('repeated jobs: memory stays bounded', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = sampleMemory().heap_used_mb;
    const retained: unknown[] = [];
    for (let i = 0; i < 60; i++) {
      const raw = heavyProgress({ packKb: 512, logs: 200, articleWords: 4000 });
      // Simulate the poll/SSE path: compact + serialize, keep only what a client would.
      retained.push(JSON.parse(JSON.stringify(compactJobProgress(raw, 'list'))));
      if (retained.length > 30) retained.shift(); // client caps the list at 30 jobs
    }
    gc?.();
    const after = sampleMemory().heap_used_mb;
    const retainedBytes = JSON.stringify(retained).length;
    assert.ok(retainedBytes < 600_000, `30 retained list entries ${retainedBytes}B`);
    if (gc) assert.ok(after - before < 40, `heap growth ${after - before}MB < 40MB`);
    console.log(`    heap ${before}MB → ${after}MB (gc=${gc ? 'on' : 'off'}), retained=${(retainedBytes / 1e3).toFixed(1)}KB`);
  });

  await test('enqueue single-flight: concurrent calls for one topic share one request', async () => {
    const a = enqueueDraftGenerate({ topic_id: 987654 });
    const b = enqueueDraftGenerate({ topic_id: 987654 });
    const c = enqueueDraftGenerate({ topic_id: 987655 });
    assert.equal(a, b, 'same promise for same topic');
    assert.notEqual(a, c, 'different topics are independent');
    const [ra, rb] = await Promise.all([a, b, c]);
    assert.deepEqual(ra, rb);
    // After settling, a new call starts a fresh request (no stale lock).
    assert.notEqual(enqueueDraftGenerate({ topic_id: 987654 }), a);
  });

  await test('memory tracker reports numbers only', () => {
    const t = createJobMemoryTracker('test-job');
    t.stage('writing_sections');
    const done = t.finish('completed');
    assert.equal(typeof done.peak_heap_mb, 'number');
    assert.equal(typeof done.heap_delta_mb, 'number');
  });

  console.log(`\n${passed} passed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
