import type { ResearchPack } from './research-engine.js';

export type DraftBlockType =
  | 'intro'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'comparison'
  | 'table'
  | 'tip'
  | 'warning'
  | 'faq'
  | 'summary';

export interface DraftBlock {
  id: string;
  type: DraftBlockType;
  heading?: string;
  content: unknown;
  data_keys?: string[];
}

export interface WriterDraftPayload {
  seo_title: string;
  meta_title: string;
  meta_description: string;
  excerpt: string;
  blocks: DraftBlock[];
}

const BLOCK_TYPES = new Set<DraftBlockType>([
  'intro',
  'heading',
  'paragraph',
  'list',
  'comparison',
  'table',
  'tip',
  'warning',
  'faq',
  'summary',
]);

function extractJSON(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object in AI response');
  }
  return s.slice(start, end + 1);
}

export function parseWriterJson(raw: string): WriterDraftPayload {
  const parsed = JSON.parse(extractJSON(raw)) as WriterDraftPayload;
  return parsed;
}

/** Best-effort parse for truncated JSON — used only for continuation merge seeds. */
export function tryParseWriterJsonLoose(raw: string): WriterDraftPayload | null {
  try {
    return parseWriterJson(raw);
  } catch {
    /* continue */
  }
  try {
    let s = raw.replace(/^\uFEFF/, '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const start = s.indexOf('{');
    if (start === -1) return null;
    // Truncate to last complete-looking block array item
    let candidate = s.slice(start);
    if (!candidate.includes('"blocks"')) return null;
    // Close open structures crudely
    if (!/"blocks"\s*:\s*\[/.test(candidate)) return null;
    const blocksStart = candidate.indexOf('"blocks"');
    const arrStart = candidate.indexOf('[', blocksStart);
    if (arrStart === -1) return null;
    let depth = 0;
    let lastGood = -1;
    for (let i = arrStart; i < candidate.length; i++) {
      const ch = candidate[i];
      if (ch === '[') depth++;
      if (ch === ']') {
        depth--;
        if (depth === 0) {
          lastGood = i;
          break;
        }
      }
      if (ch === '}' && depth === 1) lastGood = i;
    }
    if (lastGood === -1) return null;
    let repaired = candidate.slice(0, lastGood + 1);
    if (!repaired.trimEnd().endsWith(']')) repaired += ']';
    if (!repaired.includes('}')) repaired += '}';
    else if (!repaired.trimEnd().endsWith('}')) repaired += '}';
    // Ensure object closed
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    repaired += '}'.repeat(Math.max(0, openBraces - closeBraces));
    const parsed = JSON.parse(repaired) as WriterDraftPayload;
    if (!parsed || !Array.isArray(parsed.blocks)) return null;
    return {
      seo_title: parsed.seo_title || 'Draft',
      meta_title: parsed.meta_title || parsed.seo_title || 'Draft',
      meta_description: parsed.meta_description || 'Cost of living guide.',
      excerpt: parsed.excerpt || 'Cost of living guide.',
      blocks: parsed.blocks,
    };
  } catch {
    return null;
  }
}

function blockText(block: DraftBlock): string {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          if (typeof o.q === 'string' && typeof o.a === 'string') return `${o.q} ${o.a}`;
          if (typeof o.question === 'string' && typeof o.answer === 'string') {
            return `${o.question} ${o.answer}`;
          }
          return Object.values(o)
            .filter((v): v is string => typeof v === 'string')
            .join(' ');
        }
        return '';
      })
      .join(' ');
  }
  if (block.content && typeof block.content === 'object') {
    const o = block.content as Record<string, unknown>;
    const preferred = ['text', 'body', 'html', 'markdown', 'content']
      .map((k) => o[k])
      .filter((v): v is string => typeof v === 'string');
    if (preferred.length) return preferred.join(' ');
    return Object.values(o)
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
  }
  return '';
}

export function countDraftWords(draft: WriterDraftPayload): number {
  const parts = [
    draft.seo_title,
    draft.meta_title,
    draft.meta_description,
    draft.excerpt,
    ...(draft.blocks || []).flatMap((b) => [b.heading || '', blockText(b)]),
  ];
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** Trim longest body paragraphs until word count fits hard max (keeps structure). */
export function trimDraftToMaxWords(
  draft: WriterDraftPayload,
  maxWords: number
): WriterDraftPayload {
  if (maxWords <= 0 || countDraftWords(draft) <= maxWords) return draft;
  const next: WriterDraftPayload = {
    ...draft,
    blocks: (draft.blocks || []).map((b) => ({ ...b })),
  };
  let guard = 0;
  while (countDraftWords(next) > maxWords && guard < 80) {
    guard += 1;
    let longest: DraftBlock | null = null;
    let longestLen = 0;
    for (const b of next.blocks) {
      if (typeof b.content !== 'string') continue;
      if (!['paragraph', 'intro', 'summary', 'tip'].includes(b.type)) continue;
      const len = b.content.split(/\s+/).filter(Boolean).length;
      if (len > longestLen) {
        longestLen = len;
        longest = b;
      }
    }
    if (!longest || typeof longest.content !== 'string' || longestLen < 80) break;
    const cut = Math.max(60, longestLen - Math.max(40, Math.ceil((countDraftWords(next) - maxWords) / 2)));
    longest.content = longest.content.split(/\s+/).slice(0, cut).join(' ');
  }
  return next;
}

export function readingTimeMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 230));
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120);
}

function normalizeHeading(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function draftCorpus(draft: WriterDraftPayload): string {
  return (draft.blocks || [])
    .map((b) => `${b.heading || ''} ${blockText(b)}`)
    .join(' ')
    .toLowerCase();
}

/**
 * CityCost public path mentions counted by draft validation / publish gate.
 * Link Engine MUST emit paths that match this pattern (markdown hrefs or bare paths).
 * Do not weaken — keep in sync with Writer Internal Link Engine.
 */
export const CITYCOST_PATH_MENTION_RE =
  /\/(?:cost-of-living|compare|cities|countries|blog|city|country|methodology|data-sources|about)(?:\/[a-z0-9\-._/?#%]*)?/gi;

/** Minimum in-body CityCost path mentions required to save a draft. */
export const MIN_CITYCOST_PATH_MENTIONS = 3;

/** Count path mentions in a corpus string (case-insensitive via regex flag). */
export function countCityCostPathMentionsInText(text: string): number {
  CITYCOST_PATH_MENTION_RE.lastIndex = 0;
  return (text.match(CITYCOST_PATH_MENTION_RE) || []).length;
}

/** Count CityCost path mentions across the full draft corpus (same as validateWriterDraft). */
export function countCityCostPathMentions(draft: WriterDraftPayload): number {
  return countCityCostPathMentionsInText(draftCorpus(draft));
}

function headingCovered(required: string, headings: string[], corpus: string): boolean {
  const norm = normalizeHeading(required);
  if (!norm) return true;
  if (headings.some((h) => h.includes(norm) || norm.includes(h))) return true;
  // Allow soft coverage via body text for short labels
  const tokens = norm.split(' ').filter((t) => t.length > 3);
  if (tokens.length >= 2 && tokens.every((t) => corpus.includes(t))) return true;
  return false;
}

export function findMissingH2(draft: WriterDraftPayload, requiredH2: string[]): string[] {
  const headings = (draft.blocks || [])
    .map((b) => normalizeHeading(b.heading || (typeof b.content === 'string' ? b.content : '')))
    .filter(Boolean);
  const corpus = draftCorpus(draft);
  return (requiredH2 || []).filter((h) => !headingCovered(h, headings, corpus));
}

/** Map common model aliases onto schema block types. */
function normalizeBlockType(rawType: unknown, content: unknown, heading?: string): DraftBlockType | null {
  const t = String(rawType || '')
    .toLowerCase()
    .trim();
  if (BLOCK_TYPES.has(t as DraftBlockType)) return t as DraftBlockType;
  if (t === 'h1' || t === 'h2' || t === 'h3' || t === 'title' || t === 'header') return 'heading';
  if (t === 'section' || t === 'body' || t === 'text' || t === 'p' || t === 'content') {
    return heading && !content ? 'heading' : 'paragraph';
  }
  if (t === 'bullet' || t === 'bullets' || t === 'ul' || t === 'ol') return 'list';
  if (t === 'qa' || t === 'faqs') return 'faq';
  if (t === 'conclusion' || t === 'outro') return 'summary';
  if (t === 'note' || t === 'callout') return 'tip';
  // Infer from shape when type is missing/unknown
  if (!t) {
    if (heading && (content == null || String(content).trim() === heading.trim())) return 'heading';
    if (Array.isArray(content)) return 'list';
    if (content && typeof content === 'object' && ('q' in (content as object) || 'question' in (content as object))) {
      return 'faq';
    }
    if (typeof content === 'string' && content.trim()) return 'paragraph';
  }
  return null;
}

/** Keep only schema-valid blocks with usable content. */
export function sanitizeBlocks(blocks: DraftBlock[]): DraftBlock[] {
  const out: DraftBlock[] = [];
  /** Headings already emitted via type:heading — strip duplicates from body blocks. */
  const emittedHeadings = new Set<string>();
  const usedIds = new Set<string>();
  let seq = 0;
  const takeId = (preferred: string | undefined, prefix: string): string => {
    let id = typeof preferred === 'string' ? preferred.trim() : '';
    if (!id || usedIds.has(id)) {
      do {
        seq += 1;
        id = `${prefix}-${seq}`;
      } while (usedIds.has(id));
    }
    usedIds.add(id);
    return id;
  };

  for (const raw of blocks || []) {
    if (!raw || typeof raw !== 'object') continue;
    const headingHint = typeof raw.heading === 'string' ? raw.heading.trim() : '';
    const type = normalizeBlockType(raw.type, raw.content, headingHint);
    if (!type) continue;
    const heading = typeof raw.heading === 'string' ? raw.heading.trim() : '';
    const text = blockText(raw).trim();
    const isProtectedType =
      type === 'intro' ||
      type === 'faq' ||
      type === 'summary' ||
      (type === 'list' && /table of contents|^contents$/i.test(heading));

    if (type === 'heading') {
      if (!heading && !text) continue;
      const h = heading || text.slice(0, 80);
      const norm = normalizeHeading(h);
      if (norm && emittedHeadings.has(norm)) continue;
      if (norm) emittedHeadings.add(norm);
      out.push({
        id: takeId(typeof raw.id === 'string' ? raw.id : undefined, 'h'),
        type,
        heading: h,
        content: text || heading,
        data_keys: Array.isArray(raw.data_keys) ? raw.data_keys.map(String) : undefined,
      });
      continue;
    }
    if (!text && !isProtectedType) continue;
    // Drop tiny filler paragraphs — never drop protected intro/faq/summary/toc
    if (
      !isProtectedType &&
      type === 'paragraph' &&
      text.split(/\s+/).length < 12
    ) {
      continue;
    }
    let blockHeading = heading || undefined;
    const normHeading = blockHeading ? normalizeHeading(blockHeading) : '';
    // Never keep the same heading on body blocks after a heading block rendered it
    if (normHeading && emittedHeadings.has(normHeading) && !isProtectedType) {
      blockHeading = undefined;
    } else if (normHeading) {
      // First time we see this label on a content block — keep once for TOC-less drafts
      emittedHeadings.add(normHeading);
    }
    const preferredId =
      type === 'intro'
        ? 'intro'
        : type === 'faq'
          ? 'faq'
          : type === 'summary'
            ? 'summary'
            : isProtectedType
              ? 'toc'
              : typeof raw.id === 'string'
                ? raw.id
                : undefined;
    out.push({
      id: takeId(preferredId, type === 'list' ? 'list' : 'b'),
      type,
      heading: blockHeading,
      content: raw.content,
      data_keys: Array.isArray(raw.data_keys) ? raw.data_keys.map(String) : undefined,
    });
  }
  return out;
}

/** Split FAQ/summary/intro/toc from body so rewrites can preserve guide structure. */
export function splitStructuralBlocks(blocks: DraftBlock[]): {
  body: DraftBlock[];
  faq: DraftBlock | undefined;
  summary: DraftBlock | undefined;
  intro?: DraftBlock;
  toc?: DraftBlock;
} {
  let faq: DraftBlock | undefined;
  let summary: DraftBlock | undefined;
  let intro: DraftBlock | undefined;
  let toc: DraftBlock | undefined;
  const body: DraftBlock[] = [];
  for (const b of blocks || []) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'intro') {
      if (!intro) intro = b;
      continue;
    }
    if (b.type === 'faq') {
      if (!faq) faq = b;
      continue;
    }
    if (b.type === 'summary') {
      if (!summary) summary = b;
      continue;
    }
    const heading = (b.heading || '').toLowerCase();
    if (
      b.id === 'toc' ||
      (b.type === 'list' && /table of contents|^contents$/.test(heading.trim()))
    ) {
      if (!toc) toc = b;
      continue;
    }
    body.push(b);
  }
  return { body, faq, summary, intro, toc };
}

/**
 * After a full-block rewrite, reinject protected structural blocks.
 * Order: intro → toc → body → faq → summary.
 */
export function reattachStructuralBlocks(
  rewrittenBlocks: DraftBlock[],
  preservedBlocks: DraftBlock[]
): DraftBlock[] {
  const rewritten = splitStructuralBlocks(rewrittenBlocks);
  const preserved = splitStructuralBlocks(preservedBlocks);
  const intro = rewritten.intro || preserved.intro;
  const toc = rewritten.toc || preserved.toc;
  const faq = rewritten.faq || preserved.faq;
  const summary = rewritten.summary || preserved.summary;
  return sanitizeBlocks([
    ...(intro ? [{ ...intro, id: 'intro', type: 'intro' as const }] : []),
    ...(toc ? [{ ...toc, id: 'toc' }] : []),
    ...rewritten.body,
    ...(faq ? [{ ...faq, id: 'faq', type: 'faq' as const }] : []),
    ...(summary ? [{ ...summary, id: 'summary', type: 'summary' as const }] : []),
  ]);
}

export function mergeDraftBlocks(
  base: WriterDraftPayload,
  extraBlocks: DraftBlock[]
): WriterDraftPayload {
  const blocks = sanitizeBlocks([...(base.blocks || [])]);
  const ids = new Set(blocks.map((b) => b.id));
  for (const b of sanitizeBlocks(extraBlocks)) {
    let id = b.id || `extra-${Math.random().toString(36).slice(2, 8)}`;
    while (ids.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 5)}`;
    ids.add(id);
    blocks.push({ ...b, id });
  }
  return { ...base, blocks };
}

export interface DraftValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  word_count: number;
  missing_h2: string[];
  missing_elements: string[];
}

export function validateWriterDraft(
  draft: WriterDraftPayload,
  limits: { min: number; max: number },
  research?: ResearchPack | null
): DraftValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing_elements: string[] = [];

  if (!draft || typeof draft !== 'object') {
    return {
      ok: false,
      errors: ['Draft is not an object'],
      warnings: [],
      word_count: 0,
      missing_h2: [],
      missing_elements: ['draft'],
    };
  }
  for (const key of ['seo_title', 'meta_title', 'meta_description', 'excerpt'] as const) {
    if (!draft[key] || typeof draft[key] !== 'string' || !draft[key].trim()) {
      errors.push(`Missing ${key}`);
      missing_elements.push(key);
    }
  }
  // Sanitize before structural checks so junk model blocks don't drown errors
  draft = { ...draft, blocks: sanitizeBlocks(draft.blocks || []) };

  if (!Array.isArray(draft.blocks) || draft.blocks.length < 10) {
    errors.push('blocks must be an array with at least 10 blocks');
    missing_elements.push('blocks_min_10');
  }

  const ids = new Set<string>();
  const headings = new Set<string>();
  let hasIntro = false;
  let hasFaq = false;
  let hasSummary = false;
  let hasTocHint = false;
  let hasTable = false;
  let hasComparison = false;
  let faqCount = 0;
  const corpus = draftCorpus(draft);
  let emptyBlockErrors = 0;

  for (const block of draft.blocks || []) {
    if (!block?.id || typeof block.id !== 'string') errors.push('Block missing id');
    else if (ids.has(block.id)) errors.push(`Duplicate block id: ${block.id}`);
    else ids.add(block.id);

    if (!BLOCK_TYPES.has(block.type)) {
      if (errors.filter((e) => e.startsWith('Invalid block type')).length < 5) {
        errors.push(`Invalid block type: ${block.type}`);
      }
      continue;
    }

    const text = blockText(block).trim();
    const heading = (block.heading || '').trim();
    if (!text && block.type !== 'heading') {
      emptyBlockErrors += 1;
      if (emptyBlockErrors <= 3) errors.push(`Empty block content: ${block.id || '?'}`);
    }
    if (block.type === 'heading' && !heading && !text) {
      errors.push(`Empty heading block: ${block.id || '?'}`);
    }
    if (heading) {
      const norm = heading.toLowerCase();
      if (headings.has(norm)) warnings.push(`Duplicate heading: ${heading}`);
      headings.add(norm);
      if (/table of contents|^contents$/i.test(heading)) hasTocHint = true;
      if (/conclusion/i.test(heading)) {
        /* conclusion may be summary block */
      }
    }
    if (block.type === 'intro') hasIntro = true;
    if (block.type === 'faq') {
      hasFaq = true;
      if (Array.isArray(block.content)) faqCount = Math.max(faqCount, block.content.length);
    }
    if (block.type === 'summary') hasSummary = true;
    if (block.type === 'table') hasTable = true;
    if (block.type === 'comparison') hasComparison = true;
    if (block.type === 'list' && /table of contents|contents/i.test(heading + text)) {
      hasTocHint = true;
    }
  }

  if (emptyBlockErrors > 3) {
    errors.push(`Empty block content: ${emptyBlockErrors - 3} more`);
  }

  if (!hasIntro) {
    errors.push('Missing intro block');
    missing_elements.push('intro');
  }
  if (!hasFaq) {
    errors.push('Missing faq block');
    missing_elements.push('faq');
  } else if (faqCount > 0 && faqCount < 6) {
    errors.push(`FAQ has ${faqCount} items; need at least 6`);
    missing_elements.push('faq_min_6');
  }
  if (!hasSummary) {
    errors.push('Missing summary/takeaways block');
    missing_elements.push('summary');
  }
  if (!hasTocHint) {
    errors.push('Missing table of contents (heading or list)');
    missing_elements.push('toc');
  }

  const hasConclusion =
    hasSummary ||
    [...headings].some((h) => /conclusion|key takeaway|final thought/i.test(h)) ||
    /conclusion|key takeaway/i.test(corpus);
  if (!hasConclusion) {
    errors.push('Missing conclusion');
    missing_elements.push('conclusion');
  }

  const missing_h2 = research?.required_h2?.length
    ? findMissingH2(draft, research.required_h2)
    : [];
  // Soft gate: allow up to 2 missing H2 as warnings; more is hard fail
  if (missing_h2.length > 2) {
    errors.push(`Missing H2 sections (${missing_h2.length}): ${missing_h2.slice(0, 6).join('; ')}`);
    missing_elements.push('outline_h2');
  } else if (missing_h2.length) {
    warnings.push(`Soft-missing H2: ${missing_h2.join('; ')}`);
  }

  if (research?.required_tables?.length && !hasTable) {
    // Require table when research asks for one
    errors.push('Missing table block required by research pack');
    missing_elements.push('table');
  }
  if (research?.required_comparison_blocks?.length && !hasComparison) {
    const needs =
      research.required_comparison_blocks.filter((x) => !/optional/i.test(x)).length > 0;
    if (needs) {
      errors.push('Missing comparison block required by research pack');
      missing_elements.push('comparison');
    }
  }

  // Internal links: real CityCost public paths (and legacy aliases)
  const linkHits = countCityCostPathMentionsInText(corpus);
  if (linkHits < MIN_CITYCOST_PATH_MENTIONS) {
    errors.push(
      `Missing internal links (found ${linkHits}, need ≥ ${MIN_CITYCOST_PATH_MENTIONS} CityCost path mentions)`
    );
    missing_elements.push('internal_links');
  } else if (linkHits < 6) {
    warnings.push(`Internal links soft target: found ${linkHits}, prefer ≥ 6`);
  }

  const word_count = countDraftWords(draft);
  if (word_count < limits.min) {
    errors.push(`Word count ${word_count} below minimum ${limits.min}`);
    missing_elements.push('word_count');
  }
  if (word_count > limits.max) {
    errors.push(`Word count ${word_count} above maximum ${limits.max}`);
    missing_elements.push('word_count_max');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    word_count,
    missing_h2,
    missing_elements: [...new Set(missing_elements)],
  };
}
