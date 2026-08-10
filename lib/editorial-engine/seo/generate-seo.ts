/**
 * SEO Engine orchestrator — generate + persist SEO package for an article.
 * Never publishes. Never exposes public blog routes.
 */

import { SEO_ENGINE_VERSION } from '../constants.js';
import {
  getArticleById,
  listArticles,
  saveArticleSeoPackage,
} from '../db/articles-repo.js';
import {
  replaceInternalLinks,
  listInternalLinks,
} from '../db/internal-links-repo.js';
import { getSettings } from '../db/settings-repo.js';
import { getTopicById } from '../db/topics-repo.js';
import { insertGenerationLog } from '../db/generation-logs-repo.js';
import { getLatestQualityReport } from '../db/quality-reports-repo.js';
import type { QualityReport } from '../reviewer/quality-report.js';
import { buildStructuredContext } from '../writer/context-pack.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { ResearchPack } from '../writer/research-engine.js';
import { headingFingerprint } from '../validation/normalize-draft.js';
import { validateContentSeo, type SeoValidationResult } from './content-seo-validator.js';
import { extractEntityMap, type EntityMap } from './entity-map.js';
import { buildInternalLinks, type InternalLinkPackage } from './internal-links.js';
import { buildEditorialJsonLd, type EditorialJsonLd } from './json-ld.js';
import { buildSeoPackage, type SeoPackage } from './seo-package.js';

export interface SeoGenerateResult {
  ok: boolean;
  article_id: number;
  preview_version?: number;
  seo_package?: SeoPackage;
  entity_map?: EntityMap;
  json_ld?: EditorialJsonLd;
  internal_links?: InternalLinkPackage;
  seo_validation?: SeoValidationResult;
  message: string;
  errors?: string[];
}

export interface ArticlePreviewPayload {
  article_id: number;
  slug: string;
  status: string;
  preview_version: number | null;
  reading_time_minutes: number | null;
  word_count: number;
  quality_score: number | null;
  review_score: number | null;
  blocks: WriterDraftPayload['blocks'];
  excerpt: string | null;
  seo_package: SeoPackage | null;
  entity_map: EntityMap | null;
  json_ld: EditorialJsonLd | null;
  internal_links: InternalLinkPackage | null;
  seo_validation: SeoValidationResult | null;
  quality_panel: {
    overall_seo_score: number | null;
    eeat_score: number | null;
    helpful_content_score: number | null;
    search_intent_score: number | null;
    readability_score: number | null;
    internal_link_count: number;
    schema_status: EditorialJsonLd['schema_status'] | null;
    missing_items: string[];
    quality_score: number | null;
  };
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

function asResearch(
  article: NonNullable<Awaited<ReturnType<typeof getArticleById>>>
): ResearchPack | null {
  if (article.research_pack_json && typeof article.research_pack_json === 'object') {
    return article.research_pack_json as ResearchPack;
  }
  return null;
}

export async function generateArticleSeo(
  articleId: number,
  opts?: { skipAiPolish?: boolean }
): Promise<SeoGenerateResult> {
  const started = Date.now();
  const article = await getArticleById(articleId);
  if (!article) {
    return {
      ok: false,
      article_id: articleId,
      message: 'Article not found',
      errors: ['article_not_found'],
    };
  }
  if (!['draft', 'review'].includes(article.status)) {
    return {
      ok: false,
      article_id: articleId,
      message: `Cannot generate SEO for status '${article.status}'`,
      errors: ['invalid_status'],
    };
  }

  try {
    const settings = await getSettings();
    const draft = asDraft(article);
    const research = asResearch(article);

    let context = null;
    if (article.topic_id) {
      const topic = await getTopicById(article.topic_id);
      if (topic) context = buildStructuredContext(topic);
    }

    const entities = extractEntityMap({ draft, research, context });
    let seo_package = buildSeoPackage({
      slug: article.slug,
      draft,
      research,
      entities,
      contentType: article.content_type,
    });
    // Optional Router polish — never blocks deterministic SEO on failure
    if (!opts?.skipAiPolish) {
      try {
        const { polishSeoMetaWithRouter } = await import('./ai-seo.js');
        seo_package = await polishSeoMetaWithRouter(seo_package, { articleId });
      } catch {
        /* keep deterministic package */
      }
    }

    const blogPeers = await listArticles({ status: undefined, limit: 40 });
    const existingBlog = blogPeers.articles
      .filter((a) => a.id !== articleId && ['draft', 'review', 'published'].includes(a.status))
      .slice(0, 12)
      .map((a) => ({ slug: a.slug, seo_title: a.seo_title }));

    const internal_links = buildInternalLinks({
      draft,
      entities,
      settings,
      authorityLinks: context?.authority_links,
      toolLinks: context?.tool_links,
      existingBlogArticles: existingBlog,
    });

    const json_ld = buildEditorialJsonLd({
      seo: seo_package,
      draft,
      entities,
      wordCount: article.word_count,
      dateModified: article.updated_at?.toISOString?.() || null,
    });

    const seo_validation = validateContentSeo({
      draft,
      seo: seo_package,
      entities,
      links: internal_links,
      jsonLd: json_ld,
    });

    const preview_version = (article.preview_version || 0) + 1;

    await saveArticleSeoPackage({
      id: articleId,
      seo_package,
      entity_map: entities,
      json_ld,
      internal_links,
      seo_validation,
      preview_version,
      canonical_url: seo_package.canonical,
      seo_title: seo_package.seo_title,
      meta_title: seo_package.meta_title,
      meta_description: seo_package.meta_description,
    });

    await replaceInternalLinks(
      articleId,
      internal_links.recommendations.map((r) => ({
        href: r.target,
        label: r.anchor,
        link_kind: r.link_kind,
        reason: r.reason,
        confidence: r.confidence,
        location: r.location,
      }))
    );

    await insertGenerationLog({
      article_id: articleId,
      topic_id: article.topic_id,
      stage: 'seo',
      success: true,
      latency_ms: Date.now() - started,
      meta_json: {
        seo_engine: SEO_ENGINE_VERSION,
        seo_prompt_version: SEO_ENGINE_VERSION,
        seo_prompt_hash: `seo-${SEO_ENGINE_VERSION}`,
        preview_version,
        seo_score: seo_validation.seo_score,
        link_count: internal_links.count,
      },
    });

    return {
      ok: true,
      article_id: articleId,
      preview_version,
      seo_package,
      entity_map: entities,
      json_ld,
      internal_links,
      seo_validation,
      message: `SEO package generated (preview v${preview_version})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await insertGenerationLog({
        article_id: articleId,
        topic_id: article.topic_id,
        stage: 'seo',
        success: false,
        error_message: message,
        latency_ms: Date.now() - started,
        meta_json: { seo_engine: SEO_ENGINE_VERSION },
      });
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      article_id: articleId,
      message,
      errors: [message],
    };
  }
}

/** Live draft checks for quality panel — avoid stale SEO-package duplicate/meta flags. */
function liveQualityMissingItems(
  draft: WriterDraftPayload,
  seo_package: SeoPackage | null,
  seo_validation: SeoValidationResult | null
): string[] {
  const items: string[] = [];
  const headings = (draft.blocks || [])
    .filter((b) => b.type === 'heading')
    .map((b) => String(b.heading || b.content || '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  let dupH2 = 0;
  for (const h of headings) {
    const fp = headingFingerprint(h);
    if (seen.has(fp)) dupH2 += 1;
    seen.add(fp);
  }
  if (dupH2 > 0) items.push(`${dupH2} duplicate heading(s)`);

  const metaDesc =
    draft.meta_description ||
    seo_package?.meta_description ||
    '';
  if (metaDesc && metaDesc.length < 150) {
    items.push(`Meta description short (${metaDesc.length})`);
  }

  for (const m of seo_validation?.missing_items || []) {
    if (/duplicate heading/i.test(m)) continue;
    if (/Meta description short/i.test(m)) continue;
    if (!items.includes(m)) items.push(m);
  }
  return items;
}

export async function getArticlePreview(articleId: number): Promise<ArticlePreviewPayload | null> {
  const article = await getArticleById(articleId);
  if (!article) return null;

  const draft = asDraft(article);
  const seo_package = (article.seo_package_json as SeoPackage | null) || null;
  const entity_map = (article.entity_map_json as EntityMap | null) || null;
  const json_ld = (article.json_ld_json as EditorialJsonLd | null) || null;
  const internal_links = (article.internal_links_json as InternalLinkPackage | null) || null;
  const seo_validation = (article.seo_validation_json as SeoValidationResult | null) || null;

  let linkCount = internal_links?.count ?? 0;
  if (!linkCount) {
    const rows = await listInternalLinks(articleId);
    linkCount = rows.length;
  }

  const latest = await getLatestQualityReport(articleId);
  const findings = (latest?.findings_json || null) as QualityReport | null;
  const scores = findings?.scores;

  return {
    article_id: article.id,
    slug: article.slug,
    status: article.status,
    preview_version: article.preview_version,
    reading_time_minutes: article.reading_time_minutes,
    word_count: article.word_count,
    quality_score: article.quality_score,
    review_score: article.review_score,
    blocks: draft.blocks || [],
    excerpt: article.excerpt,
    seo_package,
    entity_map,
    json_ld,
    internal_links,
    seo_validation,
    quality_panel: {
      overall_seo_score: seo_validation?.seo_score ?? null,
      eeat_score: scores?.eeat ?? null,
      helpful_content_score: scores?.helpful_content ?? null,
      search_intent_score: scores?.search_intent ?? null,
      readability_score:
        scores?.readability ??
        (typeof seo_validation?.checks.readability_grade === 'number'
          ? Number(seo_validation.checks.readability_grade)
          : null),
      internal_link_count: linkCount,
      schema_status: json_ld?.schema_status ?? null,
      missing_items: liveQualityMissingItems(draft, seo_package, seo_validation),
      quality_score: article.quality_score,
    },
  };
}
