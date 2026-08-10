export type {
  TocItem,
  FaqItem,
  ContentLink,
  ProseSection,
  HubArticleCard,
  HomeHubPayload,
} from './types.js';

export {
  HOME_TOC,
  HOME_RELATED_RESOURCES,
  buildHomeHowItWorks,
  buildHomeCompleteGuide,
  buildHomeMethodologySection,
  buildHomeDataSourcesSection,
  buildHomeAboutSection,
  buildHomeFaqs,
  buildHomeCountryIntro,
  buildHomeComparisonsIntro,
  buildHomeRelocationIntro,
} from './homepage-content.js';

export {
  buildCityToc,
  buildCityIntro,
  buildCityOverviewSection,
  buildCityHousingSection,
  buildCityFoodSection,
  buildCityTransportSection,
  buildCityHealthcareSection,
  buildCityEducationSection,
  buildCitySalarySection,
  buildCityBudgetSection,
  buildCityConclusion,
  expandCityFaqs,
  type CityContentInput,
} from './city-content.js';

export {
  buildCountryToc,
  buildCountryIntro,
  buildCountryOverviewSection,
  buildCountryRegionalSection,
  buildCountryLivingExpensesSection,
  buildCountryMajorCitiesSection,
  buildCountryBudgetSection,
  buildCountryConclusion,
  expandCountryFaqs,
  type CountryContentInput,
} from './country-content.js';

export {
  buildCompareToc,
  buildCompareSummary,
  buildCompareHousing,
  buildCompareFood,
  buildCompareTransport,
  buildCompareHealthcare,
  buildCompareSalary,
  buildCompareProsCons,
  buildCompareRecommendation,
  buildCompareFaqs,
  type CompareContentInput,
  type CompareSide,
} from './compare-content.js';

// NOTE: buildHomeHubPayload lives in ./hub.js and must be imported directly
// from server code only — re-exporting it here pulls seo-catalog into any
// client that imports this barrel and blanks the SPA.
