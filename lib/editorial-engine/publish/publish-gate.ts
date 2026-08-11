/**
 * Publishing gate — machine-readable readiness checks.
 * Never allows draft → published.
 */

import { getArticleById } from '../db/articles-repo.js';
import { getLatestQualityReport } from '../db/quality-reports-repo.js';
import { isManualArticle } from '../utils/article-origin.js';
import type { QualityReport } from '../reviewer/quality-report.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { validateManualDraft, validateWriterDraft } from '../writer/draft-validate.js';
import { getSettings } from '../db/settings-repo.js';
import type { SeoPackage } from '../seo/seo-package.js';
import type { EditorialJsonLd } from '../seo/json-ld.js';
import type { InternalLinkPackage } from '../seo/internal-links.js';
import type { SeoValidationResult } from '../seo/content-seo-validator.js';
import {
  confidencePublishMessage,
  confidenceReadinessPassed,
  resolveConfidencePublishAction,
} from '../observability/publish-confidence.js';
import type { ConfidenceLevel } from '../observability/confidence-engine.js';
import { countBodyInternalLinks } from '../validation/normalize-draft.js';

export interface PublishCheckItem {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface PublishReadiness {
  ready: boolean;
  article_id: number;
  status: string;
  slug: string | null;
  title: string | null;
  quality_score: number | null;
  seo_score: number | null;
  word_count: number;
  /** In-body markdown/HTML internal links (aligned with rule-validator). */
  internal_link_count: number;
  /** SEO package recommendation count (may differ from body embeds). */
  package_link_count?: number;
  canonical_url: string | null;
  checks: PublishCheckItem[];
  blocking_errors: Array<{ code: string; message: string }>;
  /** Observability — confidence-aware publish messaging */
  confidence_level?: ConfidenceLevel | null;
  overall_confidence?: number | null;
  confidence_publish_action?: string | null;
  confidence_publish_message?: string | null;
}

function asDraft(article: NonNullable<Awaited<ReturnType<typeof getArticleById>>>): WriterDraftPayload {
  if (article.draft_json && typeof article.draft_json === 'object') {
    return article.draft_json as WriterDraftPayload;
  }
  return {
    seo_title: article.seo_title || '',
    meta_title: article.meta_title || '',
    meta_description: article.meta_description || '',
    excerpt: article.excerpt || '',
    blocks: Array.isArray(article.blocks_json)
      ? (article.blocks_json as WriterDraftPayload['blocks'])
      : [],
  };
}

export async function getPublishReadiness(articleId: number): Promise<PublishReadiness> {
  const article = await getArticleById(articleId);
  if (!article) {
    return {
      ready: false,
      article_id: articleId,
      status: 'missing',
      slug: null,
      title: null,
      quality_score: null,
      seo_score: null,
      word_count: 0,
      internal_link_count: 0,
      canonical_url: null,
      checks: [],
      blocking_errors: [{ code: 'article_not_found', message: 'Article not found' }],
    };
  }

  const settings = await getSettings();
  const draft = asDraft(article);
  const manual = isManualArticle(article);
  const contentValidation = manual
    ? validateManualDraft(draft, { minWords: 50, maxWords: settings.article_length_max })
    : validateWriterDraft(draft, {
        min: settings.article_length_min,
        max: settings.article_length_max,
      });

  const latest = await getLatestQualityReport(articleId);
  const findings = (latest?.findings_json || null) as QualityReport | null;
  const qualityPassed = manual ? true : Boolean(latest?.passed && findings?.passed);

  const seo_package = article.seo_package_json as SeoPackage | null;
  const seo_validation = article.seo_validation_json as SeoValidationResult | null;
  const json_ld = article.json_ld_json as EditorialJsonLd | null;
  const internal_links = article.internal_links_json as InternalLinkPackage | null;

  const seoBlocking = (seo_validation?.errors || []).length > 0;
  const bodyLinkCount = countBodyInternalLinks(draft);
  const packageLinkCount = internal_links?.count ?? internal_links?.recommendations?.length ?? 0;
  // Publish requires in-body links (quality contract) AND enough SEO package recommendations.
  const linksPassed = manual
    ? true
    : bodyLinkCount >= 1 && packageLinkCount >= settings.internal_link_min;
  const hasJsonLd = Boolean(
    json_ld &&
      Array.isArray(json_ld['@graph']) &&
      json_ld['@graph'].length > 0 &&
      json_ld.schema_status?.article &&
      json_ld.schema_status?.webpage
  );
  const slugOk = Boolean(article.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug));
  const statusOk = article.status === 'review';

  const confidence_level =
    (findings?.confidence_level as ConfidenceLevel | undefined) ||
    ((article as { confidence_level?: string }).confidence_level as ConfidenceLevel | undefined) ||
    null;
  const overall_confidence =
    findings?.overall_confidence ??
    (article as { overall_confidence?: number | null }).overall_confidence ??
    null;
  const confidenceAction = resolveConfidencePublishAction(confidence_level, settings);
  const confidenceMsg = confidencePublishMessage(confidence_level, confidenceAction);
  const confidenceOk = manual ? true : !confidence_level || confidenceReadinessPassed(confidenceAction);

  const checks: PublishCheckItem[] = [
    {
      key: 'status_review',
      label: 'Status is review',
      passed: statusOk,
      detail: statusOk ? undefined : `Current status: ${article.status}`,
    },
    {
      key: 'quality_review',
      label: manual ? 'Quality Review (optional for manual)' : 'Quality Review',
      passed: qualityPassed,
      detail: manual
        ? 'Skipped for manual articles — run Review optionally'
        : qualityPassed
          ? `Score ${latest?.score ?? findings?.overall_score ?? '—'}`
          : !latest
            ? 'No quality review yet — click Review'
            : (findings?.failure_reasons?.length
                ? findings.failure_reasons.slice(0, 3).join(' · ')
                : `Latest review failed (score ${latest.score ?? findings?.overall_score ?? '—'}${
                    findings?.threshold != null ? ` / ${findings.threshold}` : ''
                  })`),
    },
    {
      key: 'seo_package',
      label: 'SEO',
      passed: Boolean(seo_package?.canonical && seo_package?.meta_title && seo_package?.meta_description),
      detail: seo_package ? undefined : 'SEO package missing — Generate SEO first',
    },
    {
      key: 'seo_validation',
      label: 'SEO Validation',
      passed: Boolean(seo_validation) && !seoBlocking,
      detail: seoBlocking
        ? (seo_validation?.errors || []).map((e) => e.message).join('; ')
        : seo_validation
          ? `Score ${seo_validation.seo_score}`
          : 'SEO validation missing',
    },
    {
      key: 'schema',
      label: 'Schema',
      passed: hasJsonLd,
      detail: hasJsonLd ? 'JSON-LD graph present' : 'JSON-LD missing or incomplete',
    },
    {
      key: 'internal_links',
      label: 'Internal Links',
      passed: linksPassed,
      detail: linksPassed
        ? `${bodyLinkCount} in body · ${packageLinkCount} package`
        : bodyLinkCount < 1
          ? `Need ≥1 in-body internal link (have ${bodyLinkCount}); package ${packageLinkCount}`
          : `Need ≥${settings.internal_link_min} SEO package links (have ${packageLinkCount}); body ${bodyLinkCount}`,
    },
    {
      key: 'content_validation',
      label: 'Content Validation',
      passed: contentValidation.ok,
      detail: contentValidation.ok
        ? `${contentValidation.word_count} words`
        : contentValidation.errors.join('; '),
    },
    {
      key: 'slug',
      label: 'Slug',
      passed: slugOk,
      detail: slugOk ? article.slug : 'Valid unique slug required',
    },
    {
      key: 'confidence',
      label: 'Confidence readiness',
      passed: confidenceOk,
      detail: confidenceMsg,
    },
  ];

  const blocking_errors = checks
    .filter((c) => !c.passed)
    .map((c) => ({ code: c.key, message: `${c.label}: ${c.detail || 'failed'}` }));

  // draft → published is never allowed (status_review enforces review)
  if (article.status === 'draft') {
    blocking_errors.unshift({
      code: 'draft_not_allowed',
      message: 'Cannot publish from draft — review required first',
    });
  }

  return {
    ready: blocking_errors.length === 0 && checks.every((c) => c.passed),
    article_id: articleId,
    status: article.status,
    slug: article.slug,
    title: article.seo_title || draft.seo_title,
    quality_score: article.quality_score ?? latest?.score ?? null,
    seo_score: seo_validation?.seo_score ?? null,
    word_count: article.word_count || contentValidation.word_count,
    internal_link_count: bodyLinkCount,
    package_link_count: packageLinkCount,
    canonical_url: seo_package?.canonical || article.canonical_url,
    checks,
    blocking_errors,
    confidence_level,
    overall_confidence,
    confidence_publish_action: confidenceAction,
    confidence_publish_message: confidenceMsg,
  };
}
