/**
 * Validate Writer internal markdown links against research candidates + catalog sanity.
 */

import type { ResearchPack } from './research-engine.js';
import type { WriterDraftPayload } from './draft-validate.js';
import { draftBodyText } from '../reviewer/text-utils.js';
import { normalizeGuideFamily } from './guide-contracts.js';
import { filterRelevantHrefs } from './v2/link-relevance.js';

export interface LinkValidationResult {
  ok: boolean;
  issues: string[];
  kept_hrefs: string[];
  removed_hrefs: string[];
  draft: WriterDraftPayload;
}

const ALLOWED_PREFIXES = [
  '/city/',
  '/country/',
  '/compare/',
  '/blog/',
  '/methodology',
  '/data-sources',
  '/about',
  '/authority',
  '/',
];

function extractMdLinks(text: string): Array<{ full: string; label: string; href: string }> {
  const out: Array<{ full: string; label: string; href: string }> = [];
  const re = /\[([^\]]+)\]\((\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ full: m[0], label: m[1], href: m[2] });
  }
  return out;
}

function allowedPath(href: string): boolean {
  const h = href.split('?')[0] || href;
  if (h === '/') return true;
  return ALLOWED_PREFIXES.some((p) => (p.endsWith('/') ? h.startsWith(p) : h === p || h.startsWith(`${p}/`)));
}

function countryHint(research: ResearchPack | null | undefined): string {
  const c =
    research?.entities?.countries?.[0] ||
    research?.primary_entity ||
    (research?.related_countries || [])[0]?.label ||
    '';
  return String(c || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function candidateHrefs(research: ResearchPack | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const l of research?.internal_link_candidates || []) {
    if (l?.href) set.add(l.href);
  }
  for (const l of research?.related_cities || []) {
    if (l?.href) set.add(l.href);
  }
  for (const l of research?.related_countries || []) {
    if (l?.href) set.add(l.href);
  }
  for (const l of research?.related_comparison_pages || []) {
    if (l?.href) set.add(l.href);
  }
  set.add('/methodology');
  set.add('/data-sources');
  set.add('/about');
  set.add('/');
  return set;
}

function nonsenseCompare(href: string, research: ResearchPack | null | undefined): boolean {
  if (!href.startsWith('/compare/')) return false;
  const family = normalizeGuideFamily(research?.topic?.content_type);
  // Country guides: reject compare links unless both sides look related to country cities
  if (family === 'country') {
    const cities = (research?.entities?.cities || []).map((c) =>
      c.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    );
    const slug = href.replace('/compare/', '');
    const parts = slug.split('-vs-');
    if (parts.length !== 2) return true;
    const [a, b] = parts;
    const country = countryHint(research);
    // Allow if both sides match known cities OR contain country token
    const aOk = cities.some((c) => a?.includes(c) || c.includes(a || '')) || (country && a?.includes(country));
    const bOk = cities.some((c) => b?.includes(c) || c.includes(b || '')) || (country && b?.includes(country));
    // Random cross-country pairs (abu-dhabi-vs-ajmer) → nonsense for an India country guide
    if (!aOk || !bOk) return true;
  }
  return false;
}

/** Drop invalid markdown links from prose (keep label text). */
export function validateAndRepairDraftLinks(
  draft: WriterDraftPayload,
  research?: ResearchPack | null
): LinkValidationResult {
  const allowed = candidateHrefs(research);
  const issues: string[] = [];
  const kept: string[] = [];
  const removed: string[] = [];

  const hrefCounts = new Map<string, number>();
  const blocks = (draft.blocks || []).map((b) => {
    if (typeof b.content !== 'string') return b;
    let text = b.content;
    for (const link of extractMdLinks(text)) {
      let bad = false;
      const seen = (hrefCounts.get(link.href) || 0) + 1;
      hrefCounts.set(link.href, seen);
      if (!allowedPath(link.href)) {
        bad = true;
        issues.push(`Invalid path prefix: ${link.href}`);
      } else if (nonsenseCompare(link.href, research)) {
        bad = true;
        issues.push(`Nonsensical compare link for guide type: ${link.href}`);
      } else if (seen > 2) {
        // Same href more than twice → plain text (stops repeated link wording)
        bad = true;
        issues.push(`Repeated internal-link wording: ${link.href}`);
      } else if (
        link.href.startsWith('/city/') ||
        link.href.startsWith('/country/') ||
        link.href.startsWith('/compare/')
      ) {
        if (!allowed.has(link.href) && !link.href.startsWith('/blog/')) {
          const cityNames = (research?.entities?.cities || []).map((c) =>
            c.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          );
          const okCity = cityNames.some((c) => link.href.includes(c));
          if (!okCity) {
            bad = true;
            issues.push(`Link not in research candidates: ${link.href}`);
          }
        }
      }
      if (bad) {
        text = text.replace(link.full, link.label);
        removed.push(link.href);
      } else {
        kept.push(link.href);
      }
    }
    return text === b.content ? b : { ...b, content: text };
  });

  // Cap CityCost promotion density
  const body = draftBodyText({ ...draft, blocks });
  const citycostHits = (body.match(/citycost/gi) || []).length;
  if (citycostHits > 10) {
    issues.push(`Repeated CityCost promotion (${citycostHits}×)`);
  }

  return {
    ok: !issues.some((i) => /Nonsensical|Invalid path|not in research/i.test(i)),
    issues,
    kept_hrefs: [...new Set(kept)],
    removed_hrefs: [...new Set(removed)],
    draft: { ...draft, blocks },
  };
}

/** Curate writer-facing links from research by guide family. */
export function curatedLinksForWriter(research: ResearchPack, limit = 8): string[] {
  const family = normalizeGuideFamily(research.topic?.content_type);
  const cities = (research.related_cities || []).map((l) => l.href).filter(Boolean);
  const countries = (research.related_countries || []).map((l) => l.href).filter(Boolean);
  const compares = (research.related_comparison_pages || []).map((l) => l.href).filter(Boolean);
  const authority = ['/methodology', '/data-sources'];

  let ordered: string[] = [];
  if (family === 'country') {
    ordered = [...countries.slice(0, 1), ...cities.slice(0, 5), ...authority];
  } else if (family === 'city') {
    ordered = [...cities.slice(0, 1), ...countries.slice(0, 1), ...cities.slice(1, 3), ...authority];
  } else if (family === 'comparison') {
    ordered = [...compares.slice(0, 1), ...cities.slice(0, 2), ...countries.slice(0, 1), ...authority];
  } else {
    ordered = [...cities.slice(0, 3), ...countries.slice(0, 1), ...authority];
  }

  // Fallback to candidates if empty
  if (ordered.length < 3) {
    ordered = [
      ...ordered,
      ...(research.internal_link_candidates || []).map((l) => l.href).filter(Boolean),
    ];
  }
  const unique = [...new Set(ordered)];
  // Only links to real routes that match the article's geography (legacy packs without geo_scope unchanged).
  const relevant = research.geo_scope ? filterRelevantHrefs(unique, research.geo_scope) : unique;
  return relevant.slice(0, limit);
}
