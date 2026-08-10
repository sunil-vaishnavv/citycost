/**
 * AI Reviewer — evaluate only. Never rewrites content.
 */

import type { PromptTemplate } from '../types.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { ResearchPack } from '../writer/research-engine.js';
import { clampScore } from './text-utils.js';

export interface AiReviewerScores {
  readability: number;
  eeat: number;
  search_intent: number;
  human_writing: number;
  helpful_content: number;
}

export interface AiReviewerResult {
  passed: boolean;
  score: number;
  scores: AiReviewerScores;
  issues: string[];
  rewrite_required: boolean;
  summary: string;
  raw: unknown;
}

function extractJSON(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object in AI reviewer response');
  }
  return s.slice(start, end + 1);
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? clampScore(n) : fallback;
}

export function parseAiReviewerJson(raw: string): AiReviewerResult {
  const parsed = JSON.parse(extractJSON(raw)) as Record<string, unknown>;
  const scoresObj = (parsed.scores && typeof parsed.scores === 'object'
    ? parsed.scores
    : {}) as Record<string, unknown>;

  const scores: AiReviewerScores = {
    readability: num(scoresObj.readability, num(parsed.score, 0)),
    eeat: num(scoresObj.eeat, num(parsed.score, 0)),
    search_intent: num(scoresObj.search_intent, num(parsed.score, 0)),
    human_writing: num(scoresObj.human_writing, num(parsed.score, 0)),
    helpful_content: num(scoresObj.helpful_content, num(parsed.score, 0)),
  };

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((i) => String(i)).filter(Boolean)
    : [];

  // Guard: if model returned article-like content, reject
  if (parsed.blocks || parsed.seo_title || parsed.content) {
    throw new Error('AI reviewer attempted to return article content — rejected');
  }

  return {
    passed: Boolean(parsed.passed),
    score: num(parsed.score, 0),
    scores,
    issues,
    rewrite_required: Boolean(parsed.rewrite_required),
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    raw: parsed,
  };
}

function truncateForReview(content: unknown, maxChars: number): unknown {
  if (typeof content === 'string') {
    return content.length > maxChars ? `${content.slice(0, maxChars)}…` : content;
  }
  if (Array.isArray(content)) {
    return content.slice(0, 10).map((item) => truncateForReview(item, Math.min(maxChars, 280)));
  }
  if (content && typeof content === 'object') {
    const o = content as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' || Array.isArray(v) || (v && typeof v === 'object')) {
        out[k] = truncateForReview(v, maxChars);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return content;
}

function slimResearchForReview(research: ResearchPack | null, compact: boolean): unknown {
  if (!research) return null;
  if (!compact) return research;
  const r = research as ResearchPack & Record<string, unknown>;
  return {
    target_keyword: r.target_keyword ?? null,
    search_intent: r.search_intent ?? null,
    primary_entities: r.entities ?? null,
    outline_titles: Array.isArray(r.outline)
      ? (r.outline as Array<{ title?: string }>).slice(0, 8).map((s) => s.title || null)
      : undefined,
  };
}

export function buildReviewerUserPayload(input: {
  draft: WriterDraftPayload;
  research: ResearchPack | null;
  article: {
    id: number;
    slug: string;
    content_type: string;
    word_count: number;
  };
  deterministic_hints: {
    rule_score: number;
    readability_score: number;
    uniqueness_score: number;
    eeat_score: number;
    search_intent_score: number;
    human_writing_score: number;
    helpful_content_score: number;
  };
  /** Authoritative Rule Validator output — do not rediscover structural issues */
  validator_result?: {
    passed: boolean;
    critical_fail: boolean;
    failed_rules: Array<{ code: string; message: string }>;
    auto_fixable: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
    seo_pass: boolean;
  };
  /** Smaller prompt for Fix Issues final / fast re-checks */
  compact?: boolean;
}): string {
  const compact = Boolean(input.compact);
  const sectionCap = compact ? 700 : 2000;
  const draftPayload = {
    seo_title: input.draft.seo_title,
    meta_title: input.draft.meta_title,
    meta_description: input.draft.meta_description,
    excerpt: input.draft.excerpt,
    blocks: (input.draft.blocks || []).map((b) => ({
      id: b.id,
      type: b.type,
      heading: b.heading || null,
      content: truncateForReview(b.content, sectionCap),
    })),
  };
  return JSON.stringify(
    {
      task: 'Evaluate only. Do not rewrite. Return JSON judgment only.',
      article_meta: input.article,
      research_pack: slimResearchForReview(input.research, compact),
      draft: draftPayload,
      deterministic_hints: input.deterministic_hints,
      validator_result: input.validator_result || null,
      instructions: [
        'Rule Validator already ran on this exact normalized snapshot.',
        'Do NOT report Duplicate Heading, Missing TOC/FAQ/Intro, or other structural issues unless validator_result lists them.',
        'Focus on research fidelity, hallucinations, EEAT, helpfulness, and human writing quality.',
        'Never invent missing data claims as acceptable.',
        'Never return rewritten paragraphs or blocks.',
        'scores.* must be 0–100.',
      ],
    },
    null,
    compact ? 0 : 2
  );
}

export function reviewerSystemPrompt(prompt: PromptTemplate): string {
  return prompt.body;
}
