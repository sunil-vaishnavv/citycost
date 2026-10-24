/**
 * Block Integrity Manager — unique IDs, protected structural blocks, normalize before save.
 * Corruption from humanize/similarity/expand must be repaired here, not at final validation.
 */

import type { DraftBlock, WriterDraftPayload } from '../draft-validate.js';
import { sanitizeBlocks } from '../draft-validate.js';

export const PROTECTED_BLOCK_IDS = {
  intro: 'intro',
  toc: 'toc',
  faq: 'faq',
  summary: 'summary',
  sources: 'sources',
} as const;

export type ProtectedKind = keyof typeof PROTECTED_BLOCK_IDS;

export interface ProtectedSnapshot {
  intro?: DraftBlock;
  toc?: DraftBlock;
  faq?: DraftBlock;
  summary?: DraftBlock;
  sources?: DraftBlock;
}

export interface DraftIntegrityReport {
  block_count: number;
  unique_ids: number;
  duplicate_ids: string[];
  intro: 'present' | 'missing';
  toc: 'present' | 'missing';
  faq: 'present' | 'missing';
  summary: 'present' | 'missing';
  order_valid: boolean;
  integrity: 'PASS' | 'FAIL';
  notes: string[];
}

let idSeq = 0;

/** Single factory for block IDs — never reuse. */
export function mintBlockId(prefix = 'blk'): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

export function resetBlockIdFactoryForTests(): void {
  idSeq = 0;
}

export class BlockRegistry {
  private map = new Map<string, DraftBlock>();

  clear(): void {
    this.map.clear();
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  get(id: string): DraftBlock | undefined {
    return this.map.get(id);
  }

  /**
   * Insert with unique id. If preferred id is taken, remint — never reuse.
   * Returns the block with the assigned unique id.
   */
  insert(block: DraftBlock, preferredId?: string): DraftBlock {
    let id = (preferredId || block.id || '').trim();
    if (!id || this.map.has(id)) {
      id = mintBlockId(block.type === 'heading' ? 'h' : 'b');
    }
    const next = { ...block, id };
    this.map.set(id, next);
    return next;
  }

  /**
   * Strict insert: reject immediately if id already registered.
   * Use when callers must not silently remint (e.g. protected restore).
   */
  insertStrict(block: DraftBlock, id: string): DraftBlock {
    const key = id.trim();
    if (!key) throw new Error('BlockRegistry.insertStrict: empty id');
    if (this.map.has(key)) {
      throw new Error(`BlockRegistry: duplicate block id rejected: ${key}`);
    }
    const next = { ...block, id: key };
    this.map.set(key, next);
    return next;
  }

  values(): DraftBlock[] {
    return [...this.map.values()];
  }

  size(): number {
    return this.map.size;
  }
}

export function isTocBlock(b: DraftBlock): boolean {
  if (b.id === PROTECTED_BLOCK_IDS.toc) return true;
  const heading = (b.heading || '').toLowerCase();
  if (b.type === 'list' && /table of contents|^contents$/.test(heading.trim())) return true;
  if (b.type === 'heading' && /table of contents|^contents$/.test(heading.trim())) return true;
  return false;
}

export function isSourcesBlock(b: DraftBlock): boolean {
  if (b.id === PROTECTED_BLOCK_IDS.sources) return true;
  const heading = (b.heading || '').toLowerCase().trim();
  if (heading === 'sources' || heading === 'references' || heading === 'data sources') return true;
  return false;
}

export function isProtectedBlock(b: DraftBlock): boolean {
  if (b.type === 'intro' || b.type === 'faq' || b.type === 'summary') return true;
  if (isTocBlock(b)) return true;
  if (isSourcesBlock(b)) return true;
  if (
    b.id === PROTECTED_BLOCK_IDS.intro ||
    b.id === PROTECTED_BLOCK_IDS.toc ||
    b.id === PROTECTED_BLOCK_IDS.faq ||
    b.id === PROTECTED_BLOCK_IDS.summary ||
    b.id === PROTECTED_BLOCK_IDS.sources
  ) {
    return true;
  }
  return false;
}

export function snapshotProtected(blocks: DraftBlock[]): ProtectedSnapshot {
  const snap: ProtectedSnapshot = {};
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type === 'intro' && !snap.intro) {
      snap.intro = { ...b, id: PROTECTED_BLOCK_IDS.intro, type: 'intro' };
    } else if (isTocBlock(b) && !snap.toc) {
      snap.toc = {
        ...b,
        id: PROTECTED_BLOCK_IDS.toc,
        type: b.type === 'heading' ? 'list' : b.type,
        heading: b.heading || 'Table of contents',
      };
    } else if (b.type === 'faq' && !snap.faq) {
      snap.faq = { ...b, id: PROTECTED_BLOCK_IDS.faq, type: 'faq' };
    } else if (b.type === 'summary' && !snap.summary) {
      snap.summary = { ...b, id: PROTECTED_BLOCK_IDS.summary, type: 'summary' };
    } else if (isSourcesBlock(b) && !snap.sources) {
      snap.sources = { ...b, id: PROTECTED_BLOCK_IDS.sources };
    }
  }
  return snap;
}

export function splitProtectedBlocks(blocks: DraftBlock[]): {
  body: DraftBlock[];
  protected: ProtectedSnapshot;
} {
  const protectedSnap = snapshotProtected(blocks);
  const body: DraftBlock[] = [];
  for (const b of blocks || []) {
    if (isProtectedBlock(b)) continue;
    body.push(b);
  }
  return { body, protected: protectedSnap };
}

/**
 * Merge body rewrite with protected snapshot.
 * Body blocks get unique IDs; protected blocks keep stable IDs.
 * Order: intro → toc → body → faq → summary.
 */
export function mergeWithProtected(
  bodyBlocks: DraftBlock[],
  snap: ProtectedSnapshot,
  fallbackSnap?: ProtectedSnapshot
): DraftBlock[] {
  const registry = new BlockRegistry();
  const out: DraftBlock[] = [];

  const intro = snap.intro || fallbackSnap?.intro;
  const toc = snap.toc || fallbackSnap?.toc;
  const faq = snap.faq || fallbackSnap?.faq;
  const summary = snap.summary || fallbackSnap?.summary;
  const sources = snap.sources || fallbackSnap?.sources;

  if (intro) {
    out.push(
      registry.insertStrict(
        { ...intro, id: PROTECTED_BLOCK_IDS.intro, type: 'intro' },
        PROTECTED_BLOCK_IDS.intro
      )
    );
  }
  if (toc) {
    out.push(
      registry.insertStrict(
        {
          ...toc,
          id: PROTECTED_BLOCK_IDS.toc,
          heading: toc.heading || 'Table of contents',
        },
        PROTECTED_BLOCK_IDS.toc
      )
    );
  }

  for (const raw of bodyBlocks || []) {
    if (!raw || isProtectedBlock(raw)) continue;
    // Never trust AI-supplied ids that collide with protected or each other
    const preferred =
      raw.id &&
      raw.id !== PROTECTED_BLOCK_IDS.intro &&
      raw.id !== PROTECTED_BLOCK_IDS.toc &&
      raw.id !== PROTECTED_BLOCK_IDS.faq &&
      raw.id !== PROTECTED_BLOCK_IDS.summary &&
      raw.id !== PROTECTED_BLOCK_IDS.sources &&
      !registry.has(raw.id)
        ? raw.id
        : undefined;
    out.push(registry.insert({ ...raw, id: preferred || '' }, preferred));
  }

  if (faq) {
    out.push(
      registry.insertStrict({ ...faq, id: PROTECTED_BLOCK_IDS.faq, type: 'faq' }, PROTECTED_BLOCK_IDS.faq)
    );
  }
  if (summary) {
    out.push(
      registry.insertStrict(
        { ...summary, id: PROTECTED_BLOCK_IDS.summary, type: 'summary' },
        PROTECTED_BLOCK_IDS.summary
      )
    );
  }
  if (sources) {
    out.push(
      registry.insertStrict(
        { ...sources, id: PROTECTED_BLOCK_IDS.sources },
        PROTECTED_BLOCK_IDS.sources
      )
    );
  }

  return out;
}

/** Deduplicate IDs across entire draft; remint collisions. */
export function uniquifyBlockIds(blocks: DraftBlock[]): DraftBlock[] {
  const registry = new BlockRegistry();
  return (blocks || []).map((b) => {
    if (isProtectedBlock(b)) {
      const stable =
        b.type === 'intro'
          ? PROTECTED_BLOCK_IDS.intro
          : b.type === 'faq'
            ? PROTECTED_BLOCK_IDS.faq
            : b.type === 'summary'
              ? PROTECTED_BLOCK_IDS.summary
              : isTocBlock(b)
                ? PROTECTED_BLOCK_IDS.toc
                : isSourcesBlock(b)
                  ? PROTECTED_BLOCK_IDS.sources
                  : b.id;
      return registry.insert({ ...b, id: stable }, stable);
    }
    const preferred = b.id && !registry.has(b.id) ? b.id : undefined;
    return registry.insert(b, preferred);
  });
}

export function inspectDraftIntegrity(draft: WriterDraftPayload): DraftIntegrityReport {
  const blocks = draft.blocks || [];
  const ids = blocks.map((b) => b.id);
  const seen = new Set<string>();
  const duplicate_ids: string[] = [];
  for (const id of ids) {
    if (!id) {
      duplicate_ids.push('(empty)');
      continue;
    }
    if (seen.has(id)) duplicate_ids.push(id);
    else seen.add(id);
  }

  const introIdx = blocks.findIndex((b) => b.type === 'intro' || b.id === 'intro');
  const tocIdx = blocks.findIndex((b) => isTocBlock(b));
  const faqIdx = blocks.findIndex((b) => b.type === 'faq');
  const summaryIdx = blocks.findIndex((b) => b.type === 'summary');

  const notes: string[] = [];
  let order_valid = true;
  if (introIdx >= 0 && tocIdx >= 0 && introIdx > tocIdx) {
    order_valid = false;
    notes.push('intro after toc');
  }
  if (faqIdx >= 0 && summaryIdx >= 0 && faqIdx > summaryIdx) {
    // faq before summary preferred; soft note
    notes.push('summary before faq');
  }
  if (tocIdx >= 0 && faqIdx >= 0 && tocIdx > faqIdx) {
    order_valid = false;
    notes.push('toc after faq');
  }

  const intro = introIdx >= 0 ? 'present' : 'missing';
  const toc = tocIdx >= 0 ? 'present' : 'missing';
  const faq = faqIdx >= 0 ? 'present' : 'missing';
  const summary = summaryIdx >= 0 ? 'present' : 'missing';

  const integrity: 'PASS' | 'FAIL' =
    duplicate_ids.length === 0 &&
    intro === 'present' &&
    toc === 'present' &&
    faq === 'present' &&
    summary === 'present' &&
    order_valid
      ? 'PASS'
      : 'FAIL';

  return {
    block_count: blocks.length,
    unique_ids: seen.size,
    duplicate_ids: [...new Set(duplicate_ids)],
    intro,
    toc,
    faq,
    summary,
    order_valid,
    integrity,
    notes,
  };
}

export function formatIntegrityMeta(report: DraftIntegrityReport): string {
  return [
    `blocks=${report.block_count}`,
    `unique=${report.unique_ids}`,
    `dupes=${report.duplicate_ids.length}`,
    `intro=${report.intro}`,
    `toc=${report.toc}`,
    `faq=${report.faq}`,
    `summary=${report.summary}`,
    `order=${report.order_valid ? 'ok' : 'bad'}`,
    `integrity=${report.integrity}`,
  ].join(';');
}

/** Compact stage audit: count, ids, types, order for debug logs. */
export function formatBlockAudit(stage: string, draft: WriterDraftPayload): string {
  const blocks = draft.blocks || [];
  const ids = blocks.map((b) => b.id || '?').join(',');
  const types = blocks.map((b) => b.type).join('>');
  const report = inspectDraftIntegrity(draft);
  return `[writer-v2][blocks:${stage}] count=${blocks.length} types=${types} ids=${ids} | ${formatIntegrityMeta(report)}`;
}

/** Log + return integrity report for a pipeline stage. */
export function logBlockAudit(stage: string, draft: WriterDraftPayload): DraftIntegrityReport {
  const report = inspectDraftIntegrity(draft);
  const line = formatBlockAudit(stage, draft);
  if (report.integrity === 'FAIL') console.warn(line);
  else console.log(line);
  return report;
}

/**
 * Normalize draft: restore protected blocks from snapshot, uniquify IDs,
 * enforce order intro → toc → body → faq → summary. Soft-sanitize body only.
 */
export function ensureDraftIntegrity(
  draft: WriterDraftPayload,
  snapshot: ProtectedSnapshot,
  opts?: { outlineHeadings?: string[] }
): { draft: WriterDraftPayload; report: DraftIntegrityReport; restored: string[] } {
  const current = snapshotProtected(draft.blocks || []);
  const restored: string[] = [];

  const snap: ProtectedSnapshot = {
    intro: current.intro || snapshot.intro,
    toc: current.toc || snapshot.toc,
    faq: current.faq || snapshot.faq,
    summary: current.summary || snapshot.summary,
    sources: current.sources || snapshot.sources,
  };

  if (!current.intro && snap.intro) restored.push('intro');
  if (!current.toc && snap.toc) restored.push('toc');
  if (!current.faq && snap.faq) restored.push('faq');
  if (!current.summary && snap.summary) restored.push('summary');
  if (!current.sources && snap.sources) restored.push('sources');

  // Synthesize TOC if still missing but we have headings
  if (!snap.toc && opts?.outlineHeadings?.length) {
    snap.toc = {
      id: PROTECTED_BLOCK_IDS.toc,
      type: 'list',
      heading: 'Table of contents',
      content: opts.outlineHeadings,
    };
    restored.push('toc_synthesized');
  }

  const { body } = splitProtectedBlocks(draft.blocks || []);
  // Sanitize body only — never drop protected via length floors
  const cleanBody = sanitizeBlocks(body).filter((b) => !isProtectedBlock(b));
  let merged = mergeWithProtected(cleanBody, snap);

  // Final uniquify pass
  merged = uniquifyBlockIds(merged);

  // Ensure protected stable ids after uniquify
  merged = merged.map((b) => {
    if (b.type === 'intro') return { ...b, id: PROTECTED_BLOCK_IDS.intro };
    if (b.type === 'faq') return { ...b, id: PROTECTED_BLOCK_IDS.faq };
    if (b.type === 'summary') return { ...b, id: PROTECTED_BLOCK_IDS.summary };
    if (isTocBlock(b)) return { ...b, id: PROTECTED_BLOCK_IDS.toc };
    if (isSourcesBlock(b)) return { ...b, id: PROTECTED_BLOCK_IDS.sources };
    return b;
  });

  // Dedupe protected kinds (exactly one each)
  const seenKind = new Set<string>();
  merged = merged.filter((b) => {
    const kind =
      b.type === 'intro'
        ? 'intro'
        : b.type === 'faq'
          ? 'faq'
          : b.type === 'summary'
            ? 'summary'
            : isTocBlock(b)
              ? 'toc'
              : isSourcesBlock(b)
                ? 'sources'
                : null;
    if (!kind) return true;
    if (seenKind.has(kind)) return false;
    seenKind.add(kind);
    return true;
  });

  const next = { ...draft, blocks: merged };
  const report = inspectDraftIntegrity(next);
  if (restored.length) {
    console.warn(`[writer-v2] block integrity restored: ${restored.join(', ')} | ${formatIntegrityMeta(report)}`);
  } else if (report.integrity === 'FAIL') {
    console.warn(`[writer-v2] block integrity FAIL: ${formatIntegrityMeta(report)}`);
  }

  return { draft: next, report, restored };
}
