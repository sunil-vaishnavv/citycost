/**
 * Content Intelligence Engine micro-benchmark (cold vs warm cache).
 * Run: npx tsx scripts/bench-content-engine.ts
 */
import { listEligibleCities, shortCountrySlug } from '../lib/seo-eligibility.js';
import { invalidateContentCache, contentCacheStats, generateCityContentSync } from '../lib/content-engine/index.js';

invalidateContentCache();
const cities = listEligibleCities().slice(0, 25);
console.log('eligible sample', cities.length);

function bench(label: string, n: number, fn: (i: number) => void) {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn(i);
  const ms = performance.now() - t0;
  return { label, n, ms: Math.round(ms), per_ms: +(ms / n).toFixed(3) };
}

const cold = bench('city_gen_cold', cities.length, (i) => {
  const rec = cities[i];
  generateCityContentSync({
    rec,
    countrySlug: shortCountrySlug(rec.countryCode),
    nearby: [],
    related_comparisons: [],
  });
});

const warm = bench('city_gen_warm', cities.length, (i) => {
  const rec = cities[i];
  generateCityContentSync({
    rec,
    countrySlug: shortCountrySlug(rec.countryCode),
    nearby: [],
    related_comparisons: [],
  });
});

const doc = generateCityContentSync({
  rec: cities[0],
  countrySlug: shortCountrySlug(cities[0].countryCode),
  nearby: [],
  related_comparisons: [],
});

console.log(JSON.stringify({
  cold,
  warm,
  cache: contentCacheStats(),
  sample: {
    slug: doc.meta.slug,
    words: doc.word_count,
    blocks: doc.blocks.length,
    faqs: doc.faqs.length,
    method: doc.meta.generation_method,
    version: doc.meta.content_version,
  },
  estimate_minutes: {
    cold_500: +((cold.per_ms * 500) / 60000).toFixed(2),
    cold_2000: +((cold.per_ms * 2000) / 60000).toFixed(2),
    cold_10000: +((cold.per_ms * 10000) / 60000).toFixed(2),
    warm_500: +((warm.per_ms * 500) / 60000).toFixed(2),
    warm_2000: +((warm.per_ms * 2000) / 60000).toFixed(2),
    warm_10000: +((warm.per_ms * 10000) / 60000).toFixed(2),
  },
}, null, 2));
