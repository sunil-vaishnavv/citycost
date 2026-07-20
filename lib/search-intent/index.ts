/**
 * Search Intent / Traffic Growth Engine — public API.
 */

export { SEARCH_INTENT_VERSION } from './types.js';
export type {
  SearchIntentId,
  CityLandingKind,
  CategoryHubId,
  CountryGuideKind,
  IntentLandingPublic,
  TopicalGraph,
  TopicSiloPublic,
  KeywordClusterInternal,
  IntentQualityInternal,
} from './types.js';

export {
  CITY_LANDING_KINDS,
  CATEGORY_HUBS,
  COUNTRY_GUIDE_KINDS,
  INTENT_META,
  cityLandingPath,
  categoryHubPath,
  countryGuidePath,
  parseCityLandingPath,
  parseCategoryHubPath,
  parseCountryGuidePath,
  landingKindToIntent,
  categoryToIntent,
} from './intent.js';

export {
  buildCityLandingPageData,
  buildCategoryHubPageData,
  buildCountryGuidePageData,
  buildIntentPageFromPath,
  listIndexableCityLandingUrls,
  listIndexableCategoryUrls,
  listIndexableCountryGuideUrls,
  isCityLandingIndexable,
  getIntentIndexStats,
  peekKeywordPriorityInternal,
  resetIntentCaches,
  warmIntentCatalogAsync,
} from './catalog.js';

export {
  scoreCityLandingPriority,
  scoreCategoryHubPriority,
  scoreCountryGuidePriority,
  compositeRankScore,
} from './priority.js';
export type { KeywordPriorityInternal } from './priority.js';

export {
  buildCityTopicSilo,
  buildCategoryTopicSilo,
  buildCountryGuideTopicSilo,
} from './silos.js';
export type { SiloLayerId } from './silos.js';

export {
  buildCityLandingKeywords,
  buildCategoryKeywords,
  buildCountryGuideKeywords,
} from './keywords.js';
