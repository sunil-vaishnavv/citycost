/**
 * Editorial Style Library — Brain selects one primary style before writing.
 */

import type { GuideId, StyleId, StyleProfile } from '../types.js';

const STYLES: Record<StyleId, StyleProfile> = {
  professional: {
    id: 'professional',
    label: 'Professional',
    constraints: ['Neutral expert tone', 'No slang', 'Precise but readable'],
    sentence_guidance: 'Prefer clear subject-verb sentences; vary length moderately',
  },
  conversational: {
    id: 'conversational',
    label: 'Conversational',
    constraints: ['Warm second-person sparingly', 'Avoid corporate fluff'],
    sentence_guidance: 'Natural spoken rhythm without filler questions',
  },
  analytical: {
    id: 'analytical',
    label: 'Analytical',
    constraints: ['Compare drivers explicitly', 'Show trade-offs', 'No vibes-only claims'],
    sentence_guidance: 'Use cause→effect structure; quantify only with provided facts',
  },
  financial: {
    id: 'financial',
    label: 'Financial',
    constraints: ['Budget-line framing', 'Separate rent vs everyday CPI', 'No fake yields'],
    sentence_guidance: 'Lead with cost lines; keep prose tight',
  },
  government: {
    id: 'government',
    label: 'Government',
    constraints: ['Formal clarity', 'Eligibility humility', 'No legal advice claims'],
    sentence_guidance: 'Plain-language official tone; short paragraphs',
  },
  academic: {
    id: 'academic',
    label: 'Academic',
    constraints: ['Careful hedging', 'Define terms once', 'No marketing adjectives'],
    sentence_guidance: 'Measured claims; cite categories not invented papers',
  },
  journalistic: {
    id: 'journalistic',
    label: 'Journalistic',
    constraints: ['Lead with news-you-can-use', 'Concrete examples', 'Avoid SEO spam'],
    sentence_guidance: 'Active voice; specific nouns over adjectives',
  },
  decision_first: {
    id: 'decision_first',
    label: 'Decision-first',
    constraints: ['State the decision criteria early', 'End sections with a choice'],
    sentence_guidance: 'If/then practical branching without templates',
  },
  storytelling: {
    id: 'storytelling',
    label: 'Storytelling',
    constraints: ['Scene-setting without fiction facts', 'Human stakes', 'Still evidence-bound'],
    sentence_guidance: 'Open with situation, then costs; never invent anecdotes as data',
  },
  minimalist: {
    id: 'minimalist',
    label: 'Minimalist',
    constraints: ['Cut filler', 'One idea per paragraph', 'No stacked hedges'],
    sentence_guidance: 'Short paragraphs; high information density',
  },
  friendly: {
    id: 'friendly',
    label: 'Friendly',
    constraints: ['Encouraging without cheerleading', 'Accessible vocabulary'],
    sentence_guidance: 'Plain words; avoid condescension',
  },
  authoritative: {
    id: 'authoritative',
    label: 'Authoritative',
    constraints: ['Confident where evidence exists', 'Explicit uncertainty otherwise'],
    sentence_guidance: 'Declarative tone; no hype',
  },
  consultative: {
    id: 'consultative',
    label: 'Consultative',
    constraints: ['Advisor framing', 'Next steps', 'Trade-off tables in prose'],
    sentence_guidance: 'Recommend options with conditions',
  },
};

export function getStyle(id: StyleId): StyleProfile {
  return STYLES[id];
}

export function selectStyle(input: {
  guide_id: GuideId;
  content_type?: string | null;
  persona_id?: string;
}): StyleProfile {
  const g = input.guide_id;
  const p = input.persona_id || '';
  if (g === 'visa' || g === 'tax') return STYLES.government;
  if (g === 'salary' || g === 'budget' || g === 'rent') return STYLES.financial;
  if (g === 'comparison') return STYLES.analytical;
  if (g === 'moving') return STYLES.decision_first;
  if (g === 'travel') return STYLES.conversational;
  if (g === 'healthcare') return STYLES.authoritative;
  if (g === 'student' || /student/.test(p)) return STYLES.friendly;
  if (g === 'remote') return STYLES.consultative;
  if (g === 'retirement') return STYLES.professional;
  if (/investor|entrepreneur/.test(p)) return STYLES.analytical;
  if (/nomad|backpacker/.test(p)) return STYLES.storytelling;
  return STYLES.journalistic;
}

export function stylePromptBlock(style: StyleProfile): string {
  return [
    `STYLE=${style.label}`,
    ...style.constraints.map((c) => `- ${c}`),
    `Sentence guidance: ${style.sentence_guidance}`,
  ].join('\n');
}
