import { useState } from 'react';
import { 
  Compass, 
  Home, 
  Utensils, 
  ShoppingCart, 
  Zap, 
  Wallet, 
  DollarSign, 
  TrendingDown, 
  TrendingUp, 
  Search,
  Filter
} from 'lucide-react';
import { CityData } from '../types';
import { convertAndFormat, calculateDifferencePercent } from '../utils/helpers';

interface DetailedPriceListProps {
  dataBase: CityData;
  dataCompare: CityData;
}

export function DetailedPriceList({ dataBase, dataCompare }: DetailedPriceListProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const priceCategories = [
    { id: 'all', label: 'All Items', icon: Compass },
    { id: 'rent', label: 'Housing & Rent', icon: Home, items: [1, 2, 3, 4] },
    { id: 'dining', label: 'Dining Out', icon: Utensils, items: [5, 6, 7, 8] },
    { id: 'groceries', label: 'Groceries', icon: ShoppingCart, items: [9, 10, 11, 12, 13, 14, 15, 16] },
    { id: 'utilities', label: 'Utilities & Tech', icon: Zap, items: [17, 18] },
    { id: 'transport', label: 'Transportation', icon: Wallet, items: [19, 20, 21] },
    { id: 'salary', label: 'Salary & Jobs', icon: DollarSign, items: [22] }
  ];

  const cityAName = dataBase.name.split(',')[0];
  const cityBName = dataCompare.name.split(',')[0];
  const sameCurrency =
    dataBase.currency.toUpperCase() === dataCompare.currency.toUpperCase();

  const currentCategoryObj = priceCategories.find(c => c.id === activeCategory);
  const activeItemIds = currentCategoryObj?.items;

  // Compile and match item prices between both cities
  const matchedPricesList = dataBase.prices.map(itemA => {
    const itemB = dataCompare.prices.find(b => b.item_id === itemA.item_id || b.item_name === itemA.item_name);
    return {
      item_id: itemA.item_id,
      name: itemA.item_name,
      basePrice: itemA.average_price,
      comparePrice: itemB ? itemB.average_price : 0,
      diffPercent: itemB ? calculateDifferencePercent(itemA.average_price, dataBase.exchange_rate, itemB.average_price, dataCompare.exchange_rate) : 0
    };
  })
  .filter(p => !activeItemIds || activeItemIds.includes(p.item_id))
  .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const getCategoryLabel = (id: number) => {
    if (id <= 4) return 'Rent & Lodging';
    if (id <= 8) return 'Dining & Food';
    if (id <= 16) return 'Supermarket Groceries';
    if (id <= 18) return 'Utilities & Internet';
    if (id <= 21) return 'Public Transit';
    return 'Jobs & Salaries';
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 shadow-xs">
      {/* Header and Category Tabs */}
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-xl font-extrabold font-display text-slate-800 dark:text-white flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-indigo-500" />
              <span>Granular Expense Analysis</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {sameCurrency
                ? `Prices shown in local currency (${dataBase.currency})`
                : `Local currencies with exchange conversion (${dataBase.currency} ↔ ${dataCompare.currency})`}
            </p>
          </div>

          {/* Search bar inside prices */}
          <div className="relative w-full lg:max-w-xs">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search expenses e.g. milk, rent..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-850 hover:bg-slate-100/70 border border-slate-200 dark:border-slate-800 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-950/20 rounded-xl text-xs font-semibold outline-hidden transition-all"
            />
          </div>
        </div>

        {/* Horizontal Category Tab selectors */}
        <div className="flex flex-wrap gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/80">
          {priceCategories.map((cat) => {
            const IconComponent = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={`price-cat-tab-${cat.id}`}
                onClick={() => {
                  setActiveCategory(cat.id);
                  setSearchQuery('');
                }}
                className={`inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-xl border transition-all hover-lift cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 dark:bg-indigo-600 text-white border-slate-900 dark:border-indigo-600 shadow-sm shadow-indigo-100'
                    : 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                <IconComponent className="w-3.5 h-3.5" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Expense list Table */}
      <div className="mt-6 space-y-4">
        {/* Table Header Row */}
        <div className="hidden sm:grid grid-cols-12 gap-4 px-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest pb-3 border-b border-slate-100 dark:border-slate-800/60">
          <div className="col-span-5">Expense Basket Items</div>
          <div className="col-span-2 text-right">{cityAName} ({dataBase.currency})</div>
          <div className="col-span-2 text-right">{cityBName} ({dataCompare.currency})</div>
          <div className="col-span-3 text-right">Pricing Deviation</div>
        </div>

        {/* Dynamic matched rows */}
        {matchedPricesList.length > 0 ? (
          matchedPricesList.map((item) => {
            const isSalary = item.item_id === 22;
            const isBetter = isSalary ? item.diffPercent > 0 : item.diffPercent < 0;
            const isNeutral = Math.abs(item.diffPercent) < 1;

            return (
              <div
                key={`price-basket-item-${item.item_id}`}
                className="grid grid-cols-1 sm:grid-cols-12 items-center gap-4 p-4 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/30 border border-slate-150 dark:border-slate-800/80 hover:border-indigo-200 dark:hover:border-indigo-800 rounded-2xl transition-all duration-200 hover:shadow-sm group"
                id={`price_row_${item.item_id}`}
              >
                {/* Name / Category Badge */}
                <div className="col-span-12 sm:col-span-5 space-y-1">
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-200">
                    {item.name}
                  </h4>
                  <span className="inline-block text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-extrabold px-2 py-0.5 rounded-sm uppercase tracking-wide">
                    {getCategoryLabel(item.item_id)}
                  </span>
                </div>

                {/* City A Price */}
                <div className="col-span-6 sm:col-span-2 flex sm:flex-col justify-between items-center sm:items-end border-r border-slate-100 dark:border-slate-800/50 pr-2">
                  <span className="sm:hidden text-xs text-slate-400 font-bold">{cityAName}</span>
                  <div className="text-right">
                    <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                      {dataBase.symbol}{item.basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold block leading-none mt-0.5">
                      {dataBase.currency}
                    </span>
                  </div>
                </div>

                {/* City B Price */}
                <div className="col-span-6 sm:col-span-2 flex sm:flex-col justify-between items-center sm:items-end border-r border-slate-100 dark:border-slate-800/50 pr-2">
                  <span className="sm:hidden text-xs text-slate-400 font-bold">{cityBName}</span>
                  <div className="text-right">
                    <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                      {dataCompare.symbol}{item.comparePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold block leading-none mt-0.5 whitespace-nowrap">
                      {sameCurrency
                        ? dataCompare.currency
                        : `≈ ${convertAndFormat(item.comparePrice, dataCompare.exchange_rate, dataBase.exchange_rate, dataBase.symbol)}`}
                    </span>
                  </div>
                </div>

                {/* Pricing Deviation Badge & Bar */}
                <div className="col-span-12 sm:col-span-3 flex justify-between sm:justify-end items-center gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800/80">
                  <span className="sm:hidden text-xs text-slate-400 font-bold">Deviation</span>
                  <div className="text-right flex flex-col items-end">
                    {isNeutral ? (
                      <span className="text-xs font-bold px-2.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-md">
                        Same
                      </span>
                    ) : (
                      <div className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full border ${
                        isBetter 
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' 
                          : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-100/50'
                      }`}>
                        {item.diffPercent > 0 ? '+' : ''}{item.diffPercent.toFixed(0)}%
                        {isBetter ? (
                          <TrendingDown className="w-3.5 h-3.5" />
                        ) : (
                          <TrendingUp className="w-3.5 h-3.5" />
                        )}
                      </div>
                    )}
                    
                    {/* Visual Deviation split track */}
                    <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mt-2 hidden sm:block overflow-hidden relative">
                      <div 
                        className={`h-full absolute top-0 ${item.diffPercent > 0 ? 'bg-indigo-500 right-1/2' : 'bg-teal-500 left-1/2'}`}
                        style={{ width: `${Math.min(Math.abs(item.diffPercent) / 2, 50)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12 text-slate-400 dark:text-slate-500 font-bold border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            No items matched your current active filter &quot;{searchQuery}&quot;
          </div>
        )}
      </div>
    </div>
  );
}
