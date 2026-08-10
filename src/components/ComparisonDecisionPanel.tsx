import { Award, Scale, ListChecks, Target, TrendingDown } from 'lucide-react';
import { CityData } from '../types';
import { buildComparisonDecision } from '../../lib/comparison-decision.js';

interface ComparisonDecisionPanelProps {
  dataBase: CityData;
  dataCompare: CityData;
}

function priceByName(data: CityData, name: string): number | null {
  const hit = data.prices.find((p) => p.item_name === name);
  if (!hit || !Number.isFinite(hit.average_price) || hit.average_price <= 0) return null;
  return hit.average_price;
}

export function ComparisonDecisionPanel({ dataBase, dataCompare }: ComparisonDecisionPanelProps) {
  const cityAName = dataBase.name.split(',')[0].trim();
  const cityBName = dataCompare.name.split(',')[0].trim();

  const decision = buildComparisonDecision(
    {
      name: cityAName,
      cpi: dataBase.indices.cpi_index,
      rent: dataBase.indices.rent_index,
      groceries: dataBase.indices.groceries_index,
      restaurants: dataBase.indices.restaurant_price_index,
      purchasingPower: dataBase.indices.local_purchasing_power_index,
      exchangeRate: dataBase.exchange_rate,
      rent1br: priceByName(dataBase, 'Apartment (1 bedroom) in City Centre'),
      utilities: priceByName(
        dataBase,
        'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment'
      ),
      internet: priceByName(dataBase, 'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)'),
      transport: priceByName(dataBase, 'One-way Ticket (Local Transport)'),
      salary: priceByName(dataBase, 'Average Monthly Net Salary (After Tax)'),
    },
    {
      name: cityBName,
      cpi: dataCompare.indices.cpi_index,
      rent: dataCompare.indices.rent_index,
      groceries: dataCompare.indices.groceries_index,
      restaurants: dataCompare.indices.restaurant_price_index,
      purchasingPower: dataCompare.indices.local_purchasing_power_index,
      exchangeRate: dataCompare.exchange_rate,
      rent1br: priceByName(dataCompare, 'Apartment (1 bedroom) in City Centre'),
      utilities: priceByName(
        dataCompare,
        'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment'
      ),
      internet: priceByName(dataCompare, 'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)'),
      transport: priceByName(dataCompare, 'One-way Ticket (Local Transport)'),
      salary: priceByName(dataCompare, 'Average Monthly Net Salary (After Tax)'),
    }
  );

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs print-card">
      <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800/80 pb-4">
        <div className="p-2 bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-xl shrink-0">
          <Scale className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-bold font-display text-slate-900 dark:text-white">
            Decision Insights: {cityAName} vs {cityBName}
          </h3>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
            Derived only from paired indices and available basket prices
          </p>
        </div>
      </div>

      {/* Overall Winner */}
      <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-2">
          <Award className="w-4 h-4 text-amber-500" />
          <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
            Overall Cost Winner
          </h4>
        </div>
        <p className="text-lg font-extrabold font-display text-slate-800 dark:text-white">
          {decision.overall_winner.city}
        </p>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1.5 font-medium leading-relaxed">
          {decision.overall_winner.reason}
        </p>
      </div>

      {/* Monthly + Biggest */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-emerald-500" />
            <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              Monthly Cost Difference
            </h4>
          </div>
          {decision.monthly.amountUsd != null ? (
            <p className="text-base font-extrabold text-slate-800 dark:text-white">
              ~${decision.monthly.amountUsd.toLocaleString('en-US')} / month
            </p>
          ) : (
            <p className="text-base font-extrabold text-slate-800 dark:text-white">
              ~{decision.monthly.pct}% relative gap (CPI)
            </p>
          )}
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 font-medium leading-relaxed">
            {decision.monthly.summary}
          </p>
        </div>

        {decision.biggest_difference && (
          <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-indigo-500" />
              <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Biggest Difference
              </h4>
            </div>
            <p className="text-base font-extrabold text-slate-800 dark:text-white">
              {decision.biggest_difference.category}: {decision.biggest_difference.winner}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 font-medium leading-relaxed">
              {decision.biggest_difference.gapPct}% gap — {decision.biggest_difference.note}
            </p>
          </div>
        )}
      </div>

      {/* Category Winners */}
      {decision.category_winners.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-3">
            Category Winners
          </h4>
          <div className="overflow-x-auto rounded-2xl border border-slate-150 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-bold">Category</th>
                  <th className="px-3 py-2.5 font-bold">Winner</th>
                  <th className="px-3 py-2.5 font-bold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {decision.category_winners.map((w) => (
                  <tr key={w.category} className="text-slate-700 dark:text-slate-300">
                    <td className="px-3 py-2.5 font-extrabold text-slate-800 dark:text-slate-100">
                      {w.category}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-indigo-600 dark:text-indigo-400">
                      {w.winner}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-500 dark:text-slate-400">
                      {w.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Decision */}
      {decision.best_for.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-3">
            Quick Decision — Best For
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {decision.best_for.map((item) => (
              <div
                key={item.persona}
                className="bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-2xl p-4"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  {item.persona}
                </span>
                <p className="text-sm font-extrabold text-slate-800 dark:text-white mt-1">
                  {item.city}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 font-medium leading-relaxed">
                  {item.reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key Takeaways */}
      {decision.key_takeaways.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ListChecks className="w-4 h-4 text-slate-400" />
            <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              Key Takeaways
            </h4>
          </div>
          <ul className="space-y-2">
            {decision.key_takeaways.map((t, i) => (
              <li
                key={`takeaway-${i}`}
                className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium leading-relaxed flex gap-2"
              >
                <span className="text-indigo-500 font-extrabold shrink-0">{i + 1}.</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
