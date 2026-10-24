/**
 * Category-scoped deterministic repairs + AI section merge.
 * Heading uniquify uses the single headingFingerprint algorithm from normalize-draft.
 */

import { applyAiPhraseBlacklist } from '../writer/v2/ai-phrase-blacklist.js';
import { repairPublicIntegrity } from '../writer/v2/public-integrity-gate.js';
import { filterRelevantHrefs, type LinkGeoScope } from '../writer/v2/link-relevance.js';
import { toPublicTitle } from '../utils/clean-title.js';
import { repairCorruptSentenceBreaks, safeSplitLongSentence } from '../writer/v2/prose-integrity.js';
import type { IssueCategory } from '../validation/issue-plan.js';
import { uniquifyHeadingsByFingerprint } from '../validation/normalize-draft.js';
import {
  countCityCostPathMentions,
  countDraftWords,
  type DraftBlock,
  type WriterDraftPayload,
} from '../writer/draft-validate.js';
import {
  repairRepeatedAdvice,
  repairRepeatedOpenings,
} from '../writer/repetition.js';
import type { RevisionAiPatch } from './revision-types.js';

function approxWords(content: unknown): number {
  if (typeof content === 'string') {
    return content.split(/\s+/).filter(Boolean).length;
  }
  if (Array.isArray(content)) {
    return content.reduce((n, item) => n + approxWords(item), 0);
  }
  if (content && typeof content === 'object') {
    let n = 0;
    for (const v of Object.values(content as Record<string, unknown>)) {
      if (typeof v === 'string' || Array.isArray(v)) n += approxWords(v);
    }
    return n;
  }
  return 0;
}

/** Generic, non-invented housing/budget elaborations (no fake prices). */
const EXPAND_SENTENCES = [
  ' Budget for deposits, agency fees, and the first month of utilities when comparing listings.',
  ' Neighborhood choice often matters as much as unit size for monthly housing costs.',
  ' Confirm what is included in rent before signing — some buildings bill utilities separately.',
  ' Longer leases can reduce monthly rates, while furnished units usually cost more upfront.',
  ' Compare a few districts rather than a single listing before deciding where to rent.',
  ' Factor commuting time and local amenities into the true monthly cost of a neighborhood.',
  ' Ask whether internet, hot water, and building fees are separate from base rent.',
  ' Keep a shortlist of must-haves so you can compare apartments on equal terms.',
];

/** Light normalize — never drop content during revision (unlike writer sanitize). */
function normalizeDraftBlocks(blocks: DraftBlock[]): DraftBlock[] {
  return (blocks || [])
    .filter((b) => b && typeof b === 'object')
    .map((b, i) => ({
      ...b,
      id: typeof b.id === 'string' && b.id ? b.id : `rev-${i}`,
      type: b.type,
      heading: typeof b.heading === 'string' ? b.heading : undefined,
      content: b.content,
    }));
}

const AI_FILLER =
  /\b(Additionally|Furthermore|In conclusion|Overall|Moreover|In today's world|It is important to note that)\b[,]?\s*/gi;

/** Research/synth meta that must never appear in published prose. */
const PROMPT_BLEED =
  /\s*(?:keep the CityCost angle in view:\s*[^.?!]*[.?!]|Write for\s+[^,]*,\s*with intent\s*\([^)]*\)[.?!]?|with intent\s*\([^)]*\)[.?!]?|Supporting\s+\w+\s+spoke[^.?!]*[.?!]|Certification batch[^.?!]*[.?!]|Use the keyword naturally once:[^.?!]*[.?!]|Related phrases can include[^.?!]*[.?!]|Focus this section on one verified signal:[^.?!]*[.?!]|Frame the answer as a monthly cash need[^.?!]*[.?!]|Keep language plain[^.?!]*[.?!]|Prefer short sentences and active voice[^.?!]*[.?!]|faq:\s*[^.]{0,120}?should connect to take-home pay[^.?!]*[.?!]|matters when you evaluate[^.?!]*[.?!]|Keep the persona[^.?!]*[.?!])/gi;

export function collectHeadings(draft: WriterDraftPayload): string[] {
  return (draft.blocks || [])
    .filter((b) => b.type === 'heading')
    .map((b) => String(b.heading || b.content || '').trim())
    .filter(Boolean);
}

/**
 * Thin wrapper — delegates to uniquifyHeadingsByFingerprint (single algorithm).
 * Prefer calling that after AI revision rather than during early normalize.
 */
export function uniquifyHeadings(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  fixes: string[];
} {
  const result = uniquifyHeadingsByFingerprint(draft.blocks || []);
  return { draft: { ...draft, blocks: result.blocks }, fixes: result.fixes };
}

/**
 * Target ~15–20 words/sentence for readability repair. Splits only at real
 * clause boundaries (see safeSplitLongSentence); the old midpoint split produced
 * corrupt prose like "requires. looking" and split numbers such as "$1,520".
 */
function splitLongSentence(sentence: string, maxWords = 20): string[] {
  return safeSplitLongSentence(sentence, maxWords);
}

function splitDenseParagraph(text: string): string {
  // If a single blob has no paragraph breaks and many sentences, insert blank lines
  if (text.includes('\n\n')) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  if (sentences.length < 5) return text;
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    chunks.push(sentences.slice(i, i + 3).join(' '));
  }
  return chunks.join('\n\n');
}

function simplifyWords(text: string): string {
  return text
    .replace(/\butilize\b/gi, 'use')
    .replace(/\bapproximately\b/gi, 'about')
    .replace(/\bin order to\b/gi, 'to')
    .replace(/\bdue to the fact that\b/gi, 'because')
    .replace(/\ba large number of\b/gi, 'many')
    .replace(/\bprior to\b/gi, 'before');
}

function repairText(text: string, mode: 'readability' | 'style'): { text: string; changed: boolean } {
  const original = text;
  let t = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  let changed = false;

  if (mode === 'style') {
    let fillerHits = 0;
    t = t.replace(AI_FILLER, (m) => {
      fillerHits += 1;
      return fillerHits <= 4 ? '' : m;
    });
    const beforeBleed = t;
    t = t.replace(PROMPT_BLEED, ' ').replace(/Country signals for/gi, 'Indexed averages for');
    t = t.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.!?])/g, '$1').trim();
    if (t !== beforeBleed || t !== original.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()) {
      changed = true;
    }
  }

  if (mode === 'readability') {
    const simplified = simplifyWords(t);
    if (simplified !== t) {
      t = simplified;
      changed = true;
    }
    // Paragraph by paragraph so blank lines, markdown lists, tables and headings survive.
    // Long sentences are split only at safe clause boundaries.
    t = t
      .split(/\n{2,}/)
      .map((para) => {
        if (/^\s*(?:[-*+|#>]|\d+[.)])\s/m.test(para)) return para;
        const rebuilt: string[] = [];
        for (const s of para.split(/(?<=[.!?])\s+/)) {
          // Drop filler openers ("Furthermore it is important to note that…") — a safe
          // readability gain when a sentence has no clause boundary to split at.
          const deFillered = applyAiPhraseBlacklist(s).text;
          if (deFillered !== s.trim()) changed = true;
          const trimmed = deFillered.trim();
          if (!trimmed) continue;
          const parts = splitLongSentence(trimmed, 18);
          if (parts.length > 1) changed = true;
          for (let part of parts) {
            part = part.trim();
            if (!/[.!?:)\]]$/.test(part)) part += '.';
            rebuilt.push(part);
          }
        }
        return repairCorruptSentenceBreaks(rebuilt.join(' ')).text;
      })
      .join('\n\n');
    const split = splitDenseParagraph(t);
    if (split !== t) {
      t = split;
      changed = true;
    }
  }

  if (t !== original) changed = true;
  return { text: t, changed };
}

function repairBlockContent(
  content: unknown,
  mode: 'readability' | 'style'
): { content: unknown; changed: boolean } {
  if (typeof content === 'string') {
    const r = repairText(content, mode);
    return { content: r.text, changed: r.changed };
  }
  if (Array.isArray(content)) {
    let changed = false;
    const next = content.map((item) => {
      if (typeof item === 'string') {
        const r = repairText(item, mode);
        if (r.changed) changed = true;
        return r.text;
      }
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const out = { ...obj };
        for (const key of ['q', 'a', 'question', 'answer', 'text', 'content']) {
          if (typeof obj[key] === 'string') {
            const r = repairText(String(obj[key]), mode);
            if (r.changed) {
              out[key] = r.text;
              changed = true;
            }
          }
        }
        return out;
      }
      return item;
    });
    return { content: next, changed };
  }
  return { content, changed: false };
}

function ensureToc(blocks: DraftBlock[]): { blocks: DraftBlock[]; fix?: string } {
  const hasToc = blocks.some(
    (b) =>
      (b.type === 'heading' && /table of contents|^contents$/i.test(b.heading || '')) ||
      (b.type === 'list' &&
        /table of contents|contents/i.test(String(b.heading || '') + String(b.content || '')))
  );
  if (hasToc || blocks.length <= 3) return { blocks };
  const h2s = blocks
    .filter((b) => b.type === 'heading')
    .map((b) => String(b.heading || '').trim())
    .filter((h) => h && !/table of contents|^contents$/i.test(h))
    .slice(0, 12);
  if (h2s.length < 3) return { blocks };
  const tocBlock: DraftBlock = {
    id: `toc-auto-${Date.now()}`,
    type: 'list',
    heading: 'Table of Contents',
    content: h2s,
  };
  const next = [...blocks];
  const introIdx = next.findIndex((b) => b.type === 'intro');
  const at = introIdx >= 0 ? introIdx + 1 : 0;
  next.splice(at, 0, tocBlock);
  return { blocks: next, fix: 'Inserted Table of Contents list' };
}

/**
 * Insert body internal links from SEO package / research candidates.
 * When `allowedIds` is null, any body paragraph is eligible.
 * Supports string content and `{ text|body|html|markdown|content }` objects.
 * Keeps inserting until at least 3 markdown/HTML links exist (publish content_validation).
 */
export function injectBodyLinks(
  blocks: DraftBlock[],
  allowedIds: Set<string> | null,
  candidates: string[]
): { blocks: DraftBlock[]; fixes: string[] } {
  const fixes: string[] = [];
  const minLinks = 3;
  if (!candidates.length) return { blocks, fixes };

  const countLinksIn = (content: unknown): number => {
    // Must match validateWriterDraft content_validation path allowlist.
    return countCityCostPathMentions({
      seo_title: '',
      meta_title: '',
      meta_description: '',
      excerpt: '',
      blocks: [{ id: 'tmp', type: 'paragraph', content: content as DraftBlock['content'] }],
    });
  };

  const appendLink = (content: unknown, href: string): unknown => {
    const label =
      href.split('/').filter(Boolean).slice(-1)[0]?.replace(/-/g, ' ') || 'related guide';
    const sentence = ` See our [${label}](${href}) for more context.`;
    if (typeof content === 'string') return `${content.trim()}${sentence}`;
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      const obj = { ...(content as Record<string, unknown>) };
      const textKey = ['text', 'body', 'html', 'markdown', 'content'].find(
        (k) => typeof obj[k] === 'string'
      );
      if (!textKey) {
        obj.text = sentence.trim();
        return obj;
      }
      obj[textKey] = `${String(obj[textKey]).trim()}${sentence}`;
      return obj;
    }
    return content;
  };

  const next = [...blocks];
  let total = next.reduce((n, b) => n + countLinksIn(b.content), 0);
  let inserted = 0;
  let guard = 0;

  while (total < minLinks && inserted < minLinks + 2 && guard < 24) {
    guard += 1;
    const href = (candidates[inserted % candidates.length] || '').trim();
    if (!href || !href.startsWith('/') || href === '/' || href.length < 3) {
      inserted += 1;
      continue;
    }

    let idx = next.findIndex((b) => {
      if (allowedIds && !allowedIds.has(b.id)) return false;
      if (b.type === 'heading') return false;
      if (countLinksIn(b.content) > 0) return false;
      if (typeof b.content === 'string') return true;
      if (b.content && typeof b.content === 'object' && !Array.isArray(b.content)) {
        const obj = b.content as Record<string, unknown>;
        return ['text', 'body', 'html', 'markdown', 'content'].some((k) => typeof obj[k] === 'string');
      }
      return false;
    });
    if (idx < 0) {
      idx = next.findIndex((b) => {
        if (allowedIds && !allowedIds.has(b.id)) return false;
        if (b.type === 'heading') return false;
        if (typeof b.content === 'string') return true;
        if (b.content && typeof b.content === 'object' && !Array.isArray(b.content)) return true;
        return false;
      });
    }
    if (idx < 0) break;

    const block = next[idx]!;
    next[idx] = { ...block, content: appendLink(block.content, href) as DraftBlock['content'] };
    inserted += 1;
    total = next.reduce((n, b) => n + countLinksIn(b.content), 0);
  }

  if (inserted) fixes.push(`Inserted ${inserted} body internal link(s)`);
  return { blocks: next, fixes };
}

/** Expand/trim meta fields to publish-gate SERP bands (title 30–60, description 150–160). */
export function repairMetaLengths(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  fixes: string[];
} {
  const fixes: string[] = [];
  let meta_title = (draft.meta_title || draft.seo_title || '').trim();
  let meta_description = (draft.meta_description || '').trim();
  let seo_title = (draft.seo_title || meta_title || '').trim();
  const year = new Date().getFullYear();

  if (meta_title.length > 0 && meta_title.length < 30) {
    const seed = seo_title.length >= meta_title.length ? seo_title : meta_title;
    let next = seed;
    const suffixes = [
      ` Cost of Living ${year}`,
      ' Budget Guide',
      ' — CityCost',
      ' Checklist',
    ];
    for (const s of suffixes) {
      if (next.length >= 30) break;
      next = `${next}${s}`.trim();
    }
    if (next.length > 60) next = next.slice(0, 57).replace(/\s+\S*$/, '').trim() + '…';
    if (next.length < 30) next = `${next} Cost Guide ${year}`.slice(0, 60);
    meta_title = next;
    if (!seo_title || seo_title.length < 30) seo_title = meta_title;
    fixes.push(`Expanded meta title to ${meta_title.length} chars`);
  } else if (meta_title.length > 60) {
    meta_title = meta_title.slice(0, 57).replace(/\s+\S*$/, '').trim() + '…';
    fixes.push('Trimmed meta title to ~60 chars');
  }

  if (meta_description.length > 0 && meta_description.length < 150) {
    const pads = [
      ' Compare rent, groceries, transport, and lifestyle costs with CityCost.',
      ' Use real category breakdowns to plan a realistic monthly budget.',
      ' See which city fits your savings goals before you move.',
    ];
    let next = meta_description;
    for (const p of pads) {
      if (next.length >= 150) break;
      next = `${next.replace(/\s+$/, '')}${next.endsWith('.') ? '' : '.'}${p}`.trim();
    }
    while (next.length < 150) {
      next = `${next} Plan housing and daily costs with clear side-by-side numbers.`.trim();
    }
    if (next.length > 160) next = next.slice(0, 157).replace(/\s+\S*$/, '').trim() + '…';
    meta_description = next;
    fixes.push(`Expanded meta description to ${meta_description.length} chars`);
  } else if (meta_description.length > 160) {
    meta_description = meta_description.slice(0, 157).replace(/\s+\S*$/, '').trim() + '…';
    fixes.push('Trimmed meta description to ~160 chars');
  }

  return {
    draft: { ...draft, seo_title, meta_title, meta_description },
    fixes,
  };
}

/**
 * Category-scoped deterministic repairs aligned with reviewer rule codes.
 * When `onlyBlockIds` is set, readability/style text repairs touch only those blocks.
 */
/**
 * Expand thin body sections until draft reaches hard minimum word count.
 * Uses generic housing/budget language — never invents prices or stats.
 */
export function expandDraftToMinWords(
  draft: WriterDraftPayload,
  minWords: number
): { draft: WriterDraftPayload; fixes: string[]; words: number } {
  let words = countDraftWords(draft);
  if (words >= minWords || minWords <= 0) {
    return { draft, fixes: [], words };
  }

  const blocks = [...(draft.blocks || [])];
  const bodyIdx = blocks
    .map((b, i) => ({ b, i, w: approxWords(b.content) }))
    .filter(
      ({ b }) =>
        b.type !== 'heading' &&
        ['intro', 'paragraph', 'section', 'comparison', 'summary', 'tip'].includes(b.type)
    )
    .sort((a, b) => a.w - b.w);

  if (!bodyIdx.length) {
    return { draft, fixes: [], words };
  }

  let expanded = 0;
  let cursor = 0;
  // Bound by needed words, not a fixed 120 — short drafts otherwise stop ~1600–1800.
  const maxExpansions = Math.max(
    160,
    Math.ceil((minWords - words) / 6) + bodyIdx.length * 4
  );
  while (words < minWords && expanded < maxExpansions) {
    const target = bodyIdx[cursor % bodyIdx.length]!;
    const block = blocks[target.i]!;
    const sentence = EXPAND_SENTENCES[expanded % EXPAND_SENTENCES.length]!;
    if (typeof block.content === 'string') {
      blocks[target.i] = { ...block, content: `${block.content.trim()}${sentence}` };
      expanded += 1;
    } else if (Array.isArray(block.content) && block.type === 'summary') {
      const next = [...block.content, sentence.trim()];
      blocks[target.i] = { ...block, content: next };
      expanded += 1;
    } else if (block.content && typeof block.content === 'object' && !Array.isArray(block.content)) {
      const obj = { ...(block.content as Record<string, unknown>) };
      const textKey = ['text', 'body', 'html', 'markdown', 'content'].find(
        (k) => typeof obj[k] === 'string'
      );
      if (textKey) {
        obj[textKey] = `${String(obj[textKey]).trim()}${sentence}`;
        blocks[target.i] = { ...block, content: obj };
        expanded += 1;
      } else {
        obj.text = sentence.trim();
        blocks[target.i] = { ...block, content: obj };
        expanded += 1;
      }
    } else {
      cursor += 1;
      if (cursor > bodyIdx.length * 2) break;
      continue;
    }
    words = countDraftWords({ ...draft, blocks });
    cursor += 1;
  }

  const fixes =
    expanded > 0
      ? [`Expanded ${expanded} thin section(s) toward minimum ${minWords} words (now ${words})`]
      : [];
  return { draft: { ...draft, blocks }, fixes, words };
}

export function applyDeterministicRepairs(
  draft: WriterDraftPayload,
  category: IssueCategory,
  opts?: {
    onlyBlockIds?: string[];
    /** Skip heading uniquify here — run once after AI instead */
    skipHeadingUniquify?: boolean;
    linkCandidates?: string[];
    /** When set (STRUCTURE + word_count_low), expand thin sections to this floor */
    expandToMinWords?: number;
    /** Article geography — link candidates are filtered to relevant, existing routes. */
    linkScope?: LinkGeoScope | null;
  }
): {
  draft: WriterDraftPayload;
  fixes: string[];
} {
  const fixes: string[] = [];
  let blocks = [...(draft.blocks || [])];
  let meta_title = draft.meta_title || draft.seo_title || '';
  let meta_description = draft.meta_description || '';
  let excerpt = draft.excerpt || '';
  let seo_title = draft.seo_title || '';
  const allow = opts?.onlyBlockIds?.length ? new Set(opts.onlyBlockIds) : null;

  if (category === 'STRUCTURE') {
    if (!opts?.skipHeadingUniquify) {
      const headingPass = uniquifyHeadings({ ...draft, blocks });
      blocks = headingPass.draft.blocks;
      fixes.push(...headingPass.fixes);
    }
    const toc = ensureToc(blocks);
    blocks = toc.blocks;
    if (toc.fix) fixes.push(toc.fix);
  }

  if (category === 'STRUCTURE' && opts?.expandToMinWords && opts.expandToMinWords > 0) {
    const expanded = expandDraftToMinWords(
      { ...draft, blocks, meta_title, meta_description, excerpt, seo_title },
      opts.expandToMinWords
    );
    blocks = expanded.draft.blocks;
    fixes.push(...expanded.fixes);
  }

  if (category === 'READABILITY') {
    let textFixes = 0;
    blocks = blocks.map((b) => {
      // Tables / comparisons hold data cells and the TOC holds headings — never re-punctuate them.
      if (b.type === 'heading' || b.type === 'table' || b.type === 'comparison' || b.id === 'toc') return b;
      if (allow && !allow.has(b.id)) return b;
      const r = repairBlockContent(b.content, 'readability');
      if (r.changed) textFixes += 1;
      return r.changed ? { ...b, content: r.content } : b;
    });
    if (textFixes > 0) fixes.push(`Readability pass on ${textFixes} section(s)`);
  }

  if (category === 'STYLE') {
    let textFixes = 0;
    blocks = blocks.map((b) => {
      if (b.type === 'heading') return b;
      if (allow && !allow.has(b.id)) return b;
      const r = repairBlockContent(b.content, 'style');
      if (r.changed) textFixes += 1;
      return r.changed ? { ...b, content: r.content } : b;
    });
    if (textFixes > 0) fixes.push(`Style filler cleanup on ${textFixes} section(s)`);

    // Article-level template / advice repetition (cheap; often the Fix Issues hotspot)
    let styleDraft = {
      ...draft,
      blocks,
      meta_title,
      meta_description,
      excerpt,
      seo_title,
    };
    const openings = repairRepeatedOpenings(styleDraft);
    styleDraft = openings.draft;
    if (openings.removed) fixes.push(...openings.issues.slice(0, 8));
    const advice = repairRepeatedAdvice(styleDraft);
    styleDraft = advice.draft;
    if (advice.removed) fixes.push(...advice.issues.slice(0, 8));
    blocks = styleDraft.blocks || blocks;
  }

  if (category === 'SEO') {
    const metaPass = repairMetaLengths({
      ...draft,
      blocks,
      meta_title,
      meta_description,
      excerpt,
      seo_title,
    });
    meta_title = metaPass.draft.meta_title || meta_title;
    meta_description = metaPass.draft.meta_description || meta_description;
    seo_title = metaPass.draft.seo_title || seo_title;
    fixes.push(...metaPass.fixes);
    // Body links: scan all paragraphs (allow-list is too narrow for link injection)
    const candidates = opts?.linkScope
      ? filterRelevantHrefs(opts.linkCandidates || [], opts.linkScope)
      : opts?.linkCandidates || [];
    const linkPass = injectBodyLinks(blocks, allow, candidates);
    blocks = linkPass.blocks;
    fixes.push(...linkPass.fixes);
  }

  // Mechanical public-integrity repairs on every deterministic pass (QA markers,
  // corrupt sentence breaks, irrelevant links, TOC from final headings). The publish
  // gate re-inspects the stored draft, so nothing here can bypass final validation.
  const assembled: WriterDraftPayload = {
    ...draft,
    seo_title,
    meta_title,
    meta_description,
    excerpt,
    blocks: normalizeDraftBlocks(blocks),
  };
  const integrity = repairPublicIntegrity(assembled, {
    articleTitle: toPublicTitle(seo_title || draft.seo_title || ''),
    scope: opts?.linkScope || null,
  });
  fixes.push(...integrity.fixes);

  return {
    draft: integrity.draft,
    fixes,
  };
}

export function mergeAiPatch(
  draft: WriterDraftPayload,
  patch: RevisionAiPatch,
  allowedIds?: string[],
  touchMeta = false
): { draft: WriterDraftPayload; fixed: string[] } {
  const fixed = [...(patch.fixed_issues || [])];
  let next: WriterDraftPayload = { ...draft, blocks: [...draft.blocks] };
  const allow = allowedIds ? new Set(allowedIds) : null;

  if (touchMeta) {
    if (typeof patch.meta_title === 'string' && patch.meta_title.trim()) {
      next.meta_title = patch.meta_title.trim();
      fixed.push('Updated meta title');
    }
    if (typeof patch.meta_description === 'string' && patch.meta_description.trim()) {
      next.meta_description = patch.meta_description.trim();
      fixed.push('Updated meta description');
    }
    if (typeof patch.excerpt === 'string' && patch.excerpt.trim()) {
      next.excerpt = patch.excerpt.trim();
      fixed.push('Updated excerpt');
    }
    if (typeof patch.seo_title === 'string' && patch.seo_title.trim()) {
      next.seo_title = patch.seo_title.trim();
      fixed.push('Updated seo title');
    }
  }

  if (Array.isArray(patch.block_patches) && patch.block_patches.length) {
    const byId = new Map(next.blocks.map((b) => [b.id, { ...b }]));
    let applied = 0;
    let rejectedShrink = 0;
    for (const p of patch.block_patches) {
      if (!p?.id || !byId.has(p.id)) continue;
      if (allow && !allow.has(p.id)) continue;
      const cur = byId.get(p.id)!;
      if (typeof p.heading === 'string') cur.heading = p.heading;
      if (p.content !== undefined) {
        const beforeW = approxWords(cur.content);
        const afterW = approxWords(p.content);
        // Reject truncated rewrites that destroy body length (common AI failure mode).
        if (beforeW >= 40 && afterW < Math.floor(beforeW * 0.65)) {
          rejectedShrink += 1;
        } else {
          cur.content = p.content;
          applied += 1;
        }
      } else if (typeof p.heading === 'string') {
        applied += 1;
      }
      byId.set(p.id, cur);
    }
    next.blocks = normalizeDraftBlocks(next.blocks.map((b) => byId.get(b.id) || b));
    if (applied) fixed.push(`Rewrote ${applied} affected section(s)`);
    if (rejectedShrink) {
      fixed.push(`Rejected ${rejectedShrink} truncated section rewrite(s)`);
    }
  }

  return { draft: next, fixed: [...new Set(fixed)] };
}

export function parseRevisionAiJson(raw: string): RevisionAiPatch {
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Revision AI returned no JSON object');
  const parsed = JSON.parse(s.slice(start, end + 1)) as RevisionAiPatch;
  if (!parsed || typeof parsed !== 'object') throw new Error('Revision AI JSON invalid');
  return parsed;
}
