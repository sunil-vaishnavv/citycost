/**
 * Currency engine — static FX table (local units per 1 USD).
 * Future: swap implementation for live FX provider without changing callers.
 */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  rate: number;
}

const CURRENCY_BY_COUNTRY: Record<string, CurrencyInfo> = {
  US: { code: 'USD', symbol: '$', rate: 1 },
  IN: { code: 'INR', symbol: '₹', rate: 83.5 },
  GB: { code: 'GBP', symbol: '£', rate: 0.78 },
  JP: { code: 'JPY', symbol: '¥', rate: 160.5 },
  AE: { code: 'AED', symbol: 'AED ', rate: 3.67 },
  AU: { code: 'AUD', symbol: 'A$', rate: 1.51 },
  DE: { code: 'EUR', symbol: '€', rate: 0.92 },
  FR: { code: 'EUR', symbol: '€', rate: 0.92 },
  IT: { code: 'EUR', symbol: '€', rate: 0.92 },
  ES: { code: 'EUR', symbol: '€', rate: 0.92 },
  NL: { code: 'EUR', symbol: '€', rate: 0.92 },
  IE: { code: 'EUR', symbol: '€', rate: 0.92 },
  AT: { code: 'EUR', symbol: '€', rate: 0.92 },
  BE: { code: 'EUR', symbol: '€', rate: 0.92 },
  PT: { code: 'EUR', symbol: '€', rate: 0.92 },
  GR: { code: 'EUR', symbol: '€', rate: 0.92 },
  CA: { code: 'CAD', symbol: 'C$', rate: 1.37 },
  SG: { code: 'SGD', symbol: 'S$', rate: 1.35 },
  CH: { code: 'CHF', symbol: 'Fr.', rate: 0.9 },
  CN: { code: 'CNY', symbol: '¥', rate: 7.25 },
  KR: { code: 'KRW', symbol: '₩', rate: 1380 },
  BR: { code: 'BRL', symbol: 'R$', rate: 5.4 },
  MX: { code: 'MXN', symbol: '$', rate: 18.2 },
  ZA: { code: 'ZAR', symbol: 'R', rate: 18.5 },
  NZ: { code: 'NZD', symbol: 'NZ$', rate: 1.63 },
  SE: { code: 'SEK', symbol: 'kr', rate: 10.5 },
  NO: { code: 'NOK', symbol: 'kr', rate: 10.6 },
  DK: { code: 'DKK', symbol: 'kr.', rate: 6.9 },
  PL: { code: 'PLN', symbol: 'zł', rate: 3.95 },
  TR: { code: 'TRY', symbol: '₺', rate: 32.8 },
  SA: { code: 'SAR', symbol: '﷼', rate: 3.75 },
  QA: { code: 'QAR', symbol: '﷼', rate: 3.64 },
  TH: { code: 'THB', symbol: '฿', rate: 36.5 },
  MY: { code: 'MYR', symbol: 'RM', rate: 4.71 },
  ID: { code: 'IDR', symbol: 'Rp', rate: 16300 },
  PH: { code: 'PHP', symbol: '₱', rate: 58.5 },
  VN: { code: 'VND', symbol: '₫', rate: 25400 },
  PK: { code: 'PKR', symbol: '₨', rate: 278 },
  BD: { code: 'BDT', symbol: '৳', rate: 110 },
  EG: { code: 'EGP', symbol: 'E£', rate: 48 },
  HK: { code: 'HKD', symbol: 'HK$', rate: 7.82 },
  TW: { code: 'TWD', symbol: 'NT$', rate: 32 },
  IL: { code: 'ILS', symbol: '₪', rate: 3.7 },
  RU: { code: 'RUB', symbol: '₽', rate: 92 },
};

export function getCurrencyForCountry(countryCode: string, fallbackCode?: string | null): CurrencyInfo {
  if (CURRENCY_BY_COUNTRY[countryCode]) return CURRENCY_BY_COUNTRY[countryCode];
  if (fallbackCode) {
    const hit = Object.values(CURRENCY_BY_COUNTRY).find((c) => c.code === fallbackCode);
    if (hit) return hit;
  }
  return { code: fallbackCode || 'USD', symbol: fallbackCode && fallbackCode !== 'USD' ? `${fallbackCode} ` : '$', rate: 1 };
}

/** Convert amount from currency A to B using USD pivot (rates = local per 1 USD). */
export function convertCurrency(
  amount: number,
  fromRate: number,
  toRate: number
): number {
  const usd = amount / (fromRate || 1);
  return usd * (toRate || 1);
}

export function sameCountry(codeA: string, codeB: string): boolean {
  return codeA.toUpperCase() === codeB.toUpperCase();
}
