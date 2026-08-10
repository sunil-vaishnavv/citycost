/**
 * JSON-LD @graph for editorial articles.
 * Uses existing CityCost Organization data. Never invents reviews/ratings.
 */

import {
  buildOrganizationSchema,
  SITE_NAME,
  SITE_URL,
} from '../../../src/utils/seo.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { EntityMap } from './entity-map.js';
import type { SeoPackage } from './seo-package.js';

export interface EditorialJsonLd {
  '@context': 'https://schema.org';
  '@graph': Record<string, unknown>[];
  schema_status: {
    organization: boolean;
    webpage: boolean;
    article: boolean;
    breadcrumb: boolean;
    faq: boolean;
    has_reviews: false;
    has_ratings: false;
  };
}

function stripContext(node: Record<string, unknown>): Record<string, unknown> {
  const { ['@context']: _c, ...rest } = node;
  return rest;
}

function extractFaqs(draft: WriterDraftPayload): Array<{ q: string; a: string }> {
  const faqs: Array<{ q: string; a: string }> = [];
  for (const block of draft.blocks || []) {
    if (block.type !== 'faq') continue;
    const content = block.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === 'object') {
          const q = String((item as { q?: string }).q || (item as { question?: string }).question || '');
          const a = String((item as { a?: string }).a || (item as { answer?: string }).answer || '');
          if (q && a) faqs.push({ q, a });
        }
      }
    } else if (typeof content === 'string' && content.trim()) {
      faqs.push({ q: block.heading || 'FAQ', a: content.trim() });
    }
  }
  return faqs.slice(0, 12);
}

export function buildEditorialJsonLd(input: {
  seo: SeoPackage;
  draft: WriterDraftPayload;
  entities: EntityMap;
  wordCount: number;
  dateModified?: string | null;
}): EditorialJsonLd {
  const { seo, draft, entities, wordCount } = input;
  const org = stripContext(buildOrganizationSchema() as Record<string, unknown>);
  org['@id'] = `${SITE_URL}/#organization`;

  const pageId = `${seo.canonical}#webpage`;
  const articleId = `${seo.canonical}#article`;

  const webpage: Record<string, unknown> = {
    '@type': 'WebPage',
    '@id': pageId,
    url: seo.canonical,
    name: seo.meta_title,
    description: seo.meta_description,
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
    about: {
      '@type': 'Thing',
      name: entities.primary_entity,
    },
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: seo.og.image,
    },
    breadcrumb: { '@id': `${seo.canonical}#breadcrumb` },
    mainEntity: { '@id': articleId },
  };
  if (input.dateModified) webpage.dateModified = input.dateModified;

  const keywords = [seo.primary_keyword, ...seo.semantic_keywords]
    .filter(Boolean)
    .slice(0, 12)
    .join(', ');

  const article: Record<string, unknown> = {
    '@type': 'Article',
    '@id': articleId,
    headline: seo.seo_title,
    description: seo.meta_description,
    url: seo.canonical,
    inLanguage: 'en-US',
    isAccessibleForFree: true,
    wordCount,
    keywords,
    image: [seo.og.image],
    author: { '@id': `${SITE_URL}/#organization` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    mainEntityOfPage: { '@id': pageId },
    about: [
      { '@type': 'Thing', name: entities.primary_entity },
      ...entities.secondary_entities.slice(0, 6).map((name) => ({
        '@type': 'Thing',
        name,
      })),
    ],
    mentions: entities.related_cost_categories.slice(0, 8).map((name) => ({
      '@type': 'Thing',
      name,
    })),
  };
  // Explicitly never add aggregateRating / review

  const breadcrumb: Record<string, unknown> = {
    '@type': 'BreadcrumbList',
    '@id': `${seo.canonical}#breadcrumb`,
    itemListElement: seo.breadcrumb_labels.map((name, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item:
        i === 0
          ? SITE_URL
          : i === 1
            ? `${SITE_URL}/blog`
            : seo.canonical,
    })),
  };

  const graph: Record<string, unknown>[] = [org, webpage, article, breadcrumb];

  const faqs = extractFaqs(draft);
  let faq = false;
  if (faqs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${seo.canonical}#faq`,
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: f.a,
        },
      })),
    });
    faq = true;
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
    schema_status: {
      organization: true,
      webpage: true,
      article: true,
      breadcrumb: true,
      faq,
      has_reviews: false,
      has_ratings: false,
    },
  };
}
