/**
 * SEO Engine — titles, meta, OG/Twitter, canonical, suggested blog URL.
 * Application-owned slug/URL (never AI-invented).
 */

import {
  LOGO_URL,
  OG_IMAGE,
  SITE_NAME,
  SITE_URL,
} from '../../../src/utils/seo.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { ResearchPack } from '../writer/research-engine.js';
import { cleanEditorialTitle } from '../utils/clean-title.js';
import type { EntityMap } from './entity-map.js';

export interface SeoPackage {
  seo_title: string;
  meta_title: string;
  meta_description: string;
  canonical: string;
  suggested_url: string;
  slug: string;
  og: {
    title: string;
    description: string;
    url: string;
    type: string;
    image: string;
    site_name: string;
  };
  twitter: {
    card: string;
    title: string;
    description: string;
    image: string;
  };
  article_schema_type: string;
  breadcrumb_labels: string[];
  faq_schema_ready: boolean;
  webpage_schema_ready: boolean;
  primary_keyword: string;
  semantic_keywords: string[];
}

const META_DESC_MIN = 150;
const META_DESC_MAX = 160;
const TITLE_MAX = 60;

function clampTitle(title: string, max = TITLE_MAX): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
}

function keywordPresent(text: string, keyword: string): boolean {
  if (!keyword.trim()) return true;
  const lower = text.toLowerCase();
  if (lower.includes(keyword.toLowerCase())) return true;
  const tokens = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokens.length <= 1) return tokens[0] ? lower.includes(tokens[0]) : true;
  const hits = tokens.filter((t) => lower.includes(t)).length;
  return hits / tokens.length >= 0.6;
}

/**
 * Fit meta description to 150–160 chars with natural keyword + CTR cue.
 */
export function fitMetaDescription(raw: string, keyword: string): string {
  let d = (raw || '').replace(/\s+/g, ' ').trim();
  const kw = keyword.replace(/\s+/g, ' ').trim();

  if (!d) {
    d = kw
      ? `Practical guide to ${kw}: compare housing, food, transport, and monthly budgets with clear CityCost index checks.`
      : 'Practical cost of living guidance: compare housing, everyday expenses, and budgeting signals with clear CityCost index checks.';
  }

  if (kw && !keywordPresent(d, kw)) {
    d = `${d} Explore ${kw} with transparent CityCost signals.`.replace(/\s+/g, ' ').trim();
  }

  if (!/[.!?]$/.test(d)) d += '.';

  const ctrBits = [
    ' Compare housing, food, and transport before you move.',
    ' Verify monthly budgets on CityCost before you decide.',
    ' See practical cost signals without guesswork.',
  ];
  let i = 0;
  while (d.length < META_DESC_MIN && i < 12) {
    d = `${d.replace(/[.!?]$/, '')}${ctrBits[i % ctrBits.length]}`.replace(/\s+/g, ' ').trim();
    if (!/[.!?]$/.test(d)) d += '.';
    i += 1;
  }

  if (d.length > META_DESC_MAX) {
    let cut = d.slice(0, META_DESC_MAX);
    const breakAt = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
    if (breakAt >= META_DESC_MIN - 8) cut = cut.slice(0, breakAt);
    d = cut.replace(/[,;:\s-]+$/g, '').trim();
    if (!/[.!?]$/.test(d)) d += '.';
  }

  // Final hard fit into 150–160
  if (d.length < META_DESC_MIN) {
    const filler = ' Check CityCost indexes now.';
    while (d.length < META_DESC_MIN) {
      const room = META_DESC_MAX - d.length;
      if (room <= 1) break;
      d = `${d.replace(/[.!?]$/, '')}${filler.slice(0, room)}`.trim();
      if (!/[.!?]$/.test(d) && d.length < META_DESC_MAX) d += '.';
      if (d.length >= META_DESC_MIN) break;
    }
  }
  if (d.length > META_DESC_MAX) {
    d = d.slice(0, META_DESC_MAX).replace(/\s+\S*$/, '').replace(/[,;:\s-]+$/g, '').trim();
    if (!/[.!?]$/.test(d)) {
      if (d.length >= META_DESC_MAX) d = `${d.slice(0, META_DESC_MAX - 1)}.`;
      else d += '.';
    }
  }
  if (d.length < META_DESC_MIN) {
    d = d.padEnd(META_DESC_MIN, '.');
  }
  return d.slice(0, META_DESC_MAX);
}

function buildCtrTitle(entity: string, keyword: string, draftTitle: string): string {
  const base = cleanEditorialTitle((draftTitle || '').replace(/\s+/g, ' ').trim());
  if (base && base.length >= 28) return clampTitle(base, TITLE_MAX);
  const subject = cleanEditorialTitle(entity || keyword || 'Cost of Living');
  // Benefit-led, keyword-natural, under 60
  return clampTitle(`${subject}: Cost of Living Guide`, TITLE_MAX);
}

export function buildSeoPackage(input: {
  slug: string;
  draft: WriterDraftPayload;
  research: ResearchPack | null;
  entities: EntityMap;
  contentType: string;
}): SeoPackage {
  const { slug, draft, research, entities } = input;
  const keyword = entities.target_keyword || research?.target_keyword || '';

  let seo_title = buildCtrTitle(
    entities.primary_entity,
    keyword,
    cleanEditorialTitle(draft.seo_title || '')
  );
  if (!/citycost/i.test(seo_title) && seo_title.length <= 46) {
    seo_title = clampTitle(`${seo_title.replace(/\s*\|\s*CityCost.*$/i, '')} | ${SITE_NAME}`, TITLE_MAX);
  } else {
    seo_title = clampTitle(seo_title, TITLE_MAX);
  }

  let meta_title = clampTitle(
    cleanEditorialTitle(draft.meta_title || seo_title).trim(),
    TITLE_MAX
  );
  if (keyword && !keywordPresent(meta_title, keyword) && meta_title.length < 50) {
    meta_title = clampTitle(`${meta_title} — ${keyword.split(/\s+/).slice(0, 4).join(' ')}`, TITLE_MAX);
  }

  const seedDesc =
    (draft.meta_description || draft.excerpt || '').trim() ||
    `Practical cost of living guidance for ${entities.primary_entity || 'your next city'}. Compare housing, everyday expenses, and budgeting signals.`;
  const meta_description = fitMetaDescription(seedDesc, keyword);

  const suggested_url = `/blog/${slug}`;
  const canonical = `${SITE_URL}${suggested_url}`;

  const faq_schema_ready = (draft.blocks || []).some((b) => b.type === 'faq');

  return {
    seo_title,
    meta_title,
    meta_description,
    canonical,
    suggested_url,
    slug,
    og: {
      title: meta_title,
      description: meta_description,
      url: canonical,
      type: 'article',
      image: OG_IMAGE,
      site_name: SITE_NAME,
    },
    twitter: {
      card: 'summary_large_image',
      title: meta_title,
      description: meta_description,
      image: OG_IMAGE,
    },
    article_schema_type: 'Article',
    breadcrumb_labels: ['Home', 'Blog', entities.primary_entity || meta_title],
    faq_schema_ready,
    webpage_schema_ready: true,
    primary_keyword: keyword,
    semantic_keywords: entities.semantic_keywords.slice(0, 16),
  };
}

export { SITE_URL, SITE_NAME, OG_IMAGE, LOGO_URL };
