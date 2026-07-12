import { ChevronRight, MapPin, Sparkles, Building2 } from 'lucide-react';
import TrustStrip from './TrustStrip';
import { buildTrustSignals } from '../../lib/eeat-engine/trust-signals.js';

export interface CityPageViewData {
  city: string;
  state: string;
  country: string;
  countryCode: string;
  countrySlug: string;
  slug: string;
  population: number | null;
  timezone: string;
  currency: string;
  symbol: string;
  indices: {
    cpi_index: number;
    rent_index: number;
    groceries_index: number;
    restaurant_price_index: number;
    local_purchasing_power_index: number;
  };
  rent_1br: number;
  salary: number;
  groceries_sample: number;
  transport_sample: number;
  utilities: number;
  restaurant_meal: number;
  nearby: Array<{ city: string; slug: string; state?: string }>;
  related_comparisons: Array<{ slug: string; label: string }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
  data_source: string;
  confidence_label: string;
  latitude: number | null;
  longitude: number | null;
  last_updated?: string;
}

interface Props {
  data: CityPageViewData;
  onNavigate: (path: string) => void;
  onCompare: (slug: string) => void;
}

function fmt(n: number, symbol: string) {
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

export default function CityPage({ data, onNavigate, onCompare }: Props) {
  const trust = buildTrustSignals({
    data_source: data.data_source,
    confidence_label: data.confidence_label,
    last_updated: data.last_updated,
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-400" aria-label="Breadcrumb">
        <button type="button" onClick={() => onNavigate('/')} className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer">Home</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" onClick={() => onNavigate(`/country/${data.countrySlug}`)} className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer">
          {data.country}
        </button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-slate-800 dark:text-white">{data.city}</span>
      </nav>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-start gap-3">
          <Building2 className="w-8 h-8 text-indigo-500 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-extrabold font-display text-slate-800 dark:text-white">
              Cost of Living in {data.city}{data.state ? `, ${data.state}` : ''}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
              City overview for {data.city}, {data.country}: rent, salary, groceries, transport, utilities, restaurants, and cost index — with nearby cities and related comparisons.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {[
            { label: 'Country', value: data.country },
            { label: 'State / Region', value: data.state || '—' },
            { label: 'Population', value: data.population ? data.population.toLocaleString() : '—' },
            { label: 'Timezone', value: data.timezone },
            { label: 'Currency', value: data.currency },
            { label: 'Avg 1BR rent', value: fmt(data.rent_1br, data.symbol) },
            { label: 'Avg salary', value: fmt(data.salary, data.symbol) },
            { label: 'Cost index (CPI)', value: String(data.indices.cpi_index) },
            { label: 'Groceries (milk 1L)', value: fmt(data.groceries_sample, data.symbol) },
            { label: 'Transport ticket', value: fmt(data.transport_sample, data.symbol) },
            { label: 'Utilities (85m²)', value: fmt(data.utilities, data.symbol) },
            { label: 'Restaurant meal', value: fmt(data.restaurant_meal, data.symbol) },
          ].map((item) => (
            <div key={item.label} className="bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-800 rounded-2xl p-3">
              <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">{item.label}</div>
              <div className="text-sm font-extrabold text-slate-800 dark:text-white mt-1 truncate" title={item.value}>{item.value}</div>
            </div>
          ))}
        </div>

        <TrustStrip trust={trust} onNavigate={onNavigate} />
      </section>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-3 shadow-xs">
        <h2 className="text-sm font-extrabold font-display text-slate-800 dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          AI Generated Summary
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">{data.summary}</p>
      </section>

      {data.nearby.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-3 shadow-xs">
          <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-indigo-500" />
            Nearby cities
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {data.nearby.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => onNavigate(`/city/${c.slug}`)}
                className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3 py-3 rounded-xl cursor-pointer text-center truncate"
              >
                {c.city}
              </button>
            ))}
          </div>
        </section>
      )}

      {data.related_comparisons.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-3 shadow-xs">
          <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Related comparisons</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {data.related_comparisons.map((c) => (
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
