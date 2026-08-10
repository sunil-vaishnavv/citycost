/**
 * Editorial Engine certification — 10 NEW full-pipeline articles.
 *
 * Research → Writer → Review → (single-cycle Revision if needed) → SEO → Ready
 *
 * Run: npx tsx scripts/qa-certification-10.ts
 * Resume: same command (skips topics that already have a cert article)
 * Force regenerate one: npx tsx scripts/qa-certification-10.ts --only=3
 */
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initEditorialEngine } from '../lib/editorial-engine/init.js';
import {
  approveTopic,
  upsertScoredTopic,
  setTopicStatus,
  getTopicById,
} from '../lib/editorial-engine/db/topics-repo.js';
import {
  getArticleById,
  getLatestArticleByTopicId,
} from '../lib/editorial-engine/db/articles-repo.js';
import { getLatestQualityReport } from '../lib/editorial-engine/db/quality-reports-repo.js';
import { pool } from '../lib/db.js';
import type { RowDataPacket } from 'mysql2';
import {
  ensureClusterRegistry,
  getClusterBySlug,
  resolveClusterSlugForTopic,
} from '../lib/editorial-engine/strategy/cluster-registry.js';
import { generateArticleDraft, previewTopicResearch } from '../lib/editorial-engine/writer/generate.js';
import { reviewArticle } from '../lib/editorial-engine/reviewer/review.js';
import { generateArticleSeo } from '../lib/editorial-engine/seo/generate-seo.js';
import { runRevisionLoop } from '../lib/editorial-engine/revision/revision-service.js';
import type { QualityReport } from '../lib/editorial-engine/reviewer/quality-report.js';
import { countrySlugFromCode, listIndexableCities } from '../lib/seo-catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(__dirname, 'qa-certification-report.json');
const BATCH = process.env.CERT_BATCH || 'cert10-20260802k';

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? Number(onlyArg.split('=')[1]) : null;
const regenArg = process.argv.find((a) => a.startsWith('--regen='));
const REGEN = regenArg
  ? regenArg
      .split('=')[1]
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n))
  : null;

interface Spec {
  n: number;
  label: string;
  content_type: string;
  title: string;
  country: string;
  country_code: string;
  country_slug: string;
  cities: string[];
  primary_keyword: string;
  secondary_keywords: string[];
  persona: string;
  intent: string;
  guide_kind?: string;
  comparison?: { a: string; b: string; slugA: string; slugB: string };
}

function hashTopic(parts: string[]): string {
  return createHash('sha256').update(parts.join('|').toLowerCase()).digest('hex');
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 96);
}

function findCity(name: string, code: string) {
  const cities = listIndexableCities();
  return cities.find(
    (c) => c.countryCode === code && c.city.toLowerCase() === name.toLowerCase()
  );
}

function buildSpecs(): Spec[] {
  const de = countrySlugFromCode('DE');
  const berlin = findCity('Berlin', 'DE');
  const munich = findCity('Munich', 'DE');
  if (!berlin || !munich) throw new Error('Berlin/Munich missing from catalog');

  return [
    {
      n: 1,
      label: 'Germany Country Guide',
      content_type: 'country_guide',
      title: `Germany Cost of Living Country Guide: Regional Budgets and City Tradeoffs`,
      country: 'Germany',
      country_code: 'DE',
      country_slug: de,
      cities: [],
      primary_keyword: 'cost of living in Germany 2026 guide',
      secondary_keywords: [
        'Germany living costs by region',
        'is Germany expensive to live',
        'Germany monthly budget expatriates',
      ],
      persona: 'people researching a country before choosing a city',
      intent: 'informational',
      guide_kind: 'country',
    },
    {
      n: 2,
      label: 'Berlin vs Munich',
      content_type: 'comparison_guide',
      title: `Berlin vs Munich Cost of Living: Rent, Salary Stretch, and Daily Costs`,
      country: 'Germany',
      country_code: 'DE',
      country_slug: de,
      cities: ['Berlin', 'Munich'],
      primary_keyword: 'Berlin vs Munich cost of living',
      secondary_keywords: [
        'Berlin or Munich cheaper',
        'Munich vs Berlin rent',
        'cost of living Berlin Munich comparison',
      ],
      persona: 'people comparing two cities before moving',
      intent: 'commercial_investigation',
      comparison: {
        a: 'Berlin',
        b: 'Munich',
        slugA: berlin.pageSlug,
        slugB: munich.pageSlug,
      },
    },
    {
      n: 3,
      label: 'Japan Student Guide',
      content_type: 'student_guide',
      title: `Japan Student Cost of Living Guide: Housing, Food, and Campus Budgets`,
      country: 'Japan',
      country_code: 'JP',
      country_slug: countrySlugFromCode('JP'),
      cities: [],
      primary_keyword: 'Japan student cost of living',
      secondary_keywords: [
        'study in Japan budget',
        'student housing Japan costs',
        'cheap student cities Japan',
      ],
      persona: 'international students',
      intent: 'informational',
      guide_kind: 'student',
    },
    {
      n: 4,
      label: 'Canada Salary Guide',
      content_type: 'salary_guide',
      title: `Canada Salary Guide: Average Wages, Taxes, and Buying Power`,
      country: 'Canada',
      country_code: 'CA',
      country_slug: countrySlugFromCode('CA'),
      cities: [],
      primary_keyword: 'Canada average salary buying power',
      secondary_keywords: [
        'Canada wages vs cost of living',
        'living on salary in Canada',
        'Canada take-home pay guide',
      ],
      persona: 'professionals evaluating relocation offers',
      intent: 'commercial_investigation',
      guide_kind: 'salary',
    },
    {
      n: 5,
      label: 'Italy Rent Guide',
      content_type: 'rent_guide',
      title: `Italy Rent Guide: Housing Costs by City and Lease Realities`,
      country: 'Italy',
      country_code: 'IT',
      country_slug: countrySlugFromCode('IT'),
      cities: [],
      primary_keyword: 'Italy rent prices by city',
      secondary_keywords: [
        'average rent in Italy',
        'Italy apartment costs',
        'housing costs Italy expats',
      ],
      persona: 'people budgeting housing before moving',
      intent: 'commercial_investigation',
      guide_kind: 'rent',
    },
    {
      n: 6,
      label: 'France Healthcare',
      content_type: 'healthcare_guide',
      title: `France Healthcare Costs Guide: Insurance, Visits, and Expat Access`,
      country: 'France',
      country_code: 'FR',
      country_slug: countrySlugFromCode('FR'),
      cities: [],
      primary_keyword: 'France healthcare costs for expats',
      secondary_keywords: [
        'health insurance France cost',
        'medical costs France',
        'doctor visit cost France',
      ],
      persona: 'families and long-term movers',
      intent: 'informational',
      guide_kind: 'healthcare',
    },
    {
      n: 7,
      label: 'Spain Food',
      content_type: 'food_guide',
      title: `Spain Food Prices Guide: Groceries, Dining, and Monthly Food Budgets`,
      country: 'Spain',
      country_code: 'ES',
      country_slug: countrySlugFromCode('ES'),
      cities: [],
      primary_keyword: 'Spain food prices cost of living',
      secondary_keywords: [
        'grocery costs in Spain',
        'restaurant prices Spain',
        'Spain food budget monthly',
      ],
      persona: 'budget-conscious relocators',
      intent: 'informational',
      guide_kind: 'food',
    },
    {
      n: 8,
      label: 'Australia Moving',
      content_type: 'moving_guide',
      title: `Moving to Australia Cost Checklist: First-Month Budget Planner`,
      country: 'Australia',
      country_code: 'AU',
      country_slug: countrySlugFromCode('AU'),
      cities: [],
      primary_keyword: 'moving to Australia cost checklist',
      secondary_keywords: [
        'relocate to Australia budget',
        'Australia moving costs first month',
        'Australia relocation checklist',
      ],
      persona: 'people planning an international move',
      intent: 'commercial_investigation',
      guide_kind: 'moving',
    },
    {
      n: 9,
      label: 'Singapore Visa',
      content_type: 'visa_guide',
      title: `Singapore Visa and Residence Cost Guide: Fees, Deposits, and Timelines`,
      country: 'Singapore',
      country_code: 'SG',
      country_slug: countrySlugFromCode('SG'),
      cities: ['Singapore'],
      primary_keyword: 'Singapore visa costs residence',
      secondary_keywords: [
        'Singapore work visa cost',
        'Singapore residence permit fees',
        'immigration costs Singapore',
      ],
      persona: 'relocators researching legal entry costs',
      intent: 'commercial_investigation',
      guide_kind: 'visa',
    },
    {
      n: 10,
      label: 'Dubai Transport',
      content_type: 'transportation_guide',
      title: `Dubai Transportation Costs Guide: Metro, Taxi, and Car Ownership`,
      country: 'United Arab Emirates',
      country_code: 'AE',
      country_slug: countrySlugFromCode('AE'),
      cities: ['Dubai'],
      primary_keyword: 'Dubai transportation costs',
      secondary_keywords: [
        'Dubai metro taxi costs',
        'car ownership Dubai cost',
        'UAE public transport prices',
      ],
      persona: 'commuters and relocators',
      intent: 'informational',
      guide_kind: 'transportation',
    },
  ];
}

interface ArticleRow {
  n: number;
  label: string;
  content_type: string;
  title: string;
  topic_id: number | null;
  article_id: number | null;
  slug: string | null;
  overall_score: number | null;
  ai_score: number | null;
  human_writing: number | null;
  readability: number | null;
  eeat: number | null;
  search_intent: number | null;
  generation_time_ms: number | null;
  revision_needed: boolean;
  final_status: string | null;
  decision: string | null;
  ready: boolean;
  message: string;
  pipeline_ms: number;
  estimated_ai_cost_usd: number | null;
  errors?: string[];
}

function avg(nums: Array<number | null | undefined>): number {
  const v = nums.filter((x): x is number => typeof x === 'number' && !Number.isNaN(x));
  if (!v.length) return 0;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

async function findAnyArticleForTopic(topicId: number) {
  const latest = await getLatestArticleByTopicId(topicId);
  if (latest) return latest;
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM editorial_articles WHERE topic_id = $1 ORDER BY id DESC LIMIT 1`,
    [topicId]
  );
  if (!rows[0]) return null;
  return getArticleById(Number(rows[0].id));
}

async function sumAiCostForArticles(ids: number[]): Promise<number> {
  if (!pool || !ids.length) return 0;
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost
       FROM editorial_ai_usage_logs
       WHERE article_id = ANY($1::int[])`,
      [ids]
    );
    return Math.round(Number(rows[0]?.cost || 0) * 1e6) / 1e6;
  } catch {
    return 0;
  }
}

async function ensureTopic(spec: Spec): Promise<number> {
  const isComparison = spec.content_type === 'comparison_guide';
  const clusterSlug = resolveClusterSlugForTopic({
    countrySlug: spec.country_slug,
    kind: isComparison ? 'comparison' : 'country',
    persona: spec.guide_kind === 'student' ? 'students' : null,
  });
  const cluster = await getClusterBySlug(clusterSlug);

  const topicHash = hashTopic([BATCH, String(spec.n), spec.content_type, spec.country_slug]);
  // Prefer short editorial compare slugs (berlin-vs-munich) — pageSlug pairs often miss the index.
  const compareSlug = spec.comparison
    ? `${spec.comparison.a.toLowerCase().replace(/\s+/g, '-')}-vs-${spec.comparison.b.toLowerCase().replace(/\s+/g, '-')}`
    : null;

  const source_refs: Record<string, unknown> = {
    title: spec.title,
    slug: slugify(spec.title),
    intent: spec.intent,
    content_type: spec.content_type,
    primary_keyword: spec.primary_keyword,
    secondary_keywords: spec.secondary_keywords,
    persona: spec.persona,
    cluster: clusterSlug,
    parent_topic: `Cost of Living in ${spec.country}`,
    country: spec.country,
    country_code: spec.country_code,
    country_slug: spec.country_slug,
    cities: spec.cities,
    estimated_search_value: 82,
    difficulty: 48,
    priority: 'high',
    seo_reason: `Certification batch ${BATCH} — ${spec.label}`,
    internal_link_opportunities: [
      `/country/${spec.country_slug}`,
      ...spec.cities.slice(0, 2).map((c) => {
        const hit = findCity(c, spec.country_code);
        return hit ? `/city/${hit.pageSlug}` : null;
      }).filter(Boolean),
      ...(spec.comparison
        ? [
            `/city/${spec.comparison.slugA}`,
            `/city/${spec.comparison.slugB}`,
            `/compare/${compareSlug}`,
          ]
        : []),
    ],
    guide_kind: spec.guide_kind || null,
    seasonal_hint: null,
    geo_priority: 80,
    cert_batch: BATCH,
  };

  if (spec.comparison && compareSlug) {
    source_refs.comparison_slug = compareSlug;
    source_refs.page_slug_a = spec.comparison.slugA;
    source_refs.page_slug_b = spec.comparison.slugB;
    source_refs.query_a = `${spec.comparison.a}, ${spec.country}`;
    source_refs.query_b = `${spec.comparison.b}, ${spec.country}`;
    source_refs.href = `/compare/${compareSlug}`;
    source_refs.comparison_tier = 'same_country_major';
  } else {
    source_refs.href = `/country/${spec.country_slug}`;
  }

  const topicId = await upsertScoredTopic({
    title: spec.title,
    cluster_id: cluster?.id ?? null,
    content_type: spec.content_type,
    source_refs,
    priority_score: 90,
    topic_hash: topicHash,
    rationale: [`certification:${BATCH}`, spec.label],
    status: 'approved',
  });

  const topic = await getTopicById(topicId);
  if (topic && topic.status === 'candidate') {
    try {
      await approveTopic(topicId);
    } catch {
      await setTopicStatus(topicId, 'approved');
    }
  } else if (topic && ['draft', 'generating', 'review', 'published'].includes(topic.status)) {
    // Already used — leave status; generate will refuse. Caller handles resume via article.
  } else if (topic && topic.status !== 'approved' && topic.status !== 'scheduled') {
    await setTopicStatus(topicId, 'approved');
  }

  return topicId;
}

function scoresFromReport(report: QualityReport | null | undefined) {
  const s = report?.scores;
  return {
    overall_score: s?.overall ?? report?.overall_score ?? null,
    ai_score: s?.ai_review ?? report?.ai_review?.score ?? null,
    human_writing: s?.human_writing ?? null,
    readability: s?.readability ?? null,
    eeat: s?.eeat ?? null,
    search_intent: s?.search_intent ?? null,
    decision: report?.decision ?? null,
    ready: Boolean(report?.ready || report?.decision === 'approved'),
  };
}

async function runOne(spec: Spec): Promise<ArticleRow> {
  const started = Date.now();
  const row: ArticleRow = {
    n: spec.n,
    label: spec.label,
    content_type: spec.content_type,
    title: spec.title,
    topic_id: null,
    article_id: null,
    slug: null,
    overall_score: null,
    ai_score: null,
    human_writing: null,
    readability: null,
    eeat: null,
    search_intent: null,
    generation_time_ms: null,
    revision_needed: false,
    final_status: null,
    decision: null,
    ready: false,
    message: '',
    pipeline_ms: 0,
    estimated_ai_cost_usd: null,
    errors: [],
  };

  try {
    const topicId = await ensureTopic(spec);
    row.topic_id = topicId;
    console.error(`\n======== [${spec.n}/10] ${spec.label} · topic #${topicId} ========`);

    // Resume if article already ready for this topic
    let existing = await findAnyArticleForTopic(topicId);
    if (existing?.status === 'review' && (existing.quality_score ?? 0) >= 75) {
      const report = await getLatestQualityReport(existing.id);
      const sc = scoresFromReport(report?.findings_json as QualityReport | undefined);
      Object.assign(row, {
        article_id: existing.id,
        slug: existing.slug,
        ...sc,
        overall_score: sc.overall_score ?? existing.quality_score,
        final_status: existing.status,
        revision_needed: false,
        message: 'Resumed existing READY article',
        pipeline_ms: Date.now() - started,
      });
      console.error(`RESUME ready article #${existing.id} score=${row.overall_score}`);
      return row;
    }

    // Research
    try {
      const research = await previewTopicResearch(topicId);
      console.error(
        `Research OK intent=${research.research.intent} kw=${research.research.target_keyword}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Research preview warn: ${msg}`);
    }

    // Writer (or reuse draft)
    let articleId = existing?.id ?? null;
    if (!existing || !['draft', 'review', 'needs_manual_review'].includes(existing.status)) {
      // Topic may be locked in generating/draft from prior run — reset if needed
      const topic = await getTopicById(topicId);
      if (topic && !['candidate', 'approved', 'scheduled'].includes(topic.status)) {
        await setTopicStatus(topicId, 'approved');
      }
      const genStarted = Date.now();
      const gen = await generateArticleDraft(topicId);
      row.generation_time_ms = Date.now() - genStarted;
      if (!gen.ok || !gen.article_id) {
        row.message = gen.message || 'Writer failed';
        row.errors = gen.errors || ['writer_failed'];
        row.pipeline_ms = Date.now() - started;
        console.error(`WRITER FAIL: ${row.message}`);
        return row;
      }
      articleId = gen.article_id;
      row.article_id = articleId;
      row.slug = gen.slug || null;
      console.error(
        `Writer OK #${articleId} words=${gen.word_count} ms=${row.generation_time_ms}`
      );
    } else {
      articleId = existing.id;
      row.article_id = articleId;
      row.slug = existing.slug;
      console.error(`Reusing article #${articleId} status=${existing.status}`);
    }

    // Review
    let review = await reviewArticle(articleId!);
    console.error(
      `Review1 ok=${review.ok} passed=${review.passed} score=${review.overall_score} decision=${review.decision} status=${review.status} msg=${(review.message || '').slice(0, 220)}`
    );
    if (!review.ok) {
      row.message = review.message || 'Review failed';
      row.errors = review.errors || ['review_failed'];
      row.final_status = review.status;
      row.pipeline_ms = Date.now() - started;
      return row;
    }

    if (!review.ok || !review.passed) {
      // Single-cycle revision also for soft manual_review (e.g. stale draft near-dup) when forceable.
      row.revision_needed = true;
      console.error(`Starting single-cycle revision (decision=${review.decision})…`);
      const loop = await runRevisionLoop(articleId!, {
        maxAttempts: 1,
        force: true,
        reuseLatestReport: true,
      });
      console.error(
        `Revision passed=${loop.passed} ${loop.before_score}→${loop.after_score} :: ${loop.message}`
      );
      review = {
        ok: loop.ok,
        passed: loop.passed,
        article_id: articleId!,
        overall_score: loop.after_score ?? undefined,
        status: loop.status,
        message: loop.message,
        report: loop.final_report,
        decision: loop.passed
          ? 'approved'
          : loop.needs_manual_review || loop.status === 'needs_manual_review'
            ? 'manual_review'
            : 'revision',
      };
    }

    // SEO + internal links (even if not fully ready — record attempt)
    if (review.passed || review.status === 'review') {
      const seo = await generateArticleSeo(articleId!);
      console.error(
        `SEO ok=${seo.ok} links=${seo.internal_links?.count ?? '?'} score=${seo.seo_validation?.seo_score ?? '—'}`
      );
      if (!seo.ok) {
        row.errors?.push(seo.message || 'seo_failed');
      }
    }

    const article = await getArticleById(articleId!);
    const report =
      review.report ||
      ((await getLatestQualityReport(articleId!))?.findings_json as QualityReport | undefined);
    const sc = scoresFromReport(report);
    row.article_id = articleId;
    row.slug = article?.slug ?? row.slug;
    row.overall_score = sc.overall_score ?? article?.quality_score ?? null;
    row.ai_score = sc.ai_score;
    row.human_writing = sc.human_writing;
    row.readability = sc.readability;
    row.eeat = sc.eeat;
    row.search_intent = sc.search_intent;
    row.final_status = article?.status ?? review.status;
    row.decision = sc.decision ?? review.decision ?? null;
    row.ready = Boolean(
      row.final_status === 'review' && (row.decision === 'approved' || sc.ready)
    );
    row.message = review.message || '';
    row.pipeline_ms = Date.now() - started;
    row.estimated_ai_cost_usd = await sumAiCostForArticles([articleId!]);

    console.error(
      `DONE ready=${row.ready} status=${row.final_status} overall=${row.overall_score} human=${row.human_writing} read=${row.readability}`
    );
    return row;
  } catch (err) {
    row.message = err instanceof Error ? err.message : String(err);
    row.errors = [row.message];
    row.pipeline_ms = Date.now() - started;
    console.error(`FATAL: ${row.message}`);
    return row;
  }
}

function evaluate(rows: ArticleRow[]) {
  const overall = avg(rows.map((r) => r.overall_score));
  const human = avg(rows.map((r) => r.human_writing));
  const readability = avg(rows.map((r) => r.readability));
  const readyCount = rows.filter((r) => r.ready).length;
  const manualCount = rows.filter(
    (r) => r.final_status === 'needs_manual_review' || r.decision === 'manual_review'
  ).length;
  const revisionCount = rows.filter((r) => r.revision_needed).length;
  const passRate = rows.filter((r) => r.ready && (r.overall_score ?? 0) >= 75).length / rows.length;
  const readyRate = readyCount / rows.length;
  const revisionRate = revisionCount / rows.length;
  const manualReviewRate = manualCount / rows.length;

  const criteria = {
    avg_overall_ge_85: overall >= 85,
    avg_human_writing_ge_75: human >= 75,
    avg_readability_ge_55: readability >= 55,
    manual_review_rate_lt_5pct: manualReviewRate < 0.05,
    ready_rate_gt_90pct: readyRate > 0.9,
  };
  const certified = Object.values(criteria).every(Boolean);

  return {
    averages: {
      overall,
      human_writing: human,
      readability,
      ai_score: avg(rows.map((r) => r.ai_score)),
      eeat: avg(rows.map((r) => r.eeat)),
      search_intent: avg(rows.map((r) => r.search_intent)),
    },
    rates: {
      pass_rate: Math.round(passRate * 1000) / 10,
      ready_rate: Math.round(readyRate * 1000) / 10,
      revision_rate: Math.round(revisionRate * 1000) / 10,
      manual_review_rate: Math.round(manualReviewRate * 1000) / 10,
    },
    counts: {
      total: rows.length,
      ready: readyCount,
      manual_review: manualCount,
      revision_needed: revisionCount,
    },
    criteria,
    certified,
    verdict: certified ? '✅ CERTIFIED' : '❌ NOT CERTIFIED',
  };
}

function printTable(rows: ArticleRow[]) {
  console.log('\n=== PER-ARTICLE RESULTS ===');
  console.log(
    [
      'N',
      'Label',
      'Overall',
      'AI',
      'Human',
      'Read',
      'EEAT',
      'Intent',
      'GenMs',
      'Rev?',
      'Status',
      'Ready',
    ].join('\t')
  );
  for (const r of rows) {
    console.log(
      [
        r.n,
        r.label,
        r.overall_score ?? '—',
        r.ai_score ?? '—',
        r.human_writing ?? '—',
        r.readability ?? '—',
        r.eeat ?? '—',
        r.search_intent ?? '—',
        r.generation_time_ms ?? '—',
        r.revision_needed ? 'yes' : 'no',
        r.final_status ?? '—',
        r.ready ? 'YES' : 'no',
      ].join('\t')
    );
  }
}

async function main() {
  const wallStart = Date.now();
  console.error(`Certification batch ${BATCH}`);
  const runtime = await initEditorialEngine();
  if (!runtime.ready) {
    console.error('Editorial engine not ready');
    process.exit(1);
  }
  if (!runtime.ai.isConfigured()) {
    console.error('No AI providers configured');
    process.exit(1);
  }

  // Only seed registry if our first cluster is missing (full seed is slow on remote DB).
  const probe = await getClusterBySlug('germany-cost-of-living');
  if (!probe) {
    console.error('Seeding cluster registry (missing germany-cost-of-living)…');
    await ensureClusterRegistry(50);
  } else {
    console.error('Cluster registry present — skipping full seed');
  }
  const specs = buildSpecs();
  const selected =
    REGEN != null
      ? specs.filter((s) => REGEN.includes(s.n))
      : ONLY != null
        ? specs.filter((s) => s.n === ONLY)
        : specs;

  let priorRows: ArticleRow[] = [];
  if (existsSync(REPORT_PATH) && (ONLY != null || REGEN != null)) {
    try {
      const prev = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { articles?: ArticleRow[] };
      priorRows = prev.articles || [];
    } catch {
      /* ignore */
    }
  }
  console.error(`Regenerating specs: ${selected.map((s) => s.n).join(',') || 'all'}`);

  const rows: ArticleRow[] = [...priorRows];
  for (const spec of selected) {
    const result = await runOne(spec);
    const idx = rows.findIndex((r) => r.n === spec.n);
    if (idx >= 0) rows[idx] = result;
    else rows.push(result);
    rows.sort((a, b) => a.n - b.n);

    const partial = {
      batch: BATCH,
      updated_at: new Date().toISOString(),
      articles: rows,
      evaluation: rows.length ? evaluate(rows) : null,
      fixes_applied: [
        'research-synth anti-bleed',
        'article_angle seo_reason guard',
        'human_writing bleed scoring',
        'STYLE bleed strip + section prompt fixes',
      ],
      wall_time_ms: Date.now() - wallStart,
    };
    writeFileSync(REPORT_PATH, JSON.stringify(partial, null, 2));
  }

  // Fill missing slots from prior if --only
  const full = buildSpecs().map((s) => rows.find((r) => r.n === s.n)).filter(Boolean) as ArticleRow[];
  const evaluation = evaluate(full.length === 10 ? full : rows);
  const articleIds = rows.map((r) => r.article_id).filter((x): x is number => x != null);
  const totalCost = await sumAiCostForArticles(articleIds);

  const report = {
    batch: BATCH,
    finished_at: new Date().toISOString(),
    wall_time_ms: Date.now() - wallStart,
    wall_time_min: Math.round(((Date.now() - wallStart) / 60000) * 10) / 10,
    estimated_ai_cost_usd: totalCost,
    articles: (full.length === 10 ? full : rows).sort((a, b) => a.n - b.n),
    evaluation,
    fixes_applied: [
      'research-synth: stop injecting persona/intent/article_angle into section prose',
      'research/build: reject strategy seo_reason as article_angle',
      'context-pack: reader-facing indexed averages (no Country signals label)',
      'scorers: detect prompt/meta bleed in human_writing',
      'revision-validator: strip bleed patterns on STYLE repair',
      'prompt-builder: section-batch anti-bleed + higher words_per_section',
      'generate: STYLE cleanup after research_synth_fallback; prefer full synth + trimDraftToMaxWords',
      'issue-plan: always enqueue weak_human_writing when HW < 60',
      'draft-validate: trimDraftToMaxWords to enforce article_length_max',
      'research-synth: heading-aware unique sections (no cross-H2 boilerplate)',
      'scorers: penalize near-identical repeated paragraphs',
      'context-pack: resolve comparison via short slug / cities[] fallback',
      'entities: keep comparison pair primary; parse title X vs Y',
      'writer: normalize block type aliases (section/text/h2); rescue dropped merges; lower sanitize floor',
      'duplicate scan: only review+published peers (ignore abandoned drafts)',
      'decision: soft AI style after single-cycle when deterministic gates pass',
      'quality-report: calibrate AI HW/score when heuristic is clean',
      'research-synth: stop intra-paragraph pad loops (max 2 pad sentences)',
    ],
    notes:
      'Chile #6 and prior drafts excluded. All 10 topics use unique cert_batch hashes.',
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  printTable(report.articles);
  console.log('\n=== AVERAGES ===');
  console.log(JSON.stringify(evaluation.averages, null, 2));
  console.log('\n=== RATES ===');
  console.log(JSON.stringify(evaluation.rates, null, 2));
  console.log('\n=== CRITERIA ===');
  console.log(JSON.stringify(evaluation.criteria, null, 2));
  console.log(`\nOverall: ${evaluation.verdict}`);
  console.log(`Wall time: ${report.wall_time_min} min · AI cost estimate: $${totalCost}`);
  console.log(`Report: ${REPORT_PATH}`);

  process.exit(evaluation.certified ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
