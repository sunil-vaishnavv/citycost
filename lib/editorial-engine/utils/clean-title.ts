/**
 * Strip QA/certification batch markers from editorial titles & slugs.
 * Example noise: "(cert10-20260802k): First-Month …" → clean public title.
 */

const CERT_PAREN =
  /\s*[\(\[]\s*cert\d*[-_]?\d{0,8}[a-z]?\s*[\)\]]\s*:?\s*/gi;
/** cert10-20260802k or cert10 20260802k (after hyphen→space) */
const CERT_INLINE = /\bcert\d{1,3}[-_\s]\d{6,8}[a-z]?\b/gi;
const CERT_IN_SLUG = /-?cert\d{0,3}-\d{6,8}[a-z]?-?/gi;
const COLON_JUNK_PREFIX = /^\s*:\s*/;

/** Remove cert-batch tokens from a human title. */
export function cleanEditorialTitle(title: string): string {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  // Keep subtitle separator: "Title (cert…): Rest" → "Title: Rest"
  t = t.replace(CERT_PAREN, ': ');
  t = t.replace(CERT_INLINE, ' ');
  // Collapse leftover "Title : Rest" / double colons
  t = t.replace(/\s*:\s*/g, ': ').replace(/:\s*:/g, ':').replace(COLON_JUNK_PREFIX, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  // Trailing/leading orphan separators
  t = t.replace(/^[:\-–—]+\s*/, '').replace(/\s*[:\-–—]+$/, '').trim();
  return t;
}

/** True when title/slug still contains cert-batch noise. */
export function hasCertBatchNoise(text: string | null | undefined): boolean {
  const s = String(text || '');
  return /cert\d{0,3}[-_\s]?\d{6,8}[a-z]?/i.test(s) || /\(\s*cert/i.test(s);
}

/** Slugify after stripping cert noise. */
export function cleanEditorialSlug(titleOrSlug: string): string {
  const asTitle = cleanEditorialTitle(
    String(titleOrSlug || '')
      .replace(CERT_IN_SLUG, '-')
      .replace(/-/g, ' ')
  );
  return asTitle
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120);
}

/* ── Internal QA / verification markers (public-content boundary) ────────────
 * Topics created for testing carry labels such as
 * "Sydney vs Melbourne Cost of Living 2026: Post-Fix Verification (0865)".
 * Those labels must never reach public titles, slugs, metadata, headings, TOC,
 * FAQ, alt text or body. Years, prices and other semantic numbers are kept.
 */

const QA_TERM_SRC = [
  String.raw`(?:post|pre)[- ]?fix(?:\s+(?:verification|verify|check|test|run|build))?`,
  String.raw`verification\s+(?:run|test|check|pass|build|batch)`,
  String.raw`(?:qa|uat|e2e|smoke|sanity)(?:[- ](?:test|run|check|pass|batch|fixture|verification))?`,
  String.raw`regression\s+(?:test|run|check|fixture|batch)`,
  String.raw`test\s+(?:run|batch|case|article|topic|fixture|build)`,
  String.raw`debug(?:\s+(?:run|build|mode))?`,
  String.raw`sandbox`,
  String.raw`staging`,
  String.raw`dry[- ]?run`,
  String.raw`do\s+not\s+publish`,
  String.raw`draft\s+only`,
  String.raw`internal\s+only`,
  String.raw`nonce[-_: ]?[a-z0-9]{4,}`,
  String.raw`job\s*#\s*\d+`,
  String.raw`run\s*#\s*\d+`,
  String.raw`(?:cert|batch)\d{0,3}[-_]\d{3,}[a-z]?`,
].join('|');

const QA_TERM = new RegExp(String.raw`\b(?:${QA_TERM_SRC})\b`, 'i');
const QA_TERM_G = new RegExp(String.raw`\b(?:${QA_TERM_SRC})\b`, 'gi');
/** Bracketed group that contains a QA term: "(QA run 12)", "[smoke test]". */
const QA_BRACKET_G = new RegExp(
  String.raw`\s*[\(\[\{][^\)\]\}]*?\b(?:${QA_TERM_SRC})\b[^\)\]\}]*[\)\]\}]`,
  'gi'
);
/** Bare run id in brackets at the end, e.g. "(0865)" / "[#1234]" — but never a year like "(2026)". */
const TRAILING_RUN_ID = /\s*[\(\[]\s*#?(?!(?:19|20)\d{2}\s*[\)\]])\d{3,6}\s*[\)\]]\s*$/;
const LEADING_QA_TAG = /^\s*[\[\(]?\s*(?:qa|test|debug|draft|internal)\s*[\]\)]?\s*[:\-–—|]\s*/i;
const TITLE_SEPARATOR = /\s*(?::|\||\s[–—-]\s)\s*/;

function isQaSegment(segment: string): boolean {
  if (!QA_TERM.test(segment)) return false;
  // Whatever remains after removing QA terms, bracketed ids and punctuation must be (nearly) empty.
  const leftover = segment
    .replace(QA_TERM_G, ' ')
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')
    .replace(/[#\d]+/g, ' ')
    .replace(/[^a-z]+/gi, ' ')
    .trim();
  return leftover.split(/\s+/).filter(Boolean).length <= 1;
}

/**
 * Public title for an internal topic title: drops QA/verification labels and
 * cert-batch tokens while keeping years, prices and meaningful numbers.
 */
export function toPublicTitle(rawTitle: string): string {
  let t = cleanEditorialTitle(rawTitle);
  if (!t) return t;
  t = t.replace(LEADING_QA_TAG, '');
  t = t.replace(QA_BRACKET_G, '');
  // Drop separator-delimited segments (after the first) that are only QA labels.
  const parts = t.split(TITLE_SEPARATOR);
  if (parts.length > 1) {
    const kept = [parts[0], ...parts.slice(1).filter((p) => !isQaSegment(p))];
    t = kept.join(': ');
  } else if (isQaSegment(t)) {
    t = '';
  }
  // A run id left dangling after a QA label was removed.
  if (TRAILING_RUN_ID.test(t) && QA_TERM.test(rawTitle)) t = t.replace(TRAILING_RUN_ID, '');
  return cleanEditorialTitle(t.replace(/\s{2,}/g, ' '));
}

/**
 * Markers that are never ordinary English in article prose. Body text is
 * checked only against these (plus bracketed QA tags), because phrases such as
 * "do a test run of your commute" or "a dry run" are legitimate there.
 */
const STRONG_QA_SRC = [
  String.raw`(?:post|pre)[- ]?fix(?:\s+(?:verification|verify|check|test|run|build))?`,
  String.raw`verification\s+(?:run|test|check|pass|build|batch)`,
  String.raw`(?:qa|uat|e2e)[- ](?:test|run|check|pass|batch|fixture|verification)`,
  String.raw`do\s+not\s+publish`,
  String.raw`draft\s+only`,
  String.raw`internal\s+only`,
  String.raw`nonce[-_: ]?[a-z0-9]{4,}`,
  String.raw`job\s*#\s*\d+`,
  String.raw`run\s*#\s*\d+`,
  String.raw`(?:cert|batch)\d{0,3}[-_]\d{3,}[a-z]?`,
].join('|');
const STRONG_QA_G = new RegExp(String.raw`\b(?:${STRONG_QA_SRC})\b`, 'gi');

export type QaScanMode = 'title' | 'body';

/**
 * QA/verification markers found in public text (empty when clean).
 * `title` mode (titles, metadata, headings, TOC) uses the full marker set;
 * `body` mode only strong markers and bracketed QA tags.
 */
export function findQaMarkers(text: string | null | undefined, mode: QaScanMode = 'title'): string[] {
  const s = String(text || '');
  if (!s) return [];
  const hits = new Set<string>();
  for (const m of s.matchAll(QA_BRACKET_G)) hits.add(m[0].trim());
  const termRe = mode === 'title' ? QA_TERM_G : STRONG_QA_G;
  for (const m of s.matchAll(termRe)) {
    const term = m[0];
    // Bare "sandbox"/"staging"/"debug" are ordinary words; only bracketed forms count.
    if (/^(?:sandbox|staging|debug)$/i.test(term)) continue;
    hits.add(term.trim());
  }
  if (hasCertBatchNoise(s)) hits.add('cert-batch token');
  return [...hits];
}

/**
 * Remove QA markers from public text. `extraLabels` are exact internal labels
 * (e.g. the segments stripped from the topic title) that must not appear anywhere.
 */
export function stripQaMarkers(text: string, extraLabels: string[] = [], mode: QaScanMode = 'title'): string {
  let s = String(text || '');
  if (!s) return s;
  const original = s;
  for (const label of extraLabels) {
    const l = label.trim();
    if (l.length < 4) continue;
    const escaped = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Remove the label together with a separator that introduced it ("Title: <label>").
    s = s.replace(new RegExp(String.raw`\s*(?:[:|–—-]\s*)?` + escaped, 'g'), '');
  }
  s = s.replace(QA_BRACKET_G, '');
  const termRe = mode === 'title' ? QA_TERM_G : STRONG_QA_G;
  s = s.replace(termRe, (m) => (/^(?:sandbox|staging|debug)$/i.test(m) ? m : ''));
  if (s === original) return original;
  return s
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/[ \t]*:[ \t]*(?=[.,;:!?]|$)/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .trim();
}

/** Internal label segments that toPublicTitle removed (used to scrub body text). */
export function internalTitleLabels(rawTitle: string): string[] {
  const raw = cleanEditorialTitle(rawTitle);
  const pub = toPublicTitle(rawTitle);
  if (!raw || raw === pub) return [];
  const labels: string[] = [];
  for (const m of raw.matchAll(QA_BRACKET_G)) labels.push(m[0].trim());
  for (const part of raw.split(TITLE_SEPARATOR).slice(1)) {
    if (isQaSegment(part)) labels.push(part.trim());
  }
  return [...new Set(labels.filter((l) => l.length >= 4))];
}
