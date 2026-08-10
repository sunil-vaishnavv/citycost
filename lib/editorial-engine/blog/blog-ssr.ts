/**
 * Blog SSR HTML builders — additive to resolveSeoHtml.
 * Uses persisted article data only (no Groq / reviewer / SEO regen).
 */

import {
  SITE_NAME,
  SITE_URL,
  buildOrganizationSchema,
  buildServerMetaHtml,
  buildServerJsonLdScript,
} from '../../../src/utils/seo.js';
import {
  getCachedBlogSitemapEntries,
  getCachedPublishedArticle,
  getCachedPublishedList,
} from './blog-cache.js';
import { renderArticleBlocksHtml, renderRelatedLinksHtml } from './blog-render.js';
import type { PublicBlogArticle } from '../db/public-blog-repo.js';

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escText(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function stampJsonLdDates(
  jsonLd: PublicBlogArticle['json_ld'],
  published: Date,
  modified: Date
): Record<string, unknown> | null {
  if (!jsonLd || typeof jsonLd !== 'object') return null;
  const graph = Array.isArray(jsonLd['@graph']) ? [...jsonLd['@graph']] : [];
  const pub = published.toISOString();
  const mod = modified.toISOString();
  const nextGraph = graph.map((node) => {
    if (!node || typeof node !== 'object') return node;
    const n = { ...(node as Record<string, unknown>) };
    const type = String(n['@type'] || '');
    if (type === 'Article') {
      n.datePublished = pub;
      n.dateModified = mod;
      delete n.aggregateRating;
      delete n.review;
    }
    if (type === 'WebPage') {
      n.dateModified = mod;
    }
    return n;
  });
  return {
    '@context': 'https://schema.org',
    '@graph': nextGraph,
  };
}

export function buildBlogIndexBodyHtml(
  articles: Array<{
    slug: string;
    seo_title: string;
    excerpt: string | null;
    published_at: Date;
    last_public_update_at: Date | null;
    reading_time_minutes: number | null;
    content_type: string;
  }>
): string {
  const cards = articles
    .map((a) => {
      const updated =
        a.last_public_update_at &&
        formatDate(a.last_public_update_at) !== formatDate(a.published_at)
          ? `<span>Updated ${escText(formatDate(a.last_public_update_at))}</span>`
          : '';
      return `<article class="blog-card">
  <h2><a href="/blog/${esc(a.slug)}">${escText(a.seo_title)}</a></h2>
  <p class="blog-card-meta">
    <span>Published ${escText(formatDate(a.published_at))}</span>
    ${updated}
    <span>${a.reading_time_minutes ?? '—'} min read</span>
    <span>${escText(a.content_type.replace(/_/g, ' '))}</span>
  </p>
  <p class="blog-card-excerpt">${escText(a.excerpt || '')}</p>
  <p><a href="/blog/${esc(a.slug)}">Read guide →</a></p>
</article>`;
    })
    .join('\n');

  return `<main id="seo-prerender-main" class="blog-ssr">
  <nav aria-label="Breadcrumb" class="blog-breadcrumb">
    <a href="/">Home</a> / <span>Blog</span>
  </nav>
  <h1>Cost of Living Guides &amp; Insights</h1>
  <p class="blog-intro">Practical, data-backed guides on city costs, relocation budgeting, and comparisons — built on CityCost indexes and tools.</p>
  <div class="blog-list">
    ${cards || '<p>No published guides yet.</p>'}
  </div>
  <p class="blog-cta"><a href="/">Compare living costs with the CityCost calculator →</a></p>
</main>`;
}

export function buildBlogArticleBodyHtml(
  article: PublicBlogArticle,
  related: Array<{ slug: string; title: string }>
): string {
  const links = article.internal_links?.recommendations || [];
  const body = renderArticleBlocksHtml(article.draft, links);
  const relatedHtml = renderRelatedLinksHtml({
    links,
    relatedArticles: related,
  });
  const updated =
    article.last_public_update_at &&
    formatDate(article.last_public_update_at) !== formatDate(article.published_at)
      ? `<span>Updated ${escText(formatDate(article.last_public_update_at))}</span>`
      : '';

  return `<main id="seo-prerender-main" class="blog-ssr blog-article-ssr">
  <nav aria-label="Breadcrumb" class="blog-breadcrumb">
    <a href="/">Home</a> / <a href="/blog">Blog</a> / <span>${escText(article.seo_title)}</span>
  </nav>
  <article>
    <h1>${escText(article.seo_title)}</h1>
    <p class="blog-card-meta">
      <span>Published ${escText(formatDate(article.published_at))}</span>
      ${updated}
      <span>${article.reading_time_minutes ?? '—'} min read</span>
    </p>
    ${article.excerpt ? `<p class="blog-intro">${escText(article.excerpt)}</p>` : ''}
    <div class="blog-content">
      ${body}
    </div>
    <aside class="blog-cta-box">
      <p><strong>Next step:</strong> Verify cost signals with the
      <a href="/">CityCost calculator</a> and related city or comparison pages.</p>
    </aside>
    ${relatedHtml}
  </article>
</main>`;
}

export async function resolveBlogSeoHtml(
  html: string,
  pathname: string,
  helpers: {
    stripDefaultHeadMeta: (h: string) => string;
    finalizeSeoHtml: (h: string, head: string, body: string) => string;
    buildNotFoundHtml: (h: string) => string;
  }
): Promise<{ status: 200; html: string } | { status: 404; html: string }> {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/blog') {
    const articles = await getCachedPublishedList();
    const title = `Cost of Living Guides & Insights | ${SITE_NAME}`;
    const description =
      'Practical cost of living guides, relocation budgeting tips, and city insights powered by CityCost data.';
    const canonical = `${SITE_URL}/blog`;
    const meta = buildServerMetaHtml({
      title,
      description,
      keywords: 'cost of living guides, relocation, city costs, CityCost blog',
      canonical,
      ogType: 'website',
    });
    const ld =
      buildServerJsonLdScript('organization', buildOrganizationSchema()) +
      buildServerJsonLdScript('webpage', {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        description,
        url: canonical,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
      });
    const body = buildBlogIndexBodyHtml(articles);
    return {
      status: 200,
      html: helpers.finalizeSeoHtml(helpers.stripDefaultHeadMeta(html), meta + ld, body),
    };
  }

  const match = path.match(/^\/blog\/([a-z0-9-]+)$/i);
  if (!match) {
    return { status: 404, html: helpers.buildNotFoundHtml(html) };
  }

  const slug = match[1].toLowerCase();
  const article = await getCachedPublishedArticle(slug);
  if (!article) {
    return { status: 404, html: helpers.buildNotFoundHtml(html) };
  }

  // Exact slug only — never fuzzy
  if (article.slug !== slug) {
    return { status: 404, html: helpers.buildNotFoundHtml(html) };
  }

  const canonical = `${SITE_URL}/blog/${article.slug}`;
  const title = article.meta_title || `${article.seo_title} | ${SITE_NAME}`;
  const description = article.meta_description || article.excerpt || '';
  const meta = buildServerMetaHtml({
    title,
    description,
    keywords: article.seo_package?.semantic_keywords?.join(', ') || 'cost of living, CityCost',
    canonical,
    ogType: 'article',
  });

  const modified = article.last_public_update_at || article.updated_at || article.published_at;
  const stamped = stampJsonLdDates(article.json_ld, article.published_at, modified);
  let ld = buildServerJsonLdScript('organization', buildOrganizationSchema());
  if (stamped) {
    ld += buildServerJsonLdScript('blog-graph', stamped);
  }

  const list = await getCachedPublishedList();
  const related = list
    .filter((a) => a.slug !== article.slug)
    .slice(0, 4)
    .map((a) => ({ slug: a.slug, title: a.seo_title }));

  const body = buildBlogArticleBodyHtml(article, related);
  return {
    status: 200,
    html: helpers.finalizeSeoHtml(helpers.stripDefaultHeadMeta(html), meta + ld, body),
  };
}

export async function buildBlogSitemapXml(
  xmlUrlsetDated: (entries: Array<{ loc: string; lastmod: string }>) => string
): Promise<string> {
  const entries = await getCachedBlogSitemapEntries();
  const all = [{ loc: `${SITE_URL}/blog`, lastmod: new Date().toISOString().slice(0, 10) }, ...entries];
  return xmlUrlsetDated(all);
}
