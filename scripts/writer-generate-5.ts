/**
 * Generate 5 real Writer drafts and report word counts.
 * Usage: npx tsx scripts/writer-generate-5.ts
 */
import { initEditorialEngine } from '../lib/editorial-engine/init.js';
import { approveTopic, listTopics, setTopicStatus } from '../lib/editorial-engine/db/topics-repo.js';
import { patchSettings } from '../lib/editorial-engine/db/settings-repo.js';
import { generateArticleDraft } from '../lib/editorial-engine/writer/generate.js';

async function main() {
  const runtime = await initEditorialEngine();
  if (!runtime.ready) {
    console.error('Editorial engine not ready');
    process.exit(1);
  }
  if (!runtime.ai.isConfigured()) {
    console.error('GROQ_API_KEY not configured');
    process.exit(1);
  }

  const model = process.env.WRITER_TEST_MODEL || 'llama-3.1-8b-instant';
  await patchSettings({
    writer_model: model,
    article_length_min: 2200,
    article_length_target_min: 2600,
    article_length_target_max: 2900,
    article_length_max: 3300,
    max_writer_retries: 2,
    max_tokens: 3072,
  });
  console.error(`Using writer model: ${model}`);

  const wantedTypes = [
    'comparison_guide',
    'country_guide',
    'city_guide',
    'salary_guide',
    'rent_guide',
  ];

  const picked: number[] = [];
  for (const content_type of wantedTypes) {
    const { topics } = await listTopics({
      content_type,
      status: 'candidate',
      sort: 'score_desc',
      limit: 5,
    });
    const hit = topics.find((t) => !picked.includes(t.id));
    if (hit) picked.push(hit.id);
  }
  if (picked.length < 5) {
    const { topics } = await listTopics({ status: 'candidate', sort: 'score_desc', limit: 30 });
    for (const t of topics) {
      if (picked.length >= 5) break;
      if (!picked.includes(t.id)) picked.push(t.id);
    }
  }
  if (picked.length < 5) {
    console.error('Need at least 5 candidate topics.');
    process.exit(1);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const topicId of picked.slice(0, 5)) {
    try {
      await approveTopic(topicId);
    } catch {
      await setTopicStatus(topicId, 'approved');
    }
    console.error(`\n=== Generating topic #${topicId} ===`);
    const started = Date.now();
    const result = await generateArticleDraft(topicId);
    results.push({
      topic_id: topicId,
      ok: result.ok,
      article_id: result.article_id,
      slug: result.slug,
      word_count: result.word_count,
      message: result.message.slice(0, 240),
      ms: Date.now() - started,
      passes: result.debug?.passes?.length,
      used_synth: result.debug?.passes?.some((p) => p.meta === 'research_synth_fallback') || false,
    });
    console.error(JSON.stringify(results[results.length - 1], null, 2));
    await new Promise((r) => setTimeout(r, 1500));
  }

  try {
    await patchSettings({ writer_model: 'llama-3.3-70b-versatile', max_tokens: 16384 });
  } catch {
    /* ignore */
  }

  const passed = results.filter((r) => r.ok);
  console.log(
    JSON.stringify(
      {
        generated: results.length,
        passed: passed.length,
        all_passed: passed.length === results.length,
        word_counts: results.map((r) => ({
          topic_id: r.topic_id,
          ok: r.ok,
          word_count: r.word_count ?? null,
          slug: r.slug ?? null,
          used_synth: r.used_synth,
        })),
      },
      null,
      2
    )
  );
  if (passed.length < results.length) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
