/**
 * Revision prompts — exact failed / auto-fixable rules only; patch affected sections.
 */

import type { RuleFinding } from '../reviewer/rule-validator.js';
import type { ResearchPack } from '../writer/research-engine.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { REVISION_PROMPT_VERSION } from './revision-types.js';

export function revisionSystemPrompt(): string {
  return `You are CityCost Revision Engine (${REVISION_PROMPT_VERSION}).
Single-pass issue-plan patcher (one revision cycle — no loops).

Rules:
- You receive failed_rules plus an issue plan (categories + expected_fixes).
- Patch ONLY affected_sections (by block id). Do NOT regenerate the whole article.
- Never rewrite healthy sections that are not listed.
- Never invent facts, prices, taxes, visas, or statistics.
- Preserve markdown links [text](/path) and HTML <a href="/…"> anchors.
- Preserve block ids and types.
- NEVER shrink section content. Patches must keep or expand word count vs the section you received.
- If word_count_low is listed, expand thin sections with concrete housing/budget context (no invented prices).

QUALITY PATCH FOCUS (when soft quality / readability / human_writing / FAQ issues appear):
- Fix mid-sentence period fragments (e.g. "goes far. beyond" → one grammatical sentence). Do not create new fake breaks.
- Target grade 8–10 and ~15–20 words per sentence with natural rhythm (mix short and medium; avoid choppy 6–10 word staccato).
- Rewrite FAQ answers as direct, practical replies (40–90 words). Strip prompt/meta bleed: persona, intent, article_angle, "matters when you evaluate", "Keep the persona", "Supporting … spoke", "verified CityCost signals already attached".
- Rewrite summary as reader-facing next steps only — no internal brief language.
- Remove AI-tell words (robust, delve, tapestry, cornerstone, paramount, navigating X requires) and robotic H2 restatements.
- Keep or strengthen EEAT decision guidance: trade-offs, data limits, budgeting checklist.

Return JSON only:
{"meta_title":"optional","meta_description":"optional","excerpt":"optional","block_patches":[{"id":"...","heading":"optional","content":"..."}],"fixed_issues":["rule code or message fixed"],"notes":"one sentence"}
- Prefer substantial section rewrites for listed rules, not tiny trims.`;
}

function truncateContent(content: unknown, maxChars: number): unknown {
  if (typeof content === 'string') {
    return content.length > maxChars ? `${content.slice(0, maxChars)}…` : content;
  }
  if (Array.isArray(content)) {
    return content.slice(0, 12).map((item) => {
      if (typeof item === 'string') {
        return item.length > 400 ? `${item.slice(0, 400)}…` : item;
      }
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of ['q', 'a', 'question', 'answer', 'text']) {
          if (typeof o[k] === 'string') {
            const s = String(o[k]);
            out[k] = s.length > 320 ? `${s.slice(0, 320)}…` : s;
          }
        }
        return Object.keys(out).length ? out : item;
      }
      return item;
    });
  }
  return content;
}

function selectAffectedIds(draft: WriterDraftPayload, rules: RuleFinding[]): string[] {
  const codes = new Set(rules.map((r) => r.code));
  const ids: string[] = [];
  const blocks = draft.blocks || [];
  const take = (pred: (b: (typeof blocks)[0]) => boolean) => {
    for (const b of blocks) if (pred(b) && !ids.includes(b.id)) ids.push(b.id);
  };

  if (codes.has('duplicate_heading') || codes.has('missing_h3')) take((b) => b.type === 'heading');
  if (codes.has('missing_intro') || codes.has('word_count_low')) take((b) => b.type === 'intro');
  if (codes.has('missing_faq') || codes.has('type_require_faq')) take((b) => b.type === 'faq');
  if (codes.has('missing_summary')) take((b) => b.type === 'summary');
  if (codes.has('missing_toc')) take((b) => b.type === 'list' || b.type === 'intro' || b.type === 'heading');
  if (codes.has('missing_table')) take((b) => b.type === 'table' || b.type === 'comparison');
  if (codes.has('missing_internal_links') || codes.has('forbidden_phrase')) {
    take((b) =>
      b.type === 'intro' ||
      b.type === 'paragraph' ||
      b.type === 'comparison' ||
      b.type === 'summary'
    );
  }
  if (codes.has('missing_seo_fields') || codes.has('keyword_missing_titles')) {
    take((b) => b.type === 'intro' || b.type === 'heading');
  }
  // readability / content
  if ([...codes].some((c) => /readability|human|word_count|forbidden/.test(c))) {
    take((b) => b.type !== 'heading');
  }

  if (!ids.length) {
    return blocks.filter((b) => b.type !== 'heading').slice(0, 8).map((b) => b.id);
  }
  return ids.slice(0, 14);
}

export function buildRevisionUserPayload(input: {
  draft: WriterDraftPayload;
  research: ResearchPack | null;
  rules: RuleFinding[];
  attempt: number;
  max_attempts: number;
  overall_score: number;
  threshold: number;
  /** Prefer issue-plan ids when provided */
  affectedBlockIds?: string[];
  categories?: string[];
  expectedFixes?: string[];
  minWords?: number;
  currentWords?: number;
}): string {
  const touchMeta = input.rules.some((r) => r.category === 'SEO' || r.code.startsWith('meta_') || r.code === 'missing_seo_fields');
  const affectedIds =
    input.affectedBlockIds?.length
      ? input.affectedBlockIds
      : selectAffectedIds(input.draft, input.rules);
  const affected = (input.draft.blocks || []).filter((b) => affectedIds.includes(b.id));
  const minWords = input.minWords ?? 0;
  const currentWords = input.currentWords ?? 0;

  return JSON.stringify({
    attempt: input.attempt,
    max_attempts: input.max_attempts,
    quality: { overall: input.overall_score, threshold: input.threshold },
    length: {
      current_words: currentWords,
      min_words: minWords,
      must_not_shrink_below_min: minWords > 0,
    },
    issue_plan: {
      categories: input.categories || [],
      expected_fixes: input.expectedFixes || [],
    },
    failed_rules: input.rules.map((r) => ({
      code: r.code,
      severity: r.severity,
      category: r.category,
      message: r.message,
      auto_fixable: r.auto_fixable,
      expected_fix: r.auto_fixable
        ? `Auto-fix: ${r.message}`
        : `Resolve carefully: ${r.message}`,
    })),
    keyword: input.research?.target_keyword || null,
    meta: touchMeta
      ? {
          meta_title: input.draft.meta_title,
          meta_description: input.draft.meta_description,
          excerpt: input.draft.excerpt,
          seo_title: input.draft.seo_title,
        }
      : undefined,
    affected_sections: affected.map((b) => ({
      id: b.id,
      type: b.type,
      heading: b.heading || null,
      content: truncateContent(b.content, 900),
    })),
    instruction:
      'Patch ALL planned issues in this single pass. Only rewrite affected_sections. Leave healthy sections unchanged. Do not reduce total word count; expand if below min_words. Prefer quality rewrites that restore natural sentences, clean FAQ/summary, and human editor voice when soft quality scores are below threshold.',
  });
}
