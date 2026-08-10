/**
 * Writer Content Memory — track facts, entities, statistics, and examples
 * already explained across sections so later sections add NEW value only.
 * Reusable for all guide types (no city hardcoding).
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import { isProtectedBlock } from './block-integrity.js';
import { draftSectionChunks, type SectionChunk } from './section-chunks.js';
import {
  fingerprint,
  normalizeText,
  similarityScore,
  splitSentences,
  SENTENCE_SIM_THRESHOLD,
  SECTION_SIM_THRESHOLD,
} from './content-quality/text-metrics.js';

/** Stats / index figures may be referenced later but not re-explained. */
const STAT_RE =
  /\b(?:cost|rent|grocery|restaurant|transport|local\s+purchasing\s+power|quality\s+of\s+life|safety|health\s+care|climate|pollution|traffic|property\s+price|cpi|col)\s+index\b|\bindex(?:ed)?\s+(?:of|=|:)?\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*%|\b(?:USD|EUR|GBP|INR|CAD|AUD)\s*[\d,]+(?:\.\d+)?|\b[\d,]+\s*(?:per\s+month|\/mo|a\s+month)\b/gi;

const ENTITY_RE =
  /\b(?:cost of living|monthly budget|move-?in cash|take-?home|deposit|utilities|commute|neighbourhood|neighborhood|healthcare|visa|remote work)\b/gi;

const EXAMPLE_OPEN_RE =
  /\b(?:for example|real scenario|imagine you|practical (?:move|example|check)|a common case)\b/i;

const EXPLAIN_RE =
  /\b(?:refers to|means that|is defined as|measures? (?:the|how)|represents? (?:the|how)|indicates? (?:the|how)|can be understood as)\b/i;

export interface MemoryFact {
  kind: 'stat' | 'entity' | 'example' | 'claim';
  key: string;
  text: string;
  sectionHeading: string;
  explained: boolean;
}

export interface ContentMemory {
  facts: MemoryFact[];
  sectionTexts: Array<{ heading: string; text: string }>;
  /** Fingerprints of explained stats — later sections may reference, not re-explain */
  explainedStatKeys: Set<string>;
  explainedEntityKeys: Set<string>;
  exampleFingerprints: Set<string>;
}

export interface SectionMemoryDiff {
  heading: string;
  repeatedSentences: string[];
  reExplainedStats: string[];
  similarityToPrior: number;
  needsRewrite: boolean;
}

function factKey(kind: string, raw: string): string {
  return `${kind}:${fingerprint(raw).slice(0, 80)}`;
}

function extractStats(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(STAT_RE.source, STAT_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].trim());
  }
  return out;
}

function extractEntities(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(ENTITY_RE.source, ENTITY_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(normalizeText(m[0]));
  }
  return [...new Set(out)];
}

/** Create empty memory for a writing session. */
export function createContentMemory(): ContentMemory {
  return {
    facts: [],
    sectionTexts: [],
    explainedStatKeys: new Set(),
    explainedEntityKeys: new Set(),
    exampleFingerprints: new Set(),
  };
}

/** Ingest a finished section into memory (call after generation). */
export function rememberSection(
  memory: ContentMemory,
  heading: string,
  text: string
): void {
  const trimmed = text.trim();
  if (trimmed.length < 20) return;
  memory.sectionTexts.push({ heading, text: trimmed });

  for (const stat of extractStats(trimmed)) {
    const key = factKey('stat', stat);
    const explained = EXPLAIN_RE.test(trimmed) || /\bis\s+\d/i.test(trimmed);
    memory.facts.push({
      kind: 'stat',
      key,
      text: stat,
      sectionHeading: heading,
      explained,
    });
    if (explained) memory.explainedStatKeys.add(key);
  }

  for (const ent of extractEntities(trimmed)) {
    const key = factKey('entity', ent);
    const explained = EXPLAIN_RE.test(trimmed);
    memory.facts.push({
      kind: 'entity',
      key,
      text: ent,
      sectionHeading: heading,
      explained,
    });
    if (explained) memory.explainedEntityKeys.add(key);
  }

  if (EXAMPLE_OPEN_RE.test(trimmed)) {
    for (const s of splitSentences(trimmed)) {
      if (EXAMPLE_OPEN_RE.test(s) || s.length > 60) {
        memory.exampleFingerprints.add(fingerprint(s).slice(0, 100));
        memory.facts.push({
          kind: 'example',
          key: factKey('example', s),
          text: s.slice(0, 200),
          sectionHeading: heading,
          explained: true,
        });
      }
    }
  }

  for (const s of splitSentences(trimmed)) {
    if (s.split(/\s+/).length < 8) continue;
    memory.facts.push({
      kind: 'claim',
      key: factKey('claim', s),
      text: s,
      sectionHeading: heading,
      explained: true,
    });
  }
}

/** Build memory from an existing draft (post-pass / gate). */
export function buildMemoryFromDraft(draft: WriterDraftPayload): ContentMemory {
  const memory = createContentMemory();
  for (const chunk of draftSectionChunks(draft)) {
    rememberSection(memory, chunk.heading, chunk.text);
  }
  return memory;
}

/**
 * Compare a candidate section text against prior memory.
 * Stats already explained elsewhere may be referenced lightly, not re-explained.
 */
export function diffSectionAgainstMemory(
  memory: ContentMemory,
  heading: string,
  text: string,
  opts?: { sectionSimThreshold?: number; sentenceSimThreshold?: number }
): SectionMemoryDiff {
  const sectionThresh = opts?.sectionSimThreshold ?? SECTION_SIM_THRESHOLD;
  const sentThresh = opts?.sentenceSimThreshold ?? SENTENCE_SIM_THRESHOLD;
  const sentences = splitSentences(text);
  const repeatedSentences: string[] = [];
  const reExplainedStats: string[] = [];

  let maxPriorSim = 0;
  for (const prior of memory.sectionTexts) {
    if (normalizeText(prior.heading) === normalizeText(heading)) continue;
    maxPriorSim = Math.max(maxPriorSim, similarityScore(prior.text, text));
  }

  for (const s of sentences) {
    for (const fact of memory.facts) {
      if (fact.kind !== 'claim' && fact.kind !== 'example') continue;
      if (normalizeText(fact.sectionHeading) === normalizeText(heading)) continue;
      if (similarityScore(s, fact.text) >= sentThresh) {
        repeatedSentences.push(s);
        break;
      }
    }
  }

  for (const stat of extractStats(text)) {
    const key = factKey('stat', stat);
    if (memory.explainedStatKeys.has(key) && EXPLAIN_RE.test(text)) {
      reExplainedStats.push(stat);
    }
  }

  // Also catch near-duplicate full section vs any prior
  const needsRewrite =
    maxPriorSim >= sectionThresh ||
    repeatedSentences.length >= 2 ||
    reExplainedStats.length > 0;

  return {
    heading,
    repeatedSentences: [...new Set(repeatedSentences)],
    reExplainedStats: [...new Set(reExplainedStats)],
    similarityToPrior: maxPriorSim,
    needsRewrite,
  };
}

/**
 * Rewrite section text to keep NEW value only:
 * drop sentences that duplicate prior claims; convert re-explanations of stats
 * into short references.
 */
export function rewriteSectionForNewValue(
  text: string,
  diff: SectionMemoryDiff,
  memory: ContentMemory
): string {
  const drop = new Set(diff.repeatedSentences.map((s) => fingerprint(s)));
  const kept: string[] = [];

  for (const s of splitSentences(text)) {
    if (drop.has(fingerprint(s))) continue;

    // Re-explained stats → keep as short reference if the sentence is mostly explanation
    let next = s;
    if (diff.reExplainedStats.length && EXPLAIN_RE.test(s)) {
      const hasStat = extractStats(s).some((st) =>
        diff.reExplainedStats.some((r) => normalizeText(r) === normalizeText(st))
      );
      if (hasStat) {
        // Drop explanatory rehash; optional light reference kept only if sentence has action value
        const hasAction =
          /\b(should|check|compare|confirm|decide|budget|plan|ask|verify|next)\b/i.test(s);
        if (!hasAction) continue;
        next = s.replace(EXPLAIN_RE, 'ties to').replace(/\s{2,}/g, ' ').trim();
      }
    }

    // Drop near-dup vs any remembered claim
    const claimDup = memory.facts.some(
      (f) =>
        (f.kind === 'claim' || f.kind === 'example') &&
        similarityScore(next, f.text) >= SENTENCE_SIM_THRESHOLD
    );
    if (claimDup && kept.length > 0) continue;

    kept.push(next);
  }

  if (!kept.length) {
    return `Build on the earlier baseline for this topic with a local decision: confirm the largest cost line, then decide whether your buffer still clears move-in and monthly cash needs.`;
  }
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Apply content memory across all body sections of a draft (post-pass).
 * Processes sections in order; earlier sections seed memory for later ones.
 */
export function applyContentMemoryPass(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  sectionsRewritten: number;
  diffs: SectionMemoryDiff[];
} {
  const memory = createContentMemory();
  const diffs: SectionMemoryDiff[] = [];
  let sectionsRewritten = 0;
  const blocks = [...(draft.blocks || [])];
  const chunks = draftSectionChunks(draft);

  for (const chunk of chunks) {
    const diff = diffSectionAgainstMemory(memory, chunk.heading, chunk.text);
    diffs.push(diff);

    if (diff.needsRewrite) {
      // Rewrite string body blocks in this section (skip headings / protected)
      for (const id of chunk.bodyIds) {
        const idx = blocks.findIndex((b) => b.id === id);
        if (idx < 0) continue;
        const b = blocks[idx];
        if (!b || isProtectedBlock(b) || b.type === 'heading') continue;
        if (typeof b.content !== 'string') continue;
        const blockDiff = diffSectionAgainstMemory(memory, chunk.heading, b.content);
        if (!blockDiff.needsRewrite && blockDiff.repeatedSentences.length === 0) {
          // Still ingest; may be unique
          continue;
        }
        const rewritten = rewriteSectionForNewValue(b.content, blockDiff, memory);
        if (rewritten !== b.content) {
          blocks[idx] = { ...b, content: rewritten };
          sectionsRewritten += 1;
        }
      }
    }

    // Re-read section text after possible rewrite for accurate memory
    const refreshed = refreshChunkText(blocks, chunk);
    rememberSection(memory, chunk.heading, refreshed);
  }

  return {
    draft: { ...draft, blocks },
    sectionsRewritten,
    diffs,
  };
}

function refreshChunkText(blocks: DraftBlock[], chunk: SectionChunk): string {
  const parts: string[] = [];
  for (const id of chunk.bodyIds) {
    const b = blocks.find((x) => x.id === id);
    if (!b) continue;
    if (typeof b.content === 'string') parts.push(b.content);
    else if (Array.isArray(b.content)) {
      parts.push(
        b.content
          .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join(' ')
      );
    }
  }
  return parts.join(' ');
}

/** Compact digest for section briefs (prior sections already covered). */
export function memoryDigestForPrompt(memory: ContentMemory, maxChars = 1200): string {
  const lines: string[] = [];
  lines.push('ALREADY COVERED — do not re-explain; reference only if needed:');
  for (const s of [...memory.explainedStatKeys].slice(0, 12)) {
    lines.push(`- stat: ${s.replace(/^stat:/, '')}`);
  }
  for (const e of [...memory.explainedEntityKeys].slice(0, 8)) {
    lines.push(`- entity: ${e.replace(/^entity:/, '')}`);
  }
  for (const sec of memory.sectionTexts.slice(0, 6)) {
    lines.push(`- section "${sec.heading}": ${sec.text.slice(0, 120)}…`);
  }
  return lines.join('\n').slice(0, maxChars);
}
