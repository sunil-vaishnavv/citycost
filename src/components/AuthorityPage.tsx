import { ChevronRight, BookOpen } from 'lucide-react';
import type { AuthorityPageDoc } from '../../lib/eeat-engine/types.js';
import { AUTHORITY_FOOTER_LINKS } from '../../lib/eeat-engine/links.js';

interface Props {
  doc: AuthorityPageDoc;
  onNavigate: (path: string) => void;
}

/** Shared layout for methodology, about, legal, and related authority pages. */
export default function AuthorityPage({ doc, onNavigate }: Props) {
  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-3xl mx-auto">
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-400" aria-label="Breadcrumb">
        <button type="button" onClick={() => onNavigate('/')} className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer">
          Home
        </button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-slate-800 dark:text-white">{doc.h1}</span>
      </nav>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-start gap-3">
          <BookOpen className="w-8 h-8 text-indigo-500 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-extrabold font-display text-slate-800 dark:text-white">{doc.h1}</h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">{doc.intro}</p>
            <p className="text-[10px] font-bold text-slate-400">Last updated: {doc.last_updated}</p>
          </div>
        </div>
      </section>

      {doc.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-3 shadow-xs"
        >
          <h2 className="text-sm font-extrabold font-display text-slate-800 dark:text-white">{section.title}</h2>
          {section.paragraphs.map((p, i) => (
            <p key={i} className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium whitespace-pre-wrap">
              {renderPossiblyMailto(p)}
            </p>
          ))}
          {section.bullets && section.bullets.length > 0 && (
            <ul className="list-disc pl-5 space-y-1.5">
              {section.bullets.map((b) => (
                <li key={b} className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                  {b}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-3 shadow-xs">
        <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Related authority pages</h2>
        <div className="flex flex-wrap gap-2">
          {AUTHORITY_FOOTER_LINKS.filter((l) => l.href !== doc.path).map((l) => (
            <button
              key={l.href}
              type="button"
              onClick={() => onNavigate(l.href)}
              className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3 py-2 rounded-xl cursor-pointer"
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function renderPossiblyMailto(text: string) {
  const idx = text.indexOf('mailto:');
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const rest = text.slice(idx);
  const space = rest.search(/\s/);
  const href = space === -1 ? rest : rest.slice(0, space);
  const after = space === -1 ? '' : rest.slice(space);
  return (
    <>
      {before}
      <a href={href} className="text-indigo-600 dark:text-indigo-400 underline break-all">
        {href.replace(/^mailto:/, '').split('?')[0]}
      </a>
      {after}
    </>
  );
}
