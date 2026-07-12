import {
  buildCityPageData,
  buildCountryPageData,
  buildComparePageData,
  listIndexableComparisons,
  CONTENT_ENGINE_VERSION,
  contentCacheStats,
} from '../lib/seo-catalog.js';

const city = buildCityPageData('mumbai-maharashtra-india');
const country = buildCountryPageData('india');
const comps = listIndexableComparisons().slice(0, 1);
const compare = comps[0] ? buildComparePageData(comps[0].slug) : null;

console.log(JSON.stringify({
  version: CONTENT_ENGINE_VERSION,
  city: city && {
    summary: city.summary.slice(0, 100),
    faqs: city.faqs.length,
    sections: Object.keys(city.sections || {}),
  },
  country: country && {
    summary: country.summary.slice(0, 100),
    faqs: country.faqs.length,
    cities: country.cities.length,
  },
  compare: compare && {
    slug: compare.slug,
    faqs: compare.enrichment.faqs.length,
    exec: compare.enrichment.executive_summary.slice(0, 100),
  },
  cache: contentCacheStats(),
}, null, 2));
