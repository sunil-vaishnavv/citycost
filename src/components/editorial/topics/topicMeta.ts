import type { Cluster, Topic } from '../api';

export const SCORER_VERSION_LABEL = 'Scorer v3';

export function refsOf(topic: Topic): Record<string, unknown> {
  return topic.source_refs_json || {};
}

export function strRef(refs: Record<string, unknown>, key: string): string | null {
  const v = refs[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function topicKeyword(topic: Topic): string | null {
  return strRef(refsOf(topic), 'primary_keyword');
}

export function topicCountry(topic: Topic): string | null {
  const refs = refsOf(topic);
  return strRef(refs, 'country') || strRef(refs, 'country_slug') || strRef(refs, 'country_code');
}

export function topicCity(topic: Topic): string | null {
  const refs = refsOf(topic);
  const city = strRef(refs, 'city');
  if (city) return city;
  const cities = refs.cities;
  if (Array.isArray(cities) && cities.length) return String(cities[0]);
  return null;
}

export function topicIntent(topic: Topic): string | null {
  return strRef(refsOf(topic), 'intent');
}

export function topicPriority(topic: Topic): string | null {
  return strRef(refsOf(topic), 'priority');
}

export function topicDifficulty(topic: Topic): number | null {
  const d = refsOf(topic).difficulty;
  return typeof d === 'number' && Number.isFinite(d) ? d : null;
}

export function topicSearchVolume(topic: Topic): number | null {
  const refs = refsOf(topic);
  const v = refs.estimated_search_value ?? refs.search_volume ?? refs.search_demand;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function topicPersona(topic: Topic): string | null {
  return strRef(refsOf(topic), 'persona');
}

export function topicClusterLabel(topic: Topic, clusterMap: Map<number, Cluster>): string | null {
  const refs = refsOf(topic);
  const fromRefs = strRef(refs, 'cluster') || strRef(refs, 'parent_topic');
  if (fromRefs) return fromRefs;
  if (topic.cluster_id && clusterMap.has(topic.cluster_id)) {
    return clusterMap.get(topic.cluster_id)!.title;
  }
  return null;
}

export function topicOutline(topic: Topic): string[] {
  const refs = refsOf(topic);
  const outline = refs.outline || refs.recommended_outline;
  if (Array.isArray(outline)) return outline.map(String).slice(0, 12);
  if (Array.isArray(topic.rationale_json)) return topic.rationale_json.slice(0, 8);
  return [];
}

export function topicLinks(topic: Topic): string[] {
  const refs = refsOf(topic);
  const links = refs.internal_link_opportunities;
  if (Array.isArray(links)) return links.map(String).slice(0, 10);
  return [];
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatGeneratedDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Topic statuses that may start Writer draft generation (post-approval). */
export function topicCanGenerateDraft(status: string): boolean {
  return status === 'approved' || status === 'scheduled';
}

export const STATUS_META: Array<{ value: string; label: string; icon: string }> = [
  { value: '', label: 'All statuses', icon: '◎' },
  { value: 'candidate', label: 'Candidate', icon: '🟡' },
  { value: 'approved', label: 'Approved', icon: '🟢' },
  { value: 'scheduled', label: 'Scheduled', icon: '🔵' },
  { value: 'draft', label: 'Draft', icon: '🟣' },
  { value: 'review', label: 'Review', icon: '🟠' },
  { value: 'published', label: 'Published', icon: '✅' },
  { value: 'archived', label: 'Archived', icon: '⚫' },
  { value: 'rejected', label: 'Rejected', icon: '🔴' },
  { value: 'generating', label: 'Generating', icon: '⏳' },
];

export interface SavedTopicView {
  id: string;
  name: string;
  filters: {
    q: string;
    status: string;
    contentType: string;
    country: string;
    city: string;
    intent: string;
    cluster: string;
    priority: string;
    scoreMin: string;
    scoreMax: string;
    sort: string;
  };
}

const VIEWS_KEY = 'editorial_topic_saved_views_v1';

export function loadSavedViews(): SavedTopicView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistSavedViews(views: SavedTopicView[]): void {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views.slice(0, 24)));
}
