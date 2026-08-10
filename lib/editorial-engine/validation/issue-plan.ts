/**
 * Unified issue plan — Reviewer findings → revision categories.
 * Reviewer and Revision Engine share this catalog (no duplicate rules).
 */

import type { QualityReport } from '../reviewer/quality-report.js';
import type { DraftBlock, WriterDraftPayload } from '../writer/draft-validate.js';

export type IssueCategory = 'STRUCTURE' | 'READABILITY' | 'STYLE' | 'SEO';

export const ISSUE_CATEGORY_ORDER: IssueCategory[] = [
  'STRUCTURE',
  'SEO',
  'READABILITY',
  'STYLE',
];

export interface CategorizedIssue {
  category: IssueCategory;
  code: string;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  expected_fix: string;
}

export interface CategoryPlan {
  category: IssueCategory;
  issues: CategorizedIssue[];
  expected_fixes: string[];
  /** Block ids / meta keys Revision may rewrite for this category */
  affected_block_ids: string[];
  touch_meta: boolean;
}

export interface IssuePlan {
  categories: CategoryPlan[];
  /** First unfinished category in priority order */
  primary: CategoryPlan | null;
  all_issues: CategorizedIssue[];
}

const STRUCTURE_CODES = new Set([
  'missing_intro',
  'missing_faq',
  'missing_summary',
  'missing_toc',
  'too_few_blocks',
  'empty_block',
  'duplicate_heading',
  'duplicate_block_id',
  'missing_block_id',
  'type_require_faq',
  'missing_actionable_tip',
  'word_count_low',
  'word_count_below_target',
  'word_count_high',
]);

const SEO_CODES = new Set([
  'missing_seo_fields',
  'keyword_missing_titles',
  'html_or_markdown',
  'missing_internal_links',
  'meta_title_short',
  'meta_title_long',
  'meta_description_short',
  'meta_description_long',
]);

function expectedFixFor(code: string, message: string): string {
  switch (code) {
    case 'missing_intro':
      return 'Ensure a non-empty intro block exists with a clear opening.';
    case 'missing_faq':
      return 'Add a FAQ block with at least 3 Q&A pairs grounded in the draft.';
    case 'missing_summary':
      return 'Add a summary/takeaways block with concrete bullets.';
    case 'missing_toc':
      return 'Insert a Table of Contents list after intro from H2 headings.';
    case 'duplicate_heading':
      return 'Make every heading unique; rewrite duplicates meaningfully (not tiny suffixes only).';
    case 'empty_block':
      return 'Fill or remove empty blocks; never leave blank body sections.';
    case 'missing_seo_fields':
      return 'Fill seo_title, meta_title, meta_description, and excerpt within length limits.';
    case 'meta_title_short':
      return 'Expand meta_title to 30–60 characters with the primary topic naturally.';
    case 'meta_title_long':
      return 'Trim meta_title to ≤60 characters without dropping the primary keyword.';
    case 'meta_description_short':
      return 'Expand meta_description to 150–160 characters with a clear cost benefit.';
    case 'meta_description_long':
      return 'Trim meta_description to ≤160 characters.';
    case 'word_count_low':
    case 'word_count_below_target':
      return 'Expand thin sections with concrete cost/context detail (no invented prices).';
    case 'word_count_high':
      return 'Tighten dense sections without dropping required blocks.';
    case 'forbidden_phrase':
      return 'Rewrite AI filler phrases into natural editorial prose.';
    case 'html_or_markdown':
      return 'Remove raw HTML/Markdown; keep plain structured blocks.';
    case 'keyword_missing_titles':
      return 'Include the primary keyword naturally in meta_title / seo_title.';
    case 'missing_internal_links':
      return 'Add in-body markdown or HTML internal links to related CityCost paths (not SEO package only).';
    default:
      return `Resolve: ${message}`;
  }
}

function categorizeRuleCode(code: string): IssueCategory {
  if (STRUCTURE_CODES.has(code)) return 'STRUCTURE';
  if (SEO_CODES.has(code)) return 'SEO';
  if (code === 'forbidden_phrase') return 'STYLE';
  return 'STRUCTURE';
}

function categorizeText(text: string): IssueCategory {
  const t = text.toLowerCase();
  if (
    /duplicate heading|missing (intro|faq|summary|toc|table of contents)|too few blocks|empty block|word count|heading hierarchy|h3|table\b/.test(
      t
    )
  ) {
    return 'STRUCTURE';
  }
  if (
    /meta|seo_title|meta_title|meta_description|excerpt|schema|keyword|title length|description length/.test(
      t
    )
  ) {
    return 'SEO';
  }
  if (
    /readability|sentence|paragraph|dense|transition|flesch|grade level|long sentence/.test(t)
  ) {
    return 'READABILITY';
  }
  if (
    /human writing|ai.?sound|repetition|filler|forbidden|robotic|generic|additionally|furthermore|in conclusion/.test(
      t
    )
  ) {
    return 'STYLE';
  }
  if (/eeat|helpful|search intent|rewrite_required|ai reviewer/.test(t)) {
    return 'STYLE';
  }
  return 'READABILITY';
}

function severityFromPrefix(raw: string): 'critical' | 'major' | 'minor' {
  if (/^\[critical\]/i.test(raw)) return 'critical';
  if (/^\[major\]/i.test(raw)) return 'major';
  if (/^\[minor\]/i.test(raw)) return 'minor';
  return 'major';
}

function stripSeverity(raw: string): string {
  return raw.replace(/^\[(critical|major|minor)\]\s*/i, '').trim();
}

function selectAffectedBlocks(
  draft: WriterDraftPayload,
  category: IssueCategory,
  issues: CategorizedIssue[]
): { ids: string[]; touch_meta: boolean } {
  const blocks = draft.blocks || [];
  const ids = new Set<string>();
  let touch_meta = category === 'SEO';

  const byType = (types: string[]) => {
    for (const b of blocks) {
      if (types.includes(b.type)) ids.add(b.id);
    }
  };

  if (category === 'STRUCTURE') {
    const msgs = issues.map((i) => i.message.toLowerCase() + i.code).join(' ');
    if (/missing_intro|intro/.test(msgs)) byType(['intro']);
    if (/missing_faq|faq/.test(msgs)) byType(['faq']);
    if (/missing_summary|summary|takeaway/.test(msgs)) byType(['summary']);
    if (/missing_toc|table of contents|toc/.test(msgs)) {
      byType(['list', 'intro', 'heading']);
    }
    if (/duplicate_heading|heading/.test(msgs)) byType(['heading']);
    if (/empty_block|word_count|too_few/.test(msgs)) {
      byType(['intro', 'paragraph', 'section', 'comparison', 'faq', 'summary']);
    }
    // Always include headings for structure passes
    byType(['heading']);
  } else if (category === 'SEO') {
    touch_meta = true;
    byType(['heading', 'intro', 'summary']);
  } else if (category === 'READABILITY') {
    for (const b of blocks) {
      if (b.type === 'heading') continue;
      const len = JSON.stringify(b.content || '').length;
      if (len > 280 || ['intro', 'paragraph', 'section', 'comparison', 'summary'].includes(b.type)) {
        ids.add(b.id);
      }
    }
  } else if (category === 'STYLE') {
    const msgs = issues.map((i) => `${i.code} ${i.message}`).join(' ').toLowerCase();
    const repetitionFocus = /repetition|template|boilerplate|overused|duplicate|identical|robotic/.test(
      msgs
    );
    if (repetitionFocus) {
      // Prefer body paragraphs most likely to hold repeated template prose
      byType(['paragraph', 'intro', 'summary', 'tip']);
    } else {
      byType(['intro', 'summary', 'faq', 'paragraph', 'section', 'comparison', 'tip']);
    }
  }

  // Cap affected set — rewrite these sections only (tighter for style)
  const styleCap = category === 'STYLE' ? 6 : 14;
  const ordered = blocks.filter((b) => ids.has(b.id)).map((b) => b.id);
  const capped = ordered.slice(0, styleCap);
  if (!capped.length && blocks.length) {
    return {
      ids: blocks
        .filter((b) => b.type !== 'heading')
        .slice(0, 6)
        .map((b) => b.id),
      touch_meta,
    };
  }
  return { ids: capped, touch_meta };
}

/**
 * Build categorized revision plan from a QualityReport (same source Reviewer produced).
 */
export function buildIssuePlan(
  report: QualityReport,
  draft: WriterDraftPayload,
  skipCategories: IssueCategory[] = []
): IssuePlan {
  const bucket = new Map<IssueCategory, CategorizedIssue[]>();
  for (const c of ISSUE_CATEGORY_ORDER) bucket.set(c, []);

  const push = (issue: CategorizedIssue) => {
    bucket.get(issue.category)!.push(issue);
  };

  for (const f of report.rule_validator?.findings || []) {
    const category = categorizeRuleCode(f.code);
    push({
      category,
      code: f.code,
      severity: f.severity,
      message: f.message,
      expected_fix: expectedFixFor(f.code, f.message),
    });
  }

  for (const finding of report.readability?.findings || []) {
    push({
      category: 'READABILITY',
      code: 'readability',
      severity: 'major',
      message: finding,
      expected_fix: 'Shorten long sentences, break dense paragraphs, improve transitions.',
    });
  }

  for (const finding of report.human_writing?.findings || []) {
    push({
      category: 'STYLE',
      code: 'human_writing',
      severity: 'major',
      message: finding,
      expected_fix: 'Rewrite AI-sounding / repetitive prose into natural editorial voice.',
    });
  }

  for (const finding of [...(report.eeat?.findings || []), ...(report.helpful_content?.findings || [])]) {
    push({
      category: 'STYLE',
      code: 'eeat_helpful',
      severity: 'minor',
      message: finding,
      expected_fix: 'Strengthen helpful, specific guidance without inventing facts.',
    });
  }

  for (const finding of report.search_intent?.findings || []) {
    push({
      category: 'SEO',
      code: 'search_intent',
      severity: 'major',
      message: finding,
      expected_fix: 'Align headings and opening with the search intent / keyword.',
    });
  }

  if (report.duplicate?.is_duplicate || report.duplicate?.decision === 'manual_review') {
    push({
      category: 'STYLE',
      code: 'near_duplicate_critical',
      severity: 'critical',
      message: `Near-duplicate similarity ${report.duplicate.max_similarity}`,
      expected_fix: 'Rewrite overlapping body sections with original structure and wording.',
    });
  } else if (report.duplicate?.is_warning || report.duplicate?.decision === 'warning') {
    push({
      category: 'STYLE',
      code: 'near_duplicate_warning',
      severity: 'major',
      message: `Similarity warning ${report.duplicate.max_similarity} (not critical)`,
      expected_fix: 'Optionally differentiate overlapping body prose; headings/TOC overlap is ignored.',
    });
  }

  if (report.ai_review && (!report.ai_review.passed || report.ai_review.rewrite_required)) {
    for (const issue of (report.ai_review.issues || []).slice(0, 8)) {
      const category = categorizeText(issue);
      push({
        category,
        code: 'ai_review',
        severity: report.ai_review.rewrite_required ? 'critical' : 'major',
        message: issue,
        expected_fix: expectedFixFor('ai_review', issue),
      });
    }
  }

  // Weak score signals when no structured findings
  const scores = report.scores;
  if (scores) {
    // Align with decision gate readability_pass (>= 55)
    if ((scores.readability ?? 100) < 55 && !(bucket.get('READABILITY')!.length)) {
      push({
        category: 'READABILITY',
        code: 'weak_readability',
        severity: 'major',
        message: `Readability score ${scores.readability}`,
        expected_fix:
          'Shorten sentences (15–20 words), split dense paragraphs, simplify wording for grade 8–10.',
      });
    }
    if ((scores.human_writing ?? 100) < 60) {
      const styleMsgs = bucket.get('STYLE')!.map((i) => i.message.toLowerCase());
      const already = styleMsgs.some((m) => /human writing|prompt\/meta bleed|ai-tell/i.test(m));
      if (!already) {
        push({
          category: 'STYLE',
          code: 'weak_human_writing',
          severity: 'major',
          message: `Human writing score ${scores.human_writing}`,
          expected_fix:
            'Strip research meta (persona/intent/angle/spoke/certification). Rewrite in a sharp housing-editor voice; vary openings; remove AI-tells.',
        });
      }
    }
    if ((scores.rule_validator ?? 100) < 60 && !(bucket.get('STRUCTURE')!.length)) {
      push({
        category: 'STRUCTURE',
        code: 'weak_rules',
        severity: 'critical',
        message: `Rule validator score ${scores.rule_validator}`,
        expected_fix: 'Restore required structure blocks and unique headings.',
      });
    }
  }

  // Deduplicate by message within category
  const categories: CategoryPlan[] = [];
  for (const category of ISSUE_CATEGORY_ORDER) {
    const raw = bucket.get(category)!;
    const seen = new Set<string>();
    const issues = raw.filter((i) => {
      const key = `${i.code}|${i.message}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!issues.length) continue;
    const { ids, touch_meta } = selectAffectedBlocks(draft, category, issues);
    categories.push({
      category,
      issues,
      expected_fixes: [...new Set(issues.map((i) => i.expected_fix))],
      affected_block_ids: ids,
      touch_meta,
    });
  }

  const primary =
    categories.find((c) => !skipCategories.includes(c.category)) || null;

  return {
    categories,
    primary,
    all_issues: categories.flatMap((c) => c.issues),
  };
}

export function blocksForIds(
  draft: WriterDraftPayload,
  ids: string[]
): DraftBlock[] {
  const set = new Set(ids);
  return (draft.blocks || []).filter((b) => set.has(b.id));
}

export function countIssuesInCategory(
  plan: IssuePlan,
  category: IssueCategory
): number {
  return plan.categories.find((c) => c.category === category)?.issues.length || 0;
}
