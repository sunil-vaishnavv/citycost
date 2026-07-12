import { getIntentIndexStats, buildCityLandingPageData, buildCategoryHubPageData } from '../lib/search-intent/index.js';
import { listIndexableCities } from '../lib/seo-catalog.js';

const cities = listIndexableCities().slice(0, 3);
const stats = getIntentIndexStats();
const sampleSlug = cities[0]?.pageSlug;
const living = sampleSlug ? buildCityLandingPageData('living-in', sampleSlug) : null;
const students = buildCategoryHubPageData('students');

console.log(JSON.stringify({
  stats,
  sample: living && {
    path: living.path,
    h1: living.h1,
    siblings: living.graph.siblings.length,
    faqs: living.faqs.length,
  },
  studentsHub: students && { path: students.path, cities: students.graph.children.length },
}, null, 2));
