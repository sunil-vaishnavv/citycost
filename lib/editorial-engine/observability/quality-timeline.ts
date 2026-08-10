/**
 * Quality timeline points — before→after per revision attempt.
 */

import type { QualityReport } from '../reviewer/quality-report.js';
import type { ConfidenceResult } from './confidence-engine.js';

export interface QualityDimensionPoint {
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface QualityTimelinePoint {
  attempt: number;
  at: string;
  overall: QualityDimensionPoint;
  readability: QualityDimensionPoint;
  seo: QualityDimensionPoint;
  structure: QualityDimensionPoint;
  schema: QualityDimensionPoint;
  internal_links: QualityDimensionPoint;
  confidence?: QualityDimensionPoint;
}

function dim(before: number | null | undefined, after: number | null | undefined): QualityDimensionPoint {
  const b = before != null && Number.isFinite(before) ? Math.round(before * 10) / 10 : null;
  const a = after != null && Number.isFinite(after) ? Math.round(after * 10) / 10 : null;
  return {
    before: b,
    after: a,
    delta: b != null && a != null ? Math.round((a - b) * 10) / 10 : null,
  };
}

function structureScore(report: QualityReport | null | undefined): number | null {
  if (!report?.rule_validator) return null;
  const findings = report.rule_validator.findings || [];
  const struct = findings.filter((f) => f.category === 'STRUCTURE');
  if (!struct.length) return 100;
  return Math.max(0, 100 - struct.length * 8);
}

function schemaScore(report: QualityReport | null | undefined): number | null {
  if (!report?.rule_validator) return null;
  const broken = report.rule_validator.findings.some((f) => f.code === 'broken_json_ld');
  return broken ? 20 : 100;
}

function linksScore(report: QualityReport | null | undefined): number | null {
  if (!report?.rule_validator) return null;
  const missing = report.rule_validator.findings.some((f) => f.code === 'missing_internal_links');
  return missing ? 35 : 100;
}

export function buildQualityTimelinePoint(input: {
  attempt: number;
  before: QualityReport | null | undefined;
  after: QualityReport | null | undefined;
  confidence_before?: ConfidenceResult | null;
  confidence_after?: ConfidenceResult | null;
  at?: string;
}): QualityTimelinePoint {
  return {
    attempt: input.attempt,
    at: input.at || new Date().toISOString(),
    overall: dim(input.before?.overall_score, input.after?.overall_score),
    readability: dim(input.before?.scores?.readability, input.after?.scores?.readability),
    seo: dim(input.before?.scores?.seo, input.after?.scores?.seo),
    structure: dim(structureScore(input.before), structureScore(input.after)),
    schema: dim(schemaScore(input.before), schemaScore(input.after)),
    internal_links: dim(linksScore(input.before), linksScore(input.after)),
    confidence: dim(
      input.confidence_before?.overall_confidence,
      input.confidence_after?.overall_confidence
    ),
  };
}
