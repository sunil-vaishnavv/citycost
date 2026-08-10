/**
 * Near-duplicate detector — body-prose only (paragraph hashes + token Jaccard).
 * Ignores titles, headings, FAQ questions, TOC, CTA, schema/boilerplate.
 */

import type { DraftBlock, WriterDraftPayload } from '../writer/draft-validate.js';
import { clampScore, tokenize } from './text-utils.js';

/** Soft warning band (continue review; not manual). */
export const DUPLICATE_WARNING_THRESHOLD = 0.9;
/** Critical / needs_manual_review floor. */
export const DUPLICATE_CRITICAL_THRESHOLD = 0.95;

export type DuplicateDecision = 'pass' | 'warning' | 'manual_review';

export interface DuplicateMatch {
  article_id: number;
  slug: string;
  title: string;
  similarity: number;
  /** Legacy field — not used for decisions (headings/titles ignored). */
  title_similarity: number;
  matching_sections: string[];
}

export interface DuplicateDetectorResult {
  /** True only when similarity >= critical threshold (manual review). */
  is_duplicate: boolean;
  /** True when warning band (0.90–critical), not critical. */
  is_warning: boolean;
  decision: DuplicateDecision;
  max_similarity: number;
  similarity_pct: number;
  uniqueness_score: number;
  /** Critical threshold used for is_duplicate. */
  threshold: number;
  warning_threshold: number;
  matches: DuplicateMatch[];
  matched_article: { id: number; title: string; slug: string } | null;
  matching_sections: string[];
}

/** Content-type families that share structural templates (headings/TOC/FAQ). */
const CONTENT_TYPE_FAMILIES: Record<string, string> = {
  country_guide: 'country_guide',
  city_guide: 'city_guide',
  comparison_guide: 'comparison',
  comparison: 'comparison',
  salary_guide: 'salary',
  rent_guide: 'rent',
  moving_guide: 'moving',
  student_guide: 'student',
  retirement_guide: 'retirement',
  healthcare_guide: 'healthcare',
  food_guide: 'food',
  transportation_guide: 'transport',
  transport_guide: 'transport',
  budget_guide: 'budget',
  visa_guide: 'visa',
  tax_guide: 'tax',
  remote_worker_guide: 'remote_worker',
};

export function contentTypeFamily(contentType: string | null | undefined): string {
  const key = String(contentType || '')
    .toLowerCase()
    .trim();
  if (!key) return 'unknown';
  if (CONTENT_TYPE_FAMILIES[key]) return CONTENT_TYPE_FAMILIES[key];
  // Heuristic: *guide suffixes
  const m = key.match(
    /^(country|city|comparison|salary|rent|moving|student|retirement|healthcare|food|transport(?:ation)?|budget|visa|tax|remote_worker)/
  );
  return m ? m[1].replace('transportation', 'transport') : key;
}

export function resolveCriticalThreshold(settingsThreshold?: number): number {
  const t =
    typeof settingsThreshold === 'number' && Number.isFinite(settingsThreshold)
      ? settingsThreshold
      : DUPLICATE_CRITICAL_THRESHOLD;
  // Migrate legacy defaults (e.g. 0.82) up to the new critical policy.
  if (t < DUPLICATE_WARNING_THRESHOLD) return DUPLICATE_CRITICAL_THRESHOLD;
  return Math.min(1, Math.max(DUPLICATE_WARNING_THRESHOLD, t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function stripMarkup(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\(([^)]*)\)/g, ' $1 ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[#*_~>|]+/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ');
}

function normalizeProse(raw: string): string {
  return stripMarkup(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBoilerplateHeading(heading: string): boolean {
  return /^(table of contents|contents|faq|frequently asked|related (articles|guides|reads)|see also|further reading|share this|subscribe|newsletter|disclaimer|sources?|references|key takeaways|quick (summary|answer)|call to action|cta)\b/i.test(
    heading.trim()
  );
}

function isCtaOrBoilerplateText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length < 40) {
    return /^(compare|read more|learn more|click here|get started|try (our|the)|sign up|subscribe|share|download)/i.test(
      t
    );
  }
  return /compare (cities|cost of living) (now|today)|use our (free )?calculator|start (your )?comparison/i.test(
    t
  );
}

function contentToPlain(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          // FAQ: answers only (ignore questions)
          if ('a' in o || 'answer' in o) {
            return String(o.a ?? o.answer ?? '');
          }
          // Table rows: skip header-like keys
          if ('cells' in o && Array.isArray(o.cells)) {
            return o.cells.map((c) => String(c ?? '')).join(' ');
          }
          if ('row' in o && Array.isArray(o.row)) {
            return o.row.map((c) => String(c ?? '')).join(' ');
          }
          // Avoid serializing schema-ish objects wholesale
          const vals = Object.values(o)
            .filter((v) => typeof v === 'string' || typeof v === 'number')
            .map(String);
          return vals.join(' ');
        }
        return '';
      })
      .join(' ');
  }
  if (content && typeof content === 'object') {
    const o = content as Record<string, unknown>;
    if ('a' in o || 'answer' in o) return String(o.a ?? o.answer ?? '');
    if ('text' in o) return String(o.text ?? '');
    if ('paragraphs' in o && Array.isArray(o.paragraphs)) {
      return o.paragraphs.map(String).join(' ');
    }
  }
  return '';
}

export interface BodyParagraph {
  /** Normalized prose used for hashing / tokens. */
  text: string;
  /** Nearest section heading (for explanation only — never in similarity corpus). */
  section: string;
  hash: string;
}

function simpleHash(text: string): string {
  // FNV-1a 32-bit — stable, fast, good enough for paragraph overlap
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Extract unique body prose paragraphs — excludes headings, FAQ Qs, TOC, CTA, metadata.
 */
export function extractBodyParagraphs(draft: WriterDraftPayload): BodyParagraph[] {
  const out: BodyParagraph[] = [];
  let currentSection = 'Intro';
  const seen = new Set<string>();

  for (const block of draft.blocks || []) {
    const heading = String(block.heading || '').trim();

    if (block.type === 'heading') {
      const label = heading || contentToPlain(block.content).trim();
      if (label && !isBoilerplateHeading(label)) currentSection = label;
      continue;
    }

    if (heading && !isBoilerplateHeading(heading)) {
      // Section label on a body block — update context, do not score the heading text
      currentSection = heading;
    }

    if (
      block.type === 'faq' ||
      isBoilerplateHeading(heading) ||
      /table of contents|^contents$/i.test(heading)
    ) {
      // FAQ answers only; skip TOC list items entirely
      if (block.type === 'faq') {
        const answers = extractFaqAnswers(block);
        for (const ans of answers) pushParagraph(ans, currentSection || 'FAQ', out, seen);
      }
      continue;
    }

    if (block.type === 'table') {
      // Body cells only — skip first row if it looks like headers
      const rows = tableBodyRows(block);
      for (const row of rows) pushParagraph(row, currentSection, out, seen);
      continue;
    }

    const plain = contentToPlain(block.content);
    if (!plain.trim()) continue;
    if (isCtaOrBoilerplateText(plain)) continue;

    // Split on blank lines / sentence clusters into paragraph-ish chunks
    const chunks = plain
      .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/g)
      .map((c) => c.trim())
      .filter(Boolean);

    const pieces = chunks.length ? chunks : [plain];
    for (const piece of pieces) {
      pushParagraph(piece, currentSection, out, seen);
    }
  }

  return out;
}

function extractFaqAnswers(block: DraftBlock): string[] {
  const c = block.content;
  if (!Array.isArray(c)) {
    const one = contentToPlain(c);
    return one ? [one] : [];
  }
  return c
    .map((item) => {
      if (typeof item === 'string') return ''; // bare strings in FAQ are usually questions/labels
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return String(o.a ?? o.answer ?? '');
      }
      return '';
    })
    .filter((s) => s.trim().length > 0);
}

function tableBodyRows(block: DraftBlock): string[] {
  const c = block.content;
  if (!Array.isArray(c)) {
    const t = contentToPlain(c);
    return t ? [t] : [];
  }
  const rows = c.map((row) => {
    if (typeof row === 'string') return row;
    if (Array.isArray(row)) return row.map(String).join(' ');
    if (row && typeof row === 'object') {
      const o = row as Record<string, unknown>;
      if (Array.isArray(o.cells)) return o.cells.map(String).join(' ');
      if (Array.isArray(o.row)) return o.row.map(String).join(' ');
      return Object.values(o)
        .filter((v) => typeof v === 'string' || typeof v === 'number')
        .map(String)
        .join(' ');
    }
    return '';
  });
  // Drop header row when short label-like cells dominate
  if (rows.length >= 2) {
    const header = rows[0];
    const words = header.split(/\s+/).filter(Boolean);
    if (words.length <= 8 && words.every((w) => w.length < 24)) {
      return rows.slice(1).filter(Boolean);
    }
  }
  return rows.filter(Boolean);
}

function pushParagraph(
  raw: string,
  section: string,
  out: BodyParagraph[],
  seen: Set<string>
): void {
  const text = normalizeProse(raw);
  if (text.length < 28) return; // skip tiny fragments / labels
  if (isCtaOrBoilerplateText(text)) return;
  const hash = simpleHash(text);
  if (seen.has(hash)) return;
  seen.add(hash);
  out.push({ text, section: section || 'Body', hash });
}

function bodyCorpus(paragraphs: BodyParagraph[]): string {
  return paragraphs.map((p) => p.text).join(' ');
}

function decideFromSimilarity(
  similarity: number,
  criticalThreshold: number
): DuplicateDecision {
  if (similarity >= criticalThreshold) return 'manual_review';
  if (similarity >= DUPLICATE_WARNING_THRESHOLD) return 'warning';
  return 'pass';
}

function matchingSectionsFor(
  self: BodyParagraph[],
  other: BodyParagraph[]
): string[] {
  const otherHashes = new Set(other.map((p) => p.hash));
  const sections = new Set<string>();
  for (const p of self) {
    if (otherHashes.has(p.hash) && p.section) sections.add(p.section);
  }
  // Token-overlap fallback for near-paraphrase sections
  if (sections.size < 2) {
    const otherBySection = new Map<string, Set<string>>();
    for (const p of other) {
      if (!otherBySection.has(p.section)) otherBySection.set(p.section, new Set());
      for (const t of tokenize(p.text)) otherBySection.get(p.section)!.add(t);
    }
    const selfBySection = new Map<string, Set<string>>();
    for (const p of self) {
      if (!selfBySection.has(p.section)) selfBySection.set(p.section, new Set());
      for (const t of tokenize(p.text)) selfBySection.get(p.section)!.add(t);
    }
    for (const [sec, tokens] of selfBySection) {
      const ot = otherBySection.get(sec);
      if (!ot) continue;
      const sim = jaccard(tokens, ot);
      if (sim >= 0.55) sections.add(sec);
    }
  }
  return [...sections].slice(0, 12);
}

function setIntersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

function coverage(a: Set<string>, b: Set<string>): number {
  const inter = setIntersectionSize(a, b);
  const denom = Math.min(a.size, b.size);
  return denom === 0 ? 0 : inter / denom;
}

function similarityBodyOnly(self: BodyParagraph[], other: BodyParagraph[]): number {
  if (!self.length || !other.length) return 0;

  const selfHashes = new Set(self.map((p) => p.hash));
  const otherHashes = new Set(other.map((p) => p.hash));
  const hashJaccard = jaccard(selfHashes, otherHashes);
  // Fraction of paragraphs copied (primary near-dupe signal)
  const hashCoverage = coverage(selfHashes, otherHashes);

  const selfTokens = new Set(tokenize(bodyCorpus(self)));
  const otherTokens = new Set(tokenize(bodyCorpus(other)));
  const tokenJaccard = jaccard(selfTokens, otherTokens);
  const tokenCoverage = coverage(selfTokens, otherTokens);

  // Paragraph hashes dominate; tokens only refine. Never use titles/headings.
  const paraScore = Math.max(hashCoverage, hashJaccard);
  const tokenScore = Math.max(tokenCoverage * 0.85, tokenJaccard);
  return Math.round((paraScore * 0.75 + tokenScore * 0.25) * 1000) / 1000;
}

export function detectDuplicates(input: {
  draft: WriterDraftPayload;
  articleId: number;
  /** Settings duplicate_threshold — clamped to critical policy. */
  threshold?: number;
  contentType?: string | null;
  candidates: Array<{
    id: number;
    slug: string;
    seo_title: string | null;
    excerpt: string | null;
    draft_json: unknown;
    content_type?: string | null;
  }>;
}): DuplicateDetectorResult {
  const critical = resolveCriticalThreshold(input.threshold);
  const selfParas = extractBodyParagraphs(input.draft);
  const selfFamily = contentTypeFamily(input.contentType);

  const matches: DuplicateMatch[] = [];

  for (const c of input.candidates) {
    if (c.id === input.articleId) continue;

    let otherDraft: WriterDraftPayload | null = null;
    if (c.draft_json && typeof c.draft_json === 'object') {
      otherDraft = c.draft_json as WriterDraftPayload;
    }
    if (!otherDraft?.blocks?.length) continue;

    // Same-cluster / same family: still body-only (global rule); explicit no-op for headings.
    void (contentTypeFamily(c.content_type) === selfFamily);

    const otherParas = extractBodyParagraphs(otherDraft);
    if (!otherParas.length) continue;

    const similarity = similarityBodyOnly(selfParas, otherParas);
    if (similarity < 0.35) continue;

    const title = c.seo_title || c.slug;
    matches.push({
      article_id: c.id,
      slug: c.slug,
      title,
      similarity,
      title_similarity: 0,
      matching_sections: matchingSectionsFor(selfParas, otherParas),
    });
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  const top = matches.slice(0, 8);
  const max_similarity = top[0]?.similarity ?? 0;
  const decision = decideFromSimilarity(max_similarity, critical);
  const is_duplicate = decision === 'manual_review';
  const is_warning = decision === 'warning';
  const uniqueness_score = clampScore((1 - max_similarity) * 100);
  const best = top[0] || null;

  return {
    is_duplicate,
    is_warning,
    decision,
    max_similarity,
    similarity_pct: Math.round(max_similarity * 1000) / 10,
    uniqueness_score,
    threshold: critical,
    warning_threshold: DUPLICATE_WARNING_THRESHOLD,
    matches: top,
    matched_article: best
      ? { id: best.article_id, title: best.title, slug: best.slug }
      : null,
    matching_sections: best?.matching_sections || [],
  };
}
