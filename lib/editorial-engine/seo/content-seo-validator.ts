/**
 * Content SEO Validator — structural/SEO checks with warnings, errors, recommendations.
 */

import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { blockContentText, draftPlainText } from '../reviewer/text-utils.js';
import { headingFingerprint } from '../validation/normalize-draft.js';
import type { EntityMap } from './entity-map.js';
import type { InternalLinkPackage } from './internal-links.js';
import type { SeoPackage } from './seo-package.js';
import type { EditorialJsonLd } from './json-ld.js';
import { analyzeReadability } from '../reviewer/readability.js';

export interface SeoValidationIssue {
  code: string;
  severity: 'error' | 'warning' | 'recommendation';
  message: string;
}

export interface SeoValidationResult {
  seo_score: number;
  errors: SeoValidationIssue[];
  warnings: SeoValidationIssue[];
  recommendations: SeoValidationIssue[];
  checks: Record<string, boolean | number | string>;
  missing_items: string[];
}

function push(
  list: SeoValidationIssue[],
  severity: SeoValidationIssue['severity'],
  code: string,
  message: string
) {
  list.push({ code, severity, message });
}

export function validateContentSeo(input: {
  draft: WriterDraftPayload;
  seo: SeoPackage;
  entities: EntityMap;
  links: InternalLinkPackage;
  jsonLd: EditorialJsonLd;
}): SeoValidationResult {
  const errors: SeoValidationIssue[] = [];
  const warnings: SeoValidationIssue[] = [];
  const recommendations: SeoValidationIssue[] = [];
  const { draft, seo, entities, links, jsonLd } = input;
  const text = draftPlainText(draft).toLowerCase();
  const blocks = draft.blocks || [];

  // Title length
  const titleLen = seo.meta_title.length;
  if (titleLen < 30) push(errors, 'error', 'title_short', `Meta title too short (${titleLen})`);
  else if (titleLen > 60) push(warnings, 'warning', 'title_long', `Meta title long (${titleLen}); prefer ≤60`);
  else push(recommendations, 'recommendation', 'title_ok', 'Meta title length looks healthy');

  // Meta description — production target 150–160
  const descLen = seo.meta_description.length;
  if (descLen < 150) {
    push(errors, 'error', 'meta_short', `Meta description short (${descLen}); target 150–160`);
  } else if (descLen > 160) {
    push(warnings, 'warning', 'meta_long', `Meta description long (${descLen}); target 150–160`);
  } else {
    push(recommendations, 'recommendation', 'meta_ok', 'Meta description length is in the 150–160 band');
  }
  if (seo.primary_keyword && !seo.meta_description.toLowerCase().includes(
    seo.primary_keyword.toLowerCase().split(/\s+/).slice(0, 2).join(' ')
  )) {
    push(warnings, 'warning', 'meta_keyword', 'Meta description should include the primary keyword naturally');
  }

  // Heading structure / H2 — only count real heading blocks (fingerprint = rule validator)
  const headings = blocks
    .filter((b) => b.type === 'heading')
    .map((b) => (b.heading || blockContentText(b)).trim())
    .filter(Boolean);
  const h2Set = new Set<string>();
  let dupH2 = 0;
  for (const h of headings) {
    const fp = headingFingerprint(h);
    if (h2Set.has(fp)) dupH2 += 1;
    h2Set.add(fp);
  }
  if (headings.length < 3) push(errors, 'error', 'missing_h2', 'Too few section headings');
  if (dupH2 > 0) push(errors, 'error', 'duplicate_h2', `${dupH2} duplicate heading(s)`);

  // TOC
  const hasToc = blocks.some(
    (b) =>
      /table of contents|^contents$/i.test(b.heading || '') ||
      (b.type === 'list' && /table of contents|contents/i.test(blockContentText(b)))
  );
  if (!hasToc) push(errors, 'error', 'missing_toc', 'Missing table of contents');

  // Keyword coverage
  const kwTokens = seo.primary_keyword.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const kwHits = kwTokens.filter((t) => text.includes(t)).length;
  const kwCoverage = kwTokens.length ? kwHits / kwTokens.length : 0;
  if (kwCoverage < 0.4) push(warnings, 'warning', 'keyword_weak', 'Primary keyword coverage is weak');

  // Entity coverage
  const entityHit =
    text.includes(entities.primary_entity.toLowerCase().split(',')[0]!.trim()) ||
    entities.secondary_entities.some((e) => text.includes(e.toLowerCase().split(',')[0]!.trim()));
  if (!entityHit) push(warnings, 'warning', 'entity_weak', 'Primary entity weakly reflected in body');

  // Image placeholders (editorial blocks don't have images yet — count tip)
  const imagePlaceholders = blocks.filter((b) =>
    /image|figure|photo/i.test(b.heading || '') || /\[image/i.test(blockContentText(b))
  ).length;
  if (imagePlaceholders === 0) {
    push(
      recommendations,
      'recommendation',
      'images',
      'No image placeholders — consider adding when publishing assets exist'
    );
  }

  // FAQ
  const hasFaq = blocks.some((b) => b.type === 'faq');
  if (!hasFaq) push(errors, 'error', 'missing_faq', 'Missing FAQ block');

  // Internal links
  if (links.count < links.target_min) {
    push(
      errors,
      'error',
      'links_low',
      `Internal links ${links.count} below target min ${links.target_min}`
    );
  } else if (links.count > links.target_max) {
    push(warnings, 'warning', 'links_high', `Internal links ${links.count} above max ${links.target_max}`);
  }

  // External references — we don't invent them; recommend methodology trust links
  const hasAuthority = links.recommendations.some((r) => r.link_kind === 'authority');
  if (!hasAuthority) {
    push(
      recommendations,
      'recommendation',
      'external_trust',
      'Add methodology/data-sources mention for EEAT (internal authority pages)'
    );
  }

  // Readability
  const readability = analyzeReadability(draft);
  if (!readability.in_target_band) {
    push(warnings, 'warning', 'readability', readability.findings[0] || 'Readability outside target band');
  }

  // Paragraph length / thin sections
  let thin = 0;
  let longPara = 0;
  for (const b of blocks) {
    if (!['paragraph', 'intro', 'summary'].includes(b.type)) continue;
    const words = blockContentText(b).split(/\s+/).filter(Boolean).length;
    if (words > 0 && words < 40) thin += 1;
    if (words > 180) longPara += 1;
  }
  if (thin >= 3) push(warnings, 'warning', 'thin_sections', `${thin} thin text sections`);
  if (longPara >= 2) {
    push(recommendations, 'recommendation', 'long_paragraphs', 'Some paragraphs are long — prefer shorter blocks');
  }

  // Schema
  if (!jsonLd.schema_status.article || !jsonLd.schema_status.webpage) {
    push(errors, 'error', 'schema_incomplete', 'JSON-LD graph missing Article/WebPage');
  }
  if (!jsonLd.schema_status.faq && hasFaq) {
    push(warnings, 'warning', 'faq_schema', 'FAQ present but FAQ schema not generated');
  }

  const missing_items: string[] = [];
  for (const e of errors) missing_items.push(e.message);

  let seo_score = 100;
  seo_score -= errors.length * 12;
  seo_score -= warnings.length * 5;
  seo_score -= Math.max(0, recommendations.length - 2) * 1;
  if (kwCoverage >= 0.6) seo_score += 3;
  if (links.in_range) seo_score += 4;
  if (jsonLd.schema_status.faq) seo_score += 3;
  seo_score = Math.max(0, Math.min(100, Math.round(seo_score * 10) / 10));

  return {
    seo_score,
    errors,
    warnings,
    recommendations,
    checks: {
      title_length: titleLen,
      meta_length: descLen,
      heading_count: headings.length,
      duplicate_h2: dupH2,
      has_toc: hasToc,
      keyword_coverage: Math.round(kwCoverage * 100) / 100,
      entity_coverage: entityHit,
      image_placeholders: imagePlaceholders,
      has_faq: hasFaq,
      internal_links: links.count,
      readability_grade: readability.grade_estimate,
      schema_faq: jsonLd.schema_status.faq,
      schema_article: jsonLd.schema_status.article,
    },
    missing_items,
  };
}
