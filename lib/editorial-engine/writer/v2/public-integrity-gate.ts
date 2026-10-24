/**
 * Public integrity gate — the last check before a draft is saved, and again at
 * publish time. Repairs only verified, mechanical defects, then re-inspects the
 * final content; any residual error blocks save/publish.
 *
 * Checks:
 * - internal QA / verification markers in public fields (title boundary)
 * - corrupt sentence breaks ("requires. looking") and malformed markdown
 * - TOC built from final headings; empty / duplicate / title-repeating headings
 * - internal links: real routes, geographically relevant
 * - figures consistent with the calculation ledger and across sections
 * - grounding requirement (when EDITORIAL_REQUIRE_GROUNDING is on)
 */

import type { WriterDraftPayload } from '../draft-validate.js';
import type { CalculationLedger } from '../../research/comparison-ledger.js';
import { findQaMarkers, stripQaMarkers } from '../../utils/clean-title.js';
import {
  collectDraftText,
  inspectProseIntegrity,
  mapDraftText,
  repairProseIntegrity,
  type TextLocation,
} from './prose-integrity.js';
import { inspectHeadingsAndToc, repairHeadingsAndToc } from './heading-integrity.js';
import type { LinkGeoScope } from './link-relevance.js';
import { findSiteLinkIssues, type SiteLinkIssue } from './link-normalize.js';
import { unlinkIrrelevantLinks } from './link-engine.js';
import { validateLedgerConsistency } from './ledger-consistency.js';
import { inspectPublicContentQuality, repairPublicContentQuality } from './public-content-quality.js';

export interface PublicIntegrityContext {
  /** Public article title (already passed through toPublicTitle). */
  articleTitle: string;
  /** Exact internal labels stripped from the raw topic title. */
  internalLabels?: string[];
  scope?: LinkGeoScope | null;
  ledger?: CalculationLedger | null;
  /** research_status recorded on the research pack. */
  researchStatus?: string | null;
  groundingRequired?: boolean;
}

export interface PublicIntegrityFinding {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  location?: TextLocation | { blockId?: string };
}

export interface PublicIntegrityReport {
  ok: boolean;
  errors: PublicIntegrityFinding[];
  warnings: PublicIntegrityFinding[];
  fixes: string[];
}

function isTitleLike(loc: TextLocation): boolean {
  return loc.field === 'meta' || loc.field === 'heading' || loc.field === 'alt' || loc.field === 'faq_q';
}

/** Remove internal QA labels everywhere (full marker set in title-like fields). */
export function scrubDraftQaMarkers(
  draft: WriterDraftPayload,
  labels: string[] = []
): { draft: WriterDraftPayload; fixes: number } {
  let fixes = 0;
  const out = mapDraftText(draft, (text, loc) => {
    const next = stripQaMarkers(text, labels, isTitleLike(loc) ? 'title' : 'body');
    if (next !== text) fixes += 1;
    return next;
  });
  return { draft: out, fixes };
}

export function findDraftQaMarkers(draft: WriterDraftPayload): Array<{ marker: string; location: TextLocation }> {
  const out: Array<{ marker: string; location: TextLocation }> = [];
  for (const { text, loc } of collectDraftText(draft)) {
    for (const marker of findQaMarkers(text, isTitleLike(loc) ? 'title' : 'body')) {
      out.push({ marker, location: loc });
    }
  }
  return out;
}

function inspectLinks(draft: WriterDraftPayload, scope: LinkGeoScope | null): PublicIntegrityFinding[] {
  const findings: PublicIntegrityFinding[] = [];
  const messages: Record<SiteLinkIssue['kind'], string> = {
    placeholder_url: 'Placeholder / example URL in public content',
    unknown_route: 'Link to a non-existent route',
    irrelevant: 'Irrelevant internal link',
    slug_label: 'Malformed link text (built from a URL slug)',
  };
  for (const { text, loc } of collectDraftText(draft)) {
    for (const issue of findSiteLinkIssues(text, scope)) {
      findings.push({
        code: issue.kind === 'irrelevant' ? 'link_irrelevant' : issue.kind === 'unknown_route' ? 'link_unknown_route' : issue.kind,
        severity: 'error',
        message: `${messages[issue.kind]}: ${issue.label ? `[${issue.label}]` : ''}(${issue.href})`,
        location: loc,
      });
    }
  }
  return findings;
}

/** Mechanical repairs only — never rewrites meaning. */
export function repairPublicIntegrity(
  draft: WriterDraftPayload,
  ctx: PublicIntegrityContext
): { draft: WriterDraftPayload; fixes: string[] } {
  const fixes: string[] = [];
  let d = draft;
  const qa = scrubDraftQaMarkers(d, ctx.internalLabels || []);
  d = qa.draft;
  if (qa.fixes) fixes.push(`qa_markers_scrubbed:${qa.fixes}`);
  const quality = repairPublicContentQuality(d, ctx.ledger);
  d = quality.draft;
  fixes.push(...quality.fixes);
  const prose = repairProseIntegrity(d);
  d = prose.draft;
  if (prose.fixes) fixes.push(`sentence_breaks_repaired:${prose.fixes}`);
  {
    const un = unlinkIrrelevantLinks(d, ctx.scope || null);
    d = un.draft;
    if (un.removed.length) fixes.push(`invalid_links_unlinked:${un.removed.length}`);
    if (un.relabelled) fixes.push(`link_labels_fixed:${un.relabelled}`);
  }
  const headings = repairHeadingsAndToc(d, ctx.articleTitle);
  d = headings.draft;
  fixes.push(...headings.fixes);
  return { draft: d, fixes };
}

/** Inspect the final content (no mutation). */
export function inspectPublicIntegrity(
  draft: WriterDraftPayload,
  ctx: PublicIntegrityContext
): PublicIntegrityReport {
  const errors: PublicIntegrityFinding[] = [];
  const warnings: PublicIntegrityFinding[] = [];

  for (const q of findDraftQaMarkers(draft)) {
    errors.push({ code: 'qa_marker_leak', severity: 'error', message: `Internal QA marker in public content: "${q.marker}"`, location: q.location });
  }
  for (const label of ctx.internalLabels || []) {
    if (label.length >= 4 && collectDraftText(draft).some((t) => t.text.includes(label))) {
      errors.push({ code: 'qa_marker_leak', severity: 'error', message: `Internal topic label in public content: "${label}"` });
    }
  }
  for (const f of inspectProseIntegrity(draft)) {
    errors.push({ code: f.code, severity: 'error', message: f.message, location: f.location });
  }
  for (const h of inspectHeadingsAndToc(draft, ctx.articleTitle)) {
    errors.push({ code: h.code, severity: 'error', message: h.message, location: { blockId: h.blockId } });
  }
  errors.push(...inspectLinks(draft, ctx.scope || null));
  for (const f of inspectPublicContentQuality(draft, ctx.ledger)) {
    (f.severity === 'error' ? errors : warnings).push({ code: f.code, severity: f.severity, message: f.message, location: f.location });
  }
  for (const f of validateLedgerConsistency(draft, ctx.ledger)) {
    (f.severity === 'error' ? errors : warnings).push({ code: f.code, severity: f.severity, message: f.message, location: f.location });
  }
  if (ctx.groundingRequired && ctx.researchStatus !== 'grounding_verified') {
    errors.push({
      code: 'grounding_required',
      severity: 'error',
      message: `Grounding is required for this article but research status is ${ctx.researchStatus || 'unknown'}`,
    });
  }
  return { ok: errors.length === 0, errors, warnings, fixes: [] };
}

/** Repair, then inspect the repaired content. */
export function runPublicIntegrityGate(
  draft: WriterDraftPayload,
  ctx: PublicIntegrityContext
): { draft: WriterDraftPayload; report: PublicIntegrityReport } {
  const repaired = repairPublicIntegrity(draft, ctx);
  const report = inspectPublicIntegrity(repaired.draft, ctx);
  return { draft: repaired.draft, report: { ...report, fixes: repaired.fixes } };
}

export function formatPublicIntegrityDebug(report: PublicIntegrityReport): string {
  return [
    `ok=${report.ok ? 'yes' : 'no'}`,
    `errors=${report.errors.length}`,
    `warnings=${report.warnings.length}`,
    report.fixes.length ? `fixes=${report.fixes.slice(0, 8).join('|')}` : 'fixes=none',
    report.errors.length ? `first=${report.errors.slice(0, 3).map((e) => e.code).join('|')}` : '',
  ]
    .filter(Boolean)
    .join(';');
}

/**
 * Mechanical integrity repair for ANY save of a generated (non-manual) draft —
 * Fix Issues, AI revision patches, review normalisation, FAQ regeneration.
 * Rebuilds the TOC from final headings and re-applies link, leakage, QA-marker and
 * prose repairs so no revision path can persist content that skipped them.
 * The publish gate re-inspects the stored draft independently.
 */
export function finalizeDraftForSave(
  article: { prompt_hash?: string | null; ai_model?: string | null; research_pack_json?: unknown; seo_title?: string | null },
  draft: WriterDraftPayload
): { draft: WriterDraftPayload; fixes: string[] } {
  const research = (article.research_pack_json || null) as {
    geo_scope?: LinkGeoScope;
    calculation_ledger?: CalculationLedger | null;
    origin?: string;
  } | null;
  const manual =
    article.prompt_hash === 'manual' || article.ai_model === 'manual' || research?.origin === 'manual';
  if (manual) return { draft, fixes: [] };
  return repairPublicIntegrity(draft, {
    articleTitle: draft.seo_title || article.seo_title || '',
    scope: research?.geo_scope || null,
    ledger: research?.calculation_ledger || null,
  });
}
