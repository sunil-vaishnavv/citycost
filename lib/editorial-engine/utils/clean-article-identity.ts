/**
 * Persist cleaned public titles/slugs (strip cert-batch QA markers).
 */

import type { RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import {
  getArticleById,
  slugExists,
  updateArticleIdentity,
} from '../db/articles-repo.js';
import type { SeoPackage } from '../seo/seo-package.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { SITE_URL } from '../../../src/utils/seo.js';
import {
  cleanEditorialSlug,
  cleanEditorialTitle,
  hasCertBatchNoise,
} from './clean-title.js';

export async function cleanArticlePublicIdentity(articleId: number): Promise<{
  cleaned: boolean;
  slug: string | null;
  seo_title: string | null;
  fixes: string[];
}> {
  const article = await getArticleById(articleId);
  if (!article) {
    return { cleaned: false, slug: null, seo_title: null, fixes: [] };
  }
  const draft =
    article.draft_json && typeof article.draft_json === 'object'
      ? ({ ...(article.draft_json as WriterDraftPayload) } as WriterDraftPayload)
      : null;

  const dirtyTitle =
    hasCertBatchNoise(article.seo_title) ||
    hasCertBatchNoise(article.meta_title) ||
    hasCertBatchNoise(draft?.seo_title) ||
    hasCertBatchNoise(draft?.meta_title) ||
    hasCertBatchNoise(article.slug);

  if (!dirtyTitle) {
    return {
      cleaned: false,
      slug: article.slug,
      seo_title: article.seo_title,
      fixes: [],
    };
  }

  const seedTitle =
    cleanEditorialTitle(article.seo_title || draft?.seo_title || article.meta_title || '') ||
    cleanEditorialTitle(article.slug.replace(/-/g, ' '));
  const seo_title = seedTitle.slice(0, 70);
  const meta_title = cleanEditorialTitle(article.meta_title || draft?.meta_title || seo_title).slice(
    0,
    60
  );

  // Published: clean titles only (keep live slug/URL). Draft/review: also rename slug.
  let slug = article.slug;
  if (article.status !== 'published') {
    slug = cleanEditorialSlug(seo_title);
    if (!slug) slug = `article-${articleId}`;
    if (await slugExists(slug, articleId)) {
      slug = `${slug}-${articleId}`;
    }
  }

  if (draft) {
    draft.seo_title = seo_title;
    draft.meta_title = meta_title;
    if (draft.meta_description) {
      draft.meta_description = cleanEditorialTitle(draft.meta_description);
    }
    if (draft.excerpt) {
      draft.excerpt = cleanEditorialTitle(draft.excerpt);
    }
  }

  let seo_package = (article.seo_package_json as SeoPackage | null) || null;
  const canonical = `${SITE_URL}/blog/${slug}`;
  if (seo_package && typeof seo_package === 'object') {
    seo_package = {
      ...seo_package,
      seo_title,
      meta_title,
      slug,
      suggested_url: `/blog/${slug}`,
      canonical,
      og: {
        ...(seo_package.og || {
          title: meta_title,
          description: seo_package.meta_description || '',
          url: canonical,
          type: 'article',
          image: '',
          site_name: 'CityCost',
        }),
        title: meta_title,
        url: canonical,
      },
      twitter: {
        ...(seo_package.twitter || {
          card: 'summary_large_image',
          title: meta_title,
          description: seo_package.meta_description || '',
          image: '',
        }),
        title: meta_title,
      },
    };
  }

  await updateArticleIdentity({
    id: articleId,
    slug,
    seo_title,
    meta_title,
    meta_description: draft?.meta_description ?? article.meta_description,
    excerpt: draft?.excerpt ?? article.excerpt,
    draft: draft ?? undefined,
    seo_package: seo_package ?? undefined,
    canonical_url: canonical,
  });

  return {
    cleaned: true,
    slug,
    seo_title,
    fixes: [`Cleaned cert-batch noise from title/slug → "${seo_title}" · /blog/${slug}`],
  };
}

/** Persist-clean all articles whose title/slug still contain cert-batch markers. */
export async function scrubCertNoiseFromArticles(): Promise<number> {
  if (!pool) return 0;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, seo_title, meta_title, slug FROM editorial_articles
     WHERE seo_title ILIKE '%cert%'
        OR meta_title ILIKE '%cert%'
        OR slug ILIKE '%cert%'`
  );
  let fixed = 0;
  for (const row of rows) {
    const id = Number(row.id);
    if (
      !hasCertBatchNoise(String(row.seo_title || '')) &&
      !hasCertBatchNoise(String(row.meta_title || '')) &&
      !hasCertBatchNoise(String(row.slug || ''))
    ) {
      continue;
    }
    const result = await cleanArticlePublicIdentity(id);
    if (result.cleaned) fixed += 1;
  }
  return fixed;
}
