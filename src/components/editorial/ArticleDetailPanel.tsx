import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
  Pencil,
} from 'lucide-react';
import {
  api,
  ApiError,
  getAuthToken,
  type Article,
  type ArticleObservability,
  type ArticlePreview,
  type ArticleRaw,
  type PublishReadiness,
  type QualityReport,
  type ResearchPreview,
  type ReviewArticleResponse,
  type ReviewHistoryItem,
} from './api';
import {
  countBodyInternalLinks,
  deriveArticleWorkflow,
  hasResearchPack,
  type PrimaryActionId,
  type WizardStepKey,
} from './article-workflow';
import { useEditorialJobsOptional } from './jobs/JobsProvider';
import {
  loadTrackedJobIds,
  saveTrackedJobIds,
  type DraftJobView,
} from './jobs/types';
import {
  Badge,
  Button,
  Callout,
  Card,
  Divider,
  KeyValue,
  PageLoader,
  ScoreBar,
  StatusPill,
} from './ui';
import AdvancedPanel from './wizard/AdvancedPanel';
import WizardProgress from './wizard/WizardProgress';
import PublishedContentEditor from './PublishedContentEditor';
import ManualBlogEditor, { isManualArticle } from './ManualBlogEditor';
import { extractFeaturedImage } from './manual-html-blocks';
import {
  FieldRow,
  PreviewHeading,
  RenderBlockBody,
  headingLabel,
  isTocBlock,
  normHeading,
  sectionAnchor,
  shouldShowHeading,
} from './wizard/article-content-render';

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

type BusyKind =
  | 'research'
  | 'draft'
  | 'seo'
  | 'review'
  | 'revise'
  | 'publish'
  | 'unpublish'
  | 'update'
  | 'export'
  | null;

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export default function ArticleDetailPanel({
  articleId,
  onChanged,
  onNavigateArticle,
}: {
  articleId: number;
  onChanged?: () => void;
  /** When generate creates a different article id, parent can open it */
  onNavigateArticle?: (id: number) => void;
}) {
  const [article, setArticle] = useState<Article | null>(null);
  const [preview, setPreview] = useState<ArticlePreview | null>(null);
  const [raw, setRaw] = useState<ArticleRaw | null>(null);
  const [history, setHistory] = useState<ReviewHistoryItem[]>([]);
  const [readiness, setReadiness] = useState<PublishReadiness | null>(null);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [revisions, setRevisions] = useState<RevisionHistoryItem[]>([]);
  const [observability, setObservability] = useState<ArticleObservability | null>(null);
  const [sessionResearch, setSessionResearch] = useState<ResearchPreview | null>(null);
  const [forceStage, setForceStage] = useState<WizardStepKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyKind>(null);
  const jobsCtx = useEditorialJobsOptional();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [blogPreviewOpen, setBlogPreviewOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [qualityDetailsOpen, setQualityDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [contentEditOpen, setContentEditOpen] = useState(false);
  const [revisionRunning, setRevisionRunning] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Reconnect Fix Issues job → open the shared AI Jobs drawer (same as Draft Generation)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.get<{
          job: { id: number; status: string } | null;
        }>(`/api/editorial/articles/${articleId}/revision-job`);
        if (cancelled || !data.job) return;
        if (data.job.status === 'queued' || data.job.status === 'running') {
          setRevisionRunning(true);
          const ids = loadTrackedJobIds();
          saveTrackedJobIds([data.job.id, ...ids.filter((x) => x !== data.job!.id)]);
          jobsCtx?.openDrawer(data.job.id);
          void jobsCtx?.refreshJobs();
        } else if (data.job.status === 'failed') {
          // Keep drawer available for Retry
          const ids = loadTrackedJobIds();
          saveTrackedJobIds([data.job.id, ...ids.filter((x) => x !== data.job!.id)]);
          jobsCtx?.openDrawer(data.job.id);
          void jobsCtx?.refreshJobs();
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect once per article open
  }, [articleId]);

  // Auto-refresh article when Fix Issues job finishes (drawer may stay open on failure)
  useEffect(() => {
    if (!jobsCtx) return;
    return jobsCtx.subscribeJobTerminal((job: DraftJobView) => {
      if (job.job_type !== 'revision_batch') return;
      const aid = Number(job.article_id || job.progress.article_id);
      if (aid !== articleId) return;
      setRevisionRunning(false);
      setForceStage(null);
      void (async () => {
        await load();
        onChanged?.();
        if (job.status === 'failed') {
          setMessage('');
          setError(job.error_message || job.progress.failure_reason || 'Fix Issues failed');
          return;
        }
        const passed = job.progress.passed === true;
        const detail = job.progress.result_message || '';
        if (passed) {
          setMessage(detail || 'Fix Issues finished — article is Ready to Publish.');
          setError('');
        } else {
          setMessage('');
          setError(
            detail ||
              'Fix Issues finished but review still needs revision. Quality was refreshed.'
          );
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable per article
  }, [jobsCtx, articleId]);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [overflowOpen]);

  useEffect(() => {
    if (busy !== 'draft') return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000);
      setMessage(
        `Generating draft — section batches, FAQ, and quality checks… ${sec}s elapsed (usually 45–90s).`
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      // Load article first so server can auto-strip cert-batch noise from title/slug
      const articleRes = await api.get<{ article: Article }>(
        `/api/editorial/articles/${articleId}`
      );
      const [previewRes, historyRes, readinessRes, rawRes, revRes, obsRes] = await Promise.all([
        api.get<{ preview: ArticlePreview }>(`/api/editorial/articles/${articleId}/preview`),
        api.get<{ reports: ReviewHistoryItem[] }>(`/api/editorial/articles/${articleId}/reviews`),
        api.get<{ readiness: PublishReadiness }>(
          `/api/editorial/articles/${articleId}/publish-readiness`
        ),
        api.get<ArticleRaw>(`/api/editorial/articles/${articleId}/raw`).catch(() => null),
        api
          .get<{ revisions: RevisionHistoryItem[] }>(
            `/api/editorial/articles/${articleId}/revisions`
          )
          .catch(() => ({ revisions: [] as RevisionHistoryItem[] })),
        api
          .get<ArticleObservability>(`/api/editorial/articles/${articleId}/observability`)
          .catch(() => null),
      ]);
      setArticle(articleRes.article);
      setPreview(previewRes.preview);
      setHistory(historyRes.reports || []);
      setReadiness(readinessRes.readiness);
      setRaw(rawRes);
      setRevisions(revRes.revisions || []);
      setObservability(obsRes);
      try {
        const qr = await api.get<{
          report: { findings_json: QualityReport; passed: boolean; score: number };
        }>(`/api/editorial/articles/${articleId}/quality-report`);
        const findings = qr.report.findings_json || ({} as QualityReport);
        if (!findings.passed && !(findings.failure_reasons?.length)) {
          const derived: string[] = [];
          if (
            typeof findings.overall_score === 'number' &&
            typeof findings.threshold === 'number' &&
            findings.overall_score < findings.threshold
          ) {
            derived.push(
              `Overall quality score ${findings.overall_score} is below threshold ${findings.threshold}`
            );
          }
          if (findings.summary) derived.push(findings.summary);
          if (findings.issues?.length) derived.push(...findings.issues.slice(0, 3));
          findings.failure_reasons = derived.length
            ? derived
            : ['Quality review did not pass — re-run Review for a detailed breakdown'];
        }
        setQualityReport(findings);
      } catch {
        setQualityReport(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load article');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSessionResearch(null);
    setForceStage(null);
    setMessage('');
    setError('');
    setBusy(null);
    setConfirmPublish(false);
    setContentEditOpen(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  const runResearch = async () => {
    const topicId = article?.topic_id;
    if (!topicId) {
      setError('No topic linked — research is available when the article has a topic_id.');
      return;
    }
    setBusy('research');
    setMessage('Loading research pack…');
    setError('');
    try {
      const result = await api.get<{ research: ResearchPreview }>(
        `/api/editorial/articles/research-preview${qs({ topic_id: topicId })}`
      );
      setSessionResearch(result.research);
      setMessage('Research ready — continuing to Writing.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Research preview failed');
      setMessage('');
    } finally {
      setBusy(null);
    }
  };

  const runGenerateDraft = async () => {
    const topicId = article?.topic_id;
    if (!topicId) {
      setError('No topic linked — generate drafts from Topics, or open an article that already has content.');
      return;
    }
    setBusy('draft');
    setMessage('Queuing background draft job…');
    setError('');
    try {
      if (jobsCtx) {
        const result = await jobsCtx.enqueueGenerate(topicId);
        if (!result.ok || !result.jobId) {
          setError(result.message || result.error || 'Failed to queue draft');
          setMessage('');
          return;
        }
        setMessage(`Draft job #${result.jobId} queued — track progress in AI Jobs (header). Safe to leave this page.`);
        return;
      }
      const result = await api.post<{
        ok: boolean;
        message: string;
        jobId?: number;
      }>('/api/editorial/articles/generate', { topic_id: topicId });
      if (!result.ok || !result.jobId) {
        setError(result.message || 'Failed to queue draft');
        setMessage('');
        return;
      }
      setMessage(`Draft job #${result.jobId} queued — watch AI Jobs in the header.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to queue draft');
      setMessage('');
    } finally {
      setBusy(null);
    }
  };

  const runSeo = async () => {
    setBusy('seo');
    setMessage('Generating SEO package & internal links…');
    setError('');
    try {
      const result = await api.post<{ ok: boolean; message: string }>(
        `/api/editorial/articles/${articleId}/seo/generate`
      );
      setMessage(result.message || 'SEO & links generated — continuing to Review.');
      setForceStage('review');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'SEO generation failed');
      setMessage('');
    } finally {
      setBusy(null);
    }
  };

  const runReview = async () => {
    setBusy('review');
    setMessage('Running quality review…');
    setError('');
    try {
      const result = await api.post<ReviewArticleResponse>(
        `/api/editorial/articles/${articleId}/review`
      );
      setForceStage(null);
      await load();
      onChanged?.();
      if (result.passed) {
        setMessage(result.message || 'Review passed — ready to publish.');
        setError('');
      } else {
        setMessage('');
        setError('');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Review failed');
      setMessage('');
    } finally {
      setBusy(null);
    }
  };

  const runAutoFix = async () => {
    setBusy('revise');
    setMessage('Queuing Fix Issues revision batch…');
    setError('');
    try {
      if (jobsCtx) {
        const result = await jobsCtx.enqueueRevision(articleId);
        if (!result.ok || !result.jobId) {
          setError(result.message || result.error || 'Failed to queue Fix Issues');
          setMessage('');
          return;
        }
        setRevisionRunning(true);
        setMessage(
          result.message ||
            `Fix Issues job #${result.jobId} running — track progress in the AI Jobs drawer. Safe to leave this page.`
        );
        setError('');
        return;
      }
      const result = await api.post<{
        ok: boolean;
        jobId?: number;
        status?: string;
        message: string;
        async?: boolean;
      }>(`/api/editorial/articles/${articleId}/revise`);
      if (result.jobId) {
        setRevisionRunning(true);
        const ids = loadTrackedJobIds();
        saveTrackedJobIds([result.jobId, ...ids.filter((x) => x !== result.jobId)]);
        setMessage(result.message || 'Fix Issues running in the background…');
        setError('');
      } else {
        setMessage(result.message || 'Revision queued');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auto fix failed');
      setMessage('');
    } finally {
      setBusy(null);
    }
  };

  const confirmAndPublish = async () => {
    setBusy('publish');
    setMessage('Publishing…');
    setError('');
    try {
      const result = await api.post<{
        ok: boolean;
        message: string;
        slug?: string;
        errors?: Array<{ message: string }>;
      }>(`/api/editorial/articles/${articleId}/publish`);
      if (!result.ok) {
        const errs = (result.errors || []).map((e) => e.message).filter(Boolean).join('; ');
        throw new Error(errs || result.message || 'Publish failed');
      }
      setMessage(`Published · /blog/${result.slug}`);
      setConfirmPublish(false);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
      setMessage('');
    } finally {
      setBusy(null);
    }
  };

  const runUnpublish = async () => {
    if (!window.confirm('Unpublish this article? It will return to review and leave the public blog.')) {
      return;
    }
    setBusy('unpublish');
    setError('');
    try {
      const result = await api.post<{ ok: boolean; message: string }>(
        `/api/editorial/articles/${articleId}/unpublish`
      );
      setMessage(result.message);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unpublish failed');
    } finally {
      setBusy(null);
    }
  };

  const exportDebugBundle = async () => {
    setBusy('export');
    setError('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/editorial/articles/${articleId}/export-debug`, {
        headers,
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError((data as { error?: string }).error || 'Export failed', res.status);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `article-${articleId}-debug-bundle.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Debug bundle downloaded.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const blocks = preview?.blocks || [];
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

  if (loading && !preview) {
    return <PageLoader label="Loading article…" />;
  }

  if (!preview || !article) {
    return <Callout tone="rose">{error || 'Article unavailable'}</Callout>;
  }

  const research = sessionResearch || raw?.research_pack_json || null;
  const hasResearch = hasResearchPack({
    researchPack: raw?.research_pack_json,
    researchPackSizeChars: article.generation_debug?.research_pack_size_chars,
    sessionResearch,
  });

  const workflow = deriveArticleWorkflow({
    status: preview.status,
    preview,
    qualityReport,
    readiness,
    hasResearch,
    topicId: article.topic_id,
    busy,
    forceStage,
  });

  const manualArticle = isManualArticle(article);

  const seo = preview.seo_package;
  const links = preview.internal_links?.recommendations || [];
  const panel = preview.quality_panel;
  const bodyLinkCount = countBodyInternalLinks(preview.blocks);
  const liveUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/blog/${preview.slug}`;

  const actionsLocked =
    busy === 'revise' ||
    busy === 'review' ||
    busy === 'seo' ||
    busy === 'publish' ||
    busy === 'update' ||
    busy === 'research' ||
    busy === 'draft';

  const displayAction: PrimaryActionId =
    busy === 'revise'
      ? 'auto_fix'
      : busy === 'review'
        ? 'run_review'
        : busy === 'seo'
          ? 'generate_seo_links'
          : busy === 'publish'
            ? 'publish'
            : busy === 'research'
              ? 'start_research'
              : busy === 'draft'
                ? 'generate_draft'
                : workflow.primaryAction;

  const runPrimaryAction = (action: PrimaryActionId) => {
    if (action === 'start_research') void runResearch();
    else if (action === 'generate_draft') void runGenerateDraft();
    else if (action === 'generate_seo_links') void runSeo();
    else if (action === 'continue_review') {
      setForceStage('review');
      setMessage('Continuing to Review…');
    } else if (action === 'run_review') void runReview();
    else if (action === 'auto_fix') void runAutoFix();
    else if (action === 'publish') setConfirmPublish(true);
    else if (action === 'view_live') window.open(`/blog/${preview.slug}`, '_blank', 'noreferrer');
  };

  const primaryIcon =
    displayAction === 'start_research' ? (
      <Search className="h-3.5 w-3.5" />
    ) : displayAction === 'generate_draft' ? (
      <FileText className="h-3.5 w-3.5" />
    ) : displayAction === 'generate_seo_links' || displayAction === 'continue_review' ? (
      <Sparkles className="h-3.5 w-3.5" />
    ) : displayAction === 'run_review' ? (
      <ShieldCheck className="h-3.5 w-3.5" />
    ) : displayAction === 'auto_fix' ? (
      <Wand2 className="h-3.5 w-3.5" />
    ) : displayAction === 'publish' ? (
      <Globe className="h-3.5 w-3.5" />
    ) : displayAction === 'view_live' ? (
      <Eye className="h-3.5 w-3.5" />
    ) : undefined;

  const primaryLoading = Boolean(busy && busy !== 'export' && busy !== 'unpublish');
  const showHeaderPrimary =
    displayAction !== 'none' &&
    !(workflow.showAutoFixBanner && displayAction === 'auto_fix') &&
    workflow.stage !== 'published';

  const copyLiveUrl = async () => {
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy URL');
    }
  };

  return (
    <Card padding="p-0" className="overflow-hidden">
      {/* Minimal header */}
      <div className="border-b border-slate-100 px-5 py-4 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold text-slate-900 dark:text-white">
              {seo?.seo_title || article.seo_title || preview.slug}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              /blog/{preview.slug}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusPill status={preview.status} />
              {manualArticle ? (
                <Badge tone="sky">Manual</Badge>
              ) : (
                <Badge tone="neutral">Automatic</Badge>
              )}
              {!manualArticle && <Badge tone="sky">{workflow.stageLabel}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {preview.status === 'published' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  disabled={actionsLocked || contentEditOpen}
                  onClick={() => {
                    setContentEditOpen(true);
                    setError('');
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === 'unpublish'}
                  disabled={actionsLocked || contentEditOpen}
                  onClick={() => void runUnpublish()}
                >
                  Unpublish
                </Button>
              </>
            )}
            <div className="relative" ref={overflowRef}>
              <Button
                size="sm"
                variant="outline"
                icon={<MoreHorizontal className="h-3.5 w-3.5" />}
                disabled={actionsLocked}
                onClick={() => setOverflowOpen((o) => !o)}
                aria-label="More actions"
              >
                More
              </Button>
              {overflowOpen && (
                <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-slate-900">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                    onClick={() => {
                      setOverflowOpen(false);
                      void exportDebugBundle();
                    }}
                  >
                    <Download className="h-3.5 w-3.5" /> Export Debug
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {!manualArticle && (
          <div className="mt-4">
            <WizardProgress steps={workflow.steps} />
          </div>
        )}
      </div>

      {(message || error) && (
        <div className="space-y-1.5 border-b border-slate-100 px-5 py-2.5 dark:border-white/10">
          {message && (
            <p className="whitespace-pre-wrap text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {message}
            </p>
          )}
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-500/30 dark:bg-rose-500/10">
              <p className="whitespace-pre-wrap text-xs font-medium text-rose-700 dark:text-rose-300">
                {error}
              </p>
            </div>
          )}
        </div>
      )}

      {blogPreviewOpen && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-sm sm:p-6">
          <div className="editorial-fade-in flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-white/10">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
                  Blog preview
                </p>
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {seo?.seo_title || article.seo_title || preview.slug}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {preview.status === 'published' && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<ExternalLink className="h-3.5 w-3.5" />}
                    onClick={() =>
                      window.open(`/blog/${preview.slug}`, '_blank', 'noreferrer')
                    }
                  >
                    Open live
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setBlogPreviewOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
            <div className="overflow-y-auto px-5 py-6 sm:px-8">
              <article className="mx-auto max-w-2xl">
                <p className="text-xs text-slate-400">/blog/{preview.slug}</p>
                <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {seo?.seo_title || article.seo_title || preview.slug}
                </h1>
                {preview.excerpt && (
                  <p className="mt-3 text-base text-slate-600 dark:text-slate-300">
                    {preview.excerpt}
                  </p>
                )}
                {(() => {
                  const fi = extractFeaturedImage(raw?.draft_json);
                  if (!fi?.url) return null;
                  return (
                    <img
                      src={fi.url}
                      alt={fi.alt || seo?.seo_title || article.seo_title || 'Featured'}
                      className="mt-5 aspect-[16/9] w-full rounded-xl border border-slate-200 object-cover dark:border-white/10"
                    />
                  );
                })()}
                <p className="mt-2 text-xs text-slate-400">
                  {preview.word_count} words
                  {preview.reading_time_minutes != null
                    ? ` · ${preview.reading_time_minutes} min read`
                    : ''}
                  {preview.status !== 'published' ? ' · Draft preview (not live)' : ''}
                </p>
                <Divider className="my-6" />
                <div className="space-y-5 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                  {preview.blocks.map((b, i) => {
                    const showH = shouldShowHeading(b, i, preview.blocks);
                    const label = headingLabel(b);
                    return (
                      <section key={b.id}>
                        {showH && label && (
                          block.type === 'heading' ? (
                            <PreviewHeading block={b} />
                          ) : (
                            <h2 className="mb-2 font-display text-xl font-semibold text-slate-900 dark:text-white">
                              {label}
                            </h2>
                          )
                        )}
                        {b.type !== 'heading' && (
                          <RenderBlockBody block={b} headingToAnchor={headingToAnchor} />
                        )}
                      </section>
                    );
                  })}
                </div>
              </article>
            </div>
          </div>
        </div>
      )}

      {confirmPublish && readiness && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="editorial-fade-in w-full max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Confirm Publish
            </h3>
            <dl className="space-y-0.5">
              <KeyValue label="Title" value={readiness.title || '—'} />
              <KeyValue label="Slug" value={`/blog/${readiness.slug}`} />
              <KeyValue label="Quality Score" value={readiness.quality_score ?? '—'} />
              <KeyValue label="SEO Score" value={readiness.seo_score ?? '—'} />
              <KeyValue label="Word Count" value={readiness.word_count} />
              <KeyValue label="Internal Links" value={readiness.internal_link_count} />
            </dl>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy !== null}
                onClick={() => setConfirmPublish(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                loading={busy === 'publish'}
                disabled={!readiness.ready}
                onClick={() => void confirmAndPublish()}
              >
                Confirm Publish
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className={manualArticle && preview.status !== 'published' ? '' : 'grid lg:grid-cols-[1fr_240px]'}>
        <div
          className={
            manualArticle && preview.status !== 'published'
              ? 'p-5'
              : 'min-h-[420px] space-y-5 p-5'
          }
        >
          {manualArticle && preview.status !== 'published' && (
            <ManualBlogEditor
              mode="edit"
              articleId={articleId}
              topicId={article.topic_id}
              articleStatus={preview.status}
              preview={preview}
              initial={{
                seo_title: article.seo_title || '',
                meta_title: article.meta_title || '',
                meta_description: article.meta_description || '',
                excerpt: article.excerpt || '',
                slug: article.slug,
                content_type: article.content_type,
                published_at: article.published_at,
                blocks: preview.blocks,
                draft_json: raw?.draft_json,
              }}
              onSaved={() => {
                setMessage('Draft saved');
                void load();
                onChanged?.();
              }}
              onPreview={() => setBlogPreviewOpen(true)}
              onPublished={() => {
                setMessage('Published successfully');
                void load();
                onChanged?.();
              }}
            />
          )}

          {manualArticle && preview.status === 'published' && contentEditOpen && (
            <PublishedContentEditor
              articleId={articleId}
              preview={preview}
              rawDraft={raw?.draft_json}
              disabled={actionsLocked}
              onSaved={(msg) => {
                setMessage(msg);
                setContentEditOpen(false);
                void load();
                onChanged?.();
              }}
              onCancel={() => setContentEditOpen(false)}
            />
          )}

          {!manualArticle && workflow.stage === 'research' && (
            <StepShell
              emoji="🔍"
              title="Research"
              subtitle="Validate search intent, keywords, and outline before writing."
              primary={
                showHeaderPrimary ? (
                  <PrimaryCta
                    label={workflow.primaryLabel}
                    icon={primaryIcon}
                    loading={primaryLoading}
                    disabled={actionsLocked && !primaryLoading}
                    estimate={workflow.estimatedTime}
                    onClick={() => runPrimaryAction(displayAction)}
                  />
                ) : null
              }
            >
              {!research && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No research pack on this article yet.
                  {article.topic_id
                    ? ' Start Research to load a preview from the linked topic.'
                    : ' Link a topic or generate the article from Topics to capture research.'}
                </p>
              )}
              {research && <ResearchSummary research={research} />}
            </StepShell>
          )}

          {!manualArticle && workflow.stage === 'writing' && (
            <StepShell
              emoji="✍️"
              title="Writing"
              subtitle="Generate or confirm the article draft before SEO."
              primary={
                showHeaderPrimary ? (
                  <PrimaryCta
                    label={workflow.primaryLabel}
                    icon={primaryIcon}
                    loading={primaryLoading}
                    disabled={actionsLocked && !primaryLoading}
                    estimate={workflow.estimatedTime}
                    onClick={() => runPrimaryAction(displayAction)}
                  />
                ) : null
              }
            >
              {!preview.blocks.length && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No draft content yet.
                  {article.topic_id
                    ? ' Generate Draft uses the topic-level generate API (may create a new article if one already exists for this topic).'
                    : ' Generate drafts from Topics, then open the resulting article here.'}
                </p>
              )}
              {preview.blocks.length > 0 && (
                <div className="space-y-3 text-sm">
                  <p className="text-slate-600 dark:text-slate-300">
                    {preview.excerpt || 'Draft ready.'} · {preview.word_count} words
                  </p>
                  {preview.blocks.slice(0, 4).map((b, i) => {
                    const showH = shouldShowHeading(b, i, preview.blocks);
                    const label = headingLabel(b);
                    return (
                      <div
                        key={b.id}
                        className="border-b border-slate-100 pb-2 dark:border-white/10"
                      >
                        {showH && label && (
                          <h3 className="font-semibold text-slate-900 dark:text-white">{label}</h3>
                        )}
                        {b.type !== 'heading' && (
                          <div className="mt-1 line-clamp-3">
                            <RenderBlockBody block={b} headingToAnchor={headingToAnchor} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {preview.blocks.length > 4 && (
                    <p className="text-xs text-slate-400">
                      +{preview.blocks.length - 4} more sections — open Advanced → Preview
                    </p>
                  )}
                </div>
              )}
            </StepShell>
          )}

          {!manualArticle && workflow.stage === 'seo' && (
            <StepShell
              emoji="🎯"
              title="SEO & Internal Links"
              subtitle="One step for meta package, schema signals, and internal link recommendations."
              primary={
                showHeaderPrimary ? (
                  <PrimaryCta
                    label={workflow.primaryLabel}
                    icon={primaryIcon}
                    loading={primaryLoading}
                    disabled={actionsLocked && !primaryLoading}
                    estimate={workflow.estimatedTime}
                    onClick={() => runPrimaryAction(displayAction)}
                  />
                ) : null
              }
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 text-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    SEO package
                  </p>
                  {!seo && (
                    <p className="text-slate-500 dark:text-slate-400">
                      No SEO package yet — generate to create meta + links together.
                    </p>
                  )}
                  {seo && (
                    <>
                      <FieldRow label="SEO Title" value={String(seo.seo_title || '')} />
                      <FieldRow label="Meta Title" value={String(seo.meta_title || '')} />
                      <FieldRow
                        label="Meta Description"
                        value={String(seo.meta_description || '')}
                      />
                      <FieldRow label="Canonical" value={String(seo.canonical || '')} />
                      <FieldRow
                        label="Primary keyword"
                        value={String(seo.primary_keyword || '')}
                      />
                      {preview.seo_validation && (
                        <p className="text-xs text-slate-500">
                          SEO score: {preview.seo_validation.seo_score ?? '—'}
                          {(preview.seo_validation.errors?.length ?? 0) > 0
                            ? ` · ${preview.seo_validation.errors!.length} note(s) for Review`
                            : ''}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Internal links
                  </p>
                  {!links.length && (
                    <p className="text-slate-500 dark:text-slate-400">
                      No link recommendations yet — included when you generate SEO.
                    </p>
                  )}
                  {links.slice(0, 5).map((l) => (
                    <Card key={`${l.target}-${l.anchor}`} padding="p-3">
                      <p className="font-medium text-slate-900 dark:text-white">{l.anchor}</p>
                      <p className="mt-0.5 text-xs text-teal-700 dark:text-teal-400">{l.target}</p>
                    </Card>
                  ))}
                  {links.length > 5 && (
                    <p className="text-xs text-slate-400">+{links.length - 5} more</p>
                  )}
                  <p className="text-[11px] text-slate-400">
                    Body links: {bodyLinkCount} · Package:{' '}
                    {preview.internal_links?.count ?? links.length}
                  </p>
                  {bodyLinkCount < 1 && (preview.internal_links?.count ?? links.length) > 0 && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Package links are ready. In-body links are checked at Review — you can continue.
                    </p>
                  )}
                </div>
              </div>
            </StepShell>
          )}

          {!manualArticle && workflow.stage === 'review' && (
            <StepShell
              emoji="✅"
              title="Review"
              subtitle="Quality gate — pass to unlock Ready to Publish."
              primary={
                !workflow.showAutoFixBanner &&
                !workflow.needsManualReview &&
                displayAction === 'run_review' ? (
                  <PrimaryCta
                    label={workflow.primaryLabel}
                    icon={primaryIcon}
                    loading={primaryLoading}
                    disabled={actionsLocked && !primaryLoading}
                    estimate={workflow.estimatedTime}
                    onClick={() => runPrimaryAction(displayAction)}
                  />
                ) : null
              }
            >
              {workflow.needsManualReview && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Manual review required
                  </p>
                  <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                    {workflow.failureReason ||
                      'Automation stopped. Edit the draft, then re-run Review.'}
                  </p>
                  {workflow.failureReasons.length > 1 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800 dark:text-amber-300">
                      {workflow.failureReasons.slice(0, 6).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3">
                    <PrimaryCta
                      label="Run Review"
                      icon={<ShieldCheck className="h-3.5 w-3.5" />}
                      loading={busy === 'review'}
                      disabled={actionsLocked && busy !== 'review'}
                      estimate="~30s"
                      onClick={() => void runReview()}
                    />
                  </div>
                </div>
              )}

              {!workflow.needsManualReview && workflow.showAutoFixBanner && (
                <div className="space-y-3">
                  {revisionRunning ? (
                    <div className="rounded-xl border border-teal-200 bg-teal-50/90 px-4 py-3 dark:border-teal-900/40 dark:bg-teal-950/30">
                      <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
                        Fix Issues running
                      </p>
                      <p className="mt-1 text-xs text-teal-800 dark:text-teal-300">
                        Progress is in the AI Jobs drawer (same as Draft Generation). You can leave
                        this page — the job continues and reconnects when you return.
                      </p>
                      {jobsCtx && (
                        <div className="mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const j = jobsCtx.jobs.find(
                                (x) =>
                                  x.job_type === 'revision_batch' &&
                                  Number(x.article_id || x.progress.article_id) === articleId &&
                                  (x.status === 'queued' || x.status === 'running')
                              );
                              if (j) jobsCtx.openDrawer(j.id);
                              else if (jobsCtx.drawerJobId) jobsCtx.openDrawer(jobsCtx.drawerJobId);
                            }}
                          >
                            Open AI Jobs drawer
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/90 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                      <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                        {workflow.statusLabel === 'fix_publish_blockers'
                          ? 'Publish blockers found'
                          : 'Review failed'}
                      </p>
                      <p className="mt-1 text-xs text-rose-800 dark:text-rose-300">
                        {workflow.failureReason ||
                          (workflow.statusLabel === 'fix_publish_blockers'
                            ? 'Fix Issues will attempt to resolve remaining publish checks.'
                            : 'Quality checks did not pass.')}
                      </p>
                      {workflow.failureReasons.length > 1 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-800 dark:text-rose-300">
                          {workflow.failureReasons.slice(0, 6).map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      )}
                      {workflow.recommendedFix && (
                        <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">
                          {workflow.recommendedFix}
                        </p>
                      )}
                      <div className="mt-3">
                        <PrimaryCta
                          label="Fix Issues"
                          icon={<Wand2 className="h-3.5 w-3.5" />}
                          loading={busy === 'revise'}
                          disabled={actionsLocked && busy !== 'revise'}
                          estimate="~60s"
                          onClick={() => void runAutoFix()}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {revisionRunning && !workflow.showAutoFixBanner && (
                <div className="rounded-xl border border-teal-200 bg-teal-50/90 px-4 py-3 dark:border-teal-900/40 dark:bg-teal-950/30">
                  <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
                    Fix Issues running
                  </p>
                  <p className="mt-1 text-xs text-teal-800 dark:text-teal-300">
                    Live progress is in the shared AI Jobs drawer.
                  </p>
                </div>
              )}

              {!workflow.needsManualReview && !workflow.showAutoFixBanner && !revisionRunning && (
                <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                  <p>
                    Run Review to score readability, structure, EEAT, and policy rules. On failure,
                    only <span className="font-semibold">Fix Issues</span> is shown — it re-reviews
                    automatically.
                  </p>
                  {qualityReport && !qualityReport.rolled_back && !qualityReport.inactive && (
                    <p className="text-xs text-slate-500">
                      Last score: {qualityReport.overall_score} / threshold{' '}
                      {qualityReport.threshold}
                      {qualityReport.decision ? ` · ${qualityReport.decision}` : ''}
                    </p>
                  )}
                </div>
              )}
            </StepShell>
          )}

          {!manualArticle && workflow.stage === 'ready' && (
            <StepShell
              emoji="🚀"
              title="Ready to Publish"
              subtitle="Final checklist and scores before going live."
              primary={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="lg"
                    variant="outline"
                    icon={<Eye className="h-4 w-4" />}
                    disabled={actionsLocked}
                    onClick={() => setBlogPreviewOpen(true)}
                  >
                    Preview Blog
                  </Button>
                  {workflow.primaryAction === 'auto_fix' || displayAction === 'auto_fix' ? (
                    revisionRunning ? null : (
                    <PrimaryCta
                      label="Fix Issues"
                      icon={<Wand2 className="h-3.5 w-3.5" />}
                      loading={busy === 'revise'}
                      disabled={actionsLocked && busy !== 'revise'}
                      estimate="~60s"
                      size="lg"
                      onClick={() => void runAutoFix()}
                    />
                    )
                  ) : displayAction === 'publish' || workflow.primaryAction === 'publish' ? (
                    <PrimaryCta
                      label="Publish Article"
                      icon={<Globe className="h-4 w-4" />}
                      loading={primaryLoading}
                      disabled={(actionsLocked && !primaryLoading) || !workflow.publishReady}
                      estimate={workflow.estimatedTime}
                      size="lg"
                      onClick={() => runPrimaryAction('publish')}
                    />
                  ) : null}
                </div>
              }
            >
              {workflow.showAutoFixBanner && (
                <div className="mb-3 space-y-3">
                  {revisionRunning ? (
                    <div className="rounded-xl border border-teal-200 bg-teal-50/90 px-4 py-3 dark:border-teal-900/40 dark:bg-teal-950/30">
                      <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
                        Fix Issues running
                      </p>
                      <p className="mt-1 text-xs text-teal-800 dark:text-teal-300">
                        Progress is in the AI Jobs drawer. Safe to leave — reconnects on return.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                        Publish blockers found
                      </p>
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                        {workflow.failureReason ||
                          'Fix Issues will repair SEO meta lengths, inject body links, and refresh SEO validation.'}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {revisionRunning && !workflow.showAutoFixBanner && (
                <div className="mb-3 rounded-xl border border-teal-200 bg-teal-50/90 px-4 py-3 dark:border-teal-900/40 dark:bg-teal-950/30">
                  <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
                    Fix Issues running
                  </p>
                  <p className="mt-1 text-xs text-teal-800 dark:text-teal-300">
                    Live progress is in the shared AI Jobs drawer.
                  </p>
                </div>
              )}
              {readiness && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {readiness.checks.map((c) => (
                    <div
                      key={c.key}
                      className={`rounded-xl border px-3 py-2.5 text-xs ${
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
              )}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <ScoreCard
                  label="Quality"
                  value={readiness?.quality_score ?? panel.quality_score ?? qualityReport?.overall_score}
                />
                <ScoreCard label="SEO" value={readiness?.seo_score ?? panel.overall_seo_score} />
                <ScoreCard label="Readability" value={panel.readability_score} />
              </div>
              {!workflow.publishReady && !workflow.showAutoFixBanner && (
                <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                  Publish readiness incomplete — check failed items above or Advanced → Debug.
                </p>
              )}
            </StepShell>
          )}

          {(!manualArticle && workflow.stage === 'published') ||
          (manualArticle && preview.status === 'published' && !contentEditOpen) ? (
            <StepShell
              emoji="🌍"
              title="Published"
              subtitle="This article is live on the public blog."
              primary={
                !contentEditOpen ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Pencil className="h-3.5 w-3.5" />}
                      disabled={actionsLocked}
                      onClick={() => {
                        setContentEditOpen(true);
                        setError('');
                      }}
                    >
                      Edit content
                    </Button>
                    <PrimaryCta
                      label="View Live"
                      icon={<ExternalLink className="h-3.5 w-3.5" />}
                      onClick={() => runPrimaryAction('view_live')}
                    />
                  </div>
                ) : null
              }
            >
              {contentEditOpen ? (
                <PublishedContentEditor
                  articleId={articleId}
                  preview={preview}
                  rawDraft={raw?.draft_json}
                  disabled={actionsLocked}
                  onCancel={() => setContentEditOpen(false)}
                  onSaved={async (msg) => {
                    setContentEditOpen(false);
                    setMessage(msg);
                    setError('');
                    await load();
                    onChanged?.();
                  }}
                />
              ) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-5 py-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400" />
                  <p className="mt-3 text-base font-semibold text-emerald-900 dark:text-emerald-200">
                    Successfully published
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-emerald-800 dark:text-emerald-300">
                    /blog/{preview.slug}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<ExternalLink className="h-3.5 w-3.5" />}
                      onClick={() => window.open(`/blog/${preview.slug}`, '_blank', 'noreferrer')}
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Copy className="h-3.5 w-3.5" />}
                      onClick={() => void copyLiveUrl()}
                    >
                      {copied ? 'Copied' : 'Copy URL'}
                    </Button>
                  </div>
                </div>
              )}
            </StepShell>
          ) : null}

          <AdvancedPanel
            article={article}
            preview={preview}
            readiness={readiness}
            qualityReport={qualityReport}
            history={history}
            revisions={revisions}
            observability={observability}
          />
        </div>

        {/* Simplified right sidebar — manual drafts use editor sidebar instead */}
        {!(manualArticle && preview.status !== 'published') && (
        <aside className="space-y-3 border-t border-slate-100 bg-slate-50/70 p-4 lg:border-t-0 lg:border-l dark:border-white/10 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Quality panel
          </p>
          <ScoreBar
            label="Overall Quality"
            value={panel.quality_score ?? qualityReport?.overall_score ?? null}
          />
          <ScoreBar label="SEO" value={panel.overall_seo_score} />
          <ScoreBar label="Readability" value={panel.readability_score} />
          <KeyValue label="Word Count" value={preview.word_count} />
          <KeyValue label="Internal Links" value={bodyLinkCount} />
          <KeyValue
            label="Status"
            value={
              workflow.needsManualReview
                ? 'Needs Manual Review'
                : workflow.showAutoFixBanner
                  ? 'Needs Revision'
                  : preview.status
            }
          />
          <Divider />
          <button
            type="button"
            className="flex w-full items-center justify-between text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            onClick={() => setQualityDetailsOpen((o) => !o)}
          >
            <span>Show Details</span>
            {qualityDetailsOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          {qualityDetailsOpen && (
            <div className="space-y-3">
              <ScoreBar label="EEAT" value={panel.eeat_score} />
              <ScoreBar label="Helpful content" value={panel.helpful_content_score} />
              <ScoreBar label="Search intent" value={panel.search_intent_score} />
              <KeyValue
                label="Package link suggestions"
                value={panel.internal_link_count}
              />
              <div>
                <p className="mb-1 text-[11px] text-slate-500">Missing items</p>
                {!panel.missing_items?.length ? (
                  <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> None flagged
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {panel.missing_items.slice(0, 8).map((m) => (
                      <li key={m} className="text-[11px] text-rose-600 dark:text-rose-400">
                        • {m}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <p className="border-t border-slate-200 pt-2 text-[10px] text-slate-400 dark:border-white/10">
            Guided wizard · stage from article state
          </p>
        </aside>
        )}
      </div>
    </Card>
  );
}

function StepShell({
  emoji,
  title,
  subtitle,
  primary,
  children,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  primary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="editorial-fade-in space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
            Current step
          </p>
          <h3 className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white">
            <span className="mr-2" aria-hidden>
              {emoji}
            </span>
            {title}
          </h3>
          <p className="mt-1 max-w-xl text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        {primary}
      </div>
      {children}
    </div>
  );
}

function PrimaryCta({
  label,
  icon,
  loading,
  disabled,
  estimate,
  onClick,
  size = 'sm',
}: {
  label: string;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  estimate?: string | null;
  onClick: () => void;
  size?: 'sm' | 'lg';
}) {
  return (
    <Button
      size={size === 'lg' ? 'lg' : 'sm'}
      variant="primary"
      icon={icon}
      loading={loading}
      disabled={disabled}
      onClick={onClick}
      title={estimate ? `${label} (${estimate})` : label}
      className={size === 'lg' ? 'min-w-[180px]' : undefined}
    >
      {label}
      {estimate && !loading ? (
        <span className="ml-1.5 opacity-70">· {estimate}</span>
      ) : null}
    </Button>
  );
}

function ResearchSummary({
  research,
}: {
  research: ResearchPreview | Record<string, unknown>;
}) {
  const r = research as ResearchPreview;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card padding="p-3" className="bg-slate-50 dark:bg-white/[0.03]">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Search intent
          </p>
          <p className="mt-1 font-medium text-slate-800 dark:text-slate-100">
            {r.intent || '—'}
          </p>
        </Card>
        <Card padding="p-3" className="bg-slate-50 dark:bg-white/[0.03]">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Target keyword
          </p>
          <p className="mt-1 font-medium text-slate-800 dark:text-slate-100">
            {r.target_keyword || '—'}
          </p>
        </Card>
      </div>
      <p className="text-slate-600 dark:text-slate-300">
        <span className="font-semibold text-slate-800 dark:text-slate-100">Angle: </span>
        {r.article_angle || '—'}
      </p>
      {Array.isArray(r.search_questions) && r.search_questions.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Search questions
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
            {r.search_questions.slice(0, 6).map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(r.recommended_outline) && r.recommended_outline.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Recommended outline
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
            {r.recommended_outline.slice(0, 8).map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <Card padding="p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
        {value ?? '—'}
      </p>
    </Card>
  );
}
