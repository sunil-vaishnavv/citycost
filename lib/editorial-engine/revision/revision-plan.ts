/**
 * Issue Planner → ONE Revision Batch Plan.
 * Collects ALL fixable issues from a Quality Report and builds a single plan
 * (word budget, affected sections, staged timeline) — never per-issue loops.
 */

import type { QualityReport } from '../reviewer/quality-report.js';
import {
  buildIssuePlan,
  type CategorizedIssue,
  type IssueCategory,
  type IssuePlan,
} from '../validation/issue-plan.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { countDraftWords } from '../writer/draft-validate.js';

export interface WordBudget {
  current: number;
  /** Soft editorial target (settings target_min or mid of range) */
  target: number;
  /** Hard floor (article_length_min) — never fail solely for being below this after expand */
  min: number;
  missing: number;
  needs_expand: boolean;
}

export interface IssueSummaryItem {
  key: string;
  label: string;
  status: 'ok' | 'issue' | 'warn';
  current?: string | number;
  target?: string | number;
  missing?: string | number;
  detail?: string;
}

export interface RevisionBatchPlan {
  issue_plan: IssuePlan;
  all_issues: CategorizedIssue[];
  issue_count: number;
  categories: IssueCategory[];
  word_budget: WordBudget;
  issue_summary: IssueSummaryItem[];
  /** Concrete section ids that may be rewritten (union of category plans) */
  affected_block_ids: string[];
  touch_meta: boolean;
  needs_faq: boolean;
  needs_summary: boolean;
  needs_toc_or_table: boolean;
  needs_links: boolean;
  needs_readability: boolean;
  needs_humanization: boolean;
  needs_word_expand: boolean;
  /** Stage ids that should run for this plan (excluding always-on bookends) */
  active_fix_stages: string[];
  /** One-line expected actions for UI / logs */
  expected_actions: string[];
}

export interface BuildRevisionPlanOptions {
  article_length_min: number;
  article_length_target_min?: number;
  article_length_target_max?: number;
}

function hasCode(issues: CategorizedIssue[], ...codes: string[]): boolean {
  const set = new Set(codes);
  return issues.some((i) => set.has(i.code));
}

function hasMsg(issues: CategorizedIssue[], re: RegExp): boolean {
  return issues.some((i) => re.test(`${i.code} ${i.message}`));
}

function buildWordBudget(
  draft: WriterDraftPayload,
  plan: IssuePlan,
  opts: BuildRevisionPlanOptions
): WordBudget {
  const current = countDraftWords(draft);
  const min = Math.max(1, opts.article_length_min || 1800);
  const target =
    opts.article_length_target_min && opts.article_length_target_min > 0
      ? opts.article_length_target_min
      : min;
  const wordIssue = plan.all_issues.find(
    (i) => i.code === 'word_count_low' || i.code === 'word_count_below_target'
  );
  const parsedFromMsg = wordIssue?.message.match(/(\d+)\s*\/\s*(\d+)/);
  const msgCurrent = parsedFromMsg ? Number(parsedFromMsg[1]) : current;
  const msgTarget = parsedFromMsg ? Number(parsedFromMsg[2]) : target;
  const effectiveCurrent = Number.isFinite(msgCurrent) ? msgCurrent : current;
  const effectiveTarget = Number.isFinite(msgTarget) && msgTarget > 0 ? msgTarget : target;
  const missing = Math.max(0, Math.max(min, effectiveTarget) - effectiveCurrent);
  const needs_expand =
    missing > 0 ||
    effectiveCurrent < min ||
    hasCode(plan.all_issues, 'word_count_low', 'word_count_below_target');
  return {
    current: effectiveCurrent,
    target: effectiveTarget,
    min,
    missing,
    needs_expand,
  };
}

function buildIssueSummary(
  report: QualityReport,
  plan: IssuePlan,
  word: WordBudget,
  draft: WriterDraftPayload
): IssueSummaryItem[] {
  const issues = plan.all_issues;
  const readability = report.scores?.readability ?? null;
  const bodyLinks = (draft.blocks || []).some((b) =>
    /\]\(\/(?:cost-of-living|compare|cities|countries|blog)\//i.test(
      JSON.stringify(b.content || '')
    )
  );
  const hasFaq = (draft.blocks || []).some((b) => b.type === 'faq');
  const hasSummary = (draft.blocks || []).some((b) => b.type === 'summary');
  const hasTable = (draft.blocks || []).some(
    (b) =>
      b.type === 'table' ||
      (Array.isArray((b.content as { rows?: unknown })?.rows) &&
        ((b.content as { rows: unknown[] }).rows?.length || 0) > 0)
  );
  const dupHeadings = hasCode(issues, 'duplicate_heading') || hasMsg(issues, /duplicate heading/i);

  const items: IssueSummaryItem[] = [
    {
      key: 'word_count',
      label: 'Word count',
      status: word.needs_expand ? 'issue' : 'ok',
      current: word.current,
      target: word.target,
      missing: word.missing,
      detail: word.needs_expand
        ? `${word.current} / ${word.target} (missing ${word.missing})`
        : `${word.current} / ${word.target}`,
    },
    {
      key: 'readability',
      label: 'Readability',
      status:
        (readability != null && readability < 55) || hasCode(issues, 'readability', 'weak_readability')
          ? 'issue'
          : readability != null && readability < 70
            ? 'warn'
            : 'ok',
      current: readability ?? '—',
      target: 55,
      detail: readability != null ? `score ${readability} (pass ≥55)` : undefined,
    },
    {
      key: 'missing_table',
      label: 'Comparison table',
      status:
        hasCode(issues, 'missing_toc') || hasMsg(issues, /missing table|table of contents|\btoc\b/i)
          ? 'issue'
          : hasTable
            ? 'ok'
            : 'warn',
      current: hasTable ? 'present' : 'missing',
      target: 'present',
    },
    {
      key: 'missing_links',
      label: 'Internal links',
      status:
        hasCode(issues, 'missing_internal_links') || hasMsg(issues, /internal link/i)
          ? 'issue'
          : bodyLinks
            ? 'ok'
            : 'warn',
      current: bodyLinks ? 'present' : 'missing',
      target: '≥1 in body',
    },
    {
      key: 'duplicate_headings',
      label: 'Duplicate headings',
      status: dupHeadings ? 'issue' : 'ok',
      current: dupHeadings ? 'found' : 'none',
      target: 'unique',
    },
    {
      key: 'faq',
      label: 'FAQ',
      status: hasCode(issues, 'missing_faq', 'type_require_faq') ? 'issue' : hasFaq ? 'ok' : 'warn',
      current: hasFaq ? 'present' : 'missing',
      target: 'present',
    },
    {
      key: 'summary',
      label: 'Summary',
      status: hasCode(issues, 'missing_summary') ? 'issue' : hasSummary ? 'ok' : 'warn',
      current: hasSummary ? 'present' : 'missing',
      target: 'present',
    },
    {
      key: 'human_writing',
      label: 'Human writing',
      status:
        hasCode(issues, 'human_writing', 'weak_human_writing', 'forbidden_phrase') ||
        hasMsg(issues, /human writing|prompt.?leak|ai-tell|repetition|robotic/i)
          ? 'issue'
          : (report.scores?.human_writing ?? 100) < 60
            ? 'warn'
            : 'ok',
      current: report.scores?.human_writing ?? '—',
      target: 60,
    },
    {
      key: 'seo',
      label: 'SEO / schema',
      status: plan.categories.some((c) => c.category === 'SEO') ? 'issue' : 'ok',
      detail: plan.categories
        .find((c) => c.category === 'SEO')
        ?.issues.map((i) => i.code)
        .slice(0, 4)
        .join(', '),
    },
  ];

  return items;
}

/**
 * Build ONE revision batch plan from the quality report + draft.
 */
export function buildRevisionBatchPlan(
  report: QualityReport,
  draft: WriterDraftPayload,
  opts: BuildRevisionPlanOptions
): RevisionBatchPlan {
  const issue_plan = buildIssuePlan(report, draft);
  const word_budget = buildWordBudget(draft, issue_plan, opts);
  const all_issues = issue_plan.all_issues;
  const categories = issue_plan.categories.map((c) => c.category);
  const affected_block_ids = [
    ...new Set(issue_plan.categories.flatMap((c) => c.affected_block_ids)),
  ];
  const touch_meta = issue_plan.categories.some((c) => c.touch_meta);

  const needs_faq = hasCode(all_issues, 'missing_faq', 'type_require_faq');
  const needs_summary = hasCode(all_issues, 'missing_summary');
  const needs_toc_or_table =
    hasCode(all_issues, 'missing_toc') || hasMsg(all_issues, /missing table|table of contents/i);
  const needs_links =
    hasCode(all_issues, 'missing_internal_links') || hasMsg(all_issues, /internal link/i);
  const needs_readability =
    categories.includes('READABILITY') ||
    hasCode(all_issues, 'readability', 'weak_readability') ||
    (report.scores?.readability ?? 100) < 55;
  const needs_humanization =
    categories.includes('STYLE') ||
    hasCode(all_issues, 'human_writing', 'weak_human_writing', 'forbidden_phrase') ||
    hasMsg(all_issues, /human writing|prompt.?leak|repetition|robotic|ai-tell/i);
  const needs_word_expand = word_budget.needs_expand;

  const needs_seo =
    needs_toc_or_table ||
    touch_meta ||
    categories.includes('SEO') ||
    hasCode(all_issues, 'missing_seo_fields', 'keyword_missing_titles');

  const active_fix_stages: string[] = [];
  if (needs_word_expand) active_fix_stages.push('expanding_words');
  if (needs_readability) active_fix_stages.push('improving_readability');
  if (needs_humanization) active_fix_stages.push('humanization');
  if (needs_links) active_fix_stages.push('fixing_links');
  if (needs_seo) active_fix_stages.push('seo_repair');
  if (needs_faq) active_fix_stages.push('updating_faq');
  if (needs_summary) active_fix_stages.push('updating_summary');
  // Always run one AI / deterministic batch when there is work
  if (all_issues.length > 0 || needs_word_expand) {
    if (!active_fix_stages.includes('applying_batch')) {
      active_fix_stages.push('applying_batch');
    }
  }

  const expected_actions = [
    ...new Set(issue_plan.categories.flatMap((c) => c.expected_fixes)),
  ].slice(0, 16);

  if (needs_word_expand) {
    expected_actions.unshift(
      `Expand body by ~${word_budget.missing || Math.max(0, word_budget.min - word_budget.current)} words (current ${word_budget.current} → target ${word_budget.target})`
    );
  }

  return {
    issue_plan,
    all_issues,
    issue_count: all_issues.length,
    categories,
    word_budget,
    issue_summary: buildIssueSummary(report, issue_plan, word_budget, draft),
    affected_block_ids,
    touch_meta,
    needs_faq,
    needs_summary,
    needs_toc_or_table,
    needs_links,
    needs_readability,
    needs_humanization,
    needs_word_expand,
    active_fix_stages,
    expected_actions,
  };
}
