/**
 * Confidence + source labeling
 */

import type { DataSourceLabel, InternalSource } from './types.js';

export function mapSourceLabel(source: InternalSource): DataSourceLabel {
  switch (source) {
    case 'surveyed':
      return 'Real';
    case 'numbeo':
      return 'API';
    case 'cache_verified':
      return 'Cached';
    case 'cache':
      return 'Cached';
    case 'nearby':
      return 'Nearby';
    case 'regional':
      return 'Regional';
    case 'country':
      return 'Country';
    case 'estimated':
      return 'Estimated';
    default:
      return 'Unknown';
  }
}

export function confidenceForSource(source: InternalSource): {
  confidence: number;
  stars: number;
  label: string;
  note: string;
} {
  switch (source) {
    case 'surveyed':
    case 'numbeo':
      return {
        confidence: 0.95,
        stars: 5,
        label: '★★★★★ Real surveyed data',
        note: 'Based on curated surveyed / published cost-of-living reference data for this city.',
      };
    case 'cache_verified':
      return {
        confidence: 0.9,
        stars: 5,
        label: '★★★★★ Cached verified data',
        note: 'Served from verified database cache (real/API source).',
      };
    case 'nearby':
      return {
        confidence: 0.78,
        stars: 4,
        label: '★★★★☆ Nearby city estimation',
        note: 'These values are estimated using nearby cities and regional averages.',
      };
    case 'regional':
      return {
        confidence: 0.62,
        stars: 3,
        label: '★★★☆☆ Regional estimation',
        note: 'These values are estimated using state/regional baselines and city-tier adjustments.',
      };
    case 'cache':
      return {
        confidence: 0.7,
        stars: 3,
        label: '★★★☆☆ Cached estimate',
        note: 'Served from database cache of a prior estimate.',
      };
    case 'country':
      return {
        confidence: 0.45,
        stars: 2,
        label: '★★☆☆☆ Country estimation',
        note: 'Limited city data — estimated from country-level baselines only.',
      };
    case 'estimated':
    default:
      return {
        confidence: 0.35,
        stars: 1,
        label: '★☆☆☆☆ Low confidence',
        note: 'Sparse inputs — treat figures as indicative only.',
      };
  }
}
