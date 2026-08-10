import { useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Monitor,
  Smartphone,
  Tablet,
} from 'lucide-react';
import type {
  Article,
  ArticleObservability,
  ArticlePreview,
  PublishReadiness,
  QualityReport,
  ReviewHistoryItem,
} from '../api';
import { countBodyInternalLinks } from '../article-workflow';
import { Badge, Card, Divider, KeyValue, ScoreBar, Tabs } from '../ui';
import {
  FieldRow,
  RenderBlockBody,
  formatUsd,
  headingLabel,
  isTocBlock,
  normHeading,
  sectionAnchor,
  shouldShowHeading,
} from './article-content-render';

interface RevisionHistoryItem {
  id: number;
  attempt: number;
  before_score: number | null;
  after_score: number | null;
  fixed_issues: string[];
  remaining_issues: string[];
  provider: string | null;
  model: string | null;
  duration_ms: number | null;
  created_at: string;
  before_draft?: { blocks?: unknown[]; meta_description?: string } | null;
  after_draft?: { blocks?: unknown[]; meta_description?: string } | null;
  meta_json?: Record<string, unknown> | null;
}

type AdvSection =
  | 'preview'
  | 'schema'
  | 'history'
  | 'quality'
  | 'debug'
  | 'confidence'
  | 'cost'
  | 'health';

type Viewport = 'desktop' | 'tablet' | 'mobile';

/**
 * Collapsed-by-default Advanced accordion for completed-step inspection & debug.
 */
export default function AdvancedPanel({
  article,
  preview,
  readiness,
  qualityReport,
  history,
  revisions,
  observability,
}: {
  article: Article;
  preview: ArticlePreview;
  readiness: PublishReadiness | null;
  qualityReport: QualityReport | null;
  history: ReviewHistoryItem[];
  revisions: RevisionHistoryItem[];
  observability: ArticleObservability | null;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<AdvSection>('preview');
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [historySub, setHistorySub] = useState<'reviews' | 'revisions' | 'quality' | 'confidence' | 'cost'>(
    'reviews'
  );
  const [diffRevisionId, setDiffRevisionId] = useState<number | null>(null);

  const blocks = preview.blocks || [];
  const seo = preview.seo_package;
  const debug = article.generation_debug;
  const healthLabel =
    observability?.article_health || qualityReport?.article_health || article.article_health || null;
  const confidenceScore =
    observability?.overall_confidence ??
    qualityReport?.overall_confidence ??
    article.overall_confidence ??
    null;
  const confidenceLevel =
    observability?.confidence_level ||
    qualityReport?.confidence_level ||
    article.confidence_level ||
    null;
  const breakdown =
    observability?.confidence_breakdown || qualityReport?.confidence_breakdown || null;

  const headingToAnchor = useMemo(() => {
    const map = new Map<string, string>();
    let idx = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (!shouldShowHeading(b, i, blocks)) continue;
      if (isTocBlock(b)) continue;
      const label = headingLabel(b);
      if (!label || /^table of contents|^contents$/i.test(label)) continue;
      idx += 1;
      map.set(normHeading(label), sectionAnchor(label, idx));
    }
    return map;
  }, [blocks]);

  const previewHeadingToAnchor = useMemo(() => {
    const map = new Map<string, string>();
    for (const [k, v] of headingToAnchor.entries()) map.set(k, `${v}-preview`);
    return map;
  }, [headingToAnchor]);

  const widthClass =
    viewport === 'mobile' ? 'max-w-[390px]' : viewport === 'tablet' ? 'max-w-[768px]' : 'max-w-3xl';

  const sectionItems: Array<{ key: AdvSection; label: string }> = [
    { key: 'preview', label: 'Preview' },
    { key: 'schema', label: 'Schema' },
    { key: 'history', label: 'History' },
    { key: 'quality', label: 'Quality Report' },
    { key: 'debug', label: 'Debug' },
    { key: 'confidence', label: 'Confidence' },
    { key: 'cost', label: 'AI Cost' },
    { key: 'health', label: 'Health' },
  ];

  return (
    <div className="rounded-xl border border-slate-200/80 dark:border-white/10">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div>
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Advanced</p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            History, Schema, Preview, Quality Report, Debug, Confidence, AI Cost, Health
          </p>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-4 dark:border-white/10">
          <Tabs
            items={sectionItems}
            active={section}
            onChange={(k) => setSection(k as AdvSection)}
            className="mb-4"
          />

          {section === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ViewportBtn
                  active={viewport === 'desktop'}
                  onClick={() => setViewport('desktop')}
                  icon={<Monitor className="h-3.5 w-3.5" />}
                  label="Desktop"
                />
                <ViewportBtn
                  active={viewport === 'tablet'}
                  onClick={() => setViewport('tablet')}
                  icon={<Tablet className="h-3.5 w-3.5" />}
                  label="Tablet"
                />
                <ViewportBtn
                  active={viewport === 'mobile'}
                  onClick={() => setViewport('mobile')}
                  icon={<Smartphone className="h-3.5 w-3.5" />}
                  label="Mobile"
                />
              </div>
              <div
                className={`mx-auto ${widthClass} rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900`}
              >
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  Structured preview only
                </p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {seo?.seo_title || preview.slug}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{preview.excerpt}</p>
                <div className="mt-4 space-y-4">
                  {preview.blocks.map((b, i) => {
                    const showH = shouldShowHeading(b, i, preview.blocks);
                    const label = headingLabel(b);
                    const anchor = label ? headingToAnchor.get(normHeading(label)) : undefined;
                    return (
                      <section key={b.id}>
                        {showH && label && (
                          <h4
                            id={anchor ? `${anchor}-preview` : undefined}
                            className="mb-1 font-semibold text-slate-900 dark:text-white"
                          >
                            {label}
                          </h4>
                        )}
                        {b.type !== 'heading' && (
                          <RenderBlockBody block={b} headingToAnchor={previewHeadingToAnchor} />
                        )}
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {section === 'schema' && (
            <div className="space-y-3 text-sm">
              {!preview.json_ld && (
                <p className="text-slate-500 dark:text-slate-400">No JSON-LD yet — Generate SEO first.</p>
              )}
              {preview.json_ld && (
                <>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {Object.entries(
                      (preview.json_ld.schema_status as Record<string, unknown>) || {}
                    ).map(([k, v]) => (
                      <Badge key={k} tone={v ? 'emerald' : 'neutral'}>
                        {k}: {String(v)}
                      </Badge>
                    ))}
                  </div>
                  <pre className="max-h-[480px] overflow-auto rounded-xl bg-slate-50 p-3 text-[11px] dark:bg-white/[0.03]">
                    {JSON.stringify(preview.json_ld, null, 2)}
                  </pre>
                </>
              )}
            </div>
          )}

          {section === 'history' && (
            <div className="space-y-4">
              <Tabs
                items={[
                  { key: 'reviews', label: 'Reviews' },
                  { key: 'revisions', label: 'Revisions' },
                  { key: 'quality', label: 'Quality' },
                  { key: 'confidence', label: 'Confidence' },
                  { key: 'cost', label: 'Cost' },
                ]}
                active={historySub}
                onChange={(k) => setHistorySub(k as typeof historySub)}
              />
              {historySub === 'reviews' && (
                <div className="space-y-2">
                  {!history.length && (
                    <p className="text-sm text-slate-500">No review history yet.</p>
                  )}
                  {history.map((r) => {
                    const rolledBack = Boolean(
                      r.rolled_back || r.inactive || r.report_status === 'ROLLED_BACK'
                    );
                    return (
                      <Card key={`revw-${r.id}`} padding="p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            Review #{r.attempt} ·{' '}
                            {rolledBack ? 'Rolled back' : r.passed ? 'Pass' : 'Fail'}
                          </span>
                          <Badge tone={rolledBack ? 'neutral' : r.passed ? 'emerald' : 'rose'}>
                            score {r.score ?? '—'}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-[12px] text-slate-600 dark:text-slate-300">
                          {r.summary || '—'}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {new Date(r.created_at).toLocaleString()}
                        </p>
                      </Card>
                    );
                  })}
                </div>
              )}
              {historySub === 'revisions' && (
                <div className="space-y-2">
                  {!revisions.length && (
                    <p className="text-sm text-slate-500">No revisions yet.</p>
                  )}
                  {revisions.map((r) => {
                    const openDiff = diffRevisionId === r.id;
                    const meta = r.meta_json || {};
                    return (
                      <Card key={`fix-${r.id}`} padding="p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            Revision #{r.attempt}
                          </span>
                          <Badge tone="sky">
                            {r.before_score ?? '—'} → {r.after_score ?? '—'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {r.provider || 'router'} · {r.model || '—'} ·{' '}
                          {new Date(r.created_at).toLocaleString()}
                        </p>
                        {r.fixed_issues?.length > 0 && (
                          <ul className="mt-1.5 list-disc pl-5 text-[12px] text-emerald-700 dark:text-emerald-400">
                            {r.fixed_issues.slice(0, 6).map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          className="mt-2 text-[11px] font-semibold text-teal-700 underline-offset-2 hover:underline dark:text-teal-400"
                          onClick={() => setDiffRevisionId(openDiff ? null : r.id)}
                        >
                          {openDiff ? 'Hide diff' : 'Show draft diff summary'}
                        </button>
                        {openDiff && (
                          <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
                            <div className="rounded-lg bg-rose-50 p-2 dark:bg-rose-500/10">
                              Before: {r.before_draft?.blocks?.length ?? 0} blocks
                            </div>
                            <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-500/10">
                              After: {r.after_draft?.blocks?.length ?? 0} blocks
                              {typeof meta.score_delta === 'number'
                                ? ` · Δ ${meta.score_delta}`
                                : ''}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
              {historySub === 'quality' && (
                <div className="space-y-2">
                  {revisions.map((r) => {
                    const tl = (r.meta_json?.quality_timeline || null) as Record<
                      string,
                      { before?: number | null; after?: number | null }
                    > | null;
                    if (!tl) {
                      return (
                        <Card key={`qtl-${r.id}`} padding="p-3">
                          <p className="text-xs text-slate-500">
                            Revision #{r.attempt}: no quality timeline.
                          </p>
                        </Card>
                      );
                    }
                    return (
                      <Card key={`qtl-${r.id}`} padding="p-3">
                        <p className="text-xs font-semibold">Attempt #{r.attempt}</p>
                        <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
                          {['overall', 'readability', 'seo', 'structure', 'schema', 'internal_links'].map(
                            (k) => (
                              <span key={k}>
                                {k}: {tl[k]?.before ?? '—'} → {tl[k]?.after ?? '—'}
                              </span>
                            )
                          )}
                        </div>
                      </Card>
                    );
                  })}
                  {!revisions.length && (
                    <p className="text-sm text-slate-500">No quality timeline points yet.</p>
                  )}
                </div>
              )}
              {historySub === 'confidence' && (
                <div className="space-y-2">
                  {history.map((r) => (
                    <Card key={`conf-${r.id}`} padding="p-3">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold">Review #{r.attempt}</span>
                        <Badge tone="teal">
                          {r.overall_confidence ?? '—'}
                          {r.confidence_level ? ` · ${r.confidence_level}` : ''}
                        </Badge>
                      </div>
                      {r.confidence_breakdown && (
                        <div className="mt-2 grid gap-1 sm:grid-cols-2">
                          {Object.entries(r.confidence_breakdown).map(([k, v]) => (
                            <ScoreBar key={k} label={k} value={Number(v)} />
                          ))}
                        </div>
                      )}
                    </Card>
                  ))}
                  {!history.length && (
                    <p className="text-sm text-slate-500">No confidence history yet.</p>
                  )}
                </div>
              )}
              {historySub === 'cost' && (
                <div className="space-y-3">
                  {!observability ? (
                    <p className="text-sm text-slate-500">No cost analytics yet.</p>
                  ) : (
                    <>
                      <KeyValue
                        label="Total AI cost"
                        value={`$${observability.total_ai_cost_usd.toFixed(4)}`}
                      />
                      <KeyValue label="Total calls" value={observability.cost.total_calls} />
                      {observability.cost.by_stage.map((s) => (
                        <div
                          key={s.stage}
                          className="flex justify-between text-xs text-slate-600 dark:text-slate-300"
                        >
                          <span>{s.stage}</span>
                          <span>
                            {s.calls} · ${s.estimated_cost_usd.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {section === 'quality' && (
            <div className="space-y-4 text-sm">
              {!qualityReport && (
                <p className="text-slate-500">No quality report yet — run Review first.</p>
              )}
              {qualityReport && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        qualityReport.rolled_back || qualityReport.inactive
                          ? 'neutral'
                          : qualityReport.passed
                            ? 'emerald'
                            : qualityReport.decision === 'manual_review' || qualityReport.critical_fail
                              ? 'rose'
                              : 'amber'
                      }
                      dot
                    >
                      {qualityReport.rolled_back || qualityReport.inactive
                        ? 'Rolled Back'
                        : qualityReport.passed
                          ? 'PASSED'
                          : qualityReport.decision === 'manual_review' || qualityReport.critical_fail
                            ? 'Needs Manual Review'
                            : 'Needs Revision'}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      Overall {qualityReport.overall_score} / threshold {qualityReport.threshold}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{qualityReport.summary}</p>
                  {(qualityReport.failure_reasons?.length ?? 0) > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-200">
                      {qualityReport.failure_reasons!.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(qualityReport.scores || {}).map(([k, v]) => (
                      <ScoreBar key={k} label={k.replace(/_/g, ' ')} value={v} />
                    ))}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800/40">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Internal Links
                    </p>
                    <p className="mt-1 text-sm">
                      Body: {countBodyInternalLinks(preview.blocks)} · Package:{' '}
                      {preview.internal_links?.count ??
                        preview.internal_links?.recommendations?.length ??
                        0}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {section === 'debug' && (
            <div className="space-y-3">
              {readiness && (
                <>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Publication readiness
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {readiness.checks.map((c) => (
                      <div
                        key={c.key}
                        className={`rounded-xl border px-3 py-2 text-xs ${
                          c.passed
                            ? 'border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                            : 'border-rose-100 bg-rose-50 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
                        }`}
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span>{c.label}</span>
                          <span>{c.passed ? 'PASS' : 'FAIL'}</span>
                        </div>
                        {c.detail && <p className="mt-0.5 opacity-80">{c.detail}</p>}
                      </div>
                    ))}
                  </div>
                  <Divider />
                </>
              )}
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Generation debug
              </p>
              <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                <KeyValue label="AI Model" value={debug?.ai_model || article.ai_model || '—'} />
                <KeyValue
                  label="Prompt Version"
                  value={debug?.prompt_version ?? article.prompt_version ?? '—'}
                />
                <KeyValue
                  label="Estimated AI Cost"
                  value={formatUsd(debug?.estimated_ai_cost_usd)}
                />
                <KeyValue
                  label="Research Pack Size"
                  value={
                    debug?.research_pack_size_chars != null
                      ? `${debug.research_pack_size_chars.toLocaleString()} chars`
                      : '—'
                  }
                />
                <KeyValue label="Content type" value={article.content_type} />
                <KeyValue label="Created" value={new Date(article.created_at).toLocaleString()} />
                <KeyValue label="Updated" value={new Date(article.updated_at).toLocaleString()} />
                {article.published_at && (
                  <KeyValue
                    label="Published at"
                    value={new Date(article.published_at).toLocaleString()}
                  />
                )}
              </div>
              <Divider />
              <FieldRow label="SEO Title" value={String(seo?.seo_title || '')} />
              <FieldRow label="Meta Title" value={String(seo?.meta_title || '')} />
              <FieldRow label="Canonical" value={String(seo?.canonical || '')} />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {preview.excerpt || 'No excerpt yet.'}
              </p>
            </div>
          )}

          {section === 'confidence' && (
            <div className="space-y-3">
              <KeyValue
                label="Confidence"
                value={
                  confidenceScore != null
                    ? `${confidenceScore}${confidenceLevel ? ` (${confidenceLevel})` : ''}`
                    : '—'
                }
              />
              {breakdown &&
                Object.entries(breakdown).map(([k, v]) => (
                  <ScoreBar key={k} label={k} value={Number(v)} />
                ))}
              {!breakdown && confidenceScore == null && (
                <p className="text-sm text-slate-500">No confidence data yet.</p>
              )}
            </div>
          )}

          {section === 'cost' && (
            <div className="space-y-3">
              <KeyValue
                label="Article generation cost"
                value={formatUsd(debug?.estimated_ai_cost_usd)}
              />
              <KeyValue
                label="Total AI cost (observability)"
                value={
                  observability ? `$${observability.total_ai_cost_usd.toFixed(4)}` : '—'
                }
              />
              {observability?.provider_analytics?.map((p) => (
                <div
                  key={p.provider}
                  className="flex justify-between text-xs text-slate-600 dark:text-slate-300"
                >
                  <span>{p.provider}</span>
                  <span>
                    {p.calls} · {p.success_rate}% · ${p.estimated_cost_usd.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {section === 'health' && (
            <div className="space-y-3">
              <KeyValue label="Article health" value={healthLabel || '—'} />
              <KeyValue
                label="Revisions"
                value={observability?.revision_count ?? revisions.length}
              />
              <KeyValue label="Word count" value={preview.word_count} />
              <KeyValue label="Status" value={preview.status} />
              {healthLabel && (
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Check className="h-3.5 w-3.5 text-emerald-500" /> Health signal from latest review /
                  observability
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViewportBtn(props: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
        props.active
          ? 'bg-slate-900 text-white dark:bg-teal-600'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15'
      }`}
    >
      {props.icon}
      {props.label}
    </button>
  );
}
