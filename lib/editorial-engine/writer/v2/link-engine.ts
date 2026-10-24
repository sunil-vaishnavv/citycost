/**
 * Internal Link Engine — mandatory Writer stage.
 *
 * Responsibilities:
 * 1. Naturalize slug/CTA anchors → human labels (Pune not city-pune-…)
 * 2. Count CityCost path mentions with the SAME regex as draft-validate
 * 3. generateMissingLinks when below floor — repair, never full regen
 * 4. Cap density per body section (max 2–3)
 *
 * Runs AFTER humanization / similarity / CQ / helpfulness body rewrites
 * (those stages can strip markdown links). Last content mutation before
 * Quality Audit.
 */

import { normalizeSiteLinks, routeLabel } from './link-normalize.js';
import {
  countCityCostPathMentions,
  MIN_CITYCOST_PATH_MENTIONS,
  type DraftBlock,
  type WriterDraftPayload,
} from '../draft-validate.js';
import { isProtectedBlock } from './block-integrity.js';
import { draftSectionChunks } from './section-chunks.js';
import { blockPlain } from './content-quality/text-metrics.js';
import {
  filterRelevantHrefs,
  internalLinkFloor,
  judgeLink,
  resolveSiteRoute,
  type LinkGeoScope,
} from './link-relevance.js';

export interface NaturalLinkReport {
  natural_anchors_fixed: number;
  sections_touched: string[];
  links_trimmed: number;
}

export interface LinkEngineReport extends NaturalLinkReport {
  /** Path mentions after stage (draft-validate counting). */
  path_mentions: number;
  /** New markdown links created by generateMissingLinks. */
  links_created: number;
  /** Paths injected this run. */
  paths_injected: string[];
  /** Repair attempts used to reach minimum. */
  repair_rounds: number;
  /** Links unlinked because the destination is irrelevant or not a real route. */
  irrelevant_removed?: string[];
  /** Floor applied this run (≤ relevant destinations available). */
  need?: number;
  ok: boolean;
}

const BAD_CTA =
  /^(read more|click here|see guide|learn more|check this out|more here|this page|full guide)$/i;

/** Path/slug-like tokens that should never appear as visible anchor text. */
export const SLUG_ANCHOR_RE =
  /\b(?:city|country|compare|cost-of-living|salary|rent|guide)-[a-z0-9]+(?:-[a-z0-9]+)+\b/gi;

export const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Authority fallbacks — always match draft-validate CITYCOST_PATH_MENTION_RE. */
export const LINK_ENGINE_FALLBACK_HREFS = [
  '/methodology',
  '/data-sources',
] as const;

const STOP_WORDS = new Set([
  'vs',
  'the',
  'and',
  'of',
  'in',
  'to',
  'a',
  'an',
  'for',
  'cost',
  'living',
  'comparison',
  'guide',
  'page',
]);

/** Turn a URL path or slug into a human label. */
export function slugToNaturalLabel(raw: string): string {
  // Verified city / country / compare routes use catalog names ("Sydney", not
  // "Sydney New" from the slug). Authority pages keep their lower-case labels below.
  if (/\/(?:city|country|compare)\//i.test(raw)) {
    const fromCatalog = routeLabel(raw);
    if (fromCatalog) return fromCatalog;
  }
  let s = raw.trim();
  // Strip URL / markdown path
  s = s.replace(/^https?:\/\/[^/]+/i, '');
  s = s.replace(/^\//, '');
  // Take last path segment
  const parts = s.split('/').filter(Boolean);
  let slug = parts[parts.length - 1] || s;
  slug = slug.replace(/\?.*$/, '').replace(/#.*$/, '');

  // Drop known prefixes
  slug = slug.replace(
    /^(?:city|country|compare|cost-of-living|salary|rent|guide|blog)-/i,
    ''
  );

  // compare: a-vs-b → "A vs B"
  if (/-vs-/i.test(slug)) {
    return slug
      .split(/-vs-/i)
      .map((side) => titleCaseTokens(side))
      .join(' vs ');
  }

  // Authority pages
  if (/^methodology$/i.test(slug)) return 'methodology';
  if (/^data-sources$/i.test(slug)) return 'data sources';
  if (/^about$/i.test(slug)) return 'About CityCost';

  const tokens = slug.split(/[-_]+/).filter(Boolean);
  // Prefer first meaningful geo token (city name) over long region tails
  // e.g. pune-maharashtra-india → Pune
  const geoTail = new Set([
    'india',
    'usa',
    'uk',
    'uae',
    'germany',
    'france',
    'spain',
    'portugal',
    'japan',
    'thailand',
    'mexico',
    'canada',
    'australia',
    'brazil',
    'china',
    'italy',
    'netherlands',
    'sweden',
    'poland',
    'maharashtra',
    'karnataka',
    'tamil',
    'nadu',
    'delhi',
    'ncr',
    'state',
    'province',
    'county',
    'region',
  ]);

  if (tokens.length >= 2) {
    const head: string[] = [];
    for (const t of tokens) {
      const low = t.toLowerCase();
      if (geoTail.has(low) && head.length > 0) break;
      if (STOP_WORDS.has(low)) continue;
      head.push(t);
      // City names are usually 1–2 tokens
      if (head.length >= 2) break;
    }
    if (head.length) return titleCaseTokens(head.join('-'));
  }

  return titleCaseTokens(slug);
}

function titleCaseTokens(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => {
      if (w.toLowerCase() === 'vs') return 'vs';
      if (w.length <= 3 && w === w.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function contextualAnchor(label: string, surrounding: string): string {
  const clean = label.trim();
  if (!clean) return 'this CityCost page';
  if (BAD_CTA.test(clean)) {
    // Prefer entity name from surrounding if mentioned
    const m = surrounding.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/);
    return m?.[1] || clean;
  }
  return clean;
}

export function naturalizeLinkText(text: string): { text: string; fixed: number } {
  let fixed = 0;
  let out = text.replace(MARKDOWN_LINK_RE, (full, anchor: string, href: string) => {
    let nextAnchor = anchor;
    if (
      BAD_CTA.test(anchor.trim()) ||
      SLUG_ANCHOR_RE.test(anchor) ||
      (/[-_]/.test(anchor) && /(?:city|country|compare)/i.test(anchor))
    ) {
      SLUG_ANCHOR_RE.lastIndex = 0;
      nextAnchor = slugToNaturalLabel(href || anchor);
      nextAnchor = contextualAnchor(nextAnchor, text);
      if (nextAnchor !== anchor) fixed += 1;
    } else if (/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i.test(anchor.trim())) {
      // Bare multi-segment slug as anchor
      nextAnchor = slugToNaturalLabel(anchor);
      fixed += 1;
    }
    return `[${nextAnchor}](${href})`;
  });

  // Bare slug tokens in visible prose (not inside markdown already handled)
  out = out.replace(SLUG_ANCHOR_RE, (slug) => {
    fixed += 1;
    return slugToNaturalLabel(slug);
  });

  return { text: out, fixed };
}

function transformBlockContent(content: unknown): { content: unknown; fixed: number } {
  if (typeof content === 'string') {
    const r = naturalizeLinkText(content);
    return { content: r.text, fixed: r.fixed };
  }
  if (Array.isArray(content)) {
    let fixed = 0;
    const next = content.map((item) => {
      if (typeof item === 'string') {
        const r = naturalizeLinkText(item);
        fixed += r.fixed;
        return r.text;
      }
      if (item && typeof item === 'object') {
        const o = { ...(item as Record<string, unknown>) };
        for (const key of ['q', 'a', 'question', 'answer', 'label', 'text']) {
          if (typeof o[key] === 'string') {
            const r = naturalizeLinkText(o[key] as string);
            o[key] = r.text;
            fixed += r.fixed;
          }
        }
        return o;
      }
      return item;
    });
    return { content: next, fixed };
  }
  return { content, fixed: 0 };
}

const MAX_LINKS_PER_SECTION = 3;

function countMarkdownLinks(text: string): number {
  return (text.match(MARKDOWN_LINK_RE) || []).length;
}

function trimExcessLinks(text: string, max: number): { text: string; trimmed: number } {
  let count = 0;
  let trimmed = 0;
  const next = text.replace(MARKDOWN_LINK_RE, (full, anchor: string, href: string) => {
    count += 1;
    if (count <= max) return `[${anchor}](${href})`;
    trimmed += 1;
    // Keep natural name, drop the link
    return anchor;
  });
  return { text: next, trimmed };
}

/**
 * Fix slug anchors across body blocks; trim to max 2–3 links per section.
 */
export function applyNaturalLinks(draft: WriterDraftPayload): {
  draft: WriterDraftPayload;
  report: NaturalLinkReport;
} {
  const blocks = [...(draft.blocks || [])];
  let natural_anchors_fixed = 0;
  let links_trimmed = 0;
  const sections_touched = new Set<string>();

  // First pass: naturalize all body (and lightly protected FAQ answers if sluggy)
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b) continue;
    // Body only for structural integrity — do not mutate intro/toc/faq/summary structure
    if (isProtectedBlock(b)) {
      // Still scrub slug anchors inside FAQ answers (visible text) without changing block type
      if (b.type === 'faq') {
        const r = transformBlockContent(b.content);
        if (r.fixed) {
          blocks[i] = { ...b, content: r.content };
          natural_anchors_fixed += r.fixed;
          sections_touched.add('faq');
        }
      }
      continue;
    }
    const r = transformBlockContent(b.content);
    if (r.fixed) {
      blocks[i] = { ...b, content: r.content };
      natural_anchors_fixed += r.fixed;
    }
  }

  // Second pass: enforce max links per section on body
  const chunks = draftSectionChunks({ ...draft, blocks });
  for (const chunk of chunks) {
    let sectionLinkCount = 0;
    for (const id of chunk.bodyIds) {
      const idx = blocks.findIndex((b) => b.id === id);
      if (idx < 0) continue;
      const b = blocks[idx];
      if (!b || typeof b.content !== 'string') continue;
      const linksHere = countMarkdownLinks(b.content);
      if (sectionLinkCount + linksHere <= MAX_LINKS_PER_SECTION) {
        sectionLinkCount += linksHere;
        continue;
      }
      const remaining = Math.max(0, MAX_LINKS_PER_SECTION - sectionLinkCount);
      const trimmed = trimExcessLinks(b.content, remaining);
      blocks[idx] = { ...b, content: trimmed.text };
      links_trimmed += trimmed.trimmed;
      sectionLinkCount = MAX_LINKS_PER_SECTION;
      if (trimmed.trimmed) sections_touched.add(chunk.heading);
    }
  }

  if (natural_anchors_fixed > 0) {
    for (const c of chunks) sections_touched.add(c.heading);
  }

  return {
    draft: { ...draft, blocks },
    report: {
      natural_anchors_fixed,
      sections_touched: [...sections_touched],
      links_trimmed,
    },
  };
}

/** Visible text still contains slug-style anchors? */
export function hasVisibleSlugAnchors(draft: WriterDraftPayload): boolean {
  for (const b of draft.blocks || []) {
    const text = blockPlain(b);
    // Check markdown anchors
    MARKDOWN_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = re.exec(text)) !== null) {
      const anchor = m[1] || '';
      if (BAD_CTA.test(anchor.trim())) return true;
      if (SLUG_ANCHOR_RE.test(anchor)) return true;
      SLUG_ANCHOR_RE.lastIndex = 0;
      if (/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i.test(anchor.trim())) return true;
    }
    SLUG_ANCHOR_RE.lastIndex = 0;
    if (SLUG_ANCHOR_RE.test(text)) return true;
  }
  return false;
}

function normalizeHref(href: string): string {
  const h = href.trim();
  if (!h) return '';
  if (h.startsWith('/')) return h.split(/[\s)]/)[0] || h;
  return '';
}

function isCountableHref(href: string): boolean {
  const h = normalizeHref(href);
  if (!h || h === '/') return false;
  // Must produce ≥1 draft-validate path mention when placed in prose
  return countCityCostPathMentions({
    seo_title: '',
    meta_title: '',
    meta_description: '',
    excerpt: '',
    blocks: [{ id: 't', type: 'paragraph', content: `[x](${h})` }],
  }) >= 1;
}

export function resolveLinkCandidates(candidates: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of [...candidates, ...LINK_ENGINE_FALLBACK_HREFS]) {
    const h = normalizeHref(c);
    if (!h || seen.has(h) || !isCountableHref(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

export interface InternalLinkValidation {
  ok: boolean;
  count: number;
  need: number;
  missing: number;
}

/** Same floor as validateWriterDraft — never lower the threshold here. */
export function validateInternalLinks(
  draft: WriterDraftPayload,
  need: number = MIN_CITYCOST_PATH_MENTIONS
): InternalLinkValidation {
  const count = countCityCostPathMentions(draft);
  return {
    ok: count >= need,
    count,
    need,
    missing: Math.max(0, need - count),
  };
}

/** Contextual sentence per destination type — avoids repeating one generic CTA. */
function naturalLinkSentence(href: string, variant: number): string {
  const label = slugToNaturalLabel(href);
  const route = resolveSiteRoute(href);
  if (route?.kind === 'static' && route.href === '/methodology') {
    return ` How these estimates are built is explained in our [methodology](${href}).`;
  }
  if (route?.kind === 'static' && route.href === '/data-sources') {
    return ` The underlying sources are listed on the [data sources page](${href}).`;
  }
  if (route?.kind === 'city') {
    return variant % 2
      ? ` Current item prices are on the [${label} cost of living page](${href}).`
      : ` For a fuller price breakdown, see [${label} living costs](${href}).`;
  }
  if (route?.kind === 'country') return ` National averages are summarised in the [${label} overview](${href}).`;
  if (route?.kind === 'compare') return ` A side-by-side view is in [${label}](${href}).`;
  return ` See [${label}](${href}).`;
}

function appendNaturalLink(content: unknown, href: string, variant = 0): unknown {
  const sentence = naturalLinkSentence(href, variant);
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
}

function blockHasPathMention(block: DraftBlock): boolean {
  return countCityCostPathMentions({
    seo_title: '',
    meta_title: '',
    meta_description: '',
    excerpt: '',
    blocks: [block],
  }) > 0;
}

function eligibleBodyIndices(blocks: DraftBlock[]): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || isProtectedBlock(b)) continue;
    if (b.type === 'heading' || b.type === 'table') continue;
    if (typeof b.content === 'string' && b.content.trim()) {
      idxs.push(i);
    } else if (b.content && typeof b.content === 'object' && !Array.isArray(b.content)) {
      const o = b.content as Record<string, unknown>;
      if (Array.isArray(o.headers) || Array.isArray(o.rows)) continue;
      const hasTextKey = ['text', 'body', 'html', 'markdown', 'content'].some(
        (k) => typeof o[k] === 'string' && (o[k] as string).trim()
      );
      if (hasTextKey) idxs.push(i);
    }
  }
  return idxs;
}

/**
 * Insert only the missing markdown links into body sections.
 * Never touches intro / toc / faq / summary. Never regenerates the article.
 */
export function generateMissingLinks(
  draft: WriterDraftPayload,
  candidates: string[],
  need: number = MIN_CITYCOST_PATH_MENTIONS
): {
  draft: WriterDraftPayload;
  created: number;
  paths_injected: string[];
} {
  const hrefs = resolveLinkCandidates(candidates);
  const blocks = [...(draft.blocks || [])];
  let created = 0;
  const paths_injected: string[] = [];
  let guard = 0;

  while (countCityCostPathMentions({ ...draft, blocks }) < need && guard < 24) {
    guard += 1;
    if (!hrefs.length) break;

    const href = hrefs[(created + guard) % hrefs.length]!;
    const eligible = eligibleBodyIndices(blocks);
    if (!eligible.length) break;

    // Prefer paragraphs that do not already contain a path mention
    let idx =
      eligible.find((i) => !blockHasPathMention(blocks[i]!)) ??
      eligible[created % eligible.length]!;

    const block = blocks[idx]!;
    // Respect per-section density roughly: skip if this string already has many md links
    if (typeof block.content === 'string' && countMarkdownLinks(block.content) >= MAX_LINKS_PER_SECTION) {
      const alt = eligible.find(
        (i) =>
          i !== idx &&
          typeof blocks[i]?.content === 'string' &&
          countMarkdownLinks(blocks[i]!.content as string) < MAX_LINKS_PER_SECTION
      );
      if (alt == null) {
        // Still inject — floor is more important than density; trim pass will cap later
      } else {
        idx = alt;
      }
    }

    const target = blocks[idx]!;
    blocks[idx] = {
      ...target,
      content: appendNaturalLink(target.content, href, created) as DraftBlock['content'],
    };
    created += 1;
    paths_injected.push(href);
  }

  return {
    draft: { ...draft, blocks },
    created,
    paths_injected,
  };
}

export interface RunInternalLinkEngineInput {
  draft: WriterDraftPayload;
  /** Research / curated hrefs — authority fallbacks always appended. */
  candidates?: string[];
  min?: number;
  /** Max repair rounds of generateMissingLinks (default 3). */
  max_repair_rounds?: number;
  /**
   * Article geography. When set, links to irrelevant / non-existent routes are
   * unlinked, only relevant candidates are injected, and the floor never exceeds
   * the number of relevant destinations.
   */
  scope?: LinkGeoScope;
}

const SITE_LINK_RE = /\[([^\]]+)\]\(((?:https?:\/\/(?:www\.)?citycost\.online)?\/[^)\s]*)\)/gi;

/** Replace irrelevant / non-existent internal links with their plain anchor text. */
/**
 * Reconcile every site link with verified CityCost routes (see link-normalize.ts):
 * placeholder hosts, non-existent or irrelevant routes are unlinked (text kept),
 * slug-derived anchors get catalog names. `scope` null = route checks only.
 */
export function unlinkIrrelevantLinks(
  draft: WriterDraftPayload,
  scope: LinkGeoScope | null
): { draft: WriterDraftPayload; removed: string[]; relabelled: number } {
  const removed: string[] = [];
  let relabelled = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = normalizeSiteLinks(v, scope);
      for (const f of r.fixes) {
        if (f.kind === 'slug_label') relabelled += 1;
        else removed.push(f.href);
      }
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val);
      return o;
    }
    return v;
  };
  const blocks = (draft.blocks || []).map((b) => ({ ...b, content: walk(b.content) as DraftBlock['content'] }));
  return { draft: { ...draft, blocks }, removed, relabelled };
}

/**
 * Mandatory Writer stage: naturalize → validate → repair missing links → re-validate.
 * Never fails immediately on missing links — repairs first; fails only if still short.
 */
export function runInternalLinkEngine(input: RunInternalLinkEngineInput): {
  draft: WriterDraftPayload;
  report: LinkEngineReport;
} {
  const maxRounds = input.max_repair_rounds ?? 3;
  let candidates = resolveLinkCandidates(input.candidates || []);
  let draft = input.draft;
  let irrelevant_removed: string[] = [];
  let need = input.min ?? MIN_CITYCOST_PATH_MENTIONS;
  {
    const un = unlinkIrrelevantLinks(draft, input.scope || null);
    draft = un.draft;
    irrelevant_removed = un.removed;
    if (input.scope) {
      candidates = filterRelevantHrefs(candidates, input.scope);
      need = Math.min(need, internalLinkFloor(candidates.length));
    }
  }

  let natural_anchors_fixed = 0;
  let links_trimmed = 0;
  const sections_touched = new Set<string>();
  let links_created = 0;
  const paths_injected: string[] = [];
  let repair_rounds = 0;

  // 1. Naturalize existing anchors
  {
    const nat = applyNaturalLinks(draft);
    draft = nat.draft;
    natural_anchors_fixed += nat.report.natural_anchors_fixed;
    links_trimmed += nat.report.links_trimmed;
    for (const s of nat.report.sections_touched) sections_touched.add(s);
  }

  // 2. Repair until floor met (or rounds exhausted)
  let validation = validateInternalLinks(draft, need);
  while (!validation.ok && repair_rounds < maxRounds) {
    repair_rounds += 1;
    const gen = generateMissingLinks(draft, candidates, need);
    draft = gen.draft;
    links_created += gen.created;
    paths_injected.push(...gen.paths_injected);

    const nat = applyNaturalLinks(draft);
    draft = nat.draft;
    natural_anchors_fixed += nat.report.natural_anchors_fixed;
    links_trimmed += nat.report.links_trimmed;
    for (const s of nat.report.sections_touched) sections_touched.add(s);

    validation = validateInternalLinks(draft, need);
    if (gen.created === 0) break; // cannot place more links
  }

  const path_mentions = validation.count;
  return {
    draft,
    report: {
      natural_anchors_fixed,
      sections_touched: [...sections_touched],
      links_trimmed,
      path_mentions,
      links_created,
      paths_injected,
      repair_rounds,
      irrelevant_removed,
      need,
      ok: validation.ok,
    },
  };
}

export function formatLinkEngineDebug(report: LinkEngineReport): string {
  return [
    `path_mentions=${report.path_mentions}`,
    `links_created=${report.links_created}`,
    `repair_rounds=${report.repair_rounds}`,
    `anchors_fixed=${report.natural_anchors_fixed}`,
    `trimmed=${report.links_trimmed}`,
    `need=${report.need ?? MIN_CITYCOST_PATH_MENTIONS}`,
    `irrelevant_removed=${report.irrelevant_removed?.length ?? 0}`,
    `ok=${report.ok ? 'yes' : 'no'}`,
    report.paths_injected.length
      ? `injected=${report.paths_injected.slice(0, 6).join('|')}`
      : 'injected=none',
  ].join(';');
}
