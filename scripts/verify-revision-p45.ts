/**
 * P4.5 verification — issue plan + shared checks + history stats.
 * Set REVISION_TEST_ARTICLE_ID for live Auto Fix.
 */
import { initEditorialEngine } from '../lib/editorial-engine/init.ts';
import { getSettings } from '../lib/editorial-engine/db/settings-repo.ts';
import { listArticles } from '../lib/editorial-engine/db/articles-repo.ts';
import { getLatestQualityReport } from '../lib/editorial-engine/db/quality-reports-repo.ts';
import {
  applyDeterministicRepairs,
  collectHeadings,
} from '../lib/editorial-engine/revision/revision-validator.ts';
import { listRevisionHistory, getRevisionStats } from '../lib/editorial-engine/revision/revision-history.ts';
import { autoFixArticle } from '../lib/editorial-engine/revision/revision-service.ts';
import { buildIssuePlan } from '../lib/editorial-engine/validation/issue-plan.ts';
import { runSharedDeterministicChecks } from '../lib/editorial-engine/validation/shared-checks.ts';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.ts';
import type { QualityReport } from '../lib/editorial-engine/reviewer/quality-report.ts';

async function main() {
  await initEditorialEngine();
  const settings = await getSettings();
  const stats = await getRevisionStats(30);

  const { articles } = await listArticles({ limit: 5, status: 'draft' });

  let headingFixes = 0;
  let articlesTested = 0;
  let plansBuilt = 0;
  for (const a of articles.slice(0, 5)) {
    const draft = (a as { draft_json?: unknown }).draft_json as WriterDraftPayload | undefined;
    if (!draft?.blocks) continue;
    articlesTested += 1;
    const before = collectHeadings(draft);
    const uniq = new Set(before.map((h) => h.toLowerCase()));
    const hadDupes = before.length !== uniq.size;
    const repaired = applyDeterministicRepairs(draft, 'STRUCTURE');
    const after = collectHeadings(repaired.draft);
    const afterUniq = new Set(after.map((h) => h.toLowerCase()));
    if (hadDupes && after.length === afterUniq.size) headingFixes += 1;

    const checks = runSharedDeterministicChecks({ draft, settings, research: null });
    const shell = {
      passed: false,
      overall_score: 50,
      threshold: settings.quality_score_threshold,
      scores: {
        overall: 50,
        ai_review: 50,
        rule_validator: checks.rules.score,
        uniqueness: 80,
        readability: checks.readability.score,
        eeat: checks.eeat.score,
        search_intent: checks.search_intent.score,
        human_writing: checks.human_writing.score,
        helpful_content: checks.helpful_content.score,
      },
      rule_validator: checks.rules,
      readability: checks.readability,
      eeat: checks.eeat,
      search_intent: checks.search_intent,
      human_writing: checks.human_writing,
      helpful_content: checks.helpful_content,
      duplicate: {
        is_duplicate: false,
        max_similarity: 0,
        threshold: settings.duplicate_threshold,
        uniqueness_score: 80,
        matches: [],
      },
      ai_review: {
        passed: false,
        score: 50,
        rewrite_required: false,
        summary: '',
        issues: [],
        scores: {
          eeat: 50,
          search_intent: 50,
          human_writing: 50,
          helpful_content: 50,
          readability: 50,
        },
      },
      issues: [],
      failure_reasons: [],
      summary: '',
      engine_version: 'verify',
      duplicate_threshold: settings.duplicate_threshold,
    } as QualityReport;
    const plan = buildIssuePlan(shell, draft);
    if (plan.primary) plansBuilt += 1;
  }

  let live: Record<string, unknown> | null = null;
  const liveId = process.env.REVISION_TEST_ARTICLE_ID
    ? parseInt(process.env.REVISION_TEST_ARTICLE_ID, 10)
    : NaN;
  if (Number.isFinite(liveId)) {
    const beforeReport = await getLatestQualityReport(liveId);
    const beforeScore = beforeReport?.score ?? null;
    const result = await autoFixArticle(liveId);
    const history = await listRevisionHistory(liveId);
    live = {
      article_id: liveId,
      before_score: beforeScore,
      after_score: result.after_score,
      passed: result.passed,
      attempts: result.attempts,
      needs_manual_review: result.needs_manual_review,
      history_count: history.length,
      message: result.message,
      categories: result.revisions.map((r) => r.category).filter(Boolean),
    };
  }

  console.log(
    JSON.stringify(
      {
        settings: {
          auto_revision_enabled: settings.auto_revision_enabled,
          max_revision_attempts: settings.max_revision_attempts,
          quality_score_threshold: settings.quality_score_threshold,
        },
        deterministic: {
          articles_tested: articlesTested,
          duplicate_heading_repairs: headingFixes,
          issue_plans_built: plansBuilt,
        },
        verification_30d: {
          avg_attempts: stats.avg_attempts,
          avg_score_improvement: stats.avg_score_improvement,
          failure_rate: stats.failure_rate,
          manual_review_rate: stats.manual_review_rate,
          revisions: stats.revisions,
          articles: stats.articles,
        },
        live_autofix: live,
        note: live
          ? 'Live Auto Fix executed'
          : 'Set REVISION_TEST_ARTICLE_ID to run live Auto Fix against a draft',
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
