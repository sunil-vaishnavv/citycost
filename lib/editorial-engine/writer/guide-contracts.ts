/**
 * Guide-type writing contracts — Country / City / Comparison must not share one template.
 */

export type GuideFamily = 'country' | 'city' | 'comparison' | 'supporting';

export interface GuideContract {
  family: GuideFamily;
  content_type: string;
  focus: string;
  structure: string[];
  city_role: string;
  link_policy: string;
  summary_goal: string;
  do: string[];
  dont: string[];
}

export function normalizeGuideFamily(contentType: string | null | undefined): GuideFamily {
  const t = String(contentType || '').toLowerCase();
  if (t === 'country_guide') return 'country';
  if (t === 'city_guide') return 'city';
  if (t === 'comparison_guide') return 'comparison';
  return 'supporting';
}

export function guideContractFor(contentType: string | null | undefined): GuideContract {
  const content_type = String(contentType || 'country_guide');
  const family = normalizeGuideFamily(content_type);

  if (family === 'country') {
    return {
      family,
      content_type,
      focus: 'National cost-of-living overview first; cities are examples only',
      structure: [
        'National overview',
        'What drives costs country-wide',
        'Major cities as examples (3–6 names, brief)',
        'Regional differences',
        'Typical monthly budget framing',
        'Who benefits',
        'Actionable conclusion',
      ],
      city_role:
        'Name 3–6 major cities as examples only. Never frame the article as City A vs City B. Never make two cities the subject of every section.',
      link_policy:
        'Prefer /country/{slug}, same-country /city/{slug} pages, /methodology, /data-sources. Avoid random /compare/X-vs-Y unless both cities are in this country and relevant.',
      summary_goal:
        'National recommendation: who the country suits, which cost lines to lock first, which city types to shortlist — not a two-city winner.',
      do: [
        'Lead with country-level housing, food, transport, healthcare patterns',
        'Use cities as examples ("e.g. Delhi vs smaller metros") not as the thesis',
        'Call out regional / metro vs smaller-city differences',
      ],
      dont: [
        'Write as if the topic is only two cities',
        'Repeat the same two city names in every section',
        'Use comparison-guide cadence (hold lifestyle constant, pick a winner)',
      ],
    };
  }

  if (family === 'city') {
    return {
      family,
      content_type,
      focus: 'One city deep-dive: neighbourhoods, lease reality, daily costs',
      structure: [
        'City hook',
        'Housing & neighbourhoods',
        'Food / transport / healthcare in this city',
        'Salary stretch in this city',
        'Pros / cons of living here',
        'Next steps for movers targeting this city',
      ],
      city_role: 'Primary subject is one city. Other cities only for brief contrast.',
      link_policy:
        'Prefer this city page, parent country page, 1–2 related same-country cities, methodology.',
      summary_goal: 'City-specific recommendation and next actions for someone moving there.',
      do: ['Name neighbourhoods when available', 'Keep advice local to this city'],
      dont: ['Turn the page into a multi-city comparison', 'Ignore neighbourhood / commute reality'],
    };
  }

  if (family === 'comparison') {
    return {
      family,
      content_type,
      focus: 'Fair side-by-side of exactly two places',
      structure: [
        'Comparison frame',
        'Housing stretch both sides',
        'Daily costs both sides',
        'Who wins on which criteria',
        'Decision recommendation',
      ],
      city_role: 'Both named cities stay in view. Hold lifestyle constant when comparing.',
      link_policy:
        'Prefer both city pages, the /compare/ pair if it matches, parent country, methodology.',
      summary_goal: 'Clear recommendation by persona (who should pick A vs B) — not a generic checklist.',
      do: ['Compare the same basket on both sides', 'Name who each city suits'],
      dont: ['Declare a universal winner', 'Drift into a national overview'],
    };
  }

  return {
    family,
    content_type,
    focus: `Specialist ${content_type.replace(/_/g, ' ')} lens on cost of living`,
    structure: ['Topic-specific overview', 'Practical cost lines', 'Who it helps', 'Next steps'],
    city_role: 'Places support the specialist topic; do not invent a fake city duel.',
    link_policy: 'Same-country and topic-relevant pages only.',
    summary_goal: 'Topic-specific recommendation with next actions.',
    do: ['Stay on the specialist angle'],
    dont: ['Reuse country or comparison templates wholesale'],
  };
}

/** Prompt-ready contract blob for Writer batches. */
export function guideContractPromptBlock(contentType: string | null | undefined): Record<string, unknown> {
  const c = guideContractFor(contentType);
  return {
    guide_family: c.family,
    content_type: c.content_type,
    focus: c.focus,
    structure: c.structure,
    city_role: c.city_role,
    link_policy: c.link_policy,
    summary_goal: c.summary_goal,
    do: c.do,
    dont: c.dont,
  };
}
