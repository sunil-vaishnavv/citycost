/**
 * Trust signal builders — map existing page data → EEAT display fields.
 * Does not change COL / content engines.
 */

import type { DataQualityTier, TrustSignalDisplay, EeatPageRecord } from './types.js';
import { EEAT_ENGINE_VERSION } from './types.js';
import { AUTHORITY_PATHS } from './links.js';

/** Map confidence / source labels to a transparent quality tier. */
export function inferQualityTier(confidenceLabel: string, dataSource: string): DataQualityTier {
  const c = (confidenceLabel || '').toLowerCase();
  const s = (dataSource || '').toLowerCase();
  if (c.includes('verified') || s.includes('verified') || c.includes('survey')) return 'verified';
  if (c.includes('curated') || s.includes('curated') || s.includes('reference')) return 'curated';
  if (c.includes('regional') || s.includes('regional')) return 'regional';
  if (c.includes('country') || s.includes('country')) return 'country';
  if (c.includes('estimat') || s.includes('estimat') || c.includes('model')) return 'estimated';
  if (s.includes('aggregat') || s.includes('index')) return 'curated';
  return 'estimated';
}

export function qualityTierLabel(tier: DataQualityTier): string {
  switch (tier) {
    case 'verified':
      return 'Verified Data';
    case 'curated':
      return 'Curated Reference Dataset';
    case 'estimated':
      return 'Estimated from regional averages';
    case 'regional':
      return 'Regional Estimate';
    case 'country':
      return 'Country-Level Estimate';
    default:
      return 'Estimated from regional averages';
  }
}

export function buildTrustSignals(input: {
  data_source?: string | null;
  confidence_label?: string | null;
  last_updated?: string | null;
  content_version?: string | null;
  estimation_note?: string | null;
}): TrustSignalDisplay {
  const data_source = (input.data_source || 'CityCost Index').trim();
  const confidence = (input.confidence_label || 'Standard').trim();
  const quality_tier = inferQualityTier(confidence, data_source);
  const last_updated = (input.last_updated || '').trim().slice(0, 10);

  return {
    last_updated: last_updated || '',
    confidence,
    data_source,
    quality_tier,
    quality_label: qualityTierLabel(quality_tier),
    methodology_href: AUTHORITY_PATHS.methodology,
    report_issue_href: `${AUTHORITY_PATHS.contact}?topic=data-issue`,
    content_version: input.content_version || EEAT_ENGINE_VERSION,
    review_status: 'published',
    freshness_label: last_updated ? `Updated ${last_updated}` : 'Update date from content meta when available',
  };
}

export function buildCountryTrustSignals(input?: {
  last_updated?: string;
  content_version?: string;
}): TrustSignalDisplay {
  return buildTrustSignals({
    data_source: 'CityCost Index (aggregated eligible cities)',
    confidence_label: 'Curated',
    last_updated: input?.last_updated,
    content_version: input?.content_version,
  });
}

export function buildCompareTrustSignals(input: {
  sourceA?: string | null;
  sourceB?: string | null;
  confidenceA?: string | null;
  confidenceB?: string | null;
  last_updated?: string | null;
  content_version?: string | null;
}): TrustSignalDisplay {
  const sources = [input.sourceA, input.sourceB].filter(Boolean).join(' · ') || 'CityCost Index';
  const conf =
    [input.confidenceA, input.confidenceB].filter(Boolean).join(' / ') || 'Standard';
  return buildTrustSignals({
    data_source: sources,
    confidence_label: conf,
    last_updated: input.last_updated,
    content_version: input.content_version,
  });
}

/** Internal EEAT record for pages (future editorial / review workflows). */
export function buildEeatRecord(trust: TrustSignalDisplay): EeatPageRecord {
  return {
    data_freshness: trust.freshness_label,
    confidence: trust.confidence,
    source_quality: trust.quality_tier,
    content_version: trust.content_version || EEAT_ENGINE_VERSION,
    review_status: trust.review_status,
    last_updated: trust.last_updated,
  };
}
