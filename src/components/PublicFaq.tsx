import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ContentCard, ContentSectionHeading } from './ContentPageShell';
import { RichText } from './RichText';

export type PublicFaqItem = { q: string; a: string };

interface Props {
  items: PublicFaqItem[];
  id?: string;
  title?: string;
  onNavigate?: (path: string) => void;
  /** accordion | grid — default accordion */
  variant?: 'accordion' | 'grid';
}

function FaqAccordion({
  items,
  onNavigate,
}: {
  items: PublicFaqItem[];
  onNavigate?: (path: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className="bg-white dark:bg-slate-900/80">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.03] sm:px-5"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span className="text-sm font-semibold text-slate-900 dark:text-white sm:text-base">
                {item.q}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-teal-600 transition-transform dark:text-teal-400 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-1 text-[15px] leading-relaxed text-slate-600 dark:border-white/10 dark:text-slate-300 sm:px-5">
                {onNavigate ? <RichText text={item.a} onNavigate={onNavigate} /> : item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function PublicFaq({
  items,
  id = 'faq',
  title = 'Frequently Asked Questions',
  onNavigate,
  variant = 'accordion',
}: Props) {
  if (!items.length) return null;
  return (
    <ContentCard>
      <div id={id} className="scroll-mt-28">
        <ContentSectionHeading>{title}</ContentSectionHeading>
        {variant === 'grid' ? (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((f) => (
              <div
                key={f.q}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{f.q}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {onNavigate ? <RichText text={f.a} onNavigate={onNavigate} /> : f.a}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <FaqAccordion items={items} onNavigate={onNavigate} />
        )}
      </div>
    </ContentCard>
  );
}
