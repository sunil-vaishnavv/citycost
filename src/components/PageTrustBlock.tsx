import { listActiveDataSourceNames, getShortMethodologyText } from '../../lib/eeat-engine/page-trust.js';
import { ContentCard, ContentSectionHeading } from './ContentPageShell';

interface Props {
  lastUpdated?: string | null;
  pageSources?: string[];
  onNavigate: (path: string) => void;
}

/**
 * Compact Data Sources + Methodology section — matches ContentPageShell chrome.
 */
export default function PageTrustBlock({ lastUpdated, pageSources, onNavigate }: Props) {
  const platformSources = listActiveDataSourceNames();
  const method = getShortMethodologyText();
  const onPage = (pageSources || []).filter(Boolean);

  return (
    <ContentCard>
      <ContentSectionHeading>Trust &amp; data transparency</ContentSectionHeading>
      {lastUpdated && (
        <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-300">
          Last updated:{' '}
          <span className="text-slate-900 dark:text-white">{lastUpdated.slice(0, 10)}</span>
        </p>
      )}
      <div className="mt-5 space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Data Sources
        </h3>
        {onPage.length > 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            On this page: {onPage.join(' · ')}
          </p>
        )}
        <ul className="list-disc space-y-1 pl-4 text-sm text-slate-600 dark:text-slate-400">
          {platformSources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
      <div className="mt-5 space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Methodology
        </h3>
        <p className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300">{method}</p>
      </div>
      <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold">
        <button
          type="button"
          onClick={() => onNavigate('/methodology')}
          className="cursor-pointer text-teal-700 hover:underline dark:text-teal-300"
        >
          Full methodology
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/data-sources')}
          className="cursor-pointer text-teal-700 hover:underline dark:text-teal-300"
        >
          Data sources
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/disclaimer')}
          className="cursor-pointer text-teal-700 hover:underline dark:text-teal-300"
        >
          Disclaimer
        </button>
      </div>
    </ContentCard>
  );
}
