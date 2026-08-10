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
