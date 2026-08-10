/**
 * Internal Link Engine — recommend links only to existing CityCost pages.
 * Priority: comparisons → cities → countries → calculator → existing blog drafts.
 */

import {
  listIndexableCities,
  listIndexableComparisons,
  listIndexableCountries,
} from '../../seo-catalog.js';
import type { EditorialSettings } from '../types.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import type { EntityMap } from './entity-map.js';
import { draftPlainText } from '../reviewer/text-utils.js';

export interface InternalLinkRecommendation {
  anchor: string;
  target: string;
  reason: string;
  confidence: number;
  location: string;
  link_kind: 'comparison' | 'city' | 'country' | 'calculator' | 'blog' | 'authority';
}

export interface InternalLinkPackage {
  recommendations: InternalLinkRecommendation[];
  count: number;
  target_min: number;
  target_max: number;
  in_range: boolean;
}

type Candidate = {
  href: string;
  label: string;
  kind: InternalLinkRecommendation['link_kind'];
  priority: number;
  reason: string;
};

function uniqAnchors(recs: InternalLinkRecommendation[]): InternalLinkRecommendation[] {
  const seenAnchor = new Set<string>();
  const seenTarget = new Set<string>();
  const out: InternalLinkRecommendation[] = [];
  for (const r of recs) {
    const aKey = r.anchor.toLowerCase().trim();
    if (!aKey || seenAnchor.has(aKey) || seenTarget.has(r.target)) continue;
    seenAnchor.add(aKey);
    seenTarget.add(r.target);
    out.push(r);
  }
  return out;
}

function pickLocation(draft: WriterDraftPayload, index: number): string {
  const blocks = draft.blocks || [];
  const paras = blocks.filter((b) =>
    ['paragraph', 'intro', 'summary', 'tip'].includes(b.type)
  );
  if (!paras.length) return 'body';
  const block = paras[index % paras.length]!;
  return `block:${block.id}`;
}

function anchorFor(label: string, kind: Candidate['kind']): string {
  const clean = label.replace(/\s+/g, ' ').trim();
  if (kind === 'comparison') return `${clean} cost of living`;
  if (kind === 'city') return `cost of living in ${clean.split(',')[0]!.trim()}`;
  if (kind === 'country') return `living costs in ${clean}`;
  if (kind === 'calculator') return 'CityCost calculator';
  if (kind === 'blog') return clean.slice(0, 60);
  return clean;
}

export function buildInternalLinks(input: {
  draft: WriterDraftPayload;
  entities: EntityMap;
  settings: EditorialSettings;
  authorityLinks?: Array<{ href: string; label: string }>;
  toolLinks?: Array<{ href: string; label: string }>;
  existingBlogArticles?: Array<{ slug: string; seo_title: string | null }>;
}): InternalLinkPackage {
  const { draft, entities, settings } = input;
  const text = draftPlainText(draft).toLowerCase();
  const min = settings.internal_link_min;
  const max = settings.internal_link_max;

  const candidates: Candidate[] = [];

  for (const c of entities.related_comparisons) {
    candidates.push({
      href: c.href,
      label: c.label,
      kind: 'comparison',
      priority: 100,
      reason: 'Existing comparison page strengthens topical authority and intent match',
    });
  }
  for (const c of entities.related_cities) {
    candidates.push({
      href: c.href,
      label: c.label,
      kind: 'city',
      priority: 80,
      reason: 'Related city page for entity SEO and verification',
    });
  }
  for (const c of entities.related_countries) {
    candidates.push({
      href: c.href,
      label: c.label,
      kind: 'country',
      priority: 60,
      reason: 'Country hub supports topical cluster coverage',
    });
  }
  for (const t of input.toolLinks || [{ href: '/', label: 'Cost of Living Calculator' }]) {
    candidates.push({
      href: t.href,
      label: t.label,
      kind: 'calculator',
      priority: 50,
      reason: 'Natural CTA to CityCost calculator tool',
    });
  }
  for (const a of input.existingBlogArticles || []) {
    candidates.push({
      href: `/blog/${a.slug}`,
      label: a.seo_title || a.slug,
      kind: 'blog',
      priority: 40,
      reason: 'Related editorial article for topical authority',
    });
  }
  for (const a of (input.authorityLinks || []).slice(0, 2)) {
    candidates.push({
      href: a.href,
      label: a.label,
      kind: 'authority',
      priority: 35,
      reason: 'EEAT methodology / trust page',
    });
  }

  // Catalog fillers (existing pages only) when entity context is thin
  if (candidates.filter((c) => c.kind === 'comparison').length < 4) {
    for (const p of listIndexableComparisons().slice(0, 8)) {
      candidates.push({
        href: `/compare/${p.slug}`,
        label: `${p.cityA} vs ${p.cityB}`,
        kind: 'comparison',
        priority: 70,
        reason: 'Catalog comparison page for topical authority',
      });
    }
  }
  if (candidates.filter((c) => c.kind === 'city').length < 4) {
    for (const c of listIndexableCities().slice(0, 8)) {
      candidates.push({
        href: `/city/${c.pageSlug}`,
        label: `${c.city}, ${c.country}`,
        kind: 'city',
        priority: 55,
        reason: 'Catalog city page for entity SEO',
      });
    }
  }
  if (candidates.filter((c) => c.kind === 'country').length < 2) {
    for (const c of listIndexableCountries().slice(0, 4)) {
      candidates.push({
        href: `/country/${c.slug}`,
        label: c.name,
        kind: 'country',
        priority: 45,
        reason: 'Catalog country hub for cluster coverage',
      });
    }
  }

  const scored = candidates.map((c) => {
    const token = c.label.toLowerCase().split(/[\s,]+/)[0] || '';
    const mentioned = token.length > 2 && text.includes(token);
    const confidence = Math.min(0.98, 0.55 + c.priority / 200 + (mentioned ? 0.2 : 0));
    return { ...c, confidence, mentioned };
  });

  scored.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.confidence - a.confidence;
  });

  const mentionedFirst = [
    ...scored.filter((c) => c.mentioned),
    ...scored.filter((c) => !c.mentioned),
  ];

  const toRec = (c: (typeof scored)[number], idx: number): InternalLinkRecommendation => ({
    anchor: anchorFor(c.label, c.kind),
    target: c.href,
    reason: c.reason,
    confidence: Math.round(c.confidence * 100) / 100,
    location: pickLocation(draft, idx),
    link_kind: c.kind,
  });

  // Reserve calculator (+ optional authority) slots inside the 8–15 budget
  const reserved: InternalLinkRecommendation[] = [];
  const calc = scored.find((c) => c.kind === 'calculator');
  const auth = scored.find((c) => c.kind === 'authority');
  if (calc) reserved.push(toRec(calc, 0));
  if (auth) reserved.push(toRec(auth, 1));

  const reservedTargets = new Set(reserved.map((r) => r.target));
  const picked: InternalLinkRecommendation[] = [...reserved];
  const room = Math.max(0, max - reserved.length);

  for (const c of mentionedFirst) {
    if (picked.length - reserved.length >= room) break;
    if (reservedTargets.has(c.href)) continue;
    if (c.kind === 'calculator' || c.kind === 'authority') continue;
    picked.push(toRec(c, picked.length));
  }

  const recommendations = uniqAnchors(picked).slice(0, max);

  return {
    recommendations,
    count: recommendations.length,
    target_min: min,
    target_max: max,
    in_range: recommendations.length >= min && recommendations.length <= max,
  };
}
