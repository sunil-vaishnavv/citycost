import { ChevronRight, Compass } from 'lucide-react';
import type { IntentLandingPublic } from '../../lib/search-intent/types.js';

interface Props {
  data: IntentLandingPublic;
  onNavigate: (path: string) => void;
}

function LinkGroup({
  title,
  links,
  onNavigate,
}: {
  title: string;
  links: Array<{ label: string; href: string }>;
  onNavigate: (path: string) => void;
}) {
  if (!links.length) return null;
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-3 shadow-xs">
      <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <button
            key={l.href + l.label}
            type="button"
            onClick={() => onNavigate(l.href)}
            className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3 py-2 rounded-xl cursor-pointer"
          >
            {l.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Intent landing / category / country-guide view — mirrors existing SEO page styling. */
export default function IntentLandingPage({ data, onNavigate }: Props) {
  const g = data.graph;
  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-3xl mx-auto">
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-400" aria-label="Breadcrumb">
        <button type="button" onClick={() => onNavigate('/')} className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer">
          Home
        </button>
        <ChevronRight className="w-3 h-3" />
        {g.parent && (
          <>
            <button type="button" onClick={() => onNavigate(g.parent!.href)} className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer">
              {g.parent.label}
            </button>
            <ChevronRight className="w-3 h-3" />
          </>
        )}
        <span className="text-slate-800 dark:text-white">{data.h1}</span>
      </nav>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-start gap-3">
          <Compass className="w-8 h-8 text-indigo-500 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-extrabold font-display text-slate-800 dark:text-white">{data.h1}</h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">{data.intro}</p>
            <p className="text-[10px] font-bold text-slate-400">Last updated: {data.last_updated}</p>
          </div>
        </div>
        {data.city && (
          <p className="text-[10px] text-slate-400 font-bold">
            {data.city.data_source ? `Source: ${data.city.data_source}` : ''}
            {data.city.confidence_label ? ` · Confidence: ${data.city.confidence_label}` : ''}
          </p>
        )}
      </section>

      {data.sections.map((s) => (
        <section
          key={s.id}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-3 shadow-xs"
        >
          <h2 className="text-sm font-extrabold font-display text-slate-800 dark:text-white">{s.title}</h2>
          {s.paragraphs.map((p, i) => (
            <p key={i} className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
              {p}
            </p>
          ))}
          {s.bullets && s.bullets.length > 0 && (
            <ul className="list-disc pl-5 space-y-1">
              {s.bullets.map((b) => (
                <li key={b} className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium">
                  {b}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {data.faqs.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs">
          <h2 className="text-sm font-extrabold font-display text-slate-800 dark:text-white">FAQ</h2>
          {data.faqs.map((f) => (
            <div key={f.q} className="space-y-1">
              <h3 className="text-xs font-extrabold text-slate-700 dark:text-slate-200">{f.q}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">{f.a}</p>
            </div>
          ))}
        </section>
      )}

      <LinkGroup title="Cluster pages" links={g.siblings} onNavigate={onNavigate} />
      <LinkGroup title="Related guides" links={g.related_guides} onNavigate={onNavigate} />
      <LinkGroup title="Related cities" links={g.related_cities} onNavigate={onNavigate} />
      <LinkGroup title="Related comparisons" links={g.related_comparisons} onNavigate={onNavigate} />
      <LinkGroup title="Categories" links={g.related_categories} onNavigate={onNavigate} />
      <LinkGroup title="Countries" links={g.related_countries} onNavigate={onNavigate} />
    </div>
  );
}
