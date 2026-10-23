/**
 * Single revision pass — issue-plan driven: patch ALL planned categories once.
 * Heading uniquify runs once AFTER AI merge via headingFingerprint.
 */

import type { LinkGeoScope } from '../writer/v2/link-relevance.js';
import { getSettings } from '../db/settings-repo.js';
import type { QualityReport } from '../reviewer/quality-report.js';
import type { RuleFinding } from '../reviewer/rule-validator.js';
import { detectDraftCorruption } from '../validation/corruption.js';
import {
  buildIssuePlan,
  ISSUE_CATEGORY_ORDER,
  type IssueCategory,
  type IssuePlan,
} from '../validation/issue-plan.js';
import {
  normalizeDraft,
  uniquifyHeadingsByFingerprint,
} from '../validation/normalize-draft.js';
import {
  estimateCategoryIssueCount,
  evaluateProgressGate,
} from '../validation/shared-checks.js';
import type { ResearchPack } from '../writer/research-engine.js';
import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { countDraftWords } from '../writer/draft-validate.js';
import { buildRevisionUserPayload, revisionSystemPrompt } from './revision-prompts.js';
import {
  applyDeterministicRepairs,
  expandDraftToMinWords,
  mergeAiPatch,
  parseRevisionAiJson,
} from './revision-validator.js';
import {
  REVISION_ENGINE_VERSION,
  REVISION_PROMPT_VERSION,
  type RevisionResult,
} from './revision-types.js';

function pickRevisionModel(writerModel: string): string {
  if (writerModel && !/test|dummy/i.test(writerModel)) return writerModel;
  return 'openai/gpt-oss-120b';
}

function rulesFromReport(report: QualityReport): RuleFinding[] {
  const rv = report.rule_validator;
  const list = [...(rv?.auto_fixable || []), ...(rv?.failed_rules || [])];
  if (list.length) return list;
  return (rv?.findings || []).map((f) => ({
    ...f,
    category: f.category || 'CONTENT',
    auto_fixable: f.auto_fixable ?? true,
  }));
}

function linkCandidatesFromResearch(research: ResearchPack | null): string[] {
  const raw = (research as { internal_link_candidates?: Array<string | { href?: string }> } | null)
    ?.internal_link_candidates || [];
  const links = raw
    .map((l) => (typeof l === 'string' ? l : l?.href))
    .filter((h): h is string => typeof h === 'string' && h.startsWith('/'));
  return [...new Set(links)].slice(0, 8);
}

function linkCandidatesFromPackage(pkg: {
  recommendations?: Array<{ target?: string }>;
} | null): string[] {
  const links = (pkg?.recommendations || [])
    .map((r) => r.target)
    .filter((h): h is string => typeof h === 'string' && h.startsWith('/'));
  return [...new Set(links)].slice(0, 12);
}

function planNeedsWork(plan: IssuePlan): boolean {
  return plan.all_issues.length > 0 || plan.categories.length > 0;
}

/**
 * Apply deterministic repairs for every planned category (section-scoped).
 * Heading uniquify is deferred until after AI (skipHeadingUniquify).
 */
function applyPlanDeterministic(
  draft: WriterDraftPayload,
  plan: IssuePlan,
  linkCandidates: string[],
  minWords: number,
  linkScope?: LinkGeoScope | null
): { draft: WriterDraftPayload; fixes: string[]; categories: IssueCategory[] } {
  let next = draft;
  const fixes: string[] = [];
  const categories: IssueCategory[] = [];
  const needsExpand = plan.all_issues.some(
    (i) => i.code === 'word_count_low' || i.code === 'word_count_below_target'
  );

  for (const cat of ISSUE_CATEGORY_ORDER) {
    const bucket = plan.categories.find((c) => c.category === cat);
    if (!bucket?.issues.length) continue;
    categories.push(cat);
    const det = applyDeterministicRepairs(next, cat, {
      onlyBlockIds: bucket.affected_block_ids,
      skipHeadingUniquify: true,
      linkCandidates: cat === 'SEO' ? linkCandidates : undefined,
      expandToMinWords:
        cat === 'STRUCTURE' && needsExpand ? minWords : undefined,
      linkScope,
    });
    next = det.draft;
    fixes.push(...det.fixes);
  }

  return { draft: next, fixes, categories };
}

export async function reviseDraftOnce(input: {
  article_id: number;
  draft: WriterDraftPayload;
  research: ResearchPack | null;
  report: QualityReport;
  attempt: number;
  max_attempts: number;
  deterministicOnly?: boolean;
}): Promise<RevisionResult> {
  const started = Date.now();
  const settings = await getSettings();

  // Always start from normalized snapshot (no heading uniquify here)
  const normalized = normalizeDraft(input.draft);
  let draft = normalized.draft;

  const plan = buildIssuePlan(input.report, draft);
  const rules = rulesFromReport(input.report).filter(
    (r) => r.auto_fixable || r.severity !== 'critical'
  );
  const patchRules = rules.length
    ? rules
    : (input.report.rule_validator?.findings || []).filter((f) => f.auto_fixable);

  const readabilityOnly =
    plan.categories.length === 1 && plan.categories[0]?.category === 'READABILITY';

  /** Soft style / template issues — deterministic repetition repair is enough before final gate. */
  const styleSoftOnly =
    plan.categories.length > 0 &&
    plan.categories.every((c) => c.category === 'STYLE' || c.category === 'READABILITY') &&
    plan.all_issues.every((i) =>
      /ai_review|human_writing|weak_human|repetition|template|filler|forbidden_phrase|eeat_helpful|readability|weak_readability|boilerplate|robotic|generic/i.test(
        `${i.code} ${i.message}`
      )
    );

  if (!planNeedsWork(plan) && !patchRules.length) {
    return {
      ok: true,
      article_id: input.article_id,
      attempt: input.attempt,
      draft: input.draft,
      fixed_issues: normalized.fixes,
      remaining_issues: (input.report.failure_reasons || []).slice(0, 12),
      deterministic_fixes: normalized.fixes,
      duration_ms: Date.now() - started,
      prompt_version: REVISION_PROMPT_VERSION,
      used_ai: false,
      successful: false,
      estimated_score: input.report.overall_score,
      progress_reason: 'No planned issues / auto-fixable rules',
      message: `Revision #${input.attempt}: nothing to patch · ${REVISION_ENGINE_VERSION}`,
    };
  }

  const issuesBefore = plan.all_issues.length || patchRules.length || 1;
  const oldScore = input.report.overall_score ?? 0;
  // Prefer SEO package recommendations (usually present after Generate SEO); research as fallback
  let packageLinks: string[] = [];
  try {
    const { getArticleById } = await import('../db/articles-repo.js');
    const art = await getArticleById(input.article_id);
    packageLinks = linkCandidatesFromPackage(
      (art?.internal_links_json as { recommendations?: Array<{ target?: string }> } | null) || null
    );
  } catch {
    packageLinks = [];
  }
  const linkCandidates = [
    ...new Set([...packageLinks, ...linkCandidatesFromResearch(input.research)]),
  ].slice(0, 12);

  const minWords = settings.article_length_min;
  const wordsBefore = countDraftWords(draft);

  // Deterministic repairs for ALL planned categories in one batch
  const detBatch = applyPlanDeterministic(
    draft,
    plan,
    linkCandidates,
    minWords,
    (input.research as { geo_scope?: LinkGeoScope } | null | undefined)?.geo_scope || null
  );
  draft = detBatch.draft;
  const deterministic_fixes = [...normalized.fixes, ...detBatch.fixes];
  let used_ai = false;
  let provider: string | undefined;
  let model: string | undefined;
  let tokens_in: number | undefined;
  let tokens_out: number | undefined;
  const fixed_issues = [...deterministic_fixes];
  let corrupted = false;
  let corruption_reasons: string[] = [];
  const preAiDraft = draft;

  const touchMeta = plan.categories.some((c) => c.touch_meta);
  const allowedIds = [
    ...new Set(plan.categories.flatMap((c) => c.affected_block_ids)),
  ];
  // Fallback allow-list from rules if plan empty
  if (!allowedIds.length) {
    for (const b of draft.blocks || []) {
      if (b.type !== 'heading') allowedIds.push(b.id);
    }
  }

  // AI section patches — skip readability-only and soft style (deterministic + final gate)
  const shouldAi =
    !input.deterministicOnly &&
    !readabilityOnly &&
    !styleSoftOnly &&
    (patchRules.length > 0 ||
      plan.categories.some((c) => c.category === 'STRUCTURE' || c.category === 'STYLE'));

  if (styleSoftOnly && !shouldAi) {
    fixed_issues.push(
      'Soft style/template issues — deterministic repetition repair only (skipped AI rewrite)'
    );
  }

  if (shouldAi) {
    try {
      const { getAiRouter } = await import('../ai/ai-router.js');
      // Cap patch surface — fewer sections → smaller prompt + faster completion
      const patchIds = allowedIds.slice(0, styleSoftOnly ? 4 : 8);
      const user = buildRevisionUserPayload({
        draft,
        research: input.research,
        rules: patchRules.slice(0, 8),
        attempt: input.attempt,
        max_attempts: input.max_attempts,
        overall_score: oldScore,
        threshold: input.report.threshold,
        affectedBlockIds: patchIds,
        categories: detBatch.categories,
        expectedFixes: plan.categories.flatMap((c) => c.expected_fixes).slice(0, 12),
        minWords,
        currentWords: countDraftWords(draft),
      });
      const revisionModel = pickRevisionModel(settings.writer_model);
      const patchBudget = Math.min(
        3200,
        Math.max(1200, 400 + patchIds.length * 350)
      );
      const routed = await getAiRouter().complete({
        model: revisionModel,
        system: revisionSystemPrompt(),
        user,
        temperature: Math.min(settings.temperature, 0.4),
        topP: settings.top_p,
        maxTokens: patchBudget,
        jsonMode: true,
        stage: `revision_rules_${input.attempt}`,
        preferredProvider: 'gemini',
        maxFailover: 2,
        timeoutMs: 40_000,
        articleId: input.article_id,
      });
      used_ai = true;
      provider = routed.provider;
      model = routed.model || revisionModel;
      tokens_in = routed.tokensIn;
      tokens_out = routed.tokensOut;

      let patch;
      try {
        patch = parseRevisionAiJson(routed.text);
      } catch (err) {
        draft = preAiDraft;
        fixed_issues.push(
          `JSON invalid — kept deterministic repairs: ${(err as Error).message?.slice(0, 120) || 'parse error'}`
        );
        patch = null;
      }

      if (patch) {
        const merged = mergeAiPatch(draft, patch, patchIds, touchMeta);
        // Compare vs pre-AI (post-deterministic) so expand→AI-shrink is caught
        const corruption = detectDraftCorruption(preAiDraft, merged.draft, {
          minWords,
        });
        if (corruption.corrupted) {
          // Keep deterministic repairs; reject only the AI merge
          corruption_reasons = corruption.reasons;
          draft = preAiDraft;
          fixed_issues.push(`Corrupted output rejected: ${corruption.reasons.join('; ')}`);
        } else {
          draft = normalizeDraft(merged.draft).draft;
          fixed_issues.push(...merged.fixed);
          fixed_issues.push(...patchRules.slice(0, 8).map((r) => `Targeted: ${r.code}`));
        }
      }
    } catch (err) {
      fixed_issues.push(
        `AI revision skipped: ${(err as Error).message?.slice(0, 120) || 'error'}`
      );
    }
  }

  // ONE heading fingerprint uniquify pass after AI (and after det repairs)
  if (!corrupted) {
    const uniq = uniquifyHeadingsByFingerprint(draft.blocks || []);
    draft = { ...draft, blocks: uniq.blocks };
    if (uniq.fixes.length) fixed_issues.push(...uniq.fixes);
    draft = normalizeDraft(draft).draft;
  }

  // Re-run readability after AI — AI rewrites often reintroduce long sentences
  const needsReadability =
    plan.categories.some((c) => c.category === 'READABILITY') ||
    (input.report.scores?.readability ?? 100) < 55;
  if (!corrupted && needsReadability) {
    const readPass = applyDeterministicRepairs(draft, 'READABILITY');
    draft = readPass.draft;
    if (readPass.fixes.length) fixed_issues.push(...readPass.fixes);
  }

  // Hard floor: never leave the saved draft below article_length_min if we can expand
  if (!corrupted && countDraftWords(draft) < minWords) {
    const expanded = expandDraftToMinWords(draft, minWords);
    draft = expanded.draft;
    if (expanded.fixes.length) fixed_issues.push(...expanded.fixes);
  }

  // Final guard: if we somehow still shrank below min vs the pre-revision draft, restore
  const wordsAfter = countDraftWords(draft);
  if (
    !corrupted &&
    wordsAfter < minWords &&
    wordsAfter < wordsBefore &&
    wordsBefore >= Math.floor(minWords * 0.9)
  ) {
    draft = preAiDraft.blocks?.length ? preAiDraft : input.draft;
    const restored = expandDraftToMinWords(draft, minWords);
    draft = restored.draft;
    fixed_issues.push(
      `Restored draft after word-count regression (${wordsBefore} → ${wordsAfter})`
    );
    if (restored.fixes.length) fixed_issues.push(...restored.fixes);
  }

  // Progress vs shared validator
  const primaryCat: IssueCategory =
    plan.primary?.category || detBatch.categories[0] || 'STRUCTURE';
  const estimate = estimateCategoryIssueCount(
    draft,
    input.report,
    settings,
    input.research,
    primaryCat
  );
  const issuesAfter =
    buildIssuePlan(
      {
        ...input.report,
        rule_validator: estimate.checks.rules,
        readability: estimate.checks.readability,
        scores: {
          ...input.report.scores,
          rule_validator: estimate.checks.rules.score,
          readability: estimate.checks.readability.score,
        },
      },
      draft
    ).all_issues.length;

  const gate = evaluateProgressGate({
    old_score: oldScore,
    estimated_score: estimate.estimated_score,
    issues_before: issuesBefore,
    issues_after: issuesAfter,
  });

  const successful =
    !corrupted && (gate.allow_save || deterministic_fixes.length > 0 || fixed_issues.length > 0);
  if (!successful && !corrupted) {
    draft = input.draft;
    fixed_issues.push(`Unsuccessful revision (not saved): ${gate.reason}`);
  }

  const remaining = (estimate.checks.rules.auto_fixable || [])
    .map((f) => f.message)
    .slice(0, 12);

  return {
    ok: true,
    article_id: input.article_id,
    attempt: input.attempt,
    draft,
    fixed_issues: [...new Set(fixed_issues)],
    remaining_issues: remaining,
    deterministic_fixes,
    provider,
    model,
    tokens_in,
    tokens_out,
    duration_ms: Date.now() - started,
    prompt_version: REVISION_PROMPT_VERSION,
    used_ai,
    successful,
    estimated_score: estimate.estimated_score,
    progress_reason: corrupted
      ? `Corruption: ${corruption_reasons.join('; ')}`
      : gate.reason,
    corrupted,
    corruption_reasons,
    category: primaryCat,
    message: `Revision #${input.attempt} ${
      successful ? 'successful' : 'unsuccessful'
    } · categories ${detBatch.categories.join('+') || 'none'} · ${countDraftWords(draft)} words · ${REVISION_ENGINE_VERSION}`,
  };
}
