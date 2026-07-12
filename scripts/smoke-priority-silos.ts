import {
  buildCityLandingPageData,
  peekKeywordPriorityInternal,
  getIntentIndexStats,
  resetIntentCaches,
} from '../lib/search-intent/index.js';
import { listIndexableCities } from '../lib/seo-catalog.js';

resetIntentCaches();
const slug = listIndexableCities()[0]?.pageSlug;
const page = slug ? buildCityLandingPageData('rent', slug) : null;
const priority = slug ? peekKeywordPriorityInternal('rent', slug) : null;
const publicKeys = page ? Object.keys(page) : [];
const hasPriorityLeak =
  JSON.stringify(page || {}).includes('priority_score') ||
  JSON.stringify(page || {}).includes('estimated_search_demand');

console.log(
  JSON.stringify(
    {
      version_stats: getIntentIndexStats(),
      sample_path: page?.path,
      silo: page?.topic_silo && {
        layer: page.topic_silo.layer,
        parent: page.topic_silo.parent_topic?.href,
        children: page.topic_silo.child_topics.length,
        siblings: page.topic_silo.sibling_topics.length,
        authority: page.topic_silo.authority_hub.href,
        cluster: page.topic_silo.cluster_hub.href,
      },
      graph_parent: page?.graph.parent?.href,
      internal_priority_exists: !!priority,
      priority_score_internal_only: priority?.priority_score,
      public_has_priority_leak: hasPriorityLeak,
      public_keys: publicKeys,
    },
    null,
    2
  )
);
