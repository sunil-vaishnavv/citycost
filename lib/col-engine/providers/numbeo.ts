/**
 * Optional Numbeo provider adapter (Layer 1 / future-ready).
 * Returns null when key missing or request fails — engine falls through.
 */

import type { CategoryIndices } from '../types.js';
import type { PriceItem } from '../../../src/types.js';
import { getCurrencyForCountry } from '../currency.js';
import { BASKET_KEYS } from '../surveyed-data.js';

export interface NumbeoCityResult {
  name: string;
  currency: string;
  symbol: string;
  exchange_rate: number;
  categories: CategoryIndices;
  prices: PriceItem[];
  countryCodeHint?: string;
}

const ITEM_MAP: Array<{ match: RegExp; basket: string }> = [
  { match: /1.?bedroom.*city.?centr/i, basket: BASKET_KEYS[0] },
  { match: /1.?bedroom.*outside/i, basket: BASKET_KEYS[1] },
  { match: /3.?bedroom.*city.?centr/i, basket: BASKET_KEYS[2] },
  { match: /3.?bedroom.*outside/i, basket: BASKET_KEYS[3] },
  { match: /meal.*inexpensive/i, basket: BASKET_KEYS[4] },
  { match: /meal for 2/i, basket: BASKET_KEYS[5] },
  { match: /cappuccino/i, basket: BASKET_KEYS[6] },
  { match: /coke|pepsi/i, basket: BASKET_KEYS[7] },
  { match: /milk/i, basket: BASKET_KEYS[8] },
  { match: /bread/i, basket: BASKET_KEYS[9] },
  { match: /rice/i, basket: BASKET_KEYS[10] },
  { match: /eggs/i, basket: BASKET_KEYS[11] },
  { match: /chicken/i, basket: BASKET_KEYS[12] },
  { match: /apples/i, basket: BASKET_KEYS[13] },
  { match: /potato/i, basket: BASKET_KEYS[14] },
  { match: /water.*1\.5|water \(1\.5/i, basket: BASKET_KEYS[15] },
  { match: /basic.*electricity|utilities/i, basket: BASKET_KEYS[16] },
  { match: /internet/i, basket: BASKET_KEYS[17] },
  { match: /one.?way ticket/i, basket: BASKET_KEYS[18] },
  { match: /taxi 1km|taxi 1 km/i, basket: BASKET_KEYS[19] },
  { match: /gasoline|petrol/i, basket: BASKET_KEYS[20] },
  { match: /average monthly net salary/i, basket: BASKET_KEYS[21] },
];

export async function fetchNumbeoCity(
  query: string,
  apiKey: string | undefined
): Promise<NumbeoCityResult | null> {
  if (!apiKey || apiKey === 'YOUR_NUMBEO_API_KEY') return null;

  try {
    const url = `https://www.numbeo.com/api/city_prices?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (!data || !Array.isArray(data.prices) || data.prices.length < 5) return null;

    const currencyCode = String(data.currency || 'USD');
    // Infer rough country from currency for FX table
    const countryGuess =
      currencyCode === 'INR' ? 'IN' :
      currencyCode === 'GBP' ? 'GB' :
      currencyCode === 'JPY' ? 'JP' :
      currencyCode === 'AED' ? 'AE' :
      currencyCode === 'EUR' ? 'DE' :
      currencyCode === 'AUD' ? 'AU' :
      currencyCode === 'CAD' ? 'CA' :
      'US';
    const fx = getCurrencyForCountry(countryGuess, currencyCode);

    const byName = new Map<string, number>();
    for (const p of data.prices) {
      const n = String(p.item_name || '');
      for (const m of ITEM_MAP) {
        if (m.match.test(n) && !byName.has(m.basket)) {
          byName.set(m.basket, Number(p.average_price));
        }
      }
    }

    const prices: PriceItem[] = BASKET_KEYS.map((name, i) => {
      const avg = byName.get(name) ?? 0;
      return {
        item_id: i + 1,
        item_name: name,
        average_price: parseFloat(Number(avg).toFixed(2)),
        highest_price: parseFloat((avg * 1.2).toFixed(2)),
        lowest_price: parseFloat((avg * 0.8).toFixed(2)),
        currency: currencyCode,
      };
    });

    // Derive crude indices from rent/meal/salary vs NYC-ish baselines if indices absent
    const rent = byName.get(BASKET_KEYS[0]) || 0;
    const meal = byName.get(BASKET_KEYS[4]) || 0;
    const salary = byName.get(BASKET_KEYS[21]) || 0;
    const housing = rent > 0 ? Math.min(160, (rent / fx.rate / 3500) * 100) : 40;
    const restaurants = meal > 0 ? Math.min(160, (meal / fx.rate / 25) * 100) : 40;
    const salIdx = salary > 0 ? Math.min(180, (salary / fx.rate / 6200) * 100) : 60;
    const groceries = restaurants * 0.95;
    const categories: CategoryIndices = {
      housing,
      groceries,
      restaurants,
      transport: restaurants * 0.9,
      utilities: groceries * 0.95,
      healthcare: groceries,
      education: groceries,
      entertainment: restaurants * 0.95,
      salary: salIdx,
      cpi: (groceries + restaurants) / 2,
    };

    return {
      name: data.name || query,
      currency: currencyCode,
      symbol: fx.symbol,
      exchange_rate: fx.rate,
      categories,
      prices,
      countryCodeHint: countryGuess,
    };
  } catch {
    return null;
  }
}
