/**
 * Site-link normalization — every markdown link in public content is reconciled
 * against verified CityCost routes.
 *
 * - citycost.online absolute URLs → relative site paths
 * - placeholder hosts (example.com, localhost, yourdomain…): if the path is a real
 *   CityCost route it becomes that relative path; otherwise the link is removed
 *   and only its text is kept. Bare placeholder URLs in prose are removed.
 * - relative routes that do not exist, or are irrelevant to the article, are unlinked
 * - slug-derived anchor text ("Sydney New" for /city/sydney-new-south-wales-australia)
 *   is replaced by the catalog name
 * Real external links on other hosts are left untouched.
 */

import { listIndexableComparisons, listIndexableCountries, findCityBySlug } from '../../../seo-catalog.js';
import { STATIC_PATH_LABELS } from '../../blog/linkify-paths.js';
import { judgeLink, normalizeSiteHref, resolveSiteRoute, type LinkGeoScope } from './link-relevance.js';

export const PLACEHOLDER_HOST_RE =
  /^(?:www\.)?(?:example\.(?:com|org|net|edu)|localhost|127\.0\.0\.1|0\.0\.0\.0|(?:your|my)[-_]?(?:domain|site|website|blog)\.[a-z.]+|(?:domain|website|site|placeholder|dummy)\.(?:com|org|net)|[a-z0-9.-]+\.(?:test|invalid|example|localhost|local))$/i;
const SITE_HOST_RE = /^(?:www\.)?citycost\.online$/i;
const MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BARE_PLACEHOLDER_URL_RE =
  /\bhttps?:\/\/(?:www\.)?(?:example\.(?:com|org|net|edu)|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?|(?:your|my)[-_]?(?:domain|site|website|blog)\.[a-z.]+|(?:domain|website|site|placeholder|dummy)\.(?:com|org|net))(?:\/[^\s)\]]*)?/gi;

/** Human label for a verified route (catalog names, never slug fragments). */
export function routeLabel(rawHref: string): string | null {
  const route = resolveSiteRoute(rawHref);
  if (!route) return null;
  if (route.kind === 'static') return STATIC_PATH_LABELS[route.href] || null;
  if (route.kind === 'city') return findCityBySlug(route.pageSlug)?.city || null;
  if (route.kind === 'country') return listIndexableCountries().find((c) => c.slug === route.slug)?.name || null;
  if (route.kind === 'compare') {
    const hit = listIndexableComparisons().find((c) => c.slug === route.slug);
    return hit ? `${hit.cityA} vs ${hit.cityB}` : null;
  }
  return null;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Anchor text that was built from slug tokens rather than written for readers:
 * all of its words are slug tokens, in slug order, and it is not the catalog name.
 */
export function isSlugDerivedLabel(label: string, href: string, catalogLabel: string | null): boolean {
  if (!catalogLabel) return false;
  const lt = tokens(label);
  const ct = tokens(catalogLabel);
  if (!lt.length || lt.join(' ') === ct.join(' ')) return false;
  const slug = normalizeSiteHref(href).split('/').pop() || '';
  const st = slug.split('-').filter(Boolean);
  let i = 0;
  for (const t of lt) {
    const at = st.indexOf(t, i);
    if (at < 0) return false;
    i = at + 1;
  }
  // Same first token as the catalog name but extra slug words ("Sydney New") or a bare slug.
  return lt.length > ct.length || lt.join('-') === slug;
}

export interface SiteLinkIssue {
  kind: 'placeholder_url' | 'unknown_route' | 'irrelevant' | 'slug_label';
  href: string;
  label: string;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Inspect without mutating. */
export function findSiteLinkIssues(text: string, scope?: LinkGeoScope | null): SiteLinkIssue[] {
  const issues: SiteLinkIssue[] = [];
  if (!text) return issues;
  for (const m of text.matchAll(MD_LINK_RE)) {
    const label = m[1]!;
    const href = m[2]!;
    const u = /^https?:\/\//i.test(href) ? parseUrl(href) : null;
    if (u && PLACEHOLDER_HOST_RE.test(u.hostname)) {
      issues.push({ kind: 'placeholder_url', href, label });
      continue;
    }
    if (u && !SITE_HOST_RE.test(u.hostname)) continue; // real external link
    const path = u ? u.pathname : href;
    if (!path.startsWith('/')) continue;
    const verdict = scope ? judgeLink(path, scope) : resolveSiteRoute(path) ? 'relevant' : 'unknown_route';
    if (verdict === 'unknown_route') issues.push({ kind: 'unknown_route', href, label });
    else if (verdict === 'irrelevant') issues.push({ kind: 'irrelevant', href, label });
    else if (isSlugDerivedLabel(label, path, routeLabel(path))) issues.push({ kind: 'slug_label', href, label });
  }
  const withoutLinks = text.replace(MD_LINK_RE, ' ');
  for (const m of withoutLinks.matchAll(BARE_PLACEHOLDER_URL_RE)) {
    issues.push({ kind: 'placeholder_url', href: m[0], label: '' });
  }
  return issues;
}

/** Repair links in one string. Returns the fixed text and what was changed. */
export function normalizeSiteLinks(
  text: string,
  scope?: LinkGeoScope | null
): { text: string; fixes: SiteLinkIssue[] } {
  const fixes: SiteLinkIssue[] = [];
  if (!text || (!text.includes('](') && !/https?:\/\//i.test(text))) return { text, fixes };
  let out = text.replace(MD_LINK_RE, (whole, label: string, href: string) => {
    const u = /^https?:\/\//i.test(href) ? parseUrl(href) : null;
    let path: string | null = href.startsWith('/') ? href : null;
    if (u) {
      if (SITE_HOST_RE.test(u.hostname) || PLACEHOLDER_HOST_RE.test(u.hostname)) {
        path = u.pathname || '/';
        if (PLACEHOLDER_HOST_RE.test(u.hostname)) fixes.push({ kind: 'placeholder_url', href, label });
      } else {
        return whole; // real external link
      }
    }
    if (!path) return whole;
    const normalized = normalizeSiteHref(path);
    const verdict = scope ? judgeLink(normalized, scope) : resolveSiteRoute(normalized) ? 'relevant' : 'unknown_route';
    if (verdict !== 'relevant') {
      fixes.push({ kind: verdict === 'unknown_route' ? 'unknown_route' : 'irrelevant', href, label });
      return label; // keep the words, drop the link
    }
    const catalog = routeLabel(normalized);
    let finalLabel = label;
    if (isSlugDerivedLabel(label, normalized, catalog)) {
      fixes.push({ kind: 'slug_label', href, label });
      finalLabel = catalog!;
    }
    return `[${finalLabel}](${normalized})`;
  });
  out = out.replace(BARE_PLACEHOLDER_URL_RE, (url) => {
    fixes.push({ kind: 'placeholder_url', href: url, label: '' });
    return '';
  });
  if (fixes.length) out = out.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1');
  return { text: out, fixes };
}
