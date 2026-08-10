import type { StageStatus } from '../api';

export const STAGE_ORDER = [
  'calendar',
  'research',
  'writer',
  'reviewer',
  'seo',
  'internal_links',
  'publish',
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<string, string> = {
  calendar: 'Calendar',
  research: 'Research',
  writer: 'Writer',
  reviewer: 'Reviewer',
  seo: 'SEO',
  internal_links: 'Internal Links',
  publish: 'Publish',
};

export interface NormalizedStage {
  stage: string;
  label: string;
  status: StageStatus | 'pending';
  at: string;
  detail?: string;
  duration_ms?: number;
}

export function normalizeStages(
  stages: Array<{ stage: string; status: StageStatus; at: string; detail?: string; duration_ms?: number }>
): NormalizedStage[] {
  const byName = new Map(stages.map((s) => [s.stage, s]));
  return STAGE_ORDER.map((name) => {
    const hit = byName.get(name);
    if (!hit) {
      return { stage: name, label: STAGE_LABELS[name] || name, status: 'pending' as const, at: '' };
    }
    return {
      stage: hit.stage,
      label: STAGE_LABELS[hit.stage] || hit.stage,
      status: hit.status,
      at: hit.at,
      detail: hit.detail,
      duration_ms: hit.duration_ms,
    };
  });
}
