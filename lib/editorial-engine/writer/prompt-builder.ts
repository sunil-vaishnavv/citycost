import crypto from 'crypto';
import type { EditorialSettings, PromptTemplate } from '../types.js';
import type { StructuredContextPack } from './context-pack.js';
import type { ResearchPack } from './research-engine.js';
import {
  WRITER_HARD_BAN_PHRASES,
  WRITER_ONCE_PHRASES,
} from './section-strategies.js';
import { curatedLinksForWriter } from './link-validate.js';
import { routeWriter, routedWriterPromptBlock } from './router.js';
import { sectionWritersForHeadings } from './section-writers.js';
import { stylePromptBlock } from './style-engine.js';
import { HARD_LEAKAGE } from './prompt-leakage.js';

export interface ComposedPrompt {
  system: string;
  user: string;
  prompt_version: number;
  prompt_hash: string;
  prompt_key: string;
  sizes: {
    system_chars: number;
    user_chars: number;
    research_chars: number;
    total_chars: number;
  };
}

export const WRITER_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['seo_title', 'meta_title', 'meta_description', 'excerpt', 'blocks'],
  properties: {
    seo_title: { type: 'string' },
    meta_title: { type: 'string' },
    meta_description: { type: 'string' },
    excerpt: { type: 'string' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type', 'content'],
        properties: {
          id: { type: 'string' },
          type: {
            type: 'string',
            enum: [
              'intro',
              'heading',
              'paragraph',
              'list',
              'comparison',
              'table',
              'tip',
              'warning',
              'faq',
              'summary',
            ],
          },
          heading: { type: 'string' },
          content: {},
          data_keys: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

/** Compact research brief — keeps Writer prompts under TPM ceilings. */
export function researchPackForWriter(research: ResearchPack): Record<string, unknown> {
  return {
    topic: research.topic?.title,
    content_type: research.topic?.content_type,
    intent: research.intent,
    persona: research.persona,
    angle: research.article_angle,
    primary_keyword: research.primary_keyword,
    secondary_keywords: (research.secondary_keywords || []).slice(0, 6),
    semantic_keywords: (research.semantic_keywords || []).slice(0, 8),
    required_h2: research.required_h2,
    required_h3: (research.required_h3 || []).slice(0, 8),
    required_faq: (research.required_faq || []).slice(0, 8),
    required_tables: research.required_tables,
    required_comparison_blocks: research.required_comparison_blocks,
    supporting_facts: (research.supporting_facts || []).slice(0, 8),
    facts_must_not_invent: (research.facts_must_not_invent || []).slice(0, 6),
    disclaimer_requirements: (research.disclaimer_requirements || []).slice(0, 3),
    entities: {
      cities: (research.entities?.cities || []).slice(
        0,
        research.topic?.content_type === 'country_guide' ? 8 : 4
      ),
      countries: (research.entities?.countries || []).slice(0, 4),
      currencies: (research.entities?.currencies || []).slice(0, 2),
      neighbourhoods: (research.entities?.neighbourhoods || []).slice(0, 6),
      transportation: (research.entities?.transportation || []).slice(0, 4),
      visa_names: (research.entities?.visa_names || []).slice(0, 4),
      healthcare_systems: (research.entities?.healthcare_systems || []).slice(0, 3),
    },
    pain_points: (research.user_pain_points || []).slice(0, 5),
    decision_criteria: (research.decision_criteria || []).slice(0, 5),
    common_mistakes: (research.common_mistakes || []).slice(0, 4),
    links: curatedLinksForWriter(research, 8),
    dedicated_writer: routedWriterPromptBlock(research.topic?.content_type),
    cluster: research.content_cluster,
    parent_pillar: research.parent_pillar,
    writer_contract: {
      sole_source: 'research_pack',
      must_follow_outline: true,
      must_not_invent_entities: true,
      must_not_invent_statistics: true,
      writer_id: routeWriter(research.topic?.content_type).writer.id,
    },
  };
}

function sectionWordBudget(h2Count: number, targetMid: number): number {
  const n = Math.max(8, h2Count);
  return Math.max(140, Math.round((targetMid - 400) / n));
}

/**
 * Compact prompt — Research Pack only (no pretty-print bloat).
 */
export function buildWriterPrompt(input: {
  masterPrompt: PromptTemplate;
  research: ResearchPack;
  context: StructuredContextPack;
  settings: EditorialSettings;
  organizationStyle?: string;
}): ComposedPrompt {
  const { masterPrompt, research, settings } = input;
  const hardMin = settings.article_length_min;
  const hardMax = settings.article_length_max;
  const targetMin = Math.max(settings.article_length_target_min, 2600);
  const targetMax = Math.min(Math.max(settings.article_length_target_max, targetMin), 2900);
  const targetMid = Math.round((targetMin + targetMax) / 2);
  const h2Count = (research.required_h2 || []).length || 14;
  const perH2 = sectionWordBudget(h2Count, targetMid);

  const pack = researchPackForWriter(research);
  const researchJson = JSON.stringify(pack);
  const routed = routeWriter(research.topic?.content_type);

  // Keep system short — full master prompt can blow TPM on free tiers.
  // Critical quality rules live AFTER the trim so they always apply.
  const masterTrim = masterPrompt.body.slice(0, 2200);
  const system = [
    masterTrim,
    `DEDICATED WRITER: ${routed.writer.label} (${routed.writer.id}). ${routed.writer.purpose}`,
    ...routed.writer.system_rules,
    stylePromptBlock(routed.writer.label),
    'WRITER CONTRACT: research_pack facts/entities only. Follow required_h2. No invented stats.',
    `LENGTH: target ${targetMin}-${targetMax} words (min ${hardMin}, max ${hardMax}). ~${perH2} words per H2.`,
    'SECTION WRITERS: each H2 has its own objective — Housing≠Food≠Transport≠Healthcare≠Salary≠Pros≠Cons≠Summary.',
    `ONCE-ONLY: ${WRITER_ONCE_PHRASES.slice(0, 8).join('; ')}.`,
    `HARD BAN / PROMPT LEAKAGE: ${[...WRITER_HARD_BAN_PHRASES, ...HARD_LEAKAGE.slice(0, 10)].join('; ')}.`,
    'NO FAQ in Writer output (dedicated FAQ Writer). Summary Writer owns closing recommendation.',
    'JSON only. Heading blocks separate from body.',
  ].join('\n');

  const userPayload = {
    research_pack: pack,
    writing_rules: {
      hard_min_words: hardMin,
      hard_max_words: hardMax,
      target_words: `${targetMin}-${targetMax}`,
      words_per_h2_minimum: perH2,
      grade_band: '8-10',
      avg_sentence_words: '15-20',
      paragraphs: '2-4 lines',
      unique_section_wording: true,
      no_mid_sentence_periods: true,
      no_prompt_bleed: true,
      human_editor_voice: true,
      json_only: true,
    },
    output_schema: {
      required: ['seo_title', 'meta_title', 'meta_description', 'excerpt', 'blocks'],
      block_types: [
        'intro',
        'heading',
        'paragraph',
        'list',
        'comparison',
        'table',
        'tip',
        'warning',
        'faq',
        'summary',
      ],
      notes: {
        heading_blocks: 'Emit heading blocks separately; do not duplicate heading on following paragraphs',
        faq: '[{q,a}] objects only — never stringify FAQ as raw text; answers must be direct, practical, 40–90 words, no meta/prompt language',
        summary: 'Reader-facing next steps only — no research_pack field names or internal brief language',
        table: '{headers:[], rows:[[]]} only',
        meta_description: '150-160 characters, primary keyword natural, CTR-friendly',
        meta_title: '≤60 characters',
      },
    },
    instructions: [
      'Return one JSON object only.',
      'Follow research_pack.required_h2 exactly: one heading block + unique paragraph/list body (no duplicate heading field).',
      'Include TOC after intro, summary/conclusion with NEW wording, and required tables/comparisons. Omit FAQ (generated separately).',
      'Weave research_pack.links as natural markdown links inside decision sentences — never "Cross-check X".',
      'Use bullets only when a checklist or comparison of 3+ items is clearer than prose.',
      'Pros = strengths only. Cons = weaknesses only. Housing = practical trade-offs. Summary = actions this week.',
      `Write ${targetMin}+ words. Short drafts fail.`,
    ],
  };

  const user = JSON.stringify(userPayload); // compact — no pretty print
  const prompt_hash = crypto
    .createHash('sha256')
    .update(`${masterPrompt.prompt_key}|v${masterPrompt.version}|${system}|${user}`)
    .digest('hex');

  return {
    system,
    user,
    prompt_version: masterPrompt.version,
    prompt_hash,
    prompt_key: masterPrompt.prompt_key,
    sizes: {
      system_chars: system.length,
      user_chars: user.length,
      research_chars: researchJson.length,
      total_chars: system.length + user.length,
    },
  };
}

/** Section-batch prompt: generate only a few H2s — keeps TPM small. */
export function buildSectionBatchPrompt(input: {
  research: ResearchPack;
  sections: string[];
  wordsPerSection: number;
  links: string[];
  includeIntroToc?: boolean;
  /** @deprecated FAQ is generated by dedicated FAQ module — ignored. */
  includeFaqSummary?: boolean;
  includeSummary?: boolean;
}): { system: string; user: string } {
  const pack = researchPackForWriter(input.research);
  const routed = routeWriter(input.research.topic?.content_type);
  const sectionWriters = sectionWritersForHeadings(input.sections, routed.writer);
  const includeSummary = Boolean(input.includeSummary ?? input.includeFaqSummary);
  const writerBlock = routedWriterPromptBlock(input.research.topic?.content_type);
  const links = input.links.length
    ? input.links
    : curatedLinksForWriter(input.research, 8);
  const system = [
    `You are the ${routed.writer.label}. JSON only. research_pack facts only. No invented statistics.`,
    stylePromptBlock(routed.writer.label),
    ...routed.writer.system_rules,
    `Purpose: ${routed.writer.purpose}`,
    `Do: ${routed.writer.do.join('; ')}`,
    `Don't: ${routed.writer.dont.join('; ')}`,
    'Each section_writer has its own objective — never one shared template rhythm.',
    'Never reuse openers, closers, or advice across sections.',
    `PROMPT LEAKAGE BAN: ${HARD_LEAKAGE.slice(0, 12).join('; ')}.`,
    `ONCE-ONLY: ${WRITER_ONCE_PHRASES.slice(0, 6).join('; ')}. HARD BAN: ${WRITER_HARD_BAN_PHRASES.slice(0, 5).join('; ')}.`,
    'Never write FAQ. Summary only if include_summary. Links only from allowed_links.',
    'Heading blocks separate from body.',
  ].join(' ');
  const user = JSON.stringify({
    dedicated_writer: writerBlock,
    research_pack: {
      topic: pack.topic,
      content_type: pack.content_type,
      intent: pack.intent,
      persona: pack.persona,
      angle: pack.angle,
      primary_keyword: pack.primary_keyword,
      supporting_facts: pack.supporting_facts,
      facts_must_not_invent: pack.facts_must_not_invent,
      entities: pack.entities,
      pain_points: pack.pain_points,
      decision_criteria: pack.decision_criteria,
      common_mistakes: pack.common_mistakes,
      allowed_links: links,
      required_tables: pack.required_tables,
      required_comparison_blocks: pack.required_comparison_blocks,
    },
    section_writers: sectionWriters.map((s) => ({
      heading: s.heading,
      kind: s.kind,
      objective: s.objective,
      deliver: s.deliver,
      avoid: s.avoid,
    })),
    write_sections: input.sections,
    words_per_section: input.wordsPerSection,
    include_intro_toc: Boolean(input.includeIntroToc),
    include_summary: includeSummary,
    instructions: [
      'Return {"blocks":[...]} only.',
      input.includeIntroToc
        ? 'Start with intro matching dedicated_writer.purpose + TOC, then listed sections.'
        : 'Write ONLY listed sections: heading then paragraph/list without duplicating heading text.',
      includeSummary
        ? `Optional draft summary OK; final Summary Writer will replace it. Prefer matching: ${routed.writer.summary_brief} No FAQ.`
        : 'Do not write FAQ or summary unless those titles are listed.',
      `Each H2 ~${Math.max(150, Math.min(input.wordsPerSection, 190))} words. Follow that section_writer.objective exactly.`,
      'At most one markdown link from allowed_links. Never invent /compare/ pairs. Never prompt-instruction phrasing.',
      'Never repeat advice across sections.',
    ],
  });
  return { system, user };
}

export function buildExpansionPrompt(input: {
  research: ResearchPack;
  draft: unknown;
  currentWords: number;
  minWords: number;
  targetWords: number;
  missingH2: string[];
  missingElements: string[];
  finishReason?: string | null;
}): { system: string; user: string } {
  const need = Math.max(350, input.targetWords - input.currentWords);
  const routed = routeWriter(input.research.topic?.content_type);
  const missingSectionWriters = sectionWritersForHeadings(
    input.missingH2.slice(0, 8),
    routed.writer
  );
  const system = [
    `Expand as ${routed.writer.label}. JSON only. No invented stats/entities.`,
    stylePromptBlock(routed.writer.label),
    ...routed.writer.system_rules.slice(0, 2),
    'Do not write FAQ. No prompt leakage (Cross-check, Ask whether, Before you finalize, Indexed averages).',
    'Stay under 3200 total words.',
  ].join(' ');
  const user = JSON.stringify({
    task: 'append_blocks',
    dedicated_writer: routedWriterPromptBlock(input.research.topic?.content_type),
    current_word_count: input.currentWords,
    words_still_needed: need,
    target_word_count: input.targetWords,
    hard_minimum: input.minWords,
    hard_maximum: 3300,
    previous_finish_reason: input.finishReason || null,
    missing_h2: input.missingH2.slice(0, 8),
    section_writers: missingSectionWriters,
    missing_elements: input.missingElements.filter((e) => !/^faq/i.test(e)),
    research_pack: {
      supporting_facts: (input.research.supporting_facts || []).slice(0, 6),
      facts_must_not_invent: (input.research.facts_must_not_invent || []).slice(0, 5),
      entities: {
        cities: (input.research.entities?.cities || []).slice(0, 4),
        countries: (input.research.entities?.countries || []).slice(0, 3),
      },
      required_tables: (input.research.required_tables || []).slice(0, 2),
      links: (input.research.internal_link_candidates || []).slice(0, 6).map((l) => l.href),
    },
    instructions: [
      'Return {"blocks":[...]} NEW blocks only.',
      `Gain about ${Math.min(need, 900)} words — clear hard_minimum, never past 3200.`,
      'PRIORITY: table/comparison, then missing_h2 using section_writers. Skip FAQ (FAQ Writer). Summary Writer will finalize closing.',
      'Skip FAQ entirely.',
      'Body paragraphs 90–160 words, varied openings/endings, no repeated advice loops.',
      'Use heading blocks once; body blocks omit duplicate headings.',
      'At most two natural markdown links woven into decisions.',
    ],
  });
  return { system, user };
}
