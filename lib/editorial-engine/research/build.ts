import type { EditorialTopic } from '../types.js';
import type { StructuredContextPack } from '../writer/context-pack.js';
import { extractResearchEntities } from './entities.js';
import { extractResearchKeywords } from './keywords.js';
import {
  buildCommonMistakes,
  buildDecisionCriteria,
  buildPainPoints,
  buildSearcherQuestions,
} from './questions.js';
import {
  buildRequiredCalculators,
  buildRequiredComparisonBlocks,
  buildRequiredFaq,
  buildRequiredTables,
  buildResearchOutline,
} from './outline.js';
import {
  RESEARCH_PACK_VERSION,
  ResearchPackValidationError,
  type ResearchLinkRef,
  type ResearchPack,
} from './schema.js';
import { validateResearchPack } from './validate.js';
import {
  getRagModel,
  GroundingRequiredError,
  groundingArticlePolicy,
  groundingRequiredForArticles,
  retrieveGroundedCityCostData,
  type GroundedGenerateFn,
  type RagRetrievalResult,
  type ResearchGroundingStatus,
} from '../rag/index.js';
import { toPublicTitle } from '../utils/clean-title.js';
import { buildCalculationLedger } from './comparison-ledger.js';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 96);
}

function strRef(refs: Record<string, unknown>, key: string): string | null {
  const v = refs[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function personaFromType(contentType: string, hubId?: string | null, strategyPersona?: string | null): string {
  if (strategyPersona) return strategyPersona;
  if (contentType === 'student_guide' || hubId === 'students') return 'students budgeting a move';
  if (contentType === 'remote_worker_guide' || hubId === 'remote-workers' || hubId === 'digital-nomads') {
    return 'remote workers and digital nomads';
  }
  if (contentType === 'retirement_guide' || hubId === 'retirement') return 'retirees evaluating living costs';
  if (contentType.includes('family') || hubId === 'families') return 'families planning relocation';
  if (contentType === 'comparison_guide') return 'people comparing two cities before moving';
  if (contentType === 'country_guide') return 'people researching a country move';
  if (contentType === 'city_guide') return 'people evaluating a city for living costs';
  if (contentType === 'salary_guide') return 'professionals evaluating relocation offers';
  if (contentType === 'rent_guide') return 'people budgeting housing before moving';
  if (contentType === 'visa_guide' || contentType === 'moving_guide') {
    return 'people planning an international move';
  }
  return 'people researching cost of living and relocation';
}

function intentFromTopic(topic: EditorialTopic, refs: Record<string, unknown>): string {
  const fromRefs = strRef(refs, 'intent');
  if (fromRefs) return fromRefs;
  if (topic.content_type === 'comparison_guide') return 'commercial_investigation';
  if (topic.content_type === 'checklist') return 'informational_howto';
  if (topic.content_type === 'faq_hub') return 'informational_faq';
  if (
    ['salary_guide', 'rent_guide', 'visa_guide', 'moving_guide'].includes(topic.content_type)
  ) {
    return 'commercial_investigation';
  }
  return 'informational';
}

function childArticlesFor(refs: Record<string, unknown>, countryName: string | null): string[] {
  if (!countryName) return [];
  const guideKinds = [
    'Salary Guide',
    'Rent Guide',
    'Tax Guide',
    'Food Prices Guide',
    'Transportation Costs Guide',
    'Healthcare Costs Guide',
    'Student Cost of Living Guide',
    'Digital Nomad Guide',
    'Retirement Cost of Living Guide',
    'Moving Checklist',
    'Monthly Budget Guide',
    'Visa and Residence Cost Guide',
  ];
  const parent = strRef(refs, 'parent_topic');
  // Pillar lists children; spokes point back to pillar only
  if (parent && !/cost of living in /i.test(String(refs.title || ''))) {
    return [`Cost of Living in ${countryName}`];
  }
  return guideKinds.map((g) => `${countryName} ${g}`);
}

function requiredStatistics(ctx: StructuredContextPack): string[] {
  const stats: string[] = [];
  for (const fact of ctx.known_facts) stats.push(fact);
  if (ctx.city) {
    stats.push(
      `Only use numeric Cost Index / Rent Index values already listed for ${ctx.city.city} when available.`
    );
  }
  if (ctx.country) {
    stats.push(
      `Only use country-level Average Cost Index / Average Rent Index values already listed for ${ctx.country.name}.`
    );
  }
  if (ctx.comparison?.enrichment) {
    const enr = ctx.comparison.enrichment as Record<string, unknown>;
    if (enr.overall_winner) stats.push(`Overall cost winner: ${enr.overall_winner}`);
    if (enr.monthly_difference) stats.push(`Monthly cost difference: ${String(enr.monthly_difference)}`);
    if (enr.biggest_difference) stats.push(`Largest category gap: ${String(enr.biggest_difference)}`);
  }
  if (!stats.length) {
    stats.push('No numeric CityCost statistics available — do not invent index values.');
  }
  return [...new Set(stats)].slice(0, 20);
}

function factsMustNotInvent(ctx: StructuredContextPack): string[] {
  return [
    'Exact current rents, salaries, or grocery prices not present in supporting_facts / required_statistics',
    'Crime rates, safety rankings, or school ratings without CityCost-backed sources',
    'Visa approval odds, processing times, or legal advice presented as certainty',
    'Tax rates tailored to a reader’s personal situation',
    'Fabricated testimonials or “locals say” anecdotes',
    'Fake survey percentages or made-up CPI/rent index values',
    ctx.data_gaps.length
      ? `Anything that fills these gaps with guesses: ${ctx.data_gaps.join('; ')}`
      : 'Any statistic that cannot be traced to CityCost structured context',
  ];
}

function disclaimerRequirements(contentType: string): string[] {
  return [
    'CityCost index signals are planning tools, not live quotes from landlords or employers',
    'Costs vary by neighbourhood, household size, and lifestyle',
    'Visa, tax, and healthcare rules change — readers should verify with official sources',
    contentType.includes('tax') || contentType.includes('visa')
      ? 'This guide is informational and not legal, immigration, or tax advice'
      : 'This guide is informational and not personalized financial advice',
  ];
}

/**
 * Assemble a Research Pack (unvalidated). Prefer buildResearchPack().
 */
export function assembleResearchPack(
  topic: EditorialTopic,
  ctx: StructuredContextPack,
  groundedRag?: RagRetrievalResult | null
): ResearchPack {
  const refs = ctx.topic.source_refs;
  const hubId = strRef(refs, 'hub_id');
  const strategyPersona = strRef(refs, 'persona');
  const isComparison = Boolean(ctx.comparison) || topic.content_type === 'comparison_guide';

  let primary_entity = topic.title.split(':')[0].trim();
  if (ctx.comparison) {
    primary_entity = `${ctx.comparison.cityA} vs ${ctx.comparison.cityB}`;
  } else if (ctx.city) {
    primary_entity = `${ctx.city.city}, ${ctx.city.country}`;
  } else if (ctx.country) {
    primary_entity = String(ctx.country.name);
  }

  const entities = extractResearchEntities(ctx, topic.title);
  const secondary_entities = [
    ...entities.cities.filter((c) => !primary_entity.toLowerCase().includes(c.toLowerCase())),
    ...entities.countries,
  ].slice(0, 12);

  const keywords = extractResearchKeywords(topic, ctx, primary_entity, secondary_entities);
  const persona = personaFromType(topic.content_type, hubId, strategyPersona);
  const intent = intentFromTopic(topic, refs);
  const search_intent = intent;

  const placeA = ctx.comparison
    ? String(ctx.comparison.cityA)
    : ctx.city
      ? String(ctx.city.city)
      : undefined;
  const placeB = ctx.comparison ? String(ctx.comparison.cityB) : undefined;

  const searcher_questions = buildSearcherQuestions(ctx, primary_entity, topic.content_type);
  const outlineBuilt = buildResearchOutline({
    contentType: topic.content_type,
    primaryEntity: primary_entity,
    isComparison,
    placeA,
    placeB,
  });

  // Never promote strategy seo_reason / certification meta into article_angle (writer + synth paste it).
  const rawSeoReason = strRef(refs, 'seo_reason') || '';
  const seoReasonIsMeta =
    !rawSeoReason ||
    /spoke|pillar|cluster|certification|topical authority|supporting\s+\w+\s+spoke|anchors topical/i.test(
      rawSeoReason
    );
  const article_angle = !seoReasonIsMeta
    ? rawSeoReason
    : isComparison
      ? 'Help readers decide between two places using indexed cost signals, lifestyle trade-offs, and practical budgeting — not hype.'
      : ctx.city
        ? 'Give a practical city cost-of-living briefing with honest data limits and relocation tips.'
        : ctx.country
          ? 'Frame country-level cost patterns and point readers to specific city and comparison tools.'
          : 'Build an evergreen cost-of-living guide that improves on thin pages with practical advice.';

  const related_cities: ResearchLinkRef[] = ctx.related_cities.map((c) => ({
    ...c,
    kind: 'city' as const,
  }));
  const related_countries: ResearchLinkRef[] = ctx.related_countries.map((c) => ({
    ...c,
    kind: 'country' as const,
  }));
  const related_comparison_pages: ResearchLinkRef[] = ctx.related_comparisons.map((c) => ({
    ...c,
    kind: 'comparison' as const,
  }));

  // Guide-aware link order: country guides must not lead with random /compare pairs
  const authority = [
    ...ctx.tool_links.map((l) => ({ ...l, kind: 'tool' as const })),
    ...ctx.authority_links.map((l) => ({ ...l, kind: 'authority' as const })),
  ];
  let internal_link_candidates: ResearchLinkRef[];
  if (topic.content_type === 'country_guide') {
    internal_link_candidates = [
      ...related_countries.slice(0, 2),
      ...related_cities.slice(0, 8),
      ...authority,
      // Same-country compares only as low priority (Writer may still filter)
      ...related_comparison_pages.slice(0, 2),
    ];
  } else if (topic.content_type === 'comparison_guide') {
    internal_link_candidates = [
      ...related_comparison_pages.slice(0, 3),
      ...related_cities.slice(0, 4),
      ...related_countries.slice(0, 2),
      ...authority,
    ];
  } else if (topic.content_type === 'city_guide') {
    internal_link_candidates = [
      ...related_cities.slice(0, 4),
      ...related_countries.slice(0, 2),
      ...related_comparison_pages.slice(0, 2),
      ...authority,
    ];
  } else {
    internal_link_candidates = [
      ...related_cities.slice(0, 6),
      ...related_countries.slice(0, 4),
      ...related_comparison_pages.slice(0, 4),
      ...authority,
    ];
  }

  const countryName =
    (ctx.country?.name && String(ctx.country.name)) ||
    (ctx.city?.country && String(ctx.city.country)) ||
    strRef(refs, 'country');

  const content_cluster =
    strRef(refs, 'cluster') ||
    (strRef(refs, 'country_slug')
      ? `${strRef(refs, 'country_slug')}-cost-of-living`
      : null);
  const parent_pillar =
    strRef(refs, 'parent_topic') ||
    (countryName && topic.content_type !== 'country_guide'
      ? `Cost of Living in ${countryName}`
      : null);

  const supporting_facts = [...ctx.known_facts];
  const known_data_gaps = [...ctx.data_gaps];

  // Only live, source-backed facts are added; nothing is synthesized when grounding is off.
  if (groundedRag?.status === 'live' && groundedRag.facts.length) {
    for (const gf of groundedRag.facts) {
      supporting_facts.push(`${gf.citationRef} ${gf.statement}`);
    }
  } else if (groundedRag) {
    known_data_gaps.push(
      groundedRag.status === 'blocked'
        ? 'No external web research in this draft (Google grounding is not used for articles) — rely on CityCost data, label it as CityCost data, and do not cite external statistics or [^n] footnotes'
        : `No live web-sourced figures (${groundedRag.error || groundedRag.status}) — do not cite external statistics or [^n] footnotes`
    );
  }

  if (!supporting_facts.length) {
    known_data_gaps.push('No CityCost numeric facts attached — Writer must avoid invented statistics');
  }

  const eeat_opportunities = [
    'Cite CityCost methodology and real-time grounded web references for maximum authority',
    'State exact retrieved benchmarks with publication dates',
    'Prefer practical relocation advice over generic travel copy',
    'Link to related city/country/comparison pages for verification',
    'Use entities from the Research Pack only — do not invent institutions',
    ...known_data_gaps.map((g) => `Acknowledge gap: ${g}`),
  ];

  const pack: ResearchPack = {
    schema_version: RESEARCH_PACK_VERSION,
    topic: {
      id: topic.id,
      title: topic.title,
      content_type: topic.content_type,
      slug: strRef(refs, 'slug') || slugify(topic.title),
      priority_score: topic.priority_score,
    },
    intent,
    search_intent,
    persona,
    reader_persona: persona,
    primary_keyword: keywords.primary_keyword,
    target_keyword: keywords.primary_keyword,
    secondary_keywords: keywords.secondary_keywords,
    long_tail_keywords: keywords.long_tail_keywords,
    question_keywords: keywords.question_keywords,
    semantic_keywords: keywords.semantic_keywords,
    lsi_keywords: keywords.lsi_keywords,
    article_angle,
    searcher_questions,
    search_questions: searcher_questions,
    user_pain_points: buildPainPoints(primary_entity, isComparison),
    decision_criteria: buildDecisionCriteria(isComparison),
    common_mistakes: buildCommonMistakes(primary_entity),
    supporting_facts,
    required_statistics: requiredStatistics(ctx),
    known_data_gaps,
    facts_must_not_invent: factsMustNotInvent(ctx),
    disclaimer_requirements: disclaimerRequirements(topic.content_type),
    related_cities,
    related_countries,
    related_comparison_pages,
    internal_link_candidates,
    geo_scope: ctx.geo,
    calculation_ledger: buildCalculationLedger(ctx.geo?.city_page_slugs || []) ?? undefined,
    content_cluster,
    parent_pillar,
    child_articles: childArticlesFor(refs, countryName),
    entities,
    primary_entity,
    secondary_entities,
    required_h2: outlineBuilt.required_h2,
    required_h3: outlineBuilt.required_h3,
    required_faq: buildRequiredFaq(searcher_questions),
    required_tables: buildRequiredTables(isComparison, primary_entity),
    required_comparison_blocks: buildRequiredComparisonBlocks(isComparison, placeA, placeB),
    required_calculators: buildRequiredCalculators(),
    outline: outlineBuilt.outline,
    recommended_outline: outlineBuilt.flat,
    eeat_opportunities,
    writer_contract: {
      sole_source: 'research_pack',
      must_follow_outline: true,
      must_use_pack_intent: true,
      must_not_invent_entities: true,
      must_not_invent_statistics: true,
      must_not_guess_intent: true,
      must_answer_searcher_questions: true,
      required_faq_count_min: 6,
      required_h2_count_min: 8,
    },
    validation: {
      ok: false,
      missing_fields: [],
      warnings: [],
      checked_at: new Date().toISOString(),
      schema_version: RESEARCH_PACK_VERSION,
    },
    grounding_sources: groundedRag?.status === 'live' ? groundedRag.sources : undefined,
    grounded_facts: groundedRag?.status === 'live' ? groundedRag.facts : undefined,
    rag_status: groundedRag?.status,
    rag_error_category: groundedRag && groundedRag.status !== 'live' ? groundedRag.error_category : undefined,
    rag_error: groundedRag && groundedRag.status !== 'live' ? groundedRag.error : undefined,
    rag_model: groundedRag?.model,
    research_status: groundedRag ? researchStatusFor(groundedRag) : undefined,
    grounding_trace: groundedRag?.trace,
  };

  pack.validation = validateResearchPack(pack);
  return pack;
}

/**
 * Build + validate Research Pack. Throws if incomplete — Writer must not receive invalid packs.
 */
export function buildResearchPack(
  topic: EditorialTopic,
  ctx: StructuredContextPack
): ResearchPack {
  const pack = assembleResearchPack(topic, ctx);
  if (!pack.validation.ok) {
    throw new ResearchPackValidationError(pack.validation.missing_fields, pack.validation.warnings);
  }
  return pack;
}

/** Map a retrieval outcome to the research readiness status recorded on the pack. */
export function researchStatusFor(rag: RagRetrievalResult): ResearchGroundingStatus {
  if (rag.status === 'live') return 'grounding_verified';
  if (rag.status === 'blocked') return 'grounding_blocked';
  if (rag.status === 'no_evidence') return 'evidence_insufficient';
  return 'grounding_unavailable';
}

/**
 * Build + validate a Research Pack, with Google Search Grounding only when the
 * grounding policy permits article use (see rag/grounding-policy.ts).
 * - Policy blocked: no provider call; pack is labelled `grounding_blocked`.
 * - Grounding failure: degrades to an ungrounded pack with a data-gap note,
 *   unless EDITORIAL_REQUIRE_GROUNDING is on — then it fails closed.
 * - An invalid pack throws, same contract as buildResearchPack.
 */
export async function buildGroundedResearchPackAsync(
  topic: EditorialTopic,
  ctx: StructuredContextPack,
  apiKey?: string,
  signal?: AbortSignal,
  /** Test seam: replaces the Gemini call (deterministic tests only). */
  generate?: GroundedGenerateFn
): Promise<ResearchPack> {
  const publicTitle = toPublicTitle(topic.title);
  const targetCity = ctx.comparison
    ? String(ctx.comparison.cityA)
    : ctx.city
      ? String(ctx.city.city)
      : publicTitle.split(':')[0].trim();
  const comparisonCity = ctx.comparison ? String(ctx.comparison.cityB) : undefined;

  const policy = groundingArticlePolicy();
  let ragResult: RagRetrievalResult | null = null;
  if (!policy.permitted) {
    ragResult = {
      status: 'blocked',
      error_category: 'policy',
      error: policy.reason,
      query: '',
      targetCity,
      comparisonCity,
      sources: [],
      facts: [],
      factLines: [],
      unsupportedDropped: 0,
      retrievalTimestamp: new Date().toISOString(),
      model: getRagModel(),
    };
  } else {
    try {
      ragResult = await retrieveGroundedCityCostData({
        targetCity,
        comparisonCity,
        topicTitle: publicTitle,
        category: topic.content_type,
        apiKey,
        signal,
        generate,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn('⚠️ RAG live retrieval skipped in research pack build:', err);
    }
  }

  if (groundingRequiredForArticles()) {
    const status = ragResult ? researchStatusFor(ragResult) : 'grounding_unavailable';
    if (status !== 'grounding_verified') {
      throw new GroundingRequiredError(status, ragResult?.error || 'grounding did not run');
    }
  }

  const pack = assembleResearchPack(topic, ctx, ragResult);
  if (!pack.validation.ok) {
    throw new ResearchPackValidationError(pack.validation.missing_fields, pack.validation.warnings);
  }
  return pack;
}

/**
 * Preview helper: always returns pack + validation (never throws).
 */
export function previewResearchPack(
  topic: EditorialTopic,
  ctx: StructuredContextPack
): { pack: ResearchPack; validation: ResearchPack['validation'] } {
  const pack = assembleResearchPack(topic, ctx);
  return { pack, validation: pack.validation };
}
