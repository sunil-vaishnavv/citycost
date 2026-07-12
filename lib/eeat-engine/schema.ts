/**
 * EEAT / authority JSON-LD helpers.
 */

import type { AuthorityPageDoc } from './types.js';
import { AUTHORITY_PATHS } from './links.js';

const SITE_NAME = 'CityCost Global';
const SITE_URL = 'https://citycost.online';
const LOGO_URL = `${SITE_URL}/logo.png`;

/** Enhanced Organization with EEAT-oriented fields (no sensitive internals). */
export function buildOrganizationSchemaEeat() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: LOGO_URL,
      width: 200,
      height: 60,
    },
    description:
      'CityCost Global publishes structured cost-of-living comparisons and knowledge pages with transparent methodology and data-quality labels.',
    sameAs: [
      'https://twitter.com/citycostglobal',
      'https://www.facebook.com/citycostglobal',
    ],
    publishingPrinciples: `${SITE_URL}${AUTHORITY_PATHS.methodology}`,
    knowsAbout: [
      'Cost of living',
      'City comparison',
      'Purchasing power',
      'Relocation planning',
    ],
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        url: `${SITE_URL}${AUTHORITY_PATHS.contact}`,
        email: 'support@citycost.online',
      },
      {
        '@type': 'ContactPoint',
        contactType: 'data correction',
        url: `${SITE_URL}${AUTHORITY_PATHS.contact}`,
        email: 'data@citycost.online',
      },
    ],
  };
}

export function buildAuthorityWebPageSchema(doc: AuthorityPageDoc) {
  const url = `${SITE_URL}${doc.path}`;
  return {
    '@context': 'https://schema.org',
    '@type': doc.schema_type,
    name: doc.title,
    headline: doc.h1,
    description: doc.meta_description,
    url,
    inLanguage: 'en-US',
    dateModified: doc.last_updated,
    isPartOf: { '@type': 'WebSite', url: SITE_URL, name: SITE_NAME },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      publishingPrinciples: `${SITE_URL}${AUTHORITY_PATHS.methodology}`,
    },
    about: {
      '@type': 'Thing',
      name: doc.h1,
    },
  };
}

export function buildAuthorityBreadcrumb(doc: AuthorityPageDoc) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: doc.h1, item: `${SITE_URL}${doc.path}` },
    ],
  };
}

/**
 * Reserved graph node for future editorial / author / reviewer profiles.
 * Not injected on public pages until profiles exist.
 */
export function buildEditorialTeamPlaceholder() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: `${SITE_NAME} Research`,
    url: `${SITE_URL}${AUTHORITY_PATHS.about}`,
    description:
      'Reserved for future editorial team, author, and reviewer profiles under the Authority & EEAT Engine.',
  };
}
