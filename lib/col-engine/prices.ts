/**
 * Category → price basket builder
 *
 * Prefer absolute local baskets when surveyed.
 * Otherwise derive per-category from NYC USD baselines (NOT one global multiplier).
 */

import type { CategoryIndices } from './types.js';
import type { PriceItem } from '../../src/types.js';
import type { CurrencyInfo } from './currency.js';
import { BASKET_KEYS } from './surveyed-data.js';

/** NYC USD reference baselines (only used when no local basket) */
const NYC_USD: Record<string, number> = {
  'Apartment (1 bedroom) in City Centre': 3500,
  'Apartment (1 bedroom) Outside of Centre': 2500,
  'Apartment (3 bedrooms) in City Centre': 6500,
  'Apartment (3 bedrooms) Outside of Centre': 4500,
  'Meal, Inexpensive Restaurant': 25,
  'Meal for 2 People, Mid-range Restaurant, Three-course': 100,
  'Cappuccino (regular)': 5.5,
  'Coke/Pepsi (0.33 liter bottle)': 3.0,
  'Milk (regular), (1 liter)': 1.4,
  'Loaf of Fresh White Bread (500g)': 4.0,
  'Rice (white), (1kg)': 4.5,
  'Eggs (regular) (12)': 4.8,
  'Chicken Fillets (1kg)': 14.0,
  'Apples (1kg)': 5.5,
  'Potato (1kg)': 3.8,
  'Water (1.5 liter bottle)': 2.5,
  'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment': 200,
  'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)': 70,
  'One-way Ticket (Local Transport)': 2.9,
  'Taxi 1km (Normal Tariff)': 2.5,
  'Gasoline (1 liter)': 1.05,
  'Average Monthly Net Salary (After Tax)': 6200,
};

function categoryForItem(name: string): keyof CategoryIndices {
  if (name.includes('Apartment')) return 'housing';
  if (name.includes('Restaurant') || name.includes('Meal') || name.includes('Cappuccino') || name.includes('Coke')) {
    return 'restaurants';
  }
  if (['Milk', 'Loaf', 'Rice', 'Eggs', 'Chicken', 'Apples', 'Potato', 'Water'].some((k) => name.includes(k))) {
    return 'groceries';
  }
  if (name.includes('Electricity') || name.includes('Internet')) return 'utilities';
  if (name.includes('Ticket') || name.includes('Taxi') || name.includes('Gasoline')) return 'transport';
  if (name.includes('Salary')) return 'salary';
  return 'cpi';
}

export function buildPriceBasket(
  categories: CategoryIndices,
  currency: CurrencyInfo,
  localBasket?: Partial<Record<string, number>> | null
): PriceItem[] {
  const items: PriceItem[] = [];
  let itemId = 1;

  for (const name of BASKET_KEYS) {
    let local: number;
    if (localBasket && localBasket[name] != null) {
      local = localBasket[name]!;
    } else {
      const catKey = categoryForItem(name);
      const idx = categories[catKey];
      const usd = NYC_USD[name] * (idx / 100);
      local = usd * currency.rate;
    }

    items.push({
      item_id: itemId++,
      item_name: name,
      average_price: parseFloat(local.toFixed(2)),
      highest_price: parseFloat((local * 1.2).toFixed(2)),
      lowest_price: parseFloat((local * 0.8).toFixed(2)),
      currency: currency.code,
    });
  }
  return items;
}

/**
 * Scale a reference local basket by per-category ratios vs the reference city.
 */
export function scaleLocalBasket(
  refBasket: Record<string, number>,
  refCats: CategoryIndices,
  targetCats: CategoryIndices,
  currencyCode: string
): PriceItem[] {
  const items: PriceItem[] = [];
  let itemId = 1;
  for (const name of BASKET_KEYS) {
    const catKey = categoryForItem(name);
    const ratio = (targetCats[catKey] || 1) / (refCats[catKey] || 1);
    const base = refBasket[name];
    if (base == null) {
      return buildPriceBasket(targetCats, { code: currencyCode, symbol: '', rate: 1 }, null);
    }
    const local = base * ratio;
    items.push({
      item_id: itemId++,
      item_name: name,
      average_price: parseFloat(local.toFixed(2)),
      highest_price: parseFloat((local * 1.2).toFixed(2)),
      lowest_price: parseFloat((local * 0.8).toFixed(2)),
      currency: currencyCode,
    });
  }
  return items;
}
