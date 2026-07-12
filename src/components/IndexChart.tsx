import { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Award, Percent, BarChart3, ListCollapse } from 'lucide-react';
import { CityData, IndexMetrics } from '../types';

interface IndexChartProps {
  dataBase: CityData;
  dataCompare: CityData;
}

export function IndexChart({ dataBase, dataCompare }: IndexChartProps) {
  const [viewMode, setViewMode] = useState<'index' | 'price'>('index');
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);

  const indicesKeys = [
    { key: 'cpi_index', label: 'Cost of Living', desc: 'Overall cost of consumer goods (excl. rent)' },
    { key: 'rent_index', label: 'Rent Index', desc: 'Average housing and apartment rental cost comparison' },
    { key: 'groceries_index', label: 'Groceries', desc: 'Relative prices of essential supermarket food items' },
    { key: 'restaurant_price_index', label: 'Restaurants', desc: 'Dining out prices at mid-tier and budget eateries' },
    { key: 'local_purchasing_power_index', label: 'Purchasing Power', desc: 'Relative purchasing utility of average net salary' }
  ];

  // Helper to extract specific item average prices for 'price' view mode
  const representativePrices = [
    { itemId: 1, label: '1-BR Rent (Center)', desc: 'Monthly apartment rent in City Center' },
    { itemId: 5, label: 'Meal for Two', desc: 'Three-course meal at a mid-range restaurant' },
    { itemId: 10, label: 'Loaf of Bread', desc: 'Fresh white bread (500g)' },
    { itemId: 17, label: 'Basic Utilities', desc: 'Electricity, heating, water & garbage (85m²)' },
    { itemId: 19, label: 'Monthly Transit', desc: 'Regular public transportation pass' },
  ];

  const cityAName = dataBase.name.split(',')[0];
  const cityBName = dataCompare.name.split(',')[0];

  return (
    <div className="bg-white dark:bg-brand-slate/40 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 relative overflow-hidden h-full">
      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/50 dark:bg-indigo-950/10 rounded-full blur-3xl pointer-events-none"></div>
      
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 pb-5 relative z-10">
        <div>
          <h3 className="text-lg font-bold font-display text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-500 animate-pulse" />
            <span>Interactive Side-by-Side Comparison</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {viewMode === 'index' 
              ? 'Ratios measured relative to New York City baseline (100.0)' 
              : `Direct price comparison in standard ${dataBase.currency}`}
          </p>
        </div>

        {/* View Mode Toggle Button */}
        <div className="flex bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200/50 dark:border-slate-800 self-start sm:self-auto shrink-0 shadow-inner">
          <button
            onClick={() => setViewMode('index')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              viewMode === 'index'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
            }`}
          >
            <Percent className="w-3.5 h-3.5" />
            <span>Indices</span>
          </button>
          <button
            onClick={() => setViewMode('price')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              viewMode === 'price'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>Actual Prices</span>
          </button>
        </div>
      </div>

      {/* Main Chart Stage */}
      <div className="mt-8 relative h-72 flex flex-col justify-end">
        {/* Y Axis Gridlines */}
        <div className="absolute inset-0 flex flex-col justify-between text-[9px] text-slate-400 dark:text-slate-500 font-mono font-medium pointer-events-none select-none">
          <div className="border-b border-slate-100 dark:border-slate-800/60 pb-1 flex justify-between">
            <span>{viewMode === 'index' ? '120.0' : 'Max Relative'}</span>
          </div>
          <div className="border-b border-slate-100 dark:border-slate-800/60 pb-1 flex justify-between">
            <span>{viewMode === 'index' ? '90.0' : '75% Scale'}</span>
          </div>
          <div className="border-b border-slate-100 dark:border-slate-800/60 pb-1 flex justify-between">
            <span>{viewMode === 'index' ? '60.0' : '50% Scale'}</span>
          </div>
          <div className="border-b border-slate-100 dark:border-slate-800/60 pb-1 flex justify-between">
            <span>{viewMode === 'index' ? '30.0' : '25% Scale'}</span>
          </div>
          <div className="border-b border-slate-150 dark:border-slate-800 pb-1 flex justify-between">
            <span>0.0</span>
          </div>
        </div>

        {/* Dynamic Bars Container */}
        <div className="absolute inset-x-0 bottom-0 top-6 flex justify-around items-end z-10 px-2 sm:px-4">
          {viewMode === 'index' ? (
            indicesKeys.map((item, idx) => {
              const valA = dataBase.indices[item.key as keyof IndexMetrics] || 0;
              const valB = dataCompare.indices[item.key as keyof IndexMetrics] || 0;
              
              // Max index represents 120
              const heightA = Math.min((valA / 120) * 100, 100);
              const heightB = Math.min((valB / 120) * 100, 100);
              const isHovered = hoveredBar === item.key;

              return (
                <div 
                  key={`idx-chart-${item.key}`} 
                  className="flex flex-col items-center w-full max-w-[90px] group/col"
                  onMouseEnter={() => setHoveredBar(item.key)}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <div className="flex items-end gap-1.5 sm:gap-2.5 w-full justify-center h-48 relative">
                    {/* Bar A (Indigo) */}
                    <div 
                      className={`w-3.5 sm:w-4 bg-indigo-500 hover:bg-indigo-600 rounded-t-lg transition-all duration-500 relative cursor-pointer hover:shadow-lg hover:shadow-indigo-500/20 ${
                        isHovered ? 'scale-x-110 z-20 brightness-110' : ''
                      }`}
                      style={{ height: `${heightA}%` }}
                    >
                      {/* Interactive Floating Tooltip */}
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover/col:opacity-100 transition-all duration-200 whitespace-nowrap z-30 font-bold shadow-xl flex flex-col items-center border border-slate-800">
                        <span className="text-slate-400 text-[8px] uppercase tracking-wider">{cityAName}</span>
                        <span>{valA.toFixed(1)}</span>
                        <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 mt-0.5 border-r border-b border-slate-800"></div>
                      </div>
                    </div>

                    {/* Bar B (Teal) */}
                    <div 
                      className={`w-3.5 sm:w-4 bg-teal-500 hover:bg-teal-600 rounded-t-lg transition-all duration-500 relative cursor-pointer hover:shadow-lg hover:shadow-teal-500/20 ${
                        isHovered ? 'scale-x-110 z-20 brightness-110' : ''
                      }`}
                      style={{ height: `${heightB}%` }}
                    >
                      {/* Interactive Floating Tooltip */}
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover/col:opacity-100 transition-all duration-200 whitespace-nowrap z-30 font-bold shadow-xl flex flex-col items-center border border-slate-800">
                        <span className="text-teal-400 text-[8px] uppercase tracking-wider">{cityBName}</span>
                        <span>{valB.toFixed(1)}</span>
                        <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 mt-0.5 border-r border-b border-slate-800"></div>
                      </div>
                    </div>
                  </div>

                  {/* Axis Label */}
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 text-center mt-3 leading-tight max-w-[76px] truncate">
                    {item.label}
                  </span>
                </div>
              );
            })
          ) : (
            // Prices Mode
            representativePrices.map((item, idx) => {
              const priceAObj = dataBase.prices.find(p => p.item_id === item.itemId);
              const priceBObj = dataCompare.prices.find(p => p.item_id === item.itemId);
              
              const valA = priceAObj ? priceAObj.average_price : 0;
              const rawB = priceBObj ? priceBObj.average_price : 0;
              
              // Normalize City B price to City A currency
              const valB = rawB * (dataBase.exchange_rate / dataCompare.exchange_rate);
              
              const maxVal = Math.max(valA, valB, 1);
              const heightA = (valA / maxVal) * 90; // scale to 90% max
              const heightB = (valB / maxVal) * 90;
              const isHovered = hoveredBar === `price-${item.itemId}`;

              return (
                <div 
                  key={`price-chart-${item.itemId}`} 
                  className="flex flex-col items-center w-full max-w-[90px] group/col"
                  onMouseEnter={() => setHoveredBar(`price-${item.itemId}`)}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <div className="flex items-end gap-1.5 sm:gap-2.5 w-full justify-center h-48 relative">
                    {/* Bar A (Indigo) */}
                    <div 
                      className={`w-3.5 sm:w-4 bg-indigo-500 hover:bg-indigo-600 rounded-t-lg transition-all duration-500 relative cursor-pointer hover:shadow-lg hover:shadow-indigo-500/20 ${
                        isHovered ? 'scale-x-110 z-20 brightness-110' : ''
                      }`}
                      style={{ height: `${heightA}%` }}
                    >
                      {/* Interactive Floating Tooltip */}
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover/col:opacity-100 transition-all duration-200 whitespace-nowrap z-30 font-bold shadow-xl flex flex-col items-center border border-slate-800">
                        <span className="text-slate-400 text-[8px] uppercase tracking-wider">{cityAName}</span>
                        <span>{dataBase.symbol}{valA.toFixed(2)}</span>
                        <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 mt-0.5 border-r border-b border-slate-800"></div>
                      </div>
                    </div>

                    {/* Bar B (Teal) */}
                    <div 
                      className={`w-3.5 sm:w-4 bg-teal-500 hover:bg-teal-600 rounded-t-lg transition-all duration-500 relative cursor-pointer hover:shadow-lg hover:shadow-teal-500/20 ${
                        isHovered ? 'scale-x-110 z-20 brightness-110' : ''
                      }`}
                      style={{ height: `${heightB}%` }}
                    >
                      {/* Interactive Floating Tooltip */}
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover/col:opacity-100 transition-all duration-200 whitespace-nowrap z-30 font-bold shadow-xl flex flex-col items-center border border-slate-800">
                        <span className="text-teal-400 text-[8px] uppercase tracking-wider">{cityBName}</span>
                        <span>{dataBase.symbol}{valB.toFixed(2)}</span>
                        <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 mt-0.5 border-r border-b border-slate-800"></div>
                      </div>
                    </div>
                  </div>

                  {/* Axis Label */}
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 text-center mt-3 leading-tight max-w-[76px] truncate">
                    {item.label}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legend with Color Badges */}
      <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-bold">
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 bg-indigo-500 rounded-lg shadow-xs shadow-indigo-500/20"></span>
          <span className="text-slate-700 dark:text-slate-300">
            {cityAName} <span className="text-[10px] font-mono text-slate-400">({dataBase.currency})</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 bg-teal-500 rounded-lg shadow-xs shadow-teal-500/20"></span>
          <span className="text-slate-700 dark:text-slate-300">
            {cityBName} <span className="text-[10px] font-mono text-slate-400">({dataCompare.currency})</span>
          </span>
        </div>
      </div>
    </div>
  );
}
