import type { ReactNode } from 'react';
import { AUTHORITY_FOOTER_LINKS } from '../../lib/eeat-engine/client.js';

interface Props {
  onNavigate: (path: string) => void;
  adSlot?: ReactNode;
}

/** Original footer layout — only larger, more readable type. */
export default function SiteFooter({ onNavigate, adSlot }: Props) {
  return (
    <footer className="no-print mt-16 space-y-2 border-t border-slate-200 bg-white py-12 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-brand-slate dark:text-slate-400 sm:text-[15px]">
      {adSlot && <div className="mx-auto mb-6 max-w-4xl px-4">{adSlot}</div>}
      <nav
        className="mx-auto flex max-w-3xl flex-wrap justify-center gap-x-4 gap-y-2 px-4 pb-3"
        aria-label="Authority links"
      >
        {AUTHORITY_FOOTER_LINKS.map((l) => (
          <button
            key={l.href}
            type="button"
            onClick={() => onNavigate(l.href)}
            className="cursor-pointer hover:text-teal-700 dark:hover:text-teal-300"
          >
            {l.label}
          </button>
        ))}
      </nav>
      <p className="tracking-wide">
        Cost-of-Living Comparison Tool • Crafted with Premium Engineering
      </p>
      <p>© 2026 Cost-of-Living Comparison Tool • Built with ❤️</p>
    </footer>
  );
}
