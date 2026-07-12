import { ChevronRight, Globe, MapPin, TrendingUp, TrendingDown, Sparkles } from 'lucide-react';
import TrustStrip from './TrustStrip';
import { buildCountryTrustSignals } from '../../lib/eeat-engine/trust-signals.js';

export interface CountryPageViewData {
  code: string;
  slug: string;
  name: string;
  currency: string;
  symbol: string;
  exchange_rate: number;
  population: number;
  avg_salary: number;
  avg_rent: number;
  avg_groceries_index: number;
  avg_cpi: number;
  cheapest: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  expensive: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  cities: Array<{ city: string; state?: string; slug: string; population?: number; cpi: number; rent: number }>;
  top_comparisons: Array<{ slug: string; label: string }>;
  related_countries: Array<{ slug: string; name: string }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
  canonical: string;
}

interface Props {
  data: CountryPageViewData;
  onNavigate: (path: string) => void;
  onCompare: (slug: string) => void;
}

function fmt(n: number, symbol: string) {
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

export default function CountryPage({ data, onNavigate, onCompare }: Props) {
  const trust = buildCountryTrustSignals();

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-400" aria-label="Breadcrumb">
        <button type="button" onClick={() => onNavigate('/')} className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer">Home</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-slate-600 dark:text-slate-300">Countries</span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-slate-800 dark:text-white">{data.name}</span>
      </nav>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-start gap-3">
          <Globe className="w-8 h-8 text-indigo-500 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-extrabold font-display text-slate-800 dark:text-white">
              Cost of Living in {data.name}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
              Country overview for {data.name}: currency {data.currency}, indexed cities, average rent and salaries, plus links to city pages and comparisons.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {[
            { label: 'Currency', value: data.currency },
            { label: 'Population (indexed)', value: data.population ? data.population.toLocaleString() : '—' },
            { label: 'Avg salary', value: fmt(data.avg_salary, data.symbol) },
            { label: 'Avg 1BR rent', value: fmt(data.avg_rent, data.symbol) },
            { label: 'Avg groceries idx', value: String(data.avg_groceries_index) },
            { label: 'Avg CPI', value: String(data.avg_cpi) },
            { label: 'Indexed cities', value: String(data.cities.length) },
            { label: 'FX vs USD', value: String(data.exchange_rate) },
          ].map((item) => (
            <div key={item.label} className="bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-800 rounded-2xl p-3">
              <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">{item.label}</div>
              <div className="text-sm font-extrabold text-slate-800 dark:text-white mt-1">{item.value}</div>
            </div>
          ))}
        </div>

        <TrustStrip trust={trust} onNavigate={onNavigate} />
      </section>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-3 shadow-xs">
        <h2 className="text-sm font-extrabold font-display text-slate-800 dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          AI Summary
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">{data.summary}</p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-3 shadow-xs">
          <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1.5">
            <TrendingDown className="w-4 h-4 text-emerald-500" />
            Cheapest cities
          </h2>
          <ul className="space-y-2">
            {data.cheapest.map((c) => (
              <li key={c.slug}>
                <button
                  type="button"
                  onClick={() => onNavigate(`/city/${c.slug}`)}
                  className="w-full text-left text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3 py-2.5 rounded-xl flex justify-between cursor-pointer"
                >
                  <span>{c.city}</span>
                  <span className="text-slate-400 font-mono">{fmt(c.rent, data.symbol)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-3 shadow-xs">
          <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-rose-500" />
            Most expensive cities
          </h2>
          <ul className="space-y-2">
            {data.expensive.map((c) => (
              <li key={c.slug}>
                <button
                  type="button"
                  onClick={() => onNavigate(`/city/${c.slug}`)}
                  className="w-full text-left text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3 py-2.5 rounded-xl flex justify-between cursor-pointer"
                >
                  <span>{c.city}</span>
                  <span className="text-slate-400 font-mono">{fmt(c.rent, data.symbol)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs">
        <h2 className="text-sm font-extrabold font-display text-slate-800 dark:text-white flex items-center gap-2">
          <MapPin className="w-4 h-4 text-indigo-500" />
          Cities in {data.name}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {data.cities.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => onNavigate(`/city/${c.slug}`)}
              className="text-left text-[11px] font-extrabold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3.5 py-3 rounded-xl cursor-pointer truncate"
            >
              {c.city}{c.state ? `, ${c.state}` : ''}
            </button>
          ))}
        </div>
      </section>

      {data.top_comparisons.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs">
          <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Top comparisons</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {data.top_comparisons.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => onCompare(c.slug)}
                className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3 py-3 rounded-xl cursor-pointer text-center truncate"
              >
                {c.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {data.related_countries.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-3 shadow-xs">
          <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Related countries</h2>
          <div className="flex flex-wrap gap-2">
            {data.related_countries.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => onNavigate(`/country/${c.slug}`)}
                className="text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-indigo-600 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl cursor-pointer"
              >
                {c.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs">
        <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Frequently Asked Questions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.faqs.map((f) => (
            <div key={f.q} className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-2xl">
              <h3 className="text-xs font-extrabold text-slate-800 dark:text-slate-200">{f.q}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
