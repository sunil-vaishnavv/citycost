/**
 * Deterministic Rule Validator.
 * Auto-fixable structural issues ≠ FAIL.
 * Only non-auto-fixable / critical codes fail the validator hard.
 * Findings include explainability: reason, expected, actual, location.
 */

import type { EditorialSettings } from '../types.js';
import { headingFingerprint } from '../validation/normalize-draft.js';
import {
  countDraftWords,
  type WriterDraftPayload,
} from '../writer/draft-validate.js';
import type { ResearchPack } from '../writer/research-engine.js';
import { blockContentText, clampScore } from './text-utils.js';

export type RuleCategory = 'STRUCTURE' | 'CONTENT' | 'SEO' | 'RESEARCH';

export interface RuleFinding {
  code: string;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  category: RuleCategory;
  auto_fixable: boolean;
  /** Human-readable why this failed */
  reason: string;
  /** What the validator expected */
  expected: string;
  /** What was observed */
  actual: string;
  /** Block id / section / meta field */
  location: string;
}

export interface RuleValidatorResult {
  score: number;
  /** True when no non-auto-fixable failures remain */
  passed: boolean;
  findings: RuleFinding[];
  failed_rules: RuleFinding[];
  warnings: RuleFinding[];
  auto_fixable: RuleFinding[];
  critical_fail: boolean;
  /** SEO sub-gate (meta + links + schema-ish) */
  seo_pass: boolean;
}

const FORBIDDEN = [
  /in today's world/i,
  /in conclusion/i,
  /it is worth mentioning/i,
  /as we know/i,
  /it is important to note/i,
  /as mentioned earlier/i,
  /in this article we will/i,
];

function finding(
  code: string,
  severity: RuleFinding['severity'],
  message: string,
  category: RuleCategory,
  auto_fixable: boolean,
  explain: {
    reason: string;
    expected: string;
    actual: string;
    location: string;
  }
): RuleFinding {
  return {
    code,
    severity,
    message,
    category,
    auto_fixable,
    reason: explain.reason,
    expected: explain.expected,
    actual: explain.actual,
    location: explain.location,
  };
}

export function runRuleValidator(input: {
  draft: WriterDraftPayload;
  settings: EditorialSettings;
  research?: ResearchPack | null;
  qualityRules?: Record<string, unknown> | null;
}): RuleValidatorResult {
  const { draft, settings } = input;
  const findings: RuleFinding[] = [];
  const blocks = draft.blocks || [];

  for (const key of ['seo_title', 'meta_title', 'meta_description', 'excerpt'] as const) {
    if (!draft[key]?.trim()) {
      findings.push(
        finding('missing_seo_fields', 'major', `Missing ${key}`, 'SEO', true, {
          reason: `Required SEO field ${key} is empty`,
          expected: `Non-empty ${key}`,
          actual: draft[key] ? String(draft[key]).slice(0, 40) : '(empty)',
          location: `meta.${key}`,
        })
      );
    }
  }
  const metaTitleLen = (draft.meta_title || '').trim().length;
  if (metaTitleLen > 0 && metaTitleLen < 30) {
    findings.push(
      finding('meta_title_short', 'major', `Meta title too short (${metaTitleLen})`, 'SEO', true, {
        reason: 'Meta title below recommended SERP length (matches publish SEO validation)',
        expected: '30–60 characters',
        actual: `${metaTitleLen} characters`,
        location: 'meta.meta_title',
      })
    );
  } else if (metaTitleLen > 60) {
    findings.push(
      finding('meta_title_long', 'minor', 'Meta title longer than 60 chars', 'SEO', true, {
        reason: 'Meta title exceeds recommended SERP length',
        expected: '≤ 60 characters',
        actual: `${metaTitleLen} characters`,
        location: 'meta.meta_title',
      })
    );
  }
  const metaDescLen = (draft.meta_description || '').trim().length;
  if (metaDescLen > 0 && metaDescLen < 150) {
    findings.push(
      finding(
        'meta_description_short',
        'major',
        `Meta description too short (${metaDescLen})`,
        'SEO',
        true,
        {
          reason: 'Meta description below recommended SERP length (matches publish SEO validation)',
          expected: '150–160 characters',
          actual: `${metaDescLen} characters`,
          location: 'meta.meta_description',
        }
      )
    );
  } else if (metaDescLen > 160) {
    findings.push(
      finding(
        'meta_description_long',
        'minor',
        'Meta description longer than 160 chars',
        'SEO',
        true,
        {
          reason: 'Meta description exceeds recommended SERP length',
          expected: '≤ 160 characters',
          actual: `${metaDescLen} characters`,
          location: 'meta.meta_description',
        }
      )
    );
  }

  if (blocks.length < 8) {
    findings.push(
      finding(
        'too_few_blocks',
        'major',
        `Only ${blocks.length} blocks (expect ≥8)`,
        'STRUCTURE',
        true,
        {
          reason: 'Article body has fewer content blocks than the editorial minimum',
          expected: '≥ 8 blocks',
          actual: `${blocks.length} blocks`,
          location: 'draft.blocks',
        }
      )
    );
  }

  let hasIntro = false;
  let hasFaq = false;
  let hasSummary = false;
  let hasToc = false;
  let hasTip = false;
  let hasTable = false;
  let hasH3 = false;
  let hasInternalLink = false;
  let faqCount = 0;
  const headingFps = new Map<string, string>();
  const headingLocations = new Map<string, string>();
  const ids = new Set<string>();

  for (const block of blocks) {
    if (!block?.id) {
      findings.push(
        finding('missing_block_id', 'minor', 'Block missing id', 'STRUCTURE', true, {
          reason: 'Every block must have a stable id for revision targeting',
          expected: 'Unique block.id string',
          actual: '(missing)',
          location: `block[${block?.type || 'unknown'}]`,
        })
      );
    } else if (ids.has(block.id)) {
      findings.push(
        finding(
          'duplicate_block_id',
          'major',
          `Duplicate block id ${block.id}`,
          'STRUCTURE',
          true,
          {
            reason: 'Block ids must be unique across the draft',
            expected: 'Unique id',
            actual: `Duplicate id "${block.id}"`,
            location: `block:${block.id}`,
          }
        )
      );
    } else ids.add(block.id);

    const text = blockContentText(block).trim();
    const heading = (block.heading || '').trim();
    const loc = block.id ? `block:${block.id}` : `block[${block.type || '?'}]`;

    if (!text && block.type !== 'heading') {
      findings.push(
        finding('empty_block', 'major', `Empty block ${block.id || '?'}`, 'STRUCTURE', true, {
          reason: 'Content block has no text',
          expected: 'Non-empty block content',
          actual: '(empty)',
          location: loc,
        })
      );
    }

    if (heading || block.type === 'heading') {
      const label = heading || (typeof block.content === 'string' ? block.content : '');
      const fp = headingFingerprint(label);
      if (fp) {
        if (headingFps.has(fp)) {
          const firstLoc = headingLocations.get(fp) || 'unknown';
          findings.push(
            finding(
              'duplicate_heading',
              'major',
              `Duplicate heading: ${label}`,
              'STRUCTURE',
              true,
              {
                reason: 'Two headings normalize to the same fingerprint',
                expected: 'Unique heading text per section',
                actual: `"${label}" also appears at ${firstLoc}`,
                location: `${firstLoc} → ${loc}`,
              }
            )
          );
        } else {
          headingFps.set(fp, label);
          headingLocations.set(fp, loc);
        }
      } else if (block.type === 'heading') {
        findings.push(
          finding('empty_heading', 'major', 'Empty heading block', 'STRUCTURE', true, {
            reason: 'Heading block has no usable text',
            expected: 'Non-empty heading',
            actual: '(empty)',
            location: loc,
          })
        );
      }
      if (/table of contents|^contents$/i.test(label)) hasToc = true;
      if (/^h3:|###\s/i.test(label) || (block.type === 'heading' && /:\s*\w+/.test(label))) {
        hasH3 = true;
      }
    }

    if (block.type === 'heading' && headingFps.size > 3) hasH3 = true;

    if (block.type === 'intro') hasIntro = true;
    if (block.type === 'faq') {
      hasFaq = true;
      if (Array.isArray(block.content)) faqCount = Math.max(faqCount, block.content.length);
      else if (text) faqCount = Math.max(faqCount, 1);
    }
    if (block.type === 'summary') hasSummary = true;
    if (block.type === 'tip') hasTip = true;
    if (block.type === 'table') hasTable = true;
    if (block.type === 'list' && /table of contents|contents/i.test(heading + text)) {
      hasToc = true;
    }

    const blob = `${heading}\n${text}`;
    if (/href=["']\/[a-z0-9/-]+/i.test(blob) || /\]\(\/[a-z0-9/-]+/i.test(blob)) {
      hasInternalLink = true;
    }

    // Allow intentional <a href> anchors; flag other HTML as corruption
    const withoutAnchors = blob
      .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')
      .replace(/<\/?a\b[^>]*>/gi, ' ');
    if (/<\/?[a-z][\s\S]*>/i.test(withoutAnchors)) {
      findings.push(
        finding(
          'corrupted_markdown',
          'critical',
          `Possible HTML/corrupted markup in block ${block.id || '?'}`,
          'STRUCTURE',
          false,
          {
            reason: 'HTML tags detected in structured draft content',
            expected: 'Plain structured JSON content (no HTML except <a href> links)',
            actual: 'HTML-like markup present',
            location: loc,
          }
        )
      );
    } else if (/(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[-*]\s/.test(blob)) {
      findings.push(
        finding(
          'html_or_markdown',
          'major',
          `Possible Markdown residue in block ${block.id || '?'}`,
          'STRUCTURE',
          true,
          {
            reason: 'Markdown heading/list syntax leaked into block text',
            expected: 'Structured fields without Markdown markers',
            actual: 'Markdown-like residue detected',
            location: loc,
          }
        )
      );
    }

    for (const re of FORBIDDEN) {
      if (re.test(blob)) {
        findings.push(
          finding(
            'forbidden_phrase',
            'minor',
            `Forbidden phrase matched (${re.source}) in ${block.id || 'block'}`,
            'CONTENT',
            true,
            {
              reason: 'Draft uses a forbidden AI/filler phrase',
              expected: 'Natural editorial phrasing without banned stock phrases',
              actual: `Matched /${re.source}/`,
              location: loc,
            }
          )
        );
      }
    }
  }

  if (!hasIntro) {
    findings.push(
      finding('missing_intro', 'major', 'Missing intro block', 'STRUCTURE', true, {
        reason: 'No intro block found in draft.blocks',
        expected: 'At least one block with type "intro"',
        actual: '0 intro blocks',
        location: 'draft.blocks',
      })
    );
  }
  if (!hasFaq) {
    findings.push(
      finding('missing_faq', 'major', 'Missing FAQ block', 'STRUCTURE', true, {
        reason: 'FAQ section is required for this content type / editorial standard',
        expected: 'FAQ block with ≥3 Q&A pairs',
        actual: `found ${faqCount}`,
        location: 'draft.blocks (type=faq)',
      })
    );
  }
  if (!hasSummary) {
    findings.push(
      finding(
        'missing_summary',
        'major',
        'Missing summary/takeaways block',
        'STRUCTURE',
        true,
        {
          reason: 'Key takeaways / summary block is missing',
          expected: 'Block type "summary"',
          actual: '0 summary blocks',
          location: 'draft.blocks',
        }
      )
    );
  }
  if (!hasToc) {
    findings.push(
      finding('missing_toc', 'major', 'Missing table of contents', 'STRUCTURE', true, {
        reason: 'No table of contents list/heading detected',
        expected: 'TOC list or heading after intro',
        actual: 'not found',
        location: 'draft.blocks',
      })
    );
  }
  if (!hasH3 && headingFps.size >= 4) {
    findings.push(
      finding(
        'missing_h3',
        'minor',
        'Missing subsection (H3) depth under main headings',
        'STRUCTURE',
        true,
        {
          reason: 'Article has multiple H2-level headings but no subsection depth',
          expected: 'H3 subsections under main sections',
          actual: 'none found',
          location: 'headings',
        }
      )
    );
  }
  if (!hasTable) {
    findings.push(
      finding(
        'missing_table',
        'minor',
        'Missing comparison/cost table',
        'STRUCTURE',
        true,
        {
          reason: 'No structured table block for comparisons or costs',
          expected: 'At least one table block',
          actual: '0 tables',
          location: 'draft.blocks (type=table)',
        }
      )
    );
  }
  if (!hasInternalLink) {
    findings.push(
      finding('missing_internal_links', 'major', 'Missing internal links', 'SEO', true, {
        reason: 'No in-body CityCost internal links detected',
        expected: '≥1 markdown/HTML internal link to /… paths',
        actual: '0 internal links in body',
        location: 'draft.blocks content',
      })
    );
  }
  if (!hasTip) {
    findings.push(
      finding(
        'missing_actionable_tip',
        'minor',
        'No tip block — actionable advice may be weak',
        'CONTENT',
        true,
        {
          reason: 'Actionable tip/advice block not present',
          expected: 'Block type "tip"',
          actual: '0 tip blocks',
          location: 'draft.blocks',
        }
      )
    );
  }

  if (blocks.length < 3) {
    findings.push(
      finding(
        'missing_entire_section',
        'critical',
        'Article missing entire required section set',
        'STRUCTURE',
        false,
        {
          reason: 'Draft is a hollow shell with almost no sections',
          expected: '≥ 3 substantive blocks covering required sections',
          actual: `${blocks.length} blocks`,
          location: 'draft.blocks',
        }
      )
    );
  }

  if (input.qualityRules?.require_faq && !hasFaq) {
    findings.push(
      finding('type_require_faq', 'major', 'Content-type requires FAQ', 'STRUCTURE', true, {
        reason: 'Content-type quality rules require a FAQ section',
        expected: 'FAQ block present',
        actual: 'missing',
        location: 'quality_rules.require_faq',
      })
    );
  }

  const words = countDraftWords(draft);
  if (words < settings.article_length_min) {
    findings.push(
      finding(
        'word_count_low',
        'major',
        `Word count ${words} below minimum ${settings.article_length_min}`,
        'CONTENT',
        true,
        {
          reason: 'Article is shorter than the configured minimum length',
          expected: `≥ ${settings.article_length_min} words`,
          actual: `${words} words`,
          location: 'draft (word count)',
        }
      )
    );
  } else if (words < settings.article_length_target_min) {
    findings.push(
      finding(
        'word_count_below_target',
        'minor',
        `Word count ${words} below target min ${settings.article_length_target_min}`,
        'CONTENT',
        true,
        {
          reason: 'Article is below the target minimum length',
          expected: `≥ ${settings.article_length_target_min} words`,
          actual: `${words} words`,
          location: 'draft (word count)',
        }
      )
    );
  }
  if (words > settings.article_length_max) {
    findings.push(
      finding(
        'word_count_high',
        'major',
        `Word count ${words} above maximum ${settings.article_length_max}`,
        'CONTENT',
        true,
        {
          reason: 'Article exceeds the configured maximum length',
          expected: `≤ ${settings.article_length_max} words`,
          actual: `${words} words`,
          location: 'draft (word count)',
        }
      )
    );
  }

  if (input.research?.target_keyword) {
    const hay = `${draft.seo_title} ${draft.meta_title} ${draft.meta_description}`.toLowerCase();
    const kw = input.research.target_keyword.toLowerCase().split(/\s+/).slice(0, 3).join(' ');
    if (kw && !hay.includes(kw.split(' ')[0]!)) {
      findings.push(
        finding(
          'keyword_missing_titles',
          'minor',
          'Primary keyword signal weak in titles/meta',
          'SEO',
          true,
          {
            reason: 'Primary keyword token not reflected in titles/meta',
            expected: `Include signal for "${input.research.target_keyword}"`,
            actual: 'Primary token not found in titles/meta',
            location: 'meta.seo_title|meta_title|meta_description',
          }
        )
      );
    }
  }

  const corpus = blocks.map((b) => blockContentText(b)).join('\n');
  if (/@type\s*:\s*|application\/ld\+json/i.test(corpus) && /\{[\s\S]*$/.test(corpus)) {
    if (!/"@type"\s*:/.test(corpus) && /ld\+json/i.test(corpus)) {
      findings.push(
        finding('broken_json_ld', 'critical', 'Broken JSON-LD markup detected', 'SEO', false, {
          reason: 'JSON-LD markers present but @type structure looks broken',
          expected: 'Valid JSON-LD with "@type"',
          actual: 'Broken or incomplete JSON-LD in body',
          location: 'draft.blocks (json-ld residue)',
        })
      );
    }
  }

  const auto_fixable = findings.filter((f) => f.auto_fixable);
  const failed_rules = findings.filter((f) => !f.auto_fixable);
  const warnings = findings.filter((f) => f.auto_fixable && f.severity === 'minor');
  const critical_fail = failed_rules.some((f) => f.severity === 'critical');

  const criticalN = failed_rules.filter((f) => f.severity === 'critical').length;
  const majorN = findings.filter((f) => f.severity === 'major').length;
  const minorN = findings.filter((f) => f.severity === 'minor').length;
  const score = clampScore(
    100 -
      criticalN * 25 -
      failed_rules.filter((f) => f.severity === 'major').length * 12 -
      majorN * 4 -
      minorN * 2
  );

  const seoFindings = findings.filter((f) => f.category === 'SEO' && !f.auto_fixable);
  const seo_pass =
    seoFindings.length === 0 &&
    Boolean(draft.meta_title?.trim()) &&
    Boolean(draft.meta_description?.trim());

  const passed = failed_rules.length === 0;

  return {
    score,
    passed,
    findings,
    failed_rules,
    warnings,
    auto_fixable,
    critical_fail,
    seo_pass,
  };
}
