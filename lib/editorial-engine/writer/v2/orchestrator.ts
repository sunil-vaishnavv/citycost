/**
 * Writer Engine v2 Orchestrator — Brain → Guide sections → FAQ/Summary →
 * Humanize → Similarity → Content Quality Engine → Helpfulness Pipeline →
 * Internal Link Engine → Pre-save Quality Gates (Final Sanitizer last) →
 * Quality Audit → Save.
 */

import { WRITER_ENGINE_VERSION } from '../../constants.js';
import { cleanEditorialTitle } from '../../utils/clean-title.js';
import {
  countDraftWords,
  sanitizeBlocks,
  type DraftBlock,
  type WriterDraftPayload,
} from '../draft-validate.js';
import { curatedLinksForWriter } from '../link-validate.js';
import type { ResearchPack } from '../research-engine.js';
import {
  ensureDraftIntegrity,
  formatIntegrityMeta,
  isProtectedBlock,
  logBlockAudit,
  mergeWithProtected,
  snapshotProtected,
  splitProtectedBlocks,
  type DraftIntegrityReport,
  type ProtectedSnapshot,
} from './block-integrity.js';
import { buildEditorialPlan } from './editorial-brain.js';
import { humanizeDeterministic, humanizeWithAi } from './humanization.js';
import { applyGapToSection, detectKnowledgeGaps } from './knowledge-gap/detector.js';
import { buildFactsDigest, sanitizePromptText } from './prompt-sanitizer.js';
import { repairPromptLeakage } from './leakage-repair.js';
import {
  allocateWordBudgets,
  applyWordBudgetToOutline,
  formatWordBudgetDebug,
} from './word-budget.js';
import {
  expandSectionToMin,
  type SectionActual,
} from './word-expand.js';
import { runQualityAudit } from './quality-audit.js';
import {
  formatQualityDebug,
  runContentQualityEngine,
} from './content-quality/index.js';
import {
  formatHelpfulnessDebug,
  runHelpfulnessPipeline,
} from './helpfulness-pipeline.js';
import {
  formatLinkEngineDebug,
  runInternalLinkEngine,
} from './link-engine.js';
import {
  formatQualityGatesDebug,
  runPreSaveQualityGates,
} from './quality-gates.js';
import { memoryDigestForPrompt, createContentMemory, rememberSection } from './content-memory.js';
import { assertGuideSpecificWriter, getGuideSectionWriter } from './sections/registry.js';
import { buildDeterministicFaqItems } from '../../faq/faq-deterministic.js';
import { runSimilarityEngine, similarityNeedsRewrite } from './similarity/engine.js';
import type { EditorialPlan, WriterV2Result } from './types.js';
import type { DraftJobStage, DraftProgressEvent } from '../../jobs/draft-job-types.js';
import { expandDraftToMinWords } from '../../revision/revision-validator.js';
import {
  categorizeWriterError,
  sanitizeWriterErrorMessage,
} from '../writer-error.js';

const SECTION_CONCURRENCY = 3;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Cancelled by user');
    err.name = 'AbortError';
    throw err;
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function emptyDraft(title: string): WriterDraftPayload {
  const t = cleanEditorialTitle(title);
  return {
    seo_title: t.slice(0, 70),
    meta_title: t.slice(0, 60),
    meta_description: `Practical cost-of-living guide: ${t}`.slice(0, 160),
    excerpt: `Cost planning notes for ${t}`.slice(0, 220),
    blocks: [],
  };
}

function tocBlock(outlineHeadings: string[]): DraftBlock {
  return {
    id: 'toc',
    type: 'list',
    heading: 'Table of contents',
    content: outlineHeadings.map((h) => h),
  };
}

/** Compact FAQ/summary presence for stage logs after FAQ generation. */
function structuralPresenceMeta(draft: WriterDraftPayload): string {
  const blocks = draft.blocks || [];
  const faqs = blocks.filter((b) => b.type === 'faq');
  const faq = faqs[0];
  let faq_schema: 'qa_array' | 'string' | 'other' | 'missing' = 'missing';
  if (faq) {
    if (Array.isArray(faq.content)) faq_schema = 'qa_array';
    else if (typeof faq.content === 'string') faq_schema = 'string';
    else faq_schema = 'other';
  }
  return [
    `faq_present=${faqs.length > 0 ? 'yes' : 'no'}`,
    `faq_count=${faqs.length}`,
    `faq_type=${faq?.type ?? 'none'}`,
    `faq_schema=${faq_schema}`,
    `summary_present=${blocks.some((b) => b.type === 'summary') ? 'yes' : 'no'}`,
    `draft_blocks=${blocks.length}`,
  ].join(';');
}

/**
 * After every mutating stage: audit blocks, restore protected structure from assembly snapshot.
 */
function applyBlockIntegrity(
  draft: WriterDraftPayload,
  snapshot: ProtectedSnapshot,
  stage: string,
  passes: WriterV2Result['debug']['passes'],
  outlineHeadings?: string[]
): { draft: WriterDraftPayload; report: DraftIntegrityReport } {
  logBlockAudit(stage, draft);
  const ensured = ensureDraftIntegrity(draft, snapshot, { outlineHeadings });
  passes.push({
    kind: `integrity_${stage}`,
    meta: `${formatIntegrityMeta(ensured.report)}${
      ensured.restored.length ? `;restored=${ensured.restored.join(',')}` : ''
    }`,
  });
  return { draft: ensured.draft, report: ensured.report };
}

function parseBlocksFromAi(text: string): DraftBlock[] {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) return [];
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      blocks?: DraftBlock[];
      paragraphs?: string[];
      content?: string;
    };
    if (Array.isArray(parsed.blocks) && parsed.blocks.length) return parsed.blocks;
    if (Array.isArray(parsed.paragraphs)) {
      return parsed.paragraphs
        .filter(Boolean)
        .map((p, i) => ({ id: `p-${i}`, type: 'paragraph' as const, content: p }));
    }
    if (typeof parsed.content === 'string' && parsed.content.trim()) {
      return [{ id: 'p-0', type: 'paragraph', content: parsed.content }];
    }
  } catch {
    /* ignore */
  }
  // Plain prose fallback
  const cleaned = text.replace(/```[\s\S]*?```/g, '').trim();
  if (cleaned.split(/\s+/).length >= 40) {
    return [{ id: 'p-fallback', type: 'paragraph', content: cleaned.slice(0, 4000) }];
  }
  return [];
}

async function writeSection(input: {
  plan: EditorialPlan;
  section: NonNullable<ReturnType<typeof applyGapToSection>>;
  factsDigest: string;
  priorDigests: string[];
  links: Array<{ href: string; label: string }>;
  complete: (system: string, user: string) => Promise<string>;
}): Promise<{ blocks: DraftBlock[]; writerId: string; digest: string }> {
  const writer = getGuideSectionWriter(input.plan.guide_id, input.section.key);
  assertGuideSpecificWriter(writer, input.plan.guide_id, input.section);
  const brief = writer.buildBrief({
    plan: input.plan,
    section: input.section,
    factsDigest: input.factsDigest,
    priorDigests: input.priorDigests,
  });

  const uncertainty =
    input.section.evidence_mode === 'uncertainty'
      ? 'Evidence is thin. Write qualitative guidance and state uncertainty naturally. Do NOT invent numbers.'
      : input.section.evidence_mode === 'shrink'
        ? 'Keep this section shorter. Only use evidenced claims.'
        : '';

  // Content Memory: prior sections already covered — add NEW value only
  const mem = createContentMemory();
  for (const [i, dig] of input.priorDigests.entries()) {
    rememberSection(mem, `prior-${i}`, dig);
  }
  const covered = input.priorDigests.length
    ? memoryDigestForPrompt(mem, 900)
    : '';

  const system = sanitizePromptText(
    [
      `You are ${writer.label}: ${writer.voice}`,
      'Write one article section as JSON.',
      `Aim for ${input.section.min_words}-${input.section.max_words} words (target near ${(input.section.min_words + input.section.max_words) >> 1}).`,
      'Return {"blocks":[{"type":"heading","heading":"...","content":"..."},{"type":"paragraph","content":"..."}, ...]}',
      'No FAQ or Summary here. No prompt/instruction language in prose.',
      'Internal links: optionally weave 0–2 contextual CityCost paths from the link list using natural anchors (never identical CTA wording).',
      'Do NOT re-explain facts, indexes, or examples already covered in prior sections — reference briefly at most and add NEW decision value.',
      uncertainty,
    ].join('\n')
  ).text;

  const user = sanitizePromptText(
    [
      brief,
      covered ? `CONTENT_MEMORY:\n${covered}` : '',
      `LINKS: ${JSON.stringify(input.links.slice(0, 8))}`,
      `Return heading exactly: ${input.section.heading}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  ).text;

  const text = await input.complete(system, user);
  let blocks = parseBlocksFromAi(text);
  if (!blocks.some((b) => b.type === 'heading')) {
    blocks = [
      {
        id: `h-${input.section.key}`,
        type: 'heading',
        heading: input.section.heading,
        content: input.section.heading,
      },
      ...blocks,
    ];
  }
  const digest = blocks
    .map((b) => (typeof b.content === 'string' ? b.content : ''))
    .join(' ')
    .slice(0, 400);
  return { blocks, writerId: writer.id, digest };
}

/**
 * Merge AI-generated FAQ items with deterministic fillers so the block always
 * meets the validator's minimum of 6 items. Keeps the AI's items first and only
 * appends curated fallbacks for the missing count.
 */
function fillFaqToFloor(
  aiFaq: DraftBlock,
  research: ResearchPack,
  aiCount: number
): DraftBlock {
  const MIN_FAQ = 6;
  const aiItems = Array.isArray(aiFaq.content) ? aiFaq.content : [];
  const questions = (research.required_faq?.length
    ? research.required_faq
    : research.searcher_questions || []
  )
    .map((q) => String(q || '').trim())
    .filter(Boolean)
    .slice(0, 10);
  const det = buildDeterministicFaqItems(research, questions);
  const existing = new Set(
    aiItems.map((it) =>
      String((it as { q?: string }).q || '')
        .trim()
        .toLowerCase()
    )
  );
  const extras = det.filter((d) => !existing.has(d.q.trim().toLowerCase()));
  const merged = [...aiItems, ...extras.map((d) => ({ id: d.id, q: d.q, a: d.a }))];
  const result = merged.slice(0, 10);
  console.log(
    `[writer-v2:faq] Padded ${aiCount} AI items to ${result.length} via deterministic fallback (min ${MIN_FAQ}).`
  );
  return { ...aiFaq, content: result };
}

async function writeFaq(input: {
  plan: EditorialPlan;
  draft: WriterDraftPayload;
  factsDigest: string;
  research: ResearchPack;
  complete: (system: string, user: string) => Promise<string>;
}): Promise<DraftBlock> {
  const writer = getGuideSectionWriter(input.plan.guide_id, 'faq');
  const system = sanitizePromptText(
    [
      `You are ${writer.id} FAQ engine.`,
      writer.voice,
      'Generate 6–8 unique FAQ items as JSON {"blocks":[{"type":"faq","heading":"FAQ","content":[{"q":"...","a":"..."}]}]}',
      'Direct answers. Do not reuse article sentences. Search-intent focused.',
      input.plan.persona.faq_framing,
    ].join('\n')
  ).text;
  const user = sanitizePromptText(
    `TITLE=${input.plan.purpose}\nFACTS=${input.factsDigest.slice(0, 4000)}\nSTYLE=${input.plan.style.label}`
  ).text;
  try {
    const text = await input.complete(system, user);
    const blocks = parseBlocksFromAi(text);
    const faq = blocks.find((b) => b.type === 'faq');
    if (faq) {
      const aiCount = Array.isArray(faq.content) ? faq.content.length : 0;
      console.log(
        `[writer-v2:faq] AI generated ${aiCount} FAQ items (need >=6).`
      );
      // Enforce the same >=6 floor the rest of the pipeline guarantees so the
      // draft-validate gate (faq_min_6) never rejects a well-formed AI block.
      if (aiCount >= 6) return faq;
      return fillFaqToFloor(faq, input.research, aiCount);
    }
  } catch {
    /* fall through */
  }
  console.log('[writer-v2:faq] No AI FAQ block; using deterministic fallback.');
  return {
    id: 'faq',
    type: 'faq',
    heading: 'FAQ',
    content: [
      {
        q: `What drives cost of living for this ${input.plan.guide_id} topic?`,
        a: 'Housing usually dominates, then food and transport; use local quotes to validate any index averages.',
      },
      {
        q: 'Should I trust a single monthly total?',
        a: 'No. Build a three-line budget—housing, essentials, lifestyle—and stress-test rent for your neighbourhood.',
      },
      {
        q: 'How should different households read these figures?',
        a: `${input.plan.persona.label} readers should weight ${input.plan.persona.advice_angle.toLowerCase()}.`,
      },
      {
        q: 'What if data looks estimated?',
        a: 'Widen buffers and verify rent, healthcare, and school costs with current local sources.',
      },
      {
        q: 'Where can I compare related places on CityCost?',
        a: 'Use country hubs, city pages, and compare routes on CityCost to keep methodology consistent.',
      },
      {
        q: 'What is a practical next step?',
        a: input.plan.persona.summary_stance,
      },
    ],
  };
}

async function writeSummary(input: {
  plan: EditorialPlan;
  draft: WriterDraftPayload;
  complete: (system: string, user: string) => Promise<string>;
}): Promise<DraftBlock> {
  const writer = getGuideSectionWriter(input.plan.guide_id, 'summary');
  const system = sanitizePromptText(
    [
      `You are ${writer.id} Summary engine.`,
      writer.voice,
      'Return JSON {"blocks":[{"type":"summary","heading":"Summary","content":"..."}]}',
      'Summarize and recommend. Do not repeat the introduction. Do not reuse FAQ answers.',
      input.plan.persona.summary_stance,
    ].join('\n')
  ).text;
  const headings = (input.draft.blocks || [])
    .filter((b) => b.type === 'heading')
    .map((b) => b.heading)
    .join('; ');
  const user = sanitizePromptText(
    `PURPOSE=${input.plan.purpose}\nHEADINGS=${headings}\nPERSONA=${input.plan.persona.label}`
  ).text;
  try {
    const text = await input.complete(system, user);
    const blocks = parseBlocksFromAi(text);
    const sum = blocks.find((b) => b.type === 'summary');
    if (sum) return { ...sum, type: 'summary', heading: sum.heading || 'Summary' };
    if (blocks[0] && typeof blocks[0].content === 'string') {
      return { id: 'summary', type: 'summary', heading: 'Summary', content: blocks[0].content };
    }
  } catch {
    /* fall through */
  }
  return {
    id: 'summary',
    type: 'summary',
    heading: 'Summary',
    content: `${input.plan.persona.summary_stance} Focus on housing, everyday costs, and the constraints that matter for a ${input.plan.persona.label.toLowerCase()}.`,
  };
}

export async function runWriterV2(input: {
  topic: {
    id: number;
    title: string;
    content_type?: string | null;
    persona?: string | null;
    primary_keyword?: string | null;
    angle?: string | null;
    primary_entity?: string | null;
    secondary_entity?: string | null;
    country?: string | null;
    city_a?: string | null;
    city_b?: string | null;
    cluster_id?: string | null;
  };
  research: ResearchPack;
  settings: {
    writer_model: string;
    temperature: number;
    top_p?: number;
    article_length_min: number;
    article_length_max: number;
  };
  complete: (system: string, user: string) => Promise<{
    text: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
  }>;
  signal?: AbortSignal;
  onProgress?: (event: DraftProgressEvent) => void | Promise<void>;
}): Promise<WriterV2Result> {
  const started = Date.now();
  const passes: WriterV2Result['debug']['passes'] = [];
  let tokens_in = 0;
  let tokens_out = 0;
  let currentStage: DraftJobStage = 'loading_ai';

  const emit = async (event: DraftProgressEvent) => {
    throwIfAborted(input.signal);
    if (event.stage) currentStage = event.stage;
    await input.onProgress?.(event);
  };

  const complete = async (system: string, user: string) => {
    throwIfAborted(input.signal);
    const r = await input.complete(system, user);
    tokens_in += r.tokensIn || 0;
    tokens_out += r.tokensOut || 0;
    return r.text;
  };

  try {
    await emit({
      type: 'stage',
      stage: 'editorial_brain',
      message: 'Editorial Brain: selecting persona, style, and guide',
    });
    let plan = buildEditorialPlan({
      topic: input.topic,
      research: input.research,
      depth: 'standard',
    });
    passes.push({
      kind: 'brain',
      meta: `guide=${plan.guide_id};persona=${plan.persona.id};style=${plan.style.id};sections=${plan.outline.length}`,
    });
    await emit({
      type: 'stage',
      stage: 'selecting_guide',
      message: `Guide selected: ${plan.guide_id}`,
      detail: plan.guide_id,
    });
    await emit({
      type: 'stage',
      stage: 'building_outline',
      message: `Outline built (${plan.outline.length} sections)`,
      checkpoint: 'outline',
    });

    const wordBudget = allocateWordBudgets(plan.outline, input.settings.article_length_min);
    plan = {
      ...plan,
      outline: applyWordBudgetToOutline(plan.outline, wordBudget),
    };
    passes.push({ kind: 'word_budget', meta: formatWordBudgetDebug(wordBudget) });
    await emit({
      type: 'log',
      message: `Word budget target ${wordBudget.target_total} (min ${wordBudget.article_min})`,
    });

    const factsDigest = buildFactsDigest(input.research);
    if (/indexed averages/i.test(factsDigest)) {
      throw new Error('Writer v2 prompt build failed: facts digest still contains "indexed averages"');
    }
    passes.push({
      kind: 'facts_digest',
      meta: `chars=${factsDigest.length};has_indexed_averages=false`,
    });
    const gaps = detectKnowledgeGaps(plan.outline, factsDigest);
    const linkHrefs = curatedLinksForWriter(input.research, plan.link_max);
    const links = linkHrefs.map((href) => ({
      href,
      label: href.replace(/^\//, '').replace(/\//g, ' '),
    }));

    let draft = emptyDraft(input.topic.title);
    const outlineHeadings = plan.outline
      .map((s) => applyGapToSection(s, gaps))
      .filter(Boolean)
      .map((s) => s!.heading);

    draft.blocks.push({
      id: 'intro',
      type: 'intro',
      content: '', // filled by first section batch energy — write dedicated intro
    });

    // Intro via overview/first section writer
    const introSection = {
      key: 'overview' as const,
      heading: outlineHeadings[0] || `${cleanEditorialTitle(input.topic.title)} overview`,
      priority: 1,
      min_words: wordBudget.reserve.intro,
      max_words: Math.round(wordBudget.reserve.intro * 1.4),
      evidence_mode: 'full' as const,
      brief: `Write a unique introduction for this article. Target ~${wordBudget.reserve.intro} words. No template hooks.`,
    };
    const introWriter = getGuideSectionWriter(
      plan.guide_id,
      plan.outline[0]?.key === 'overview' ? 'overview' : plan.outline[0]?.key || 'overview'
    );
    assertGuideSpecificWriter(introWriter, plan.guide_id, plan.outline[0] || introSection);

    const introSystem = sanitizePromptText(
      `You are ${introWriter.id}. Write ONLY an intro paragraph JSON {"blocks":[{"type":"intro","content":"..."}]}. Unique, guide-specific, no template clichés. Style=${plan.style.label}. Persona=${plan.persona.label}.`
    ).text;
    const introUser = sanitizePromptText(
      `TITLE=${input.topic.title}\nPURPOSE=${plan.purpose}\nFACTS=${factsDigest.slice(0, 3000)}`
    ).text;
    try {
      const introText = await complete(introSystem, introUser);
      const introBlocks = parseBlocksFromAi(introText);
      const intro = introBlocks.find((b) => b.type === 'intro') || introBlocks[0];
      if (intro && typeof intro.content === 'string') {
        draft.blocks[0] = { id: 'intro', type: 'intro', content: intro.content };
      }
      passes.push({ kind: 'intro', meta: introWriter.id });
    } catch (err) {
      draft.blocks[0] = {
        id: 'intro',
        type: 'intro',
        content: `${plan.purpose} This guide focuses on practical cost trade-offs for a ${plan.persona.label.toLowerCase()}.`,
      };
      passes.push({
        kind: 'intro',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const priorDigests: string[] = [];
    const sectionWriterIds: string[] = [introWriter.id];
    const sectionActuals: SectionActual[] = [];

    // Intro self-expand to budget (before TOC)
    {
      const expandedIntro = await expandSectionToMin({
        blocks: [draft.blocks[0]],
        section: introSection,
        min_words: wordBudget.reserve.intro,
        factsDigest,
        guideId: plan.guide_id,
        readerLabel: plan.persona.label,
        complete,
      });
      const [first, ...rest] = expandedIntro.blocks;
      draft.blocks = [
        { ...(first || draft.blocks[0]), id: 'intro', type: 'intro' },
        ...rest.map((b, i) => ({ ...b, id: b.id || `intro-x-${i}` })),
      ];
      sectionActuals.push({
        key: 'intro',
        heading: 'Introduction',
        target: wordBudget.reserve.intro,
        min: wordBudget.reserve.intro,
        actual: expandedIntro.actual,
        expansions: expandedIntro.expansions,
      });
      passes.push({
        kind: 'intro_expand',
        meta: `words=${expandedIntro.actual};exp=${expandedIntro.expansions}`,
      });
    }

    draft.blocks.push(tocBlock(outlineHeadings));

    await emit({
      type: 'stage',
      stage: 'writing_sections',
      message: 'Writing sections…',
      section_label: 'Introduction',
    });

    const bodySections = plan.outline
      .filter((raw) => raw.key !== 'summary' && raw.key !== 'faq')
      .map((raw) => applyGapToSection(raw, gaps))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

    // Parallel independent body sections (concurrency 3); intro already written.
    const sectionResults = await mapPool(bodySections, SECTION_CONCURRENCY, async (section) => {
      throwIfAborted(input.signal);
      await emit({
        type: 'section',
        stage: 'writing_sections',
        section_label: section.heading || section.key,
        message: `Writing section ${section.heading || section.key}`,
        progress_pct: Math.min(
          60,
          25 + Math.round((sectionWriterIds.length / Math.max(bodySections.length + 1, 1)) * 35)
        ),
      });
      const t0 = Date.now();
      try {
        let written = await writeSection({
          plan,
          section,
          factsDigest,
          priorDigests: [...priorDigests],
          links,
          complete,
        });
        const expanded = await expandSectionToMin({
          blocks: written.blocks,
          section,
          min_words: section.min_words,
          factsDigest,
          guideId: plan.guide_id,
          readerLabel: plan.persona.label,
          complete,
        });
        written = {
          ...written,
          blocks: expanded.blocks,
          digest: expanded.blocks
            .map((b) => (typeof b.content === 'string' ? b.content : ''))
            .join(' ')
            .slice(0, 400),
        };
        return {
          ok: true as const,
          section,
          written,
          actual: expanded.actual,
          expansions: expanded.expansions,
          latency_ms: Date.now() - t0,
        };
      } catch (err) {
        return {
          ok: false as const,
          section,
          error: err instanceof Error ? err.message : String(err),
          latency_ms: Date.now() - t0,
        };
      }
    });

    for (const result of sectionResults) {
      if (result.ok) {
        draft.blocks.push(...result.written.blocks);
        priorDigests.push(result.written.digest);
        sectionWriterIds.push(result.written.writerId);
        sectionActuals.push({
          key: result.section.key,
          heading: result.section.heading,
          target: result.section.min_words,
          min: result.section.min_words,
          actual: result.actual,
          expansions: result.expansions,
        });
        passes.push({
          kind: 'section',
          meta: `${result.written.writerId};words=${result.actual};exp=${result.expansions}`,
          latency_ms: result.latency_ms,
        });
      } else {
        passes.push({
          kind: 'section',
          meta: `${plan.guide_id}.${result.section.key}`,
          error: result.error,
          latency_ms: result.latency_ms,
        });
      }
    }

    // Half-draft checkpoint after body sections
    await emit({
      type: 'checkpoint',
      checkpoint: 'half_draft',
      stage: 'writing_sections',
      message: `Half draft ready (${draft.blocks.length} blocks)`,
    });

    await emit({
      type: 'stage',
      stage: 'generating_faq',
      message: 'Generating FAQ…',
    });
    const faq = await writeFaq({ plan, draft, factsDigest, research: input.research, complete });
    draft.blocks.push(faq);
    sectionWriterIds.push(`${plan.guide_id}.faq`);
    passes.push({
      kind: 'faq',
      meta: `${plan.guide_id}.faq;${structuralPresenceMeta(draft)}`,
    });

    await emit({
      type: 'stage',
      stage: 'generating_summary',
      message: 'Generating Summary…',
    });
    const summary = await writeSummary({ plan, draft, complete });
    draft.blocks.push(summary);
    sectionWriterIds.push(`${plan.guide_id}.summary`);
    passes.push({
      kind: 'summary',
      meta: `${plan.guide_id}.summary;${structuralPresenceMeta(draft)}`,
    });

    draft = { ...draft, blocks: sanitizeBlocks(draft.blocks) };
    passes.push({ kind: 'sanitize_assembly', meta: structuralPresenceMeta(draft) });

    // Freeze protected structural blocks BEFORE any rewrite/merge stage
    const protectedSnapshot = snapshotProtected(draft.blocks);
    {
      const assembled = applyBlockIntegrity(
        draft,
        protectedSnapshot,
        'post_assembly',
        passes,
        outlineHeadings
      );
      draft = assembled.draft;
    }

    // Internal links are injected AFTER humanize/similarity/CQ/helpfulness
    // (those rewrites strip markdown). See runInternalLinkEngine below.

    // Humanization pass 1 (body-only inside humanizeWithAi)
    const humanizeStarted = Date.now();
    await emit({ type: 'stage', stage: 'humanization', message: 'Humanization pass 1…' });
    draft = await humanizeWithAi({
      draft,
      plan,
      pass: 1,
      complete,
    });
    {
      const h1 = applyBlockIntegrity(
        draft,
        protectedSnapshot,
        'humanize_1',
        passes,
        outlineHeadings
      );
      draft = h1.draft;
    }
    passes.push({ kind: 'humanize_1', meta: structuralPresenceMeta(draft) });

    // Multi-layer similarity vs ALL published — body-only rewrite + protected restore
    const simStarted = Date.now();
    await emit({ type: 'stage', stage: 'similarity', message: 'Running similarity checks…' });
    let similarity = await runSimilarityEngine(draft);
    if (similarityNeedsRewrite(similarity)) {
      draft = humanizeDeterministic(draft);
      const snap = snapshotProtected(draft.blocks);
      const effectiveSnap: ProtectedSnapshot = {
        intro: snap.intro || protectedSnapshot.intro,
        toc: snap.toc || protectedSnapshot.toc,
        faq: snap.faq || protectedSnapshot.faq,
        summary: snap.summary || protectedSnapshot.summary,
      };
      const { body } = splitProtectedBlocks(draft.blocks);
      const rewriteSystem = sanitizePromptText(
        [
          'Rewrite ONLY body blocks to reduce similarity to other published guides.',
          'Keep facts. Do NOT include intro, table of contents, faq, or summary.',
          'Do NOT invent block ids like b-1 — omit ids.',
          'Return JSON {"blocks":[{"type":"paragraph","content":"..."},{"type":"heading","heading":"...","content":"..."}, ...]}',
        ].join('\n')
      ).text;
      const rewriteUser = sanitizePromptText(
        `BREACHES=${similarity
          .filter((s) => s.breached)
          .map((s) => s.layer)
          .join(',')}\nBODY=${JSON.stringify({ blocks: body }).slice(0, 12000)}`
      ).text;
      try {
        const text = await complete(rewriteSystem, rewriteUser);
        const blocks = parseBlocksFromAi(text);
        if (blocks.length >= 3) {
          const newBody = sanitizeBlocks(blocks).filter((b) => !isProtectedBlock(b));
          draft = {
            ...draft,
            blocks: mergeWithProtected(newBody, effectiveSnap, protectedSnapshot),
          };
        }
        passes.push({ kind: 'similarity_rewrite', meta: structuralPresenceMeta(draft) });
      } catch (err) {
        passes.push({
          kind: 'similarity_rewrite',
          meta: structuralPresenceMeta(draft),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      {
        const simInt = applyBlockIntegrity(
          draft,
          protectedSnapshot,
          'similarity_rewrite',
          passes,
          outlineHeadings
        );
        draft = simInt.draft;
      }
      similarity = await runSimilarityEngine(draft);
    } else {
      passes.push({ kind: 'similarity_ok', meta: structuralPresenceMeta(draft) });
    }
    const similarity_ms = Date.now() - simStarted;
    await emit({
      type: 'log',
      stage: 'similarity',
      message: `Similarity max score ${Math.max(0, ...similarity.map((s) => s.score)).toFixed(2)}`,
      metrics: { similarity_ms },
    });

    // Humanization pass 2 (after similarity)
    await emit({ type: 'stage', stage: 'humanization', message: 'Humanization pass 2…' });
    draft = await humanizeWithAi({
      draft,
      plan,
      pass: 2,
      complete,
    });
    draft = humanizeDeterministic(draft);
    {
      const h2 = applyBlockIntegrity(
        draft,
        protectedSnapshot,
        'humanize_2',
        passes,
        outlineHeadings
      );
      draft = h2.draft;
    }
    passes.push({ kind: 'humanize_2', meta: structuralPresenceMeta(draft) });
    const humanize_ms = Date.now() - humanizeStarted;
    await emit({ type: 'metrics', metrics: { humanize_ms } });

    // Prompt-leakage repair BEFORE Quality Audit (never weaken the detector)
    const leakRepair = await repairPromptLeakage({ draft, complete });
    {
      const leakInt = applyBlockIntegrity(
        leakRepair.draft,
        protectedSnapshot,
        'leakage_repair',
        passes,
        outlineHeadings
      );
      draft = leakInt.draft;
    }
    passes.push({
      kind: 'leakage_repair',
      meta: `before=${leakRepair.report.before_hits.join('|') || 'none'};after=${leakRepair.report.after_hits.join('|') || 'none'};stripped=${leakRepair.report.stripped_sentences};rewritten=${leakRepair.report.rewritten_blocks}`,
    });
    await emit({
      type: 'log',
      message: leakRepair.report.before_hits.length
        ? `Leakage repair: removed ${leakRepair.report.before_hits.join(', ')} from ${leakRepair.report.rewritten_blocks || leakRepair.report.stripped_sentences} unit(s)`
        : 'Leakage scan clean before audit',
    });

    // ★ Content Quality Engine — AFTER Similarity / BEFORE Quality Audit
    // Owns meaningful expansion; replaces repeat-until-count word padding.
    await emit({
      type: 'log',
      stage: 'quality_audit',
      message: 'Running Content Quality Engine…',
    });
    const cqStarted = Date.now();
    const cq = runContentQualityEngine({
      draft,
      guideId: plan.guide_id,
      country: plan.entities.country,
      city: plan.entities.city,
      articleMinWords: input.settings.article_length_min,
      complete,
    });
    {
      const cqInt = applyBlockIntegrity(
        cq.draft,
        protectedSnapshot,
        'content_quality',
        passes,
        outlineHeadings
      );
      draft = cqInt.draft;
    }
    const contentQualityDebug = formatQualityDebug(cq.report);
    passes.push({
      kind: 'content_quality',
      meta: contentQualityDebug,
      latency_ms: Date.now() - cqStarted,
    });
    await emit({
      type: 'log',
      stage: 'quality_audit',
      message: `Content Quality score ${cq.score}${cq.block_save ? ` — BLOCK SAVE: ${cq.report.block_reasons.join(', ')}` : ''}`,
      metrics: { audit_ms: Date.now() - cqStarted },
    });

    // Legacy word-ensure kept as soft debug only when CQ did not expand enough —
    // never reintroduce fake pad loops (CQ owns expansion).
    const wordEnsure = {
      draft,
      final_words: countDraftWords(draft),
      expansion_rounds: cq.report.expansion_words_added > 0 ? 1 : 0,
      debug: `delegated_to_content_quality|${contentQualityDebug}|words=${countDraftWords(draft)}`,
    };

    if (cq.block_save) {
      passes.push({
        kind: 'content_quality_block',
        meta: cq.report.block_reasons.join('|'),
      });
    }

    // ★ Helpfulness Pipeline — AFTER Content Quality / BEFORE Quality Audit
    await emit({
      type: 'log',
      stage: 'quality_audit',
      message: 'Running Helpfulness Pipeline…',
    });
    const helpStarted = Date.now();
    const knownFacts = factsDigest
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 20)
      .slice(0, 8);
    const help = runHelpfulnessPipeline({
      draft,
      context: {
        guideId: plan.guide_id,
        country: plan.entities.country,
        city: plan.entities.city,
        city_b: plan.entities.city_b,
        known_facts: knownFacts,
      },
    });
    {
      const helpInt = applyBlockIntegrity(
        help.draft,
        protectedSnapshot,
        'helpfulness',
        passes,
        outlineHeadings
      );
      draft = helpInt.draft;
    }
    const helpfulnessDebug = formatHelpfulnessDebug(help.report);
    passes.push({
      kind: 'helpfulness',
      meta: helpfulnessDebug,
      latency_ms: Date.now() - helpStarted,
    });
    passes.push({
      kind: 'helpfulness_examples',
      meta: `added=${help.report.examples_added};sections=${help.report.example?.sections_upgraded.join('|') || 'none'}`,
    });
    passes.push({
      kind: 'helpfulness_decisions',
      meta: `added=${help.report.decision_blocks_added};sections=${help.report.decision?.sections_upgraded.join('|') || 'none'}`,
    });
    passes.push({
      kind: 'helpfulness_tips',
      meta: `added=${help.report.helpful_tips_added};score=${help.report.helpful_score_before}->${help.report.helpful_score_after}`,
    });
    passes.push({
      kind: 'helpfulness_links',
      meta: `anchors_fixed=${help.report.natural_anchors_fixed};trimmed=${help.report.links_trimmed}`,
    });
    await emit({
      type: 'log',
      stage: 'quality_audit',
      message: `Helpfulness: examples=${help.report.examples_added} decisions=${help.report.decision_blocks_added} tips=${help.report.helpful_tips_added}${help.block_save ? ` — BLOCK: ${help.report.block_reasons.join(', ')}` : ''}`,
    });

    if (help.block_save) {
      passes.push({
        kind: 'helpfulness_block',
        meta: help.report.block_reasons.join('|'),
      });
    }

    // ★ Internal Link Engine — mandatory last content mutation before Final Gates.
    // Humanize / similarity / CQ / helpfulness can strip links; repair here only.
    await emit({
      type: 'log',
      stage: 'quality_audit',
      message: 'Running Internal Link Engine…',
    });
    const linkStarted = Date.now();
    const linkEngine = runInternalLinkEngine({
      draft,
      candidates: linkHrefs.length ? linkHrefs : links.map((l) => l.href),
    });
    {
      const linkInt = applyBlockIntegrity(
        linkEngine.draft,
        protectedSnapshot,
        'internal_link_engine',
        passes,
        outlineHeadings
      );
      draft = linkInt.draft;
    }
    const linkEngineDebug = formatLinkEngineDebug(linkEngine.report);
    passes.push({
      kind: 'internal_link_engine',
      meta: linkEngineDebug,
      latency_ms: Date.now() - linkStarted,
    });
    await emit({
      type: 'log',
      stage: 'quality_audit',
      message: `Internal links: ${linkEngine.report.path_mentions} path mentions (created ${linkEngine.report.links_created})${
        linkEngine.report.ok ? '' : ' — below floor after repair'
      }`,
    });

    if (!linkEngine.report.ok) {
      passes.push({
        kind: 'internal_link_engine_fail',
        meta: linkEngineDebug,
      });
    }

    // ★ Pre-save Quality Gates — Cross-section · Human · Helpful/Actionable ·
    // FAQ · Summary · Final Sanitizer (last). Auto-repair; block save on residual fail.
    await emit({
      type: 'log',
      stage: 'quality_audit',
      message: 'Running pre-save quality gates…',
    });
    const gatesStarted = Date.now();
    const gates = runPreSaveQualityGates({
      draft,
      guideId: plan.guide_id,
      country: plan.entities.country,
      city: plan.entities.city,
      city_b: plan.entities.city_b,
      snapshot: protectedSnapshot,
    });
    {
      const gatesInt = applyBlockIntegrity(
        gates.draft,
        protectedSnapshot,
        'quality_gates',
        passes,
        outlineHeadings
      );
      draft = gatesInt.draft;
    }
    // Re-run link engine lightly after gates (sanitizer may touch markdown)
    const linkAfterGates = runInternalLinkEngine({
      draft,
      candidates: linkHrefs.length ? linkHrefs : links.map((l) => l.href),
    });
    {
      const linkInt2 = applyBlockIntegrity(
        linkAfterGates.draft,
        protectedSnapshot,
        'internal_link_engine_post_gates',
        passes,
        outlineHeadings
      );
      draft = linkInt2.draft;
    }
    const qualityGatesDebug = formatQualityGatesDebug(gates.report);
    passes.push({
      kind: 'quality_gates',
      meta: qualityGatesDebug,
      latency_ms: Date.now() - gatesStarted,
    });
    await emit({
      type: 'log',
      stage: 'quality_audit',
      message: `Quality gates ${gates.report.ok ? 'PASS' : `FAIL: ${gates.report.block_reasons.join(', ')}`}`,
    });

    // Word floor — expand deterministically when post-gate draft is still short.
    currentStage = 'quality_audit';
    const wordsBeforeFloor = countDraftWords(draft);
    if (wordsBeforeFloor < input.settings.article_length_min) {
      await emit({
        type: 'log',
        stage: 'quality_audit',
        message: `Word count after quality gates: ${wordsBeforeFloor} (must be ≥ ${input.settings.article_length_min})`,
      });
      const expanded = expandDraftToMinWords(draft, input.settings.article_length_min);
      {
        const floorInt = applyBlockIntegrity(
          expanded.draft,
          protectedSnapshot,
          'word_floor',
          passes,
          outlineHeadings
        );
        draft = floorInt.draft;
      }
      passes.push({
        kind: 'word_floor',
        meta: `before=${wordsBeforeFloor};after=${expanded.words};fixes=${expanded.fixes.join('|') || 'none'}`,
      });
      await emit({
        type: 'log',
        stage: 'quality_audit',
        message: `Word floor applied: ${wordsBeforeFloor} → ${countDraftWords(draft)} words`,
      });
    }

    const auditStarted = Date.now();
    await emit({ type: 'stage', stage: 'quality_audit', message: 'Running quality audit…' });
    const audit = runQualityAudit({
      draft,
      plan,
      similarity,
      knowledge_gaps: gaps,
      section_writer_ids: sectionWriterIds,
      min_words: input.settings.article_length_min,
    });
    passes.push({
      kind: 'audit',
      meta: `${audit.ok ? 'pass' : `fail:${audit.critical.slice(0, 4).join('|')}`};${structuralPresenceMeta(draft)};words=${countDraftWords(draft)}`,
    });
    await emit({
      type: 'metrics',
      metrics: { audit_ms: Date.now() - auditStarted },
      message: audit.ok ? 'Quality audit passed' : `Quality audit: ${audit.critical.slice(0, 4).join('; ')}`,
    });

    // Normalize before save / final audit — Draft Integrity Report in debug
    const preSave = applyBlockIntegrity(
      draft,
      protectedSnapshot,
      'pre_save',
      passes,
      outlineHeadings
    );
    draft = preSave.draft;
    const integrityReport = preSave.report;
    passes.push({
      kind: 'draft_integrity_report',
      meta: formatIntegrityMeta(integrityReport),
    });

    const words = countDraftWords(draft);

    // Re-audit after integrity normalize
    const finalAudit = runQualityAudit({
      draft,
      plan,
      similarity,
      knowledge_gaps: gaps,
      section_writer_ids: sectionWriterIds,
      min_words: input.settings.article_length_min,
    });

    if (
      !finalAudit.ok ||
      integrityReport.integrity === 'FAIL' ||
      cq.block_save ||
      help.block_save ||
      !linkEngine.report.ok ||
      !linkAfterGates.report.ok ||
      gates.report.block_save ||
      words < input.settings.article_length_min
    ) {
      const integrityErrors =
        integrityReport.integrity === 'FAIL'
          ? [
              ...(integrityReport.duplicate_ids.length
                ? [`Duplicate block id: ${integrityReport.duplicate_ids.join(', ')}`]
                : []),
              ...(integrityReport.intro === 'missing' ? ['Missing intro block'] : []),
              ...(integrityReport.toc === 'missing' ? ['Missing table of contents'] : []),
              ...(integrityReport.faq === 'missing' ? ['Missing FAQ block'] : []),
              ...(integrityReport.summary === 'missing' ? ['Missing summary block'] : []),
              ...(!integrityReport.order_valid ? ['Invalid protected block order'] : []),
            ]
          : [];
      const cqErrors = cq.block_save
        ? cq.report.block_reasons.map((r) => `content_quality:${r}`)
        : [];
      const helpErrors = help.block_save
        ? help.report.block_reasons.map((r) => `helpfulness:${r}`)
        : [];
      const linkErrors =
        !linkEngine.report.ok || !linkAfterGates.report.ok
          ? [
              `Missing internal links (found ${linkAfterGates.report.path_mentions}, need ≥ 3 CityCost path mentions after Link Engine repair)`,
            ]
          : [];
      const gateErrors = gates.report.block_save
        ? gates.report.block_reasons.map((r) => `quality_gates:${r}`)
        : [];
      const wordErrors =
        words < input.settings.article_length_min
          ? [`word_count_below_minimum:${words}<${input.settings.article_length_min}`]
          : [];
      return {
        ok: false,
        draft,
        plan,
        audit: finalAudit,
        failed_stage: 'quality_audit',
        error_category: wordErrors.length ? 'word_count' : 'quality_gate',
        errors: [
          ...finalAudit.critical,
          ...integrityErrors,
          ...cqErrors,
          ...helpErrors,
          ...linkErrors,
          ...gateErrors,
          ...wordErrors,
        ],
        message: `Writer v2 quality gate failed: ${[
          ...finalAudit.critical,
          ...integrityErrors,
          ...cqErrors,
          ...helpErrors,
          ...linkErrors,
          ...gateErrors,
          ...wordErrors,
        ]
          .slice(0, 6)
          .join('; ')}`,
        debug: {
          writer_engine: WRITER_ENGINE_VERSION,
          guide_id: plan.guide_id,
          persona: plan.persona.id,
          style: plan.style.id,
          outline_headings: outlineHeadings,
          section_writer_ids: sectionWriterIds,
          word_budget: formatWordBudgetDebug(wordBudget),
          word_ensure: wordEnsure.debug,
          content_quality: contentQualityDebug,
          content_quality_score: cq.score,
          content_quality_report: cq.report,
          helpfulness: helpfulnessDebug,
          helpfulness_report: help.report,
          internal_link_engine: formatLinkEngineDebug(linkAfterGates.report),
          internal_link_report: linkAfterGates.report,
          quality_gates: qualityGatesDebug,
          quality_gates_report: gates.report,
          final_words: words,
          section_actuals: sectionActuals,
          draft_integrity: integrityReport,
          passes,
          tokens_in,
          tokens_out,
          generation_time_ms: Date.now() - started,
          model: input.settings.writer_model,
        },
      };
    }

    return {
      ok: true,
      draft,
      plan,
      audit: finalAudit,
      errors: [],
      message: 'Writer Engine v2 draft ready',
      debug: {
        writer_engine: WRITER_ENGINE_VERSION,
        guide_id: plan.guide_id,
        persona: plan.persona.id,
        style: plan.style.id,
        outline_headings: outlineHeadings,
        section_writer_ids: sectionWriterIds,
        word_budget: formatWordBudgetDebug(wordBudget),
        word_ensure: wordEnsure.debug,
        content_quality: contentQualityDebug,
        content_quality_score: cq.score,
        content_quality_report: cq.report,
        helpfulness: helpfulnessDebug,
        helpfulness_report: help.report,
        internal_link_engine: formatLinkEngineDebug(linkAfterGates.report),
        internal_link_report: linkAfterGates.report,
        quality_gates: qualityGatesDebug,
        quality_gates_report: gates.report,
        final_words: words,
        section_actuals: sectionActuals,
        draft_integrity: integrityReport,
        passes,
        tokens_in,
        tokens_out,
        generation_time_ms: Date.now() - started,
        model: input.settings.writer_model,
      },
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const safeMessage = sanitizeWriterErrorMessage(rawMessage);
    console.error(`[writer-v2] failed at ${currentStage}:`, err);
    return {
      ok: false,
      errors: [safeMessage],
      message: safeMessage,
      failed_stage: currentStage,
      error_category: categorizeWriterError(safeMessage),
      debug: {
        writer_engine: WRITER_ENGINE_VERSION,
        failed_stage: currentStage,
        error_category: categorizeWriterError(safeMessage),
        passes,
        tokens_in,
        tokens_out,
        generation_time_ms: Date.now() - started,
        model: input.settings.writer_model,
      },
    };
  }
}
