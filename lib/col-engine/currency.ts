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
  // Euro users that were missing and therefore fell back to USD display.
  AD: { code: 'EUR', symbol: '€', rate: 0.92 },
  LI: { code: 'CHF', symbol: 'Fr.', rate: 0.9 },
  MT: { code: 'EUR', symbol: '€', rate: 0.92 },
  CY: { code: 'EUR', symbol: '€', rate: 0.92 },
  LU: { code: 'EUR', symbol: '€', rate: 0.92 },
  EE: { code: 'EUR', symbol: '€', rate: 0.92 },
  LV: { code: 'EUR', symbol: '€', rate: 0.92 },
  LT: { code: 'EUR', symbol: '€', rate: 0.92 },
  SI: { code: 'EUR', symbol: '€', rate: 0.92 },
  SK: { code: 'EUR', symbol: '€', rate: 0.92 },
  FI: { code: 'EUR', symbol: '€', rate: 0.92 },
  HR: { code: 'EUR', symbol: '€', rate: 0.92 },
  ME: { code: 'EUR', symbol: '€', rate: 0.92 },
  // Estimated FX rate (local units per 1 USD) — review alongside COUNTRY_BASELINES.
  DO: { code: 'DOP', symbol: 'RD$', rate: 59 },

  // ── Remaining countries in the SEO index ─────────────────────────────
  //
  // Until these existed, getCurrencyForCountry() returned its USD fallback for
  // every country not listed above — 261 of the 498 indexed cities, including
  // all 45 Algerian, 30 Kenyan and 16 Cambodian pages, were priced in US
  // dollars. That is the same silent-US substitution as the old
  // `countryCode || 'US'` fallback, one layer further down.
  //
  // Rates are local units per 1 USD and are STATIC APPROXIMATIONS, consistent
  // with the rest of this table: accurate to the order of magnitude a
  // cost-of-living estimate needs, not to FX-dealing precision. Entries marked
  // "volatile" move fast or have divergent official/parallel rates and should be
  // reviewed first when this table is refreshed. Pegged entries are marked so a
  // reviewer knows they are not expected to drift.

  // Africa
  DZ: { code: 'DZD', symbol: 'DA ', rate: 135 },
  KE: { code: 'KES', symbol: 'KSh ', rate: 129 },
  MA: { code: 'MAD', symbol: 'MAD ', rate: 9.9 },
  TN: { code: 'TND', symbol: 'DT ', rate: 3.1 },
  LY: { code: 'LYD', symbol: 'LD ', rate: 4.85 },
  ET: { code: 'ETB', symbol: 'Br ', rate: 120 },       // floated 2024
  GH: { code: 'GHS', symbol: 'GH₵', rate: 15 },
  NG: { code: 'NGN', symbol: '₦', rate: 1550 },        // volatile
  UG: { code: 'UGX', symbol: 'USh ', rate: 3700 },
  TZ: { code: 'TZS', symbol: 'TSh ', rate: 2600 },
  RW: { code: 'RWF', symbol: 'FRw ', rate: 1350 },
  BI: { code: 'BIF', symbol: 'FBu ', rate: 2900 },
  ZM: { code: 'ZMW', symbol: 'ZK ', rate: 26 },
  ZW: { code: 'ZWG', symbol: 'ZiG ', rate: 13.5 },     // ZiG replaced ZWL in 2024, volatile
  BW: { code: 'BWP', symbol: 'P ', rate: 13.6 },
  NA: { code: 'NAD', symbol: 'N$', rate: 18.5 },       // pegged to ZAR
  MZ: { code: 'MZN', symbol: 'MT ', rate: 64 },
  AO: { code: 'AOA', symbol: 'Kz ', rate: 910 },       // volatile
  CD: { code: 'CDF', symbol: 'FC ', rate: 2800 },
  SD: { code: 'SDG', symbol: 'SDG ', rate: 600 },      // volatile
  DJ: { code: 'DJF', symbol: 'Fdj ', rate: 178 },      // pegged to USD
  GM: { code: 'GMD', symbol: 'D ', rate: 70 },
  GN: { code: 'GNF', symbol: 'FG ', rate: 8600 },
  CV: { code: 'CVE', symbol: 'CVE ', rate: 101 },      // pegged to EUR
  // CFA franc zones — both pegged to the euro at 655.957 per EUR.
  SN: { code: 'XOF', symbol: 'CFA ', rate: 604 },
  ML: { code: 'XOF', symbol: 'CFA ', rate: 604 },
  BF: { code: 'XOF', symbol: 'CFA ', rate: 604 },
  BJ: { code: 'XOF', symbol: 'CFA ', rate: 604 },
  CI: { code: 'XOF', symbol: 'CFA ', rate: 604 },
  GW: { code: 'XOF', symbol: 'CFA ', rate: 604 },
  NE: { code: 'XOF', symbol: 'CFA ', rate: 604 },
  TG: { code: 'XOF', symbol: 'CFA ', rate: 604 },
  CM: { code: 'XAF', symbol: 'FCFA ', rate: 604 },
  CF: { code: 'XAF', symbol: 'FCFA ', rate: 604 },
  CG: { code: 'XAF', symbol: 'FCFA ', rate: 604 },
  GA: { code: 'XAF', symbol: 'FCFA ', rate: 604 },
  TD: { code: 'XAF', symbol: 'FCFA ', rate: 604 },
  GQ: { code: 'XAF', symbol: 'FCFA ', rate: 604 },

  // Middle East
  JO: { code: 'JOD', symbol: 'JD ', rate: 0.709 },     // pegged to USD
  KW: { code: 'KWD', symbol: 'KD ', rate: 0.307 },     // pegged
  BH: { code: 'BHD', symbol: 'BD ', rate: 0.376 },     // pegged
  OM: { code: 'OMR', symbol: 'OMR ', rate: 0.385 },    // pegged
  IQ: { code: 'IQD', symbol: 'IQD ', rate: 1310 },
  IR: { code: 'IRR', symbol: 'IRR ', rate: 42000 },    // official rate, volatile
  LB: { code: 'LBP', symbol: 'LL ', rate: 89500 },     // post-2023 devaluation, volatile
  SY: { code: 'SYP', symbol: 'SYP ', rate: 13000 },    // official rate, volatile
  YE: { code: 'YER', symbol: 'YER ', rate: 250 },      // volatile

  // Central & South Asia
  AF: { code: 'AFN', symbol: 'Af ', rate: 70 },
  NP: { code: 'NPR', symbol: 'NRs ', rate: 133.6 },    // pegged to INR
  BT: { code: 'BTN', symbol: 'Nu ', rate: 83.5 },      // pegged to INR
  MV: { code: 'MVR', symbol: 'Rf ', rate: 15.4 },
  KZ: { code: 'KZT', symbol: '₸', rate: 480 },
  UZ: { code: 'UZS', symbol: 'UZS ', rate: 12800 },
  KG: { code: 'KGS', symbol: 'KGS ', rate: 87 },
  TM: { code: 'TMT', symbol: 'TMT ', rate: 3.5 },
  AZ: { code: 'AZN', symbol: '₼', rate: 1.7 },
  AM: { code: 'AMD', symbol: '֏', rate: 390 },
  GE: { code: 'GEL', symbol: '₾', rate: 2.7 },

  // South-East & East Asia
  KH: { code: 'KHR', symbol: '៛', rate: 4100 },
  LA: { code: 'LAK', symbol: '₭', rate: 21500 },
  MM: { code: 'MMK', symbol: 'K ', rate: 2100 },       // official rate, volatile
  KP: { code: 'KPW', symbol: 'KPW ', rate: 900 },      // official rate, nominal

  // Europe
  CZ: { code: 'CZK', symbol: 'Kc ', rate: 23 },
  HU: { code: 'HUF', symbol: 'Ft ', rate: 360 },
  RO: { code: 'RON', symbol: 'lei ', rate: 4.6 },
  BG: { code: 'BGN', symbol: 'BGN ', rate: 1.8 },      // pegged to EUR
  RS: { code: 'RSD', symbol: 'din ', rate: 108 },
  BA: { code: 'BAM', symbol: 'KM ', rate: 1.8 },       // pegged to EUR
  MK: { code: 'MKD', symbol: 'MKD ', rate: 57 },
  AL: { code: 'ALL', symbol: 'L ', rate: 92 },
  MD: { code: 'MDL', symbol: 'MDL ', rate: 17.8 },
  UA: { code: 'UAH', symbol: '₴', rate: 41 },
  BY: { code: 'BYN', symbol: 'Br ', rate: 3.3 },
  IS: { code: 'ISK', symbol: 'kr ', rate: 138 },

  // Americas
  AR: { code: 'ARS', symbol: 'AR$', rate: 1200 },      // volatile
  CL: { code: 'CLP', symbol: 'CLP$', rate: 950 },
  CO: { code: 'COP', symbol: 'COP$', rate: 4000 },
  PE: { code: 'PEN', symbol: 'S/', rate: 3.75 },
  BO: { code: 'BOB', symbol: 'Bs ', rate: 6.9 },
  PY: { code: 'PYG', symbol: '₲', rate: 7500 },
  UY: { code: 'UYU', symbol: '$U', rate: 40 },
  VE: { code: 'VES', symbol: 'Bs ', rate: 50 },        // redenominated, highly volatile
  CR: { code: 'CRC', symbol: '₡', rate: 520 },
  GT: { code: 'GTQ', symbol: 'Q', rate: 7.75 },
  HN: { code: 'HNL', symbol: 'L ', rate: 24.8 },
  NI: { code: 'NIO', symbol: 'C$', rate: 36.8 },
  PA: { code: 'PAB', symbol: 'B/.', rate: 1 },         // pegged 1:1 to USD
  BZ: { code: 'BZD', symbol: 'BZ$', rate: 2 },         // pegged
  JM: { code: 'JMD', symbol: 'J$', rate: 157 },
  BS: { code: 'BSD', symbol: 'B$', rate: 1 },          // pegged 1:1 to USD
  CU: { code: 'CUP', symbol: 'CUP$', rate: 24 },       // official rate, volatile

  // ── Countries with a country page but no indexed city ────────────────
  //
  // These have no /city/ page today, but /country/<slug> renders currency from
  // this same table, so without them 41 country pages showed US dollars.

  // Caribbean — the Eastern Caribbean dollar is pegged at 2.70 per USD.
  AG: { code: 'XCD', symbol: 'EC$', rate: 2.7 },
  DM: { code: 'XCD', symbol: 'EC$', rate: 2.7 },
  GD: { code: 'XCD', symbol: 'EC$', rate: 2.7 },
  KN: { code: 'XCD', symbol: 'EC$', rate: 2.7 },
  LC: { code: 'XCD', symbol: 'EC$', rate: 2.7 },
  VC: { code: 'XCD', symbol: 'EC$', rate: 2.7 },
  BB: { code: 'BBD', symbol: 'Bds$', rate: 2 },        // pegged
  TT: { code: 'TTD', symbol: 'TT$', rate: 6.8 },
  GY: { code: 'GYD', symbol: 'GY$', rate: 209 },
  SR: { code: 'SRD', symbol: 'SRD ', rate: 35 },       // volatile
  HT: { code: 'HTG', symbol: 'G ', rate: 132 },

  // Africa & Indian Ocean
  KM: { code: 'KMF', symbol: 'CF ', rate: 452 },       // pegged to EUR
  ER: { code: 'ERN', symbol: 'Nfk ', rate: 15 },       // pegged
  LS: { code: 'LSL', symbol: 'L ', rate: 18.5 },       // pegged to ZAR
  SZ: { code: 'SZL', symbol: 'E ', rate: 18.5 },       // pegged to ZAR
  LR: { code: 'LRD', symbol: 'L$', rate: 195 },
  MG: { code: 'MGA', symbol: 'Ar ', rate: 4550 },
  MW: { code: 'MWK', symbol: 'MK ', rate: 1735 },
  MR: { code: 'MRU', symbol: 'UM ', rate: 40 },        // MRU replaced MRO in 2018
  MU: { code: 'MUR', symbol: 'Rs ', rate: 46 },
  SC: { code: 'SCR', symbol: 'SR ', rate: 14.3 },
  SL: { code: 'SLE', symbol: 'Le ', rate: 22.5 },      // SLE redenominated SLL in 2022
  ST: { code: 'STN', symbol: 'Db ', rate: 22.5 },      // STN replaced STD in 2018
  SO: { code: 'SOS', symbol: 'Sh ', rate: 571 },
  SS: { code: 'SSP', symbol: 'SSP ', rate: 1300 },     // volatile

  // Asia
  LK: { code: 'LKR', symbol: 'Rs ', rate: 300 },
  MN: { code: 'MNT', symbol: 'MNT ', rate: 3400 },
  TJ: { code: 'TJS', symbol: 'SM ', rate: 10.9 },
  BN: { code: 'BND', symbol: 'B$', rate: 1.35 },       // pegged to SGD

  // Pacific — Kiribati, Nauru and Tuvalu use the Australian dollar.
  FJ: { code: 'FJD', symbol: 'FJ$', rate: 2.25 },
  PG: { code: 'PGK', symbol: 'K ', rate: 3.9 },
  SB: { code: 'SBD', symbol: 'SI$', rate: 8.4 },
  VU: { code: 'VUV', symbol: 'VT ', rate: 119 },
  WS: { code: 'WST', symbol: 'WS$', rate: 2.75 },
  TO: { code: 'TOP', symbol: 'T$', rate: 2.35 },
  KI: { code: 'AUD', symbol: 'A$', rate: 1.51 },
  NR: { code: 'AUD', symbol: 'A$', rate: 1.51 },
  TV: { code: 'AUD', symbol: 'A$', rate: 1.51 },

  // European microstates using the euro by monetary agreement.
  MC: { code: 'EUR', symbol: '€', rate: 0.92 },
  SM: { code: 'EUR', symbol: '€', rate: 0.92 },
  VA: { code: 'EUR', symbol: '€', rate: 0.92 },
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
