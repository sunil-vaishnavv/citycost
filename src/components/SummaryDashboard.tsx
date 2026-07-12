import { Award, TrendingDown, TrendingUp, Info, DollarSign, Percent, ShieldAlert } from 'lucide-react';
import { CityData } from '../types';
import { getCountryFlag } from '../utils/helpers';
import TrustStrip from './TrustStrip';
import { buildCompareTrustSignals } from '../../lib/eeat-engine/trust-signals.js';

interface SummaryDashboardProps {
  dataBase: CityData;
  dataCompare: CityData;
  onNavigate?: (path: string) => void;
}

export function SummaryDashboard({ dataBase, dataCompare, onNavigate }: SummaryDashboardProps) {
  const namePartsA = dataBase.name.split(',').map((p) => p.trim()).filter(Boolean);
  const namePartsB = dataCompare.name.split(',').map((p) => p.trim()).filter(Boolean);
  const cityAName = namePartsA[0] || dataBase.name;
  const cityBName = namePartsB[0] || dataCompare.name;
  const countryA = namePartsA[namePartsA.length - 1] || '';
  const countryB = namePartsB[namePartsB.length - 1] || '';

  const flagA = getCountryFlag(countryA);
  const flagB = getCountryFlag(countryB);

  const confidenceLabel =
    [dataBase.confidence_label, dataCompare.confidence_label]
      .filter(Boolean)
      .join(' · ') || null;
  const estimationNote =
    dataBase.estimation_note || dataCompare.estimation_note || null;

  // Overall Index Scores
  const cpiA = dataBase.indices.cpi_index;
  const cpiB = dataCompare.indices.cpi_index;

  // Rent Indices
  const rentA = dataBase.indices.rent_index;
  const rentB = dataCompare.indices.rent_index;

  // Groceries Indices
  const groceriesA = dataBase.indices.groceries_index;
  const groceriesB = dataCompare.indices.groceries_index;

  // Local Purchasing Power
  const pwrA = dataBase.indices.local_purchasing_power_index;
  const pwrB = dataCompare.indices.local_purchasing_power_index;

  // Calculate winner (cheaper city in terms of CPI)
  const isACheaper = cpiA < cpiB;
  const cheaperCityName = isACheaper ? cityAName : cityBName;
  const cheaperPercent = Math.abs(((cpiB - cpiA) / cpiA) * 100).toFixed(0);

  // Purchasing Power Difference calculations
  const pwrDiff = Math.abs(((pwrB - pwrA) / pwrA) * 100).toFixed(0);
  const isAPowerful = pwrA > pwrB;
  const powerfulCityName = isAPowerful ? cityAName : cityBName;

  // Circular gauge percentage calculation
  const powerCirclePercent = Math.min(Math.round((Math.max(pwrA, pwrB) / 150) * 100), 100);

  // Helper for progress bar color logic
  const getProgressBarStyles = (valA: number, valB: number, reverse: boolean = false) => {
    const diff = ((valB - valA) / valA) * 100;
    const absDiff = Math.abs(diff).toFixed(0);
    const isHigher = diff > 0;
    
    // For rent/expenses: higher is bad (red), lower is good (green)
    // For purchasing power/salary: higher is good (green), lower is bad (red)
    const isBeneficial = reverse ? isHigher : !isHigher;
    
    return {
      percent: Math.min(Math.round((valB / (valA || 1)) * 100), 150),
      diffLabel: `${isHigher ? '+' : ''}${diff.toFixed(0)}%`,
      isHigher,
      isBeneficial,
      absDiff
    };
  };

  const categories = [
    { label: 'Overall Cost of Living (CPI)', key: 'cpi_index', icon: DollarSign, valA: cpiA, valB: cpiB, reverse: false },
    { label: 'Apartment Rent Index', key: 'rent_index', icon: Percent, valA: rentA, valB: rentB, reverse: false },
    { label: 'Groceries price Index', key: 'groceries_index', icon: DollarSign, valA: groceriesA, valB: groceriesB, reverse: false },
  ];

  return (
    <div className="space-y-6">
      {/* City Header Cards & Winner Badge */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Base City Card */}
        <div className="bg-gradient-to-br from-indigo-950 to-slate-900 text-white rounded-3xl p-6 relative overflow-hidden border border-indigo-900/50 hover:shadow-xl hover:shadow-indigo-950/10 transition-all duration-300">
          <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-500 rounded-full mix-blend-screen blur-3xl opacity-10 pointer-events-none"></div>
          
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-indigo-400 bg-indigo-900/50 border border-indigo-800 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Reference City A
              </span>
              <h3 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight flex items-center gap-2 mt-2">
                <span className="text-3xl sm:text-4xl">{flagA}</span>
                <span>{cityAName}</span>
              </h3>
              <p className="text-xs text-indigo-200/80 font-medium">
                {countryA || 'Global Region'}
              </p>
            </div>
            
            {/* Index Badge */}
            <div className="bg-indigo-900/40 backdrop-blur-md border border-indigo-800 px-4 py-2.5 rounded-2xl text-center shadow-lg">
              <span className="text-[9px] uppercase font-bold tracking-widest text-indigo-300 block">CPI Index</span>
              <span className="text-xl font-black text-indigo-100">{cpiA.toFixed(1)}</span>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-indigo-900/60 grid grid-cols-3 gap-2 text-center">
            <div>
              <span className="text-[9px] text-indigo-300 font-bold uppercase block">Rent Index</span>
              <span className="text-sm font-extrabold text-white">{rentA.toFixed(1)}</span>
            </div>
            <div className="border-x border-indigo-900/60">
              <span className="text-[9px] text-indigo-300 font-bold uppercase block">Groceries</span>
              <span className="text-sm font-extrabold text-white">{groceriesA.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-[9px] text-indigo-300 font-bold uppercase block">Purchasing</span>
              <span className="text-sm font-extrabold text-white">{pwrA.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Comparison City Card */}
        <div className="bg-gradient-to-br from-teal-950 to-slate-900 text-white rounded-3xl p-6 relative overflow-hidden border border-teal-900/50 hover:shadow-xl hover:shadow-teal-950/10 transition-all duration-300">
          <div className="absolute top-0 right-0 w-40 h-40 bg-teal-500 rounded-full mix-blend-screen blur-3xl opacity-10 pointer-events-none"></div>
          
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-teal-400 bg-teal-900/50 border border-teal-800 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Comparison City B
              </span>
              <h3 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight flex items-center gap-2 mt-2">
                <span className="text-3xl sm:text-4xl">{flagB}</span>
                <span>{cityBName}</span>
              </h3>
              <p className="text-xs text-teal-200/80 font-medium">
                {countryB || 'Global Region'}
              </p>
            </div>
            
            {/* Index Badge */}
            <div className="bg-teal-900/40 backdrop-blur-md border border-teal-800 px-4 py-2.5 rounded-2xl text-center shadow-lg">
              <span className="text-[9px] uppercase font-bold tracking-widest text-teal-300 block">CPI Index</span>
              <span className="text-xl font-black text-teal-100">{cpiB.toFixed(1)}</span>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-teal-900/60 grid grid-cols-3 gap-2 text-center">
            <div>
              <span className="text-[9px] text-teal-300 font-bold uppercase block">Rent Index</span>
              <span className="text-sm font-extrabold text-white">{rentB.toFixed(1)}</span>
            </div>
            <div className="border-x border-teal-900/60">
              <span className="text-[9px] text-teal-300 font-bold uppercase block">Groceries</span>
              <span className="text-sm font-extrabold text-white">{groceriesB.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-[9px] text-teal-300 font-bold uppercase block">Purchasing</span>
              <span className="text-sm font-extrabold text-white">{pwrB.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Winner Status Callout & Circular Purchasing Power Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Winner Announcement Card */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 shadow-xs relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>
          
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-2xl shrink-0">
              <Award className="w-6 h-6 animate-bounce" style={{ animationDuration: '3s' }} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest block">Cost-of-Living Winner</span>
              <h4 className="text-base sm:text-lg font-bold font-display text-slate-800 dark:text-white mt-0.5">
                {cheaperCityName} is Cheaper!
              </h4>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-4 leading-relaxed font-medium">
            Excluding the cost of home lodging leases, general household and consumer items in <strong className="text-indigo-600 dark:text-indigo-400">{cheaperCityName}</strong> are approximately <strong className="text-emerald-600">{cheaperPercent}%</strong> less expensive than in <strong className="text-rose-500">{isACheaper ? cityBName : cityAName}</strong>. This provides a substantially higher margin for grocery food baskets and daily services.
          </p>

          <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-2">
            <span className="text-[10px] bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-extrabold px-3 py-1 rounded-full border border-amber-200/50 flex items-center gap-1">
              <span>🏆 {cheaperCityName} Wins on Affordability</span>
            </span>
            {confidenceLabel && (
              <span className="text-[10px] bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700">
                {dataBase.data_source || 'Data'} · {dataCompare.data_source || 'Data'} · {confidenceLabel}
              </span>
            )}
          </div>
          {estimationNote && (
            <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500 font-medium flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{estimationNote}</span>
            </p>
          )}
          {onNavigate && (
            <div className="mt-3">
              <TrustStrip
                compact
                trust={buildCompareTrustSignals({
                  sourceA: dataBase.data_source,
                  sourceB: dataCompare.data_source,
                  confidenceA: dataBase.confidence_label,
                  confidenceB: dataCompare.confidence_label,
                })}
                onNavigate={onNavigate}
              />
            </div>
          )}
        </div>

        {/* Circular Purchasing Power Progress Indicator */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex items-center gap-6 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 shadow-xs">
          
          {/* Circular SVG Gauge */}
          <div className="relative w-24 h-24 shrink-0">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              {/* Background track circle */}
              <circle
                cx="50"
                cy="50"
                r="40"
                className="stroke-slate-100 dark:stroke-slate-800 fill-none"
                strokeWidth="8"
              />
              {/* Highlight value circle */}
              <circle
                cx="50"
                cy="50"
                r="40"
                className="stroke-teal-500 fill-none transition-all duration-1000"
                strokeWidth="8"
                strokeDasharray={`${2 * Math.PI * 40}`}
                strokeDashoffset={`${2 * Math.PI * 40 * (1 - powerCirclePercent / 100)}`}
                strokeLinecap="round"
              />
            </svg>
            {/* Absolute overlay text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-slate-400 font-bold block leading-none uppercase">Ratio</span>
              <span className="text-lg font-black text-slate-800 dark:text-white mt-0.5 leading-none">
                {Math.max(pwrA, pwrB).toFixed(0)}
              </span>
            </div>
          </div>

          <div className="space-y-1.5 flex-1">
            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">Relative Purchasing Power</span>
            <h4 className="text-sm font-extrabold text-slate-800 dark:text-white leading-tight">
              {powerfulCityName} has better wage utility!
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal font-medium">
              Average net salaries in {powerfulCityName} can purchase <strong className="text-emerald-600 font-bold">{pwrDiff}%</strong> more local goods and services than in the other city.
            </p>
          </div>
        </div>
      </div>

      {/* Visual Horizontal Progress Bars comparing major cost categories */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 shadow-xs space-y-5">
        <div>
          <h4 className="text-base font-bold font-display text-slate-800 dark:text-white flex items-center gap-1.5">
            <TrendingDown className="w-5 h-5 text-emerald-500" />
            <span>Category Variance Indicators</span>
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A granular breakdown comparing the baseline indices of reference City A and comparison City B
          </p>
        </div>

        <div className="space-y-5 pt-2">
          {categories.map((cat) => {
            const stats = getProgressBarStyles(cat.valA, cat.valB, cat.reverse);
            return (
              <div key={cat.key} className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <cat.icon className="w-4 h-4 text-slate-400" />
                    <span>{cat.label}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-medium">
                      {cat.valA.toFixed(1)} vs {cat.valB.toFixed(1)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                      stats.isBeneficial 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' 
                        : 'bg-rose-50 text-rose-700 border-rose-200/50'
                    }`}>
                      {stats.diffLabel} {stats.isBeneficial ? 'cheaper' : 'more exp.'}
                    </span>
                  </div>
                </div>

                {/* Progress Tracks */}
                <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden relative shadow-inner">
                  {/* Progress bar A (fixed at 50% as reference baseline) */}
                  <div className="absolute left-0 top-0 h-full bg-slate-300 dark:bg-slate-700" style={{ width: '50%' }}></div>
                  {/* Progress bar B (relative to A) */}
                  <div className={`absolute top-0 h-full ${stats.isBeneficial ? 'bg-teal-500' : 'bg-rose-500'}`} style={{ 
                    left: '50%',
                    width: `${Math.min(Math.abs(Number(stats.absDiff)) / 2, 50)}%` 
                  }}></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
