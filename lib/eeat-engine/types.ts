/**
 * Authority & EEAT Engine — types.
 * Public trust signals only; no internal scoring algorithms exposed.
 */

export const EEAT_ENGINE_VERSION = '1.0.0';

export type AuthorityPageId =
  | 'methodology'
  | 'data-sources'
  | 'about'
  | 'contact'
  | 'privacy'
  | 'terms'
  | 'disclaimer';

export type DataQualityTier =
  | 'verified'
  | 'curated'
  | 'estimated'
  | 'regional'
  | 'country';

export type ReviewStatus = 'published' | 'draft' | 'under_review';

/** Displayable trust strip for city / country / compare pages. */
export interface TrustSignalDisplay {
  last_updated: string;
  confidence: string;
  data_source: string;
  quality_tier: DataQualityTier;
  quality_label: string;
  methodology_href: string;
  report_issue_href: string;
  content_version?: string;
  review_status: ReviewStatus;
  freshness_label: string;
}

/** Internal EEAT record — may include fields reserved for future editorial workflows. */
export interface EeatPageRecord {
  data_freshness: string;
  confidence: string;
  source_quality: DataQualityTier;
  content_version: string;
  review_status: ReviewStatus;
  last_updated: string;
}

export interface AuthoritySection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface AuthorityPageDoc {
  id: AuthorityPageId;
  path: string;
  title: string;
  meta_description: string;
  h1: string;
  intro: string;
  sections: AuthoritySection[];
  schema_type: string;
  last_updated: string;
  /** Reserved for future editorial team attribution. */
  editorial?: {
    authors?: Array<{ name: string; role: string; slug?: string }>;
    reviewers?: Array<{ name: string; role: string; slug?: string }>;
  };
}

export interface DataSourceEntry {
  id: string;
  name: string;
  purpose: string;
  coverage: string;
  last_update: string;
  confidence: string;
  license: string;
  category: string;
}
