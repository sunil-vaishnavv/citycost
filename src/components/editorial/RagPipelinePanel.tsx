import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Database,
  ExternalLink,
  Flame,
  Globe,
  HelpCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  auditRagClaims,
  getRagStatus,
  retrieveRagData,
  type ClaimAuditResult,
  type GroundedFact,
  type GroundingSource,
  type RagAuditReport,
  type RagRetrievalResult,
  type RagStatusResponse,
} from './api';
import { Button, Callout, Card, Field, Input, ScoreBar, StatusPill } from './ui';

const PRESET_QUERIES = [
  { city: 'Austin', comp: 'Seattle', label: 'Austin vs Seattle (Tech Relocation 2026)' },
  { city: 'Tokyo', comp: 'New York', label: 'Tokyo vs New York (Expat Living Costs)' },
  { city: 'Lisbon', comp: '', label: 'Lisbon Nomad Living Costs & IFICI Tax' },
  { city: 'New York', comp: '', label: 'NYC 1-Bedroom Rent & MTA Fares' },
  { city: 'Seattle', comp: '', label: 'Seattle Living Expenses & Sales Tax' },
];

const SAMPLE_DRAFT_TEXT = `In Austin, Texas, median 1-bedroom apartment rent in 2026 is approximately $1,520/month, reflecting a 3.2% decrease from peak pandemic periods. Monthly utilities for a standard 85m² apartment run around $190/month with peak summer air conditioning spikes. 

Commuting costs are exceptionally low compared to the West Coast, with CapMetro monthly transit passes priced at $41.25/month. Furthermore, Texas imposes 0% individual state income tax, although municipal property taxes remain high between 1.8% and 2.2%. Single adult monthly groceries average $410/month at local supermarkets like H-E-B.

However, some private listings falsely claim average 1-bedroom rent is $2,450/month in suburbs, which conflicts with verified municipal census data.`;

export default function RagPipelinePanel() {
  const [ragStatus, setRagStatus] = useState<RagStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Search Retrieval State
  const [targetCity, setTargetCity] = useState('Austin');
  const [comparisonCity, setComparisonCity] = useState('Seattle');
  const [topicAngle, setTopicAngle] = useState('Cost of living, rent, transit, and taxes 2026');
  const [retrievalResult, setRetrievalResult] = useState<RagRetrievalResult | null>(null);
  const [retrieving, setRetrieving] = useState(false);
  const [retrievalError, setRetrievalError] = useState('');

  // Fact Checker State
  const [draftText, setDraftText] = useState(SAMPLE_DRAFT_TEXT);
  const [auditing, setAuditing] = useState(false);
  const [auditReport, setAuditReport] = useState<RagAuditReport | null>(null);
  const [auditError, setAuditError] = useState('');

  // Initial load
  useEffect(() => {
    loadStatus();
    runRetrieval('Austin', 'Seattle');
  }, []);

  const loadStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await getRagStatus();
      setRagStatus(res);
    } catch {
      // ignore
    } finally {
      setLoadingStatus(false);
    }
  };

  const runRetrieval = async (city = targetCity, comp = comparisonCity) => {
    if (!city.trim()) return;
    setRetrieving(true);
    setRetrievalError('');
    try {
      const res = await retrieveRagData({
        targetCity: city.trim(),
        comparisonCity: comp.trim() || undefined,
        topicTitle: topicAngle.trim() || undefined,
      });
      if (res.ok && res.data) {
        setRetrievalResult(res.data);
      }
    } catch (err) {
      setRetrievalError((err as Error).message || 'Failed to retrieve grounding data');
    } finally {
      setRetrieving(false);
    }
  };

  const runAudit = async () => {
    if (!draftText.trim()) return;
    setAuditing(true);
    setAuditError('');
    try {
      const res = await auditRagClaims({
        text: draftText,
        targetCity: targetCity || 'Austin',
        groundedFacts: retrievalResult?.facts,
        sources: retrievalResult?.sources,
      });
      if (res.ok && res.report) {
        setAuditReport(res.report);
      }
    } catch (err) {
      setAuditError((err as Error).message || 'Failed to audit claims');
    } finally {
      setAuditing(false);
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-teal-500/20 bg-gradient-to-br from-teal-900/10 via-slate-900/40 to-indigo-950/20 p-6 backdrop-blur-xl sm:p-8 dark:border-teal-500/30 dark:bg-slate-900/60">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-400/10 dark:text-teal-300">
                <Globe className="h-3.5 w-3.5 animate-spin-slow" />
                Live Google Search Grounding & RAG
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Model: gemini-3.8-flash
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                <ShieldCheck className="h-3 w-3" /> Factual Quality Gate Active
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
              CityCost RAG Pipeline & Factual Audit Laboratory
            </h1>
            <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Pulls live economic benchmarks, rental market censuses, and municipal transit fares in real time. Automatically validates quantitative claims, eliminates AI hallucinations, and embeds traceable inline citations ([^1], [^2]) before articles are published.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="secondary"
              size="md"
              loading={loadingStatus}
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={loadStatus}
            >
              Refresh Engine
            </Button>
          </div>
        </div>

        {/* Feature Pills */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-3.5 backdrop-blur dark:border-white/5 dark:bg-white/[0.02]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">1. Retrieval</p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Google Search grounding for live 2026 rent & utility data</p>
          </div>
          <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-3.5 backdrop-blur dark:border-white/5 dark:bg-white/[0.02]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">2. Citation Mapping</p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Numbered footnote references linked to original domains</p>
          </div>
          <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-3.5 backdrop-blur dark:border-white/5 dark:bg-white/[0.02]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">3. Claim Verification</p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Sentence-by-sentence numerical discrepancy auditing</p>
          </div>
          <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-3.5 backdrop-blur dark:border-white/5 dark:bg-white/[0.02]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">4. Gate Enforcement</p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Blocks auto-publish if disputed or ungrounded claims exist</p>
          </div>
        </div>
      </div>

      {/* Preset Quick Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Quick Test Cases:</span>
        {PRESET_QUERIES.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setTargetCity(preset.city);
              setComparisonCity(preset.comp);
              runRetrieval(preset.city, preset.comp);
            }}
            className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-teal-500 hover:text-teal-700 dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-teal-400 dark:hover:text-teal-300"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Section 1: Real-time Retrieval Inspector */}
      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/5 mb-6">
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Live Grounding Retrieval Inspector
          </h2>
          {retrievalResult && (
            <span className="text-xs text-teal-700 dark:text-teal-400 font-semibold">
              {retrievalResult.sources.length} sources · {retrievalResult.facts.length} verified facts
            </span>
          )}
        </div>
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Target City">
              <Input
                value={targetCity}
                onChange={(e) => setTargetCity(e.target.value)}
                placeholder="e.g. Austin, Tokyo, Lisbon"
              />
            </Field>
            <Field label="Comparison City (Optional)">
              <Input
                value={comparisonCity}
                onChange={(e) => setComparisonCity(e.target.value)}
                placeholder="e.g. Seattle, New York"
              />
            </Field>
            <Field label="Research Angle / Topic">
              <Input
                value={topicAngle}
                onChange={(e) => setTopicAngle(e.target.value)}
                placeholder="e.g. Rent, transit, taxes 2026"
              />
            </Field>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4 dark:border-white/5">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Grounding queries: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-800 dark:bg-slate-800 dark:text-slate-200">{retrievalResult?.query || `average rent ${targetCity} ${new Date().getFullYear()}`}</code>
            </p>
            <Button
              variant="primary"
              size="md"
              loading={retrieving}
              icon={<Search className="h-4 w-4" />}
              onClick={() => runRetrieval()}
            >
              Execute Grounding Search
            </Button>
          </div>

          {retrievalError && <Callout tone="rose">{retrievalError}</Callout>}

          {retrievalResult && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Retrieved Grounding Sources */}
              <div className="space-y-3 lg:col-span-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Live Grounding Sources ({retrievalResult.sources.length})
                  </h3>
                  <span className="text-[11px] text-slate-400">Retrieved {new Date(retrievalResult.retrievalTimestamp).toLocaleDateString()}</span>
                </div>

                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {retrievalResult.sources.map((s) => (
                    <div
                      key={s.id}
                      className="group rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 transition hover:border-teal-500/50 hover:bg-white dark:border-white/5 dark:bg-slate-900/50 dark:hover:border-teal-400/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-teal-600/10 text-xs font-bold text-teal-700 dark:bg-teal-400/20 dark:text-teal-300">
                            [^{s.id}]
                          </span>
                          <span className="text-xs font-semibold text-slate-900 group-hover:text-teal-700 dark:text-white dark:group-hover:text-teal-300">
                            {s.domain}
                          </span>
                        </div>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-400 transition hover:text-teal-600 dark:hover:text-teal-400"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <p className="mt-1 text-xs text-slate-700 line-clamp-1 dark:text-slate-300 font-medium">{s.title}</p>
                      {s.snippet && (
                        <p className="mt-1 text-[11px] text-slate-500 line-clamp-2 dark:text-slate-400">{s.snippet}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Grounded Facts List */}
              <div className="space-y-3 lg:col-span-7">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Extracted Benchmark Facts with Citations ({retrievalResult.facts.length})
                  </h3>
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    Model: {retrievalResult.model}
                  </span>
                </div>

                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {retrievalResult.facts.map((f, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs dark:border-white/5 dark:bg-slate-900/60"
                    >
                      <span className="mt-0.5 inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {f.category}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                          {f.statement}
                        </p>
                      </div>
                      <span className="shrink-0 rounded bg-teal-50 px-2 py-0.5 text-xs font-mono font-bold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                        {f.citationRef}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Section 2: Automated Claim-by-Claim Fact Checker Gate */}
      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/5 mb-6">
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Automated Claim-by-Claim Fact Checker Gate
          </h2>
          {auditReport && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                auditReport.passed
                  ? 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300'
                  : 'bg-rose-500/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300'
              }`}
            >
              {auditReport.passed ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              {auditReport.accuracyScore}% Grounded · {auditReport.passed ? 'GATE PASSED' : 'GATE REJECTED'}
            </span>
          )}
        </div>
        <div className="space-y-6">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Simulate or audit an article draft. The engine parses individual assertions, cross-verifies numbers and currency against real-time retrieved grounding facts, identifies discrepancies, and produces an audit report before publishing.
          </p>

          <Field label="Draft Article Content to Audit (Paste or Edit text below)">
            <textarea
              rows={6}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              className="w-full rounded-2xl border border-slate-200/80 bg-white p-4 font-mono text-xs text-slate-800 shadow-inner focus:border-teal-500 focus:outline-none dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-200"
              placeholder="Paste article text or quantitative claims to audit..."
            />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-white/5">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDraftText(SAMPLE_DRAFT_TEXT)}
              >
                Reset to Sample Draft
              </Button>
            </div>

            <Button
              variant="primary"
              size="md"
              loading={auditing}
              icon={<ShieldCheck className="h-4 w-4" />}
              onClick={runAudit}
            >
              Run Claim-by-Claim Fact Checker
            </Button>
          </div>

          {auditError && <Callout tone="rose">{auditError}</Callout>}

          {auditReport && (
            <div className="space-y-6 border-t border-slate-100 pt-6 dark:border-white/5">
              {/* Verdict Card */}
              <div
                className={`rounded-2xl border p-5 ${
                  auditReport.passed
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100'
                    : 'border-rose-500/30 bg-rose-500/5 text-rose-950 dark:bg-rose-950/20 dark:text-rose-100'
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      {auditReport.passed ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                      )}
                      <h4 className="font-display text-base font-bold">
                        {auditReport.passed ? 'Editorial Quality Audit Passed' : 'Factual Quality Gate Failed — Action Required'}
                      </h4>
                    </div>
                    <p className="mt-1 text-xs opacity-90">{auditReport.summary}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0 text-center">
                    <div className="rounded-xl bg-white/60 p-2 dark:bg-black/20">
                      <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                        {auditReport.verifiedCount}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Verified</p>
                    </div>
                    <div className="rounded-xl bg-white/60 p-2 dark:bg-black/20">
                      <p className="text-base font-bold text-rose-600 dark:text-rose-400">
                        {auditReport.disputedCount}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Disputed</p>
                    </div>
                    <div className="rounded-xl bg-white/60 p-2 dark:bg-black/20">
                      <p className="text-base font-bold text-amber-600 dark:text-amber-400">
                        {auditReport.ungroundedCount}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Ungrounded</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <ScoreBar label="Factual Grounding Accuracy" value={auditReport.accuracyScore} />
                </div>
              </div>

              {/* Itemized Claims Table */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Itemized Claim-by-Claim Verification Breakdown ({auditReport.claims.length} claims extracted)
                </h4>

                <div className="space-y-3">
                  {auditReport.claims.map((claim) => (
                    <div
                      key={claim.claimId}
                      className={`rounded-2xl border p-4 transition ${
                        claim.status === 'verified'
                          ? 'border-emerald-200/70 bg-emerald-50/20 dark:border-emerald-500/20 dark:bg-emerald-950/10'
                          : claim.status === 'disputed'
                          ? 'border-rose-300/80 bg-rose-50/30 dark:border-rose-500/30 dark:bg-rose-950/20'
                          : 'border-amber-200/70 bg-amber-50/20 dark:border-amber-500/20 dark:bg-amber-950/10'
                      }`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                claim.status === 'verified'
                                  ? 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300'
                                  : claim.status === 'disputed'
                                  ? 'bg-rose-600/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300'
                                  : 'bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300'
                              }`}
                            >
                              {claim.status === 'verified' ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : (
                                <AlertTriangle className="h-3 w-3" />
                              )}
                              {claim.status}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              Category: {claim.category}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Confidence: {Math.round(claim.confidence * 100)}%
                            </span>
                          </div>

                          <p className="text-xs font-semibold text-slate-900 dark:text-white leading-relaxed">
                            "{claim.claimText}"
                          </p>
                        </div>

                        {claim.matchedSourceUrl && (
                          <a
                            href={claim.matchedSourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200/70 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:text-teal-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-teal-400"
                          >
                            <span className="font-mono text-teal-600 dark:text-teal-400">
                              [^{claim.matchedSourceId || 1}]
                            </span>
                            <span>{claim.matchedSourceTitle?.slice(0, 24)}…</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>

                      {/* Evidence / Discrepancy details */}
                      {claim.matchedEvidence && (
                        <div className="mt-2.5 rounded-xl bg-white/70 p-2.5 text-xs text-slate-700 dark:bg-black/20 dark:text-slate-300">
                          <span className="font-semibold text-slate-900 dark:text-white">Grounding Evidence: </span>
                          {claim.matchedEvidence}
                        </div>
                      )}

                      {claim.discrepancyNote && (
                        <div className="mt-2 rounded-xl bg-rose-500/10 p-2.5 text-xs font-medium text-rose-800 dark:text-rose-200">
                          <span className="font-bold">Audit Warning: </span>
                          {claim.discrepancyNote}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
