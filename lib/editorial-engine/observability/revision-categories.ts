/**
 * Observability revision categories — broader than IssueCategory.
 * Used for history analytics; does not change revision loop targeting.
 */

import type { RuleFinding } from '../reviewer/rule-validator.js';
import type { QualityReport } from '../reviewer/quality-report.js';

export type ObservabilityRevisionCategory =
  | 'CONTENT'
  | 'STYLE'
  | 'STRUCTURE'
  | 'SEO'
  | 'READABILITY'
  | 'INTERNAL LINKS'
  | 'SCHEMA'
  | 'FACTUAL'
  | 'EEAT';

const CODE_MAP: Array<[RegExp | string, ObservabilityRevisionCategory]> = [
  ['missing_internal_links', 'INTERNAL LINKS'],
  ['broken_json_ld', 'SCHEMA'],
  ['missing_seo_fields', 'SEO'],
  ['meta_title_long', 'SEO'],
  ['meta_description_long', 'SEO'],
  ['keyword_missing_titles', 'SEO'],
  ['html_or_markdown', 'STRUCTURE'],
  ['corrupted_markdown', 'STRUCTURE'],
  ['missing_intro', 'STRUCTURE'],
  ['missing_faq', 'STRUCTURE'],
  ['missing_summary', 'STRUCTURE'],
  ['missing_toc', 'STRUCTURE'],
  ['missing_h3', 'STRUCTURE'],
  ['missing_table', 'STRUCTURE'],
  ['too_few_blocks', 'STRUCTURE'],
  ['empty_block', 'STRUCTURE'],
  ['duplicate_heading', 'STRUCTURE'],
  ['duplicate_block_id', 'STRUCTURE'],
  ['near_duplicate_critical', 'STYLE'],
  ['near_duplicate_warning', 'STYLE'],
  ['near_duplicate', 'STYLE'],
  ['missing_block_id', 'STRUCTURE'],
  ['missing_entire_section', 'STRUCTURE'],
  ['type_require_faq', 'STRUCTURE'],
  ['forbidden_phrase', 'STYLE'],
  ['word_count_low', 'CONTENT'],
  ['word_count_below_target', 'CONTENT'],
  ['word_count_high', 'CONTENT'],
  ['missing_actionable_tip', 'CONTENT'],
  [/hallucin|invent|factual|statistic/i, 'FACTUAL'],
  [/eeat|trust|expertise/i, 'EEAT'],
  [/readab|sentence|passive|grade/i, 'READABILITY'],
  [/internal.?link/i, 'INTERNAL LINKS'],
  [/schema|json.?ld/i, 'SCHEMA'],
  [/seo|meta.?title|meta.?desc|keyword/i, 'SEO'],
  [/style|tone|forbidden|robotic|phrase/i, 'STYLE'],
  [/structure|heading|h3|toc|faq|intro|table|block/i, 'STRUCTURE'],
];

export function categorizeFinding(
  code: string,
  message?: string
): ObservabilityRevisionCategory {
  const blob = `${code} ${message || ''}`;
  for (const [key, cat] of CODE_MAP) {
    if (typeof key === 'string') {
      if (code === key) return cat;
    } else if (key.test(blob)) {
      return cat;
    }
  }
  return 'CONTENT';
}

export function primaryRevisionCategory(
  findings: Array<Pick<RuleFinding, 'code' | 'message'> | string>
): ObservabilityRevisionCategory {
  const counts = new Map<ObservabilityRevisionCategory, number>();
  for (const f of findings) {
    const code = typeof f === 'string' ? f : f.code;
    const message = typeof f === 'string' ? f : f.message;
    const cat = categorizeFinding(code, message);
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  let best: ObservabilityRevisionCategory = 'CONTENT';
  let bestN = 0;
  for (const [cat, n] of counts) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

export interface RevisionCategoryMeta {
  category: ObservabilityRevisionCategory;
  categories: ObservabilityRevisionCategory[];
  rules_fixed: string[];
  rules_remaining: string[];
  score_delta: number;
}

export function buildRevisionCategoryMeta(input: {
  before_score: number | null;
  after_score: number | null;
  fixed_issues: string[];
  remaining_issues: string[];
  before_report?: QualityReport | null;
  after_report?: QualityReport | null;
}): RevisionCategoryMeta {
  const remainingCodes = (input.after_report?.rule_validator?.findings || []).map((f) => f.code);
  const beforeCodes = new Set(
    (input.before_report?.rule_validator?.findings || []).map((f) => f.code)
  );
  const afterCodes = new Set(remainingCodes);
  const fixedFromReports = [...beforeCodes].filter((c) => !afterCodes.has(c));
  const rules_fixed =
    fixedFromReports.length > 0
      ? fixedFromReports
      : input.fixed_issues.map((x) => x.slice(0, 120));
  const rules_remaining =
    remainingCodes.length > 0
      ? remainingCodes
      : input.remaining_issues.map((x) => x.slice(0, 120));

  const categorySources = [
    ...(input.after_report?.rule_validator?.findings || []),
    ...(input.before_report?.rule_validator?.findings || []),
  ];
  const categories = [
    ...new Set(categorySources.map((f) => categorizeFinding(f.code, f.message))),
  ] as ObservabilityRevisionCategory[];
  if (!categories.length && rules_fixed.length) {
    categories.push(primaryRevisionCategory(rules_fixed));
  }
  if (!categories.length) categories.push('CONTENT');

  const score_delta =
    input.before_score != null && input.after_score != null
      ? Math.round((input.after_score - input.before_score) * 10) / 10
      : 0;

  return {
    category: categories[0]!,
    categories,
    rules_fixed: rules_fixed.slice(0, 40),
    rules_remaining: rules_remaining.slice(0, 40),
    score_delta,
  };
}
