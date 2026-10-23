/**
 * Real-Time RAG Retriever for CityCost Editorial Engine.
 * Uses Google Search Grounding via @google/genai on the server side to fetch
 * current cost-of-living, rental prices, transit fares, and municipal statistics.
 *
 * Provenance rules:
 * - A fact is kept only when Gemini's groundingSupports attribute it to at least
 *   one search result; its citation points at exactly those results.
 * - When grounding is unavailable or fails, the result is empty with a status and
 *   reason. No benchmark/fallback figures or source URLs are ever synthesized.
 */

import { GoogleGenAI } from '@google/genai';
import type { GroundedFact, GroundingSource, RagRetrievalResult } from './types.js';

const DEFAULT_RAG_MODEL = 'gemini-3.8-flash';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FACTS = 12;
/** Gemini grounding chunk URIs are redirect links on this host; the title carries the real domain. */
const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

/** Model used for grounded retrieval. Override with RAG_GEMINI_MODEL. */
export function getRagModel(): string {
  return process.env.RAG_GEMINI_MODEL?.trim() || DEFAULT_RAG_MODEL;
}

/** Minimal shape of a Gemini generateContent response that retrieval reads. */
export interface GroundedModelResponse {
  text?: string;
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      groundingSupports?: Array<{
        segment?: { startIndex?: number; endIndex?: number; partIndex?: number; text?: string };
        groundingChunkIndices?: number[];
      }>;
    };
  }>;
}

export type GroundedGenerateFn = (req: {
  model: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<GroundedModelResponse>;

function extractDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'source.web';
  }
}

function sourceDomain(uri: string, title?: string): string {
  const host = extractDomain(uri);
  if (host === GROUNDING_REDIRECT_HOST && title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title.trim())) {
    return title.trim().replace(/^www\./, '');
  }
  return host;
}

function normalizeText(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function categorize(statement: string): GroundedFact['category'] {
  if (/rent|apartment|housing|lease/i.test(statement)) return 'rent';
  if (/transit|metro|subway|bus|train|commute|fare|petrol|gas price/i.test(statement)) return 'transport';
  if (/grocer|food|meal|dining|restaurant/i.test(statement)) return 'groceries';
  if (/utilit|electric|internet|broadband|water|heating/i.test(statement)) return 'utilities';
  if (/\btax\b|income tax|sales tax|vat/i.test(statement)) return 'tax';
  if (/salary|wage|compensation|income/i.test(statement)) return 'salary';
  return 'lifestyle';
}

function extractFigure(statement: string): string | undefined {
  const m = statement.match(
    /(?:[$€£¥₹]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:-|–|to)\s?[$€£¥₹]?\s?\d[\d,]*(?:\.\d+)?)?(?:\s?\/\s?(?:mo|month))?|\d[\d,]*(?:\.\d+)?\s?(?:%|EUR|USD|GBP|JPY|INR|CHF|AUD|CAD)\b)/i
  );
  return m ? m[0].trim() : undefined;
}

function mentions(statement: string, city: string | undefined): boolean {
  if (!city) return false;
  const name = city.split(',')[0].trim().toLowerCase();
  return name.length > 1 && statement.toLowerCase().includes(name);
}

/** Assign a fact to a city only when the statement itself names it. */
function factCity(statement: string, targetCity: string, comparisonCity?: string): string | undefined {
  const a = mentions(statement, targetCity);
  const b = mentions(statement, comparisonCity);
  if (a && !b) return targetCity;
  if (b && !a) return comparisonCity;
  if (!comparisonCity && !b) return targetCity;
  return undefined; // names both cities, or neither in a comparison
}

/**
 * Parse a grounded Gemini response into source-backed facts.
 * Exported for tests; pure (no network).
 */
export function parseGroundedResponse(
  response: GroundedModelResponse,
  ctx: { targetCity: string; comparisonCity?: string; retrievedAt?: string }
): { facts: GroundedFact[]; sources: GroundingSource[]; unsupportedDropped: number } {
  const retrievedAt = ctx.retrievedAt || new Date().toISOString().split('T')[0];
  const meta = response.candidates?.[0]?.groundingMetadata;
  const chunks = meta?.groundingChunks || [];
  const supports = meta?.groundingSupports || [];
  const text = response.text || '';

  // Locate each numbered line by byte offset (segment indices are UTF-8 byte offsets).
  type Line = { statement: string; norm: string; start: number; end: number };
  const lines: Line[] = [];
  let offset = 0;
  for (const rawLine of text.split('\n')) {
    const lineBytes = Buffer.byteLength(rawLine, 'utf8');
    const m = rawLine.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) {
      const statement = m[1].replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
      if (statement.length >= 15) {
        lines.push({ statement, norm: normalizeText(statement), start: offset, end: offset + lineBytes });
      }
    }
    offset += lineBytes + 1; // '\n'
  }

  const validChunk = (i: number) => Number.isInteger(i) && i >= 0 && i < chunks.length && !!chunks[i]?.web?.uri;

  const factsRaw: Array<{ statement: string; chunkIdx: number[] }> = [];
  let unsupportedDropped = 0;
  for (const line of lines) {
    const idx = new Set<number>();
    for (const s of supports) {
      const seg = s.segment;
      if (!seg) continue;
      const byOffset =
        (seg.partIndex == null || seg.partIndex === 0) &&
        typeof seg.startIndex === 'number' &&
        typeof seg.endIndex === 'number' &&
        seg.startIndex < line.end &&
        seg.endIndex > line.start;
      const segNorm = seg.text ? normalizeText(seg.text) : '';
      const byText = segNorm.length >= 12 && (line.norm.includes(segNorm) || segNorm.includes(line.norm));
      if (!byOffset && !byText) continue;
      for (const ci of s.groundingChunkIndices || []) if (validChunk(ci)) idx.add(ci);
    }
    // Only quantified, source-backed statements become facts.
    if (idx.size === 0 || !/\d/.test(line.statement)) {
      unsupportedDropped++;
      continue;
    }
    factsRaw.push({ statement: line.statement, chunkIdx: [...idx].sort((a, b) => a - b) });
    if (factsRaw.length >= MAX_FACTS) break;
  }

  // Number only the sources that back a kept fact, in first-use order.
  const chunkToId = new Map<number, number>();
  const sources: GroundingSource[] = [];
  for (const f of factsRaw) {
    for (const ci of f.chunkIdx) {
      if (chunkToId.has(ci)) continue;
      const web = chunks[ci].web!;
      const id = sources.length + 1;
      chunkToId.set(ci, id);
      const domain = sourceDomain(web.uri!, web.title);
      sources.push({
        id,
        title: web.title || domain,
        url: web.uri!,
        domain,
        retrievedAt,
      });
    }
  }

  const facts: GroundedFact[] = factsRaw.map((f) => {
    const sourceIds = f.chunkIdx.map((ci) => chunkToId.get(ci)!);
    return {
      category: categorize(f.statement),
      statement: f.statement,
      city: factCity(f.statement, ctx.targetCity, ctx.comparisonCity),
      figure: extractFigure(f.statement),
      sourceId: sourceIds[0],
      sourceIds,
      citationRef: `[^${sourceIds[0]}]`,
    };
  });

  return { facts, sources, unsupportedDropped };
}

function defaultGenerate(apiKey: string, timeoutMs: number): GroundedGenerateFn {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return async ({ model, prompt, signal }) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        abortSignal: signal,
      },
    });
    return response as unknown as GroundedModelResponse;
  };
}

/**
 * Executes Live Google Search Grounding retrieval for city cost inquiry.
 * Never throws for provider problems — returns status `unavailable` / `error` instead.
 */
export async function retrieveGroundedCityCostData(params: {
  targetCity: string;
  comparisonCity?: string;
  topicTitle?: string;
  category?: string;
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Test seam: replaces the Gemini call. */
  generate?: GroundedGenerateFn;
}): Promise<RagRetrievalResult> {
  const { targetCity, comparisonCity, topicTitle } = params;
  const apiKey = params.apiKey || process.env.GEMINI_API_KEY;
  const model = getRagModel();
  const currentYear = new Date().getFullYear();

  const primaryQuery = comparisonCity
    ? `average 1 bedroom apartment rent ${targetCity} vs ${comparisonCity} ${currentYear}`
    : `current cost of living in ${targetCity} ${currentYear} average rent utilities groceries transit`;

  const base = {
    query: primaryQuery,
    targetCity,
    comparisonCity,
    sources: [] as GroundingSource[],
    facts: [] as GroundedFact[],
    factLines: [] as string[],
    unsupportedDropped: 0,
    retrievalTimestamp: new Date().toISOString(),
    model,
  };

  if (!apiKey && !params.generate) {
    return { ...base, status: 'unavailable', error: 'GEMINI_API_KEY is not configured — live grounding disabled.' };
  }

  const places = comparisonCity ? `${targetCity} and ${comparisonCity}` : targetCity;
  const prompt = `Research current ${currentYear} cost-of-living data for: ${topicTitle || primaryQuery}.
Location(s): ${places}. Only report figures for ${places}; never substitute another city.
Focus on:
1. Median/average 1-bedroom and 2-bedroom apartment rents.
2. Monthly public transit pass cost and commuting expenses.
3. Monthly utilities (electricity, water, heating, broadband).
4. Typical grocery basket costs and dining out averages.
5. Local taxation (income tax, sales tax/VAT) and median salary.

Return a numbered list of 8-12 statements. Each statement must name the city it refers to, contain an exact number with currency or unit, and come from a search result. Omit any item you cannot source.`;

  try {
    const generate = params.generate || defaultGenerate(apiKey!, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const response = await generate({ model, prompt, signal: params.signal });
    const { facts, sources, unsupportedDropped } = parseGroundedResponse(response, {
      targetCity,
      comparisonCity,
    });
    const factLines = facts.map((f) => `${f.citationRef} ${f.statement}`);
    if (!facts.length) {
      return {
        ...base,
        unsupportedDropped,
        status: 'no_evidence',
        error: 'Grounding returned no source-backed figures for this location.',
      };
    }
    return { ...base, sources, facts, factLines, unsupportedDropped, status: 'live' };
  } catch (err) {
    if (params.signal?.aborted) throw err;
    const message = ((err as Error)?.message || String(err)).slice(0, 300);
    console.warn(`⚠️ RAG grounding failed (model=${model}): ${message}`);
    return { ...base, status: 'error', error: message };
  }
}
