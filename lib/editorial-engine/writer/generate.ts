/**
 * Writer Engine entry — public API `generateArticleDraft`.
 * Generation path: Writer Engine v2 orchestrator (Editorial Brain → guide-specific
 * section writers → FAQ/Summary → humanize → similarity → humanize2 → audit).
 * Supports optional background-job progress callbacks and AbortSignal.
 */

import { WRITER_ENGINE_VERSION } from '../constants.js';
import { insertGenerationLog } from '../db/generation-logs-repo.js';
import { getActivePrompt } from '../db/prompts-repo.js';
import { getSettings } from '../db/settings-repo.js';
import {
  getTopicById,
  setTopicStatus,
  unlockTopic,
} from '../db/topics-repo.js';
import { insertDraftArticle, slugExists } from '../db/articles-repo.js';
import type { DraftProgressEvent } from '../jobs/draft-job-types.js';
import { getEditorialRuntime } from '../init.js';
import {
  cleanEditorialSlug,
  cleanEditorialTitle,
  internalTitleLabels,
  toPublicTitle,
} from '../utils/clean-title.js';
import { buildStructuredContext } from './context-pack.js';
import { buildResearchPack, buildGroundedResearchPackAsync } from './research-engine.js';
import { stripUntrustedGrounding } from '../research/rag-trust.js';
import {
  countDraftWords,
  readingTimeMinutes,
  slugifyTitle,
  trimDraftToMaxWords,
  type WriterDraftPayload,
} from './draft-validate.js';
import type { ResearchPack } from './research-engine.js';
import { runWriterV2 } from './v2/orchestrator.js';
import {
  formatGenerateFailureMessage,
  resolveWriterV2Failure,
  sanitizeWriterErrorMessage,
  type WriterErrorCategory,
} from './writer-error.js';

export interface GenerateArticleResult {
  ok: boolean;
  article_id?: number;
  slug?: string;
  word_count?: number;
  reading_time_minutes?: number;
  research_pack?: ResearchPack;
  prompt_version?: number;
  errors?: string[];
  message: string;
  debug?: WriterDebugLog;
}

export interface GenerateArticleOptions {
  signal?: AbortSignal;
  onProgress?: (event: DraftProgressEvent) => void | Promise<void>;
  reuseResearch?: boolean;
  cachedResearch?: unknown;
  jobId?: number;
}

export interface WriterDebugLog {
  prompt_size_chars: number;
  research_pack_size_chars: number;
  system_size_chars: number;
  user_size_chars: number;
  groq_model: string;
  tokens_requested: number;
  tokens_in?: number;
  tokens_out?: number;
  finish_reason?: string | null;
  generation_time_ms: number;
  final_word_count: number;
  validation_failures: string[];
  passes: Array<{
    kind: 'initial' | 'section' | 'expand' | 'retry';
    finish_reason?: string | null;
    tokens_out?: number;
    word_count?: number;
    latency_ms?: number;
    error?: string;
    meta?: string;
  }>;
  writer_v2?: Record<string, unknown>;
  failed_stage?: string;
  error_category?: WriterErrorCategory;
}

async function restoreTopicAfterFailure(
  topicId: number,
  previousStatus: string
): Promise<void> {
  const restoreTo =
    previousStatus === 'scheduled' || previousStatus === 'approved' || previousStatus === 'candidate'
      ? previousStatus === 'scheduled'
        ? 'approved'
        : previousStatus
      : 'approved';
  await setTopicStatus(topicId, restoreTo as 'approved' | 'candidate');
  await unlockTopic(topicId);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Cancelled by user');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Generate a draft article for a topic. Saves only when Writer v2 audit passes.
 */
export async function generateArticleDraft(
  topicId: number,
  options: GenerateArticleOptions = {}
): Promise<GenerateArticleResult> {
  const runtime = getEditorialRuntime();
  if (!runtime?.ready) {
    return { ok: false, message: 'Editorial Engine not ready', errors: ['engine_not_ready'] };
  }
  if (!runtime.ai.isConfigured()) {
    return {
      ok: false,
      message: 'No AI providers configured. Add a key in Settings → AI Providers.',
      errors: ['ai_unconfigured'],
    };
  }

  const topic = await getTopicById(topicId);
  if (!topic) {
    return { ok: false, message: 'Topic not found', errors: ['topic_not_found'] };
  }

  const allowed = ['approved', 'scheduled', 'generating'];
  if (!allowed.includes(topic.status)) {
    return {
      ok: false,
      message: `Topic status '${topic.status}' cannot generate (allowed: approved, scheduled)`,
      errors: ['invalid_topic_status'],
    };
  }

  const previousStatus = topic.status === 'generating' ? 'approved' : topic.status;
  if (topic.status !== 'generating') {
    await setTopicStatus(topicId, 'generating');
  }

  const started = Date.now();
  let promptVersion: number | null = null;
  const debug: WriterDebugLog = {
    prompt_size_chars: 0,
    research_pack_size_chars: 0,
    system_size_chars: 0,
    user_size_chars: 0,
    groq_model: '',
    tokens_requested: 0,
    generation_time_ms: 0,
    final_word_count: 0,
    validation_failures: [],
    passes: [],
  };

  const emit = async (event: DraftProgressEvent) => {
    throwIfAborted(options.signal);
    await options.onProgress?.(event);
  };

  try {
    throwIfAborted(options.signal);
    const settings = await getSettings();
    const master = await getActivePrompt('master_system');
    if (!master) {
      throw new Error('master_system prompt missing');
    }
    promptVersion = master.version;

    await emit({ type: 'stage', stage: 'preparing_research', message: 'Preparing research pack…' });
    const context = buildStructuredContext(topic);
    let research: ResearchPack;
    if (options.reuseResearch && options.cachedResearch && typeof options.cachedResearch === 'object') {
      research = stripUntrustedGrounding(options.cachedResearch as ResearchPack);
      await emit({
        type: 'log',
        message: 'Reusing cached research pack from prior job',
        checkpoint: 'research',
      });
    } else {
      await emit({
        type: 'log',
        message: 'Fetching real-time Google Search grounding facts and authoritative benchmarks…',
        checkpoint: 'research',
      });
      research = await buildGroundedResearchPackAsync(topic, context, undefined, options.signal);
    }
    await emit({
      type: 'checkpoint',
      checkpoint: 'research',
      stage: 'preparing_research',
      message: research.grounding_sources?.length
        ? `Research grounded with ${research.grounding_sources.length} live sources`
        : research.rag_status && research.rag_status !== 'live'
          ? `Research loaded without live grounding (${research.rag_status})`
          : 'Research loaded',
    });

    debug.groq_model = settings.writer_model;
    debug.research_pack_size_chars = JSON.stringify(research).length;
    debug.passes.push({ kind: 'initial', meta: 'writer_v2_orchestrator' });

    const refs = (topic.source_refs_json || {}) as Record<string, unknown>;
    const completionBudget = Math.min(Math.max(settings.max_tokens || 4096, 2048), 4096);
    debug.tokens_requested = completionBudget;

    await emit({ type: 'stage', stage: 'loading_ai', message: `Loading AI (${settings.writer_model})…` });

    const aiStarted = Date.now();
    // Public-content boundary: the writer never sees internal QA labels from the topic title.
    const publicTitle = toPublicTitle(topic.title) || cleanEditorialTitle(topic.title);
    const internalLabels = internalTitleLabels(topic.title);
    const v2 = await runWriterV2({
      internalLabels,
      topic: {
        id: topic.id,
        title: publicTitle,
        content_type: topic.content_type,
        persona: typeof refs.persona === 'string' ? refs.persona : null,
        primary_keyword:
          typeof refs.primary_keyword === 'string'
            ? refs.primary_keyword
            : typeof refs.keyword === 'string'
              ? refs.keyword
              : null,
        angle: typeof refs.angle === 'string' ? refs.angle : null,
        primary_entity: typeof refs.primary_entity === 'string' ? refs.primary_entity : null,
        secondary_entity: typeof refs.secondary_entity === 'string' ? refs.secondary_entity : null,
        country: typeof refs.country === 'string' ? refs.country : null,
        city_a: typeof refs.city_a === 'string' ? refs.city_a : null,
        city_b: typeof refs.city_b === 'string' ? refs.city_b : null,
        cluster_id: topic.cluster_id != null ? String(topic.cluster_id) : null,
      },
      research,
      settings: {
        writer_model: settings.writer_model,
        temperature: settings.temperature,
        top_p: settings.top_p,
        article_length_min: settings.article_length_min,
        article_length_max: settings.article_length_max,
      },
      signal: options.signal,
      onProgress: options.onProgress,
      complete: async (system, user) => {
        throwIfAborted(options.signal);
        const { getAiRouter } = await import('../ai/ai-router.js');
        const routed = await getAiRouter().complete({
          model: settings.writer_model,
          system,
          user,
          temperature: settings.temperature,
          maxTokens: completionBudget,
          topP: settings.top_p,
          jsonMode: true,
          stage: 'writer_v2',
        });
        debug.passes.push({
          kind: 'section',
          tokens_out: routed.tokensOut,
          latency_ms: routed.latencyMs,
          finish_reason: routed.finishReason,
          meta: 'v2_ai',
        });
        return {
          text: routed.text,
          tokensIn: routed.tokensIn,
          tokensOut: routed.tokensOut,
          latencyMs: routed.latencyMs,
        };
      },
    });

    debug.tokens_in = v2.debug.tokens_in;
    debug.tokens_out = v2.debug.tokens_out;
    debug.generation_time_ms = Date.now() - started;
    debug.writer_v2 = {
      guide_id: v2.debug.guide_id,
      persona: v2.debug.persona,
      style: v2.debug.style,
      outline_headings: v2.debug.outline_headings,
      section_writer_ids: v2.debug.section_writer_ids,
      passes: v2.debug.passes,
      audit: v2.audit,
    };
    debug.final_word_count = v2.draft ? countDraftWords(v2.draft) : 0;
    debug.validation_failures = v2.errors || [];

    await emit({
      type: 'metrics',
      metrics: {
        ai_ms: Date.now() - aiStarted,
        tokens_in: v2.debug.tokens_in,
        tokens_out: v2.debug.tokens_out,
        model: settings.writer_model,
      },
    });

    if (!v2.ok || !v2.draft) {
      const failure = resolveWriterV2Failure(v2);
      debug.validation_failures = failure.errors;
      debug.failed_stage = v2.failed_stage || v2.debug?.failed_stage;
      debug.error_category = (v2.error_category ||
        failure.error_category) as WriterErrorCategory;
      const failMessage = formatGenerateFailureMessage(failure.message, {
        failed_stage: debug.failed_stage,
        error_category: failure.error_category,
      });
      await insertGenerationLog({
        topic_id: topicId,
        stage: 'writer',
        model_used: settings.writer_model,
        writer_prompt_version: promptVersion,
        tokens_in: v2.debug.tokens_in,
        tokens_out: v2.debug.tokens_out,
        latency_ms: debug.generation_time_ms,
        success: false,
        error_message: failMessage,
        meta_json: {
          writer_engine: WRITER_ENGINE_VERSION,
          job_id: options.jobId,
          failed_stage: debug.failed_stage,
          error_category: debug.error_category,
          debug,
        },
      });
      throw new Error(failMessage);
    }

    let draft: WriterDraftPayload = v2.draft;
    if (countDraftWords(draft) > settings.article_length_max) {
      draft = trimDraftToMaxWords(draft, settings.article_length_max);
    }

    const cleanTopic = toPublicTitle(topic.title) || cleanEditorialTitle(topic.title);
    draft = {
      ...draft,
      seo_title: toPublicTitle(draft.seo_title || cleanTopic).slice(0, 70),
      meta_title: toPublicTitle(draft.meta_title || draft.seo_title || cleanTopic).slice(0, 60),
      meta_description:
        draft.meta_description || `Cost of living guide: ${cleanTopic}`.slice(0, 160),
      excerpt: draft.excerpt || `Practical budgeting guidance for ${cleanTopic}.`.slice(0, 220),
    };

    await emit({ type: 'stage', stage: 'saving_draft', message: 'Saving draft…' });

    let slug =
      cleanEditorialSlug(draft.seo_title || cleanTopic) ||
      slugifyTitle(toPublicTitle(draft.seo_title || cleanTopic));
    if (!slug) slug = `draft-${topicId}-${Date.now()}`;
    if (await slugExists(slug)) {
      slug = `${slug}-${topicId}`;
    }

    const word_count = countDraftWords(draft);
    const reading_time_minutes = readingTimeMinutes(word_count);
    const generation_time_ms = Date.now() - started;
    debug.final_word_count = word_count;
    debug.generation_time_ms = generation_time_ms;

    const finalFaqBlock = (draft.blocks || []).find((b) => b.type === 'faq');
    const finalFaqCount = finalFaqBlock && Array.isArray(finalFaqBlock.content)
      ? finalFaqBlock.content.length
      : 0;
    console.log(
      `[generate] Pre-save draft ready. blocks=${draft.blocks?.length} faq_items=${finalFaqCount} words=${word_count}`
    );

    const articleId = await insertDraftArticle({
      slug,
      content_type: topic.content_type,
      cluster_id: topic.cluster_id,
      topic_id: topicId,
      draft,
      research,
      raw_ai_response: JSON.stringify({ writer_v2: true, plan: v2.plan }),
      prompt_version: promptVersion,
      prompt_hash: `writer-v2:${v2.debug.guide_id}:${v2.debug.persona}:${v2.debug.style}`,
      ai_model: settings.writer_model,
      temperature: settings.temperature,
      top_p: settings.top_p,
      generation_time_ms,
      tokens_in: v2.debug.tokens_in,
      tokens_out: v2.debug.tokens_out,
      word_count,
      reading_time_minutes,
    });

    await setTopicStatus(topicId, 'draft');
    await insertGenerationLog({
      article_id: articleId,
      topic_id: topicId,
      stage: 'writer',
      model_used: settings.writer_model,
      writer_prompt_version: promptVersion,
      tokens_in: v2.debug.tokens_in,
      tokens_out: v2.debug.tokens_out,
      latency_ms: generation_time_ms,
      success: true,
      meta_json: {
        writer_engine: WRITER_ENGINE_VERSION,
        dedicated_writer_id: v2.debug.guide_id,
        prompt_hash: `writer-v2:${v2.debug.guide_id}`,
        word_count,
        slug,
        job_id: options.jobId,
        writer_v2: debug.writer_v2,
        debug,
      },
    });

    await emit({
      type: 'done',
      stage: 'completed',
      message: `Draft saved as article #${articleId}`,
      checkpoint: 'completed_draft',
    });

    return {
      ok: true,
      article_id: articleId,
      slug,
      word_count,
      reading_time_minutes,
      research_pack: research,
      prompt_version: promptVersion ?? undefined,
      message: `Draft generated via Writer Engine v2 (${v2.debug.guide_id} / ${v2.debug.persona} / ${v2.debug.style})`,
      debug,
    };
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    message = sanitizeWriterErrorMessage(message);
    if (/rate_limit|tokens per day|TPD|tokens per minute|TPM|too large|Request too large/i.test(message)) {
      message = `AI rate/size limit while generating the draft. Wait and retry. Details: ${message.slice(0, 280)}`;
    } else if (/API_KEY|not configured/i.test(message)) {
      message = 'AI API key missing. Configure providers in Settings and restart.';
    } else if (!/^Writer (v2|failed|engine)/i.test(message)) {
      message = formatGenerateFailureMessage(message, {
        failed_stage: debug.failed_stage,
        error_category: debug.error_category,
      });
    }
    debug.generation_time_ms = Date.now() - started;
    if (!debug.validation_failures.length) {
      debug.validation_failures = [message];
    }
    try {
      await insertGenerationLog({
        topic_id: topicId,
        stage: 'writer',
        model_used: (await getSettings()).writer_model,
        writer_prompt_version: promptVersion,
        success: false,
        error_message: message,
        latency_ms: debug.generation_time_ms,
        meta_json: {
          writer_engine: WRITER_ENGINE_VERSION,
          job_id: options.jobId,
          debug,
        },
      });
    } catch {
      /* ignore */
    }
    await restoreTopicAfterFailure(topicId, previousStatus);
    return {
      ok: false,
      message,
      errors: debug.validation_failures.length ? debug.validation_failures : [message],
      debug,
    };
  }
}

/** Research preview without calling Writer AI. */
export async function previewTopicResearch(topicId: number) {
  const topic = await getTopicById(topicId);
  if (!topic) throw new Error('Topic not found');
  const context = buildStructuredContext(topic);
  const research = buildResearchPack(topic, context);
  return {
    topic,
    research,
    context_summary: {
      known_facts: context.known_facts,
      data_gaps: context.data_gaps,
      related_cities: context.related_cities.length,
      related_comparisons: context.related_comparisons.length,
    },
  };
}
