import { CONTENT_AUTHOR } from '../../lib/eeat-engine/page-trust.js';
import { ContentNavLink } from './ContentPageShell';

interface Props {
  lastUpdated?: string | null;
  onNavigate: (path: string) => void;
  className?: string;
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const slice = d.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slice)) return null;
  try {
    return new Date(slice + 'T00:00:00Z').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return slice;
  }
}

/** Author / last updated / methodology / data-sources strip for public pages. */
export default function PageMetaBar({ lastUpdated, onNavigate, className = '' }: Props) {
  const date = fmtDate(lastUpdated);
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500 dark:text-slate-400 ${className}`}
    >
      <span>
        Author:{' '}
        <ContentNavLink
          href={CONTENT_AUTHOR.href}
          onNavigate={onNavigate}
          className="font-semibold text-teal-700 hover:underline dark:text-teal-300"
        >
          {CONTENT_AUTHOR.name}
        </ContentNavLink>
      </span>
      {date && (
        <span>
          Last updated: <span className="font-semibold text-slate-700 dark:text-slate-200">{date}</span>
        </span>
      )}
      <ContentNavLink
        href="/methodology"
        onNavigate={onNavigate}
        className="font-semibold text-teal-700 hover:underline dark:text-teal-300"
      >
        Methodology
      </ContentNavLink>
      <ContentNavLink
        href="/data-sources"
        onNavigate={onNavigate}
        className="font-semibold text-teal-700 hover:underline dark:text-teal-300"
      >
        Data Sources
      </ContentNavLink>
    </div>
  );
}
