import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { TrustSignalDisplay } from '../../lib/eeat-engine/types.js';
import { KNOWLEDGE_PAGE_AUTHORITY_LINKS } from '../../lib/eeat-engine/links.js';

interface Props {
  trust: TrustSignalDisplay;
  onNavigate: (path: string) => void;
  compact?: boolean;
}

/**
 * Minimal trust strip — does not redesign page layouts.
 * Shows Last Updated, Confidence, Data Source, Methodology, Report Issue.
 */
export default function TrustStrip({ trust, onNavigate, compact }: Props) {
  return (
    <div
      className={`rounded-2xl border border-slate-150 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 ${
        compact ? 'p-3' : 'p-4'
      } space-y-2`}
      data-eeat="trust-strip"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
        Data transparency
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-300">
        {trust.last_updated ? <span>Last updated: {trust.last_updated}</span> : null}
        <span>Confidence: {trust.confidence}</span>
        <span>Source: {trust.data_source}</span>
        <span className="text-indigo-600 dark:text-indigo-400">{trust.quality_label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold">
        <button
          type="button"
          onClick={() => onNavigate(trust.methodology_href)}
          className="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          Methodology
        </button>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <button
          type="button"
          onClick={() => onNavigate(trust.report_issue_href.split('?')[0])}
          className="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          Report data issue
        </button>
        {!compact &&
          KNOWLEDGE_PAGE_AUTHORITY_LINKS.filter((l) => l.href !== trust.methodology_href).map((l) => (
            <span key={l.href} className="inline-flex items-center gap-1 text-slate-400">
              <ChevronRight className="w-3 h-3" />
              <button
                type="button"
                onClick={() => onNavigate(l.href)}
                className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
              >
                {l.label}
              </button>
            </span>
          ))}
      </div>
    </div>
  );
}
