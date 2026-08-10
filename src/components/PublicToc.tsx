import { List } from 'lucide-react';
import { ContentCard, ContentSectionHeading } from './ContentPageShell';

export type PublicTocItem = { id: string; label: string };

interface Props {
  items: PublicTocItem[];
  title?: string;
}

/** In-page table of contents for long public knowledge sections. */
export default function PublicToc({ items, title = 'On this page' }: Props) {
  if (!items.length) return null;
  return (
    <ContentCard>
      <ContentSectionHeading>
        <span className="inline-flex items-center gap-2">
          <List className="h-5 w-5 text-teal-500" />
          {title}
        </span>
      </ContentSectionHeading>
      <nav aria-label="Table of contents" className="mt-5">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item, i) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:text-teal-300"
              >
                <span className="mt-0.5 text-[10px] font-bold text-slate-400">{i + 1}.</span>
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </ContentCard>
  );
}
