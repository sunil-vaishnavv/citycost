/**
 * Authority internal linking registry.
 */

import type { AuthorityPageId } from './types.js';

export const AUTHORITY_PATHS: Record<AuthorityPageId, string> = {
  methodology: '/methodology',
  'data-sources': '/data-sources',
  about: '/about',
  contact: '/contact',
  privacy: '/privacy',
  terms: '/terms',
  disclaimer: '/disclaimer',
};

export const AUTHORITY_NAV: Array<{ id: AuthorityPageId; label: string; href: string }> = [
  { id: 'methodology', label: 'Methodology', href: AUTHORITY_PATHS.methodology },
  { id: 'data-sources', label: 'Data Sources', href: AUTHORITY_PATHS['data-sources'] },
  { id: 'about', label: 'About', href: AUTHORITY_PATHS.about },
  { id: 'contact', label: 'Contact', href: AUTHORITY_PATHS.contact },
  { id: 'privacy', label: 'Privacy', href: AUTHORITY_PATHS.privacy },
  { id: 'terms', label: 'Terms', href: AUTHORITY_PATHS.terms },
  { id: 'disclaimer', label: 'Disclaimer', href: AUTHORITY_PATHS.disclaimer },
];

/** Footer subset — high EEAT value, crawlable. Includes public Blog. */
export const AUTHORITY_FOOTER_LINKS: Array<{ label: string; href: string }> = [
  { label: 'Blog', href: '/blog' },
  ...AUTHORITY_NAV,
];

/** Contextual links for knowledge pages (city / country / compare). */
export const KNOWLEDGE_PAGE_AUTHORITY_LINKS = [
  AUTHORITY_NAV.find((l) => l.id === 'methodology')!,
  AUTHORITY_NAV.find((l) => l.id === 'data-sources')!,
  AUTHORITY_NAV.find((l) => l.id === 'disclaimer')!,
  AUTHORITY_NAV.find((l) => l.id === 'about')!,
];

export function isAuthorityPath(pathname: string): AuthorityPageId | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const [id, href] of Object.entries(AUTHORITY_PATHS) as Array<[AuthorityPageId, string]>) {
    if (path === href) return id;
  }
  return null;
}

export function authoritySitemapUrls(baseUrl: string): string[] {
  return Object.values(AUTHORITY_PATHS).map((p) => `${baseUrl.replace(/\/$/, '')}${p}`);
}
