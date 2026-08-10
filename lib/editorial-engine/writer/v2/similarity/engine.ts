/**
 * Full published Content Memory + multi-layer similarity engine.
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import { draftBodyText } from '../../../reviewer/text-utils.js';
import type { SimilarityLayer, SimilarityLayerResult } from '../types.js';
import { loadPublishedMemory, type MemoryDoc } from './memory.js';
import { SIMILARITY_THRESHOLDS } from './thresholds.js';

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function shingles(text: string, n = 5): Set<string> {
  const words = norm(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function extractParts(draft: WriterDraftPayload) {
  const blocks = draft.blocks || [];
  const paras: string[] = [];
  const headings: string[] = [];
  const faqs: string[] = [];
  const summaries: string[] = [];
  for (const b of blocks) {
    if (b.type === 'heading' && b.heading) headings.push(String(b.heading));
    if (b.type === 'summary') {
      summaries.push(typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
    }
    if (b.type === 'faq' && Array.isArray(b.content)) {
      for (const item of b.content as Array<{ q?: string; a?: string }>) {
        faqs.push(`${item.q || ''} ${item.a || ''}`);
      }
    }
    if (typeof b.content === 'string' && b.content.trim().length > 40) paras.push(b.content);
  }
  return {
    text: paras.join('\n'),
    openings: paras.slice(0, 3).map((p) => p.slice(0, 180)),
    closings: paras.slice(-3).map((p) => p.slice(0, 180)),
    headings,
    faqs,
    summaries,
  };
}

function layerScore(
  layer: SimilarityLayer,
  draft: WriterDraftPayload,
  docs: MemoryDoc[]
): SimilarityLayerResult {
  const threshold = SIMILARITY_THRESHOLDS[layer];
  const parts = extractParts(draft);
  const body = draftBodyText(draft);
  let score = 0;
  let detail = '';

  const maxAgainst = (values: string[], pick: (d: MemoryDoc) => string[]) => {
    let best = 0;
    let slug = '';
    for (const doc of docs) {
      for (const v of values) {
        if (!v || v.length < 20) continue;
        const vs = shingles(v, layer === 'sentence' ? 4 : 5);
        for (const other of pick(doc)) {
          if (!other || other.length < 20) continue;
          const s = jaccard(vs, shingles(other, layer === 'sentence' ? 4 : 5));
          if (s > best) {
            best = s;
            slug = doc.slug;
          }
        }
      }
    }
    return { best, slug };
  };

  switch (layer) {
    case 'sentence':
    case 'paragraph': {
      const paras = parts.text.split(/\n+/).filter((p) => p.length > 60).slice(0, 40);
      const r = maxAgainst(paras, (d) =>
        d.text.split(/\n+/).filter((p) => p.length > 60).slice(0, 40)
      );
      score = r.best;
      detail = r.slug;
      break;
    }
    case 'heading':
    case 'outline': {
      const r = maxAgainst(parts.headings, (d) => d.headings);
      score = r.best;
      detail = r.slug;
      break;
    }
    case 'faq': {
      const r = maxAgainst(parts.faqs.length ? parts.faqs : [''], (d) => d.faqs);
      score = r.best;
      detail = r.slug;
      break;
    }
    case 'summary': {
      const r = maxAgainst(parts.summaries.length ? parts.summaries : [''], (d) => d.summaries);
      score = r.best;
      detail = r.slug;
      break;
    }
    case 'opening': {
      const r = maxAgainst(parts.openings, (d) => d.openings);
      score = r.best;
      detail = r.slug;
      break;
    }
    case 'closing': {
      const r = maxAgainst(parts.closings, (d) => d.closings);
      score = r.best;
      detail = r.slug;
      break;
    }
    case 'rhythm': {
      const lengths = parts.text
        .split(/[.!?]+/)
        .map((s) => s.trim().split(/\s+/).length)
        .filter((n) => n > 3);
      const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
      const variance =
        lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, lengths.length);
      score = variance < 8 ? 0.8 : variance < 15 ? 0.55 : 0.2;
      detail = `variance=${variance.toFixed(1)}`;
      break;
    }
    default: {
      const r = maxAgainst([body.slice(0, 8000)], (d) => [d.text.slice(0, 8000)]);
      score = r.best;
      detail = r.slug;
      break;
    }
  }

  return {
    layer,
    score: Number(score.toFixed(4)),
    threshold,
    breached: score >= threshold,
    detail,
  };
}

export async function runSimilarityEngine(
  draft: WriterDraftPayload,
  opts?: { excludeSlug?: string }
): Promise<SimilarityLayerResult[]> {
  const docs = (await loadPublishedMemory()).filter((d) => d.slug !== opts?.excludeSlug);
  const layers = Object.keys(SIMILARITY_THRESHOLDS) as SimilarityLayer[];
  return layers.map((layer) => layerScore(layer, draft, docs));
}

export function similarityNeedsRewrite(results: SimilarityLayerResult[]): boolean {
  return results.some((r) => r.breached);
}
