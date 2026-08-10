/**
 * Build + validate an example Research Pack (no Writer call).
 * Usage: npx tsx scripts/research-pack-example.ts
 */
import { getTopicById, listTopics } from '../lib/editorial-engine/db/topics-repo.js';
import { previewResearchPack } from '../lib/editorial-engine/research/index.js';
import { buildStructuredContext } from '../lib/editorial-engine/writer/context-pack.js';
import type { EditorialTopic } from '../lib/editorial-engine/types.js';

function syntheticComparisonTopic(): EditorialTopic {
  const now = new Date();
  return {
    id: 0,
    title: 'Berlin vs Munich: Cost of Living Comparison Guide',
    cluster_id: null,
    content_type: 'comparison_guide',
    source_refs_json: {
      comparison_slug: 'berlin-vs-munich',
      page_slug_a: 'berlin-berlin-germany',
      page_slug_b: 'munich-bavaria-germany',
      primary_keyword: 'berlin vs munich cost of living',
      secondary_keywords: ['berlin vs munich', 'is berlin cheaper than munich'],
      persona: 'people comparing two cities before moving',
      intent: 'commercial_investigation',
      cluster: 'germany-comparisons',
      parent_topic: 'Cost of Living in Germany',
      country: 'Germany',
      country_slug: 'germany',
      country_code: 'DE',
      cities: ['Berlin', 'Munich'],
      slug: 'berlin-vs-munich-cost-of-living-comparison-guide',
      seo_reason: 'Same-country comparison — strong topical cluster fit',
    },
    priority_score: 85.5,
    status: 'approved',
    topic_hash: 'demo',
    rationale_json: [],
    locked: false,
    locked_at: null,
    locked_reason: null,
    created_at: now,
    updated_at: now,
  };
}

async function main() {
  let topic: EditorialTopic | null = null;
  try {
    const listed = await listTopics({
      content_type: 'comparison_guide',
      status: 'candidate',
      q: 'Berlin vs Munich',
      limit: 1,
    });
    topic = listed.topics[0] || null;
    if (!topic) {
      const any = await listTopics({ content_type: 'comparison_guide', limit: 1 });
      topic = any.topics[0] || null;
    }
    if (topic) {
      const full = await getTopicById(topic.id);
      if (full) topic = full;
    }
  } catch {
    topic = null;
  }

  if (!topic) topic = syntheticComparisonTopic();

  const context = buildStructuredContext(topic);
  const { pack, validation } = previewResearchPack(topic, context);

  const example = {
    validation,
    schema_version: pack.schema_version,
    topic: pack.topic,
    intent: pack.intent,
    persona: pack.persona,
    keywords: {
      primary_keyword: pack.primary_keyword,
      secondary_keywords: pack.secondary_keywords.slice(0, 8),
      long_tail_keywords: pack.long_tail_keywords.slice(0, 6),
      question_keywords: pack.question_keywords.slice(0, 6),
      semantic_keywords: pack.semantic_keywords.slice(0, 10),
      lsi_keywords: pack.lsi_keywords.slice(0, 8),
    },
    entities: pack.entities,
    outline_h2: pack.required_h2,
    outline_h3: pack.required_h3,
    searcher_questions_count: pack.searcher_questions.length,
    searcher_questions_sample: pack.searcher_questions.slice(0, 12),
    required_faq: pack.required_faq,
    required_tables: pack.required_tables,
    required_comparison_blocks: pack.required_comparison_blocks,
    required_calculators: pack.required_calculators,
    cluster: {
      content_cluster: pack.content_cluster,
      parent_pillar: pack.parent_pillar,
      child_articles: pack.child_articles.slice(0, 8),
    },
    writer_contract: pack.writer_contract,
    facts_must_not_invent: pack.facts_must_not_invent,
    disclaimer_requirements: pack.disclaimer_requirements,
    supporting_facts: pack.supporting_facts,
    known_data_gaps: pack.known_data_gaps,
    outline: pack.outline.map((s) => ({
      heading: s.heading,
      children: (s.children || []).map((c) => c.heading),
    })),
  };

  console.log(JSON.stringify(example, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
