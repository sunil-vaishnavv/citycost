/**
 * Distinguish manual vs automatic editorial content without a DB migration.
 * Manual articles: prompt_hash = 'manual' and/or research_pack_json.origin = 'manual'.
 * Manual topics: source_refs_json.origin = 'manual'.
 */

export type EditorialSource = 'manual' | 'automatic';

export function isManualArticle(article: {
  prompt_hash?: string | null;
  ai_model?: string | null;
  research_pack_json?: unknown;
}): boolean {
  if (article.prompt_hash === 'manual' || article.ai_model === 'manual') return true;
  const rp = article.research_pack_json;
  if (rp && typeof rp === 'object' && !Array.isArray(rp)) {
    return (rp as Record<string, unknown>).origin === 'manual';
  }
  return false;
}

export function isManualTopic(topic: {
  source_refs_json?: Record<string, unknown> | null;
}): boolean {
  return topic.source_refs_json?.origin === 'manual';
}

export function articleSource(article: Parameters<typeof isManualArticle>[0]): EditorialSource {
  return isManualArticle(article) ? 'manual' : 'automatic';
}

export function topicSource(topic: Parameters<typeof isManualTopic>[0]): EditorialSource {
  return isManualTopic(topic) ? 'manual' : 'automatic';
}
