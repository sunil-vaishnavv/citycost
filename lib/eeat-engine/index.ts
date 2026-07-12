/**
 * Authority & EEAT Engine — public API.
 */

export { EEAT_ENGINE_VERSION } from './types.js';
export type {
  AuthorityPageId,
  AuthorityPageDoc,
  TrustSignalDisplay,
  DataQualityTier,
  EeatPageRecord,
  DataSourceEntry,
} from './types.js';

export {
  AUTHORITY_PATHS,
  AUTHORITY_NAV,
  AUTHORITY_FOOTER_LINKS,
  KNOWLEDGE_PAGE_AUTHORITY_LINKS,
  isAuthorityPath,
  authoritySitemapUrls,
} from './links.js';

export {
  buildTrustSignals,
  buildCountryTrustSignals,
  buildCompareTrustSignals,
  buildEeatRecord,
  inferQualityTier,
  qualityTierLabel,
} from './trust-signals.js';

export { getAuthorityPage, listAuthorityPages, DATA_SOURCES, AUTHORITY_PAGES } from './pages.js';

export {
  buildOrganizationSchemaEeat,
  buildAuthorityWebPageSchema,
  buildAuthorityBreadcrumb,
  buildEditorialTeamPlaceholder,
} from './schema.js';
