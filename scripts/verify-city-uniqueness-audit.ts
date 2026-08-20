/**
 * Full-catalogue data audit over every indexed city.
 *
 * Unlike verify-seo-canonical.ts (which samples), this walks the entire index
 * and is the check that has to stay green before a deploy:
 *
 *   1. uniqueness      — distinct (CPI, rent, purchasing-power) triples
 *   2. full-output     — distinct indices + complete price basket, so two pages
 *                        cannot be byte-identical below the fold either
 *   3. DEFAULT usage   — no indexed city may fall back to COUNTRY_BASELINES.DEFAULT
 *   4. country integrity — engine country must equal the catalog country for
 *                        every city (catches the old `countryCode || 'US'` path)
 *   5. labelling       — modelled output must never claim surveyed / Numbeo /
 *                        verified provenance
 *   6. sync vs async   — resolveCityCost() (city pages) and
 *                        resolveCityCostByQuery() (/api/city_prices) must agree
 *                        for every single city, not a sample
 *
 * Run: npx tsx scripts/verify-city-uniqueness-audit.ts
 */

import { warmGeoCityIndex } from '../lib/geo-cities.js';
import { listIndexableCities, listIndexableCountries } from '../lib/seo-catalog.js';
import { resolveCityCost, resolveCityCostByQuery, cityLabelFor } from '../lib/city-cost-resolve.js';
import { COUNTRY_BASELINES } from '../lib/col-engine/regional.js';
import { getCurrencyForCountry } from '../lib/col-engine/currency.js';
import { Country } from 'country-state-city';
import type { ColEngineResult } from '../lib/col-engine/types.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function tripleKey(r: ColEngineResult): string {
  return `${r.indices.cpi_index}|${r.indices.rent_index}|${r.indices.local_purchasing_power_index}`;
}

/** Everything a visitor can see: all five indices plus the whole price basket. */
function fullKey(r: ColEngineResult): string {
  const basket = (r.prices || [])
    .map((p) => `${p.item_name}=${p.average_price}`)
    .join('|');
  return `${JSON.stringify(r.indices)}#${r.currency}#${basket}`;
}

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const bucket = m.get(k);
    if (bucket) bucket.push(it);
    else m.set(k, [it]);
  }
  return m;
}

async function main(): Promise<void> {
  warmGeoCityIndex();

  const cities = listIndexableCities();
  const countries = listIndexableCountries();
  const resolved = cities.map((c) => ({ rec: c, r: resolveCityCost(c) }));

  console.log(
    `\nAudit scope: ${cities.length} indexed cities · ${countries.length} countries · ` +
      `${Object.keys(COUNTRY_BASELINES).filter((k) => k !== 'DEFAULT').length} country baselines`
  );

  console.log('\n1. Uniqueness — (CPI, rent, purchasing power) triples');
  {
    const buckets = group(resolved, (x) => tripleKey(x.r));
    const sizes = [...buckets.values()].map((v) => v.length).sort((a, b) => b - a);
    const shared = [...buckets.values()].filter((v) => v.length > 1);
    console.log(
      `     ${buckets.size} distinct triples · largest group ${sizes[0]} · ` +
        `${shared.reduce((n, v) => n + v.length, 0)} cities share a triple`
    );
    check(
      'at least 70% of cities have a distinct triple',
      buckets.size >= cities.length * 0.7,
      `${buckets.size}/${cities.length}`
    );
    check('no identical-data cluster larger than 15', sizes[0] <= 15, `largest ${sizes[0]}`);
    const worst = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (worst && worst[1].length > 1) {
      console.log(`     largest group: ${worst[1].slice(0, 12).map((x) => x.rec.pageSlug).join(', ')}`);
    }
  }

  console.log('\n2. Full-output duplicates — indices + currency + entire price basket');
  {
    const buckets = group(resolved, (x) => fullKey(x.r));
    const sizes = [...buckets.values()].map((v) => v.length).sort((a, b) => b - a);
    const sharing = [...buckets.values()].filter((v) => v.length > 1);
    console.log(
      `     ${buckets.size} distinct full outputs · largest group ${sizes[0]} · ` +
        `${sharing.reduce((n, v) => n + v.length, 0)} cities share a full output`
    );
    check(
      'no two cities emit a byte-identical full payload beyond a small tolerance',
      sizes[0] <= 15,
      `largest ${sizes[0]}`
    );
    for (const g of sharing.slice(0, 5)) {
      console.log(`     shared: ${g.map((x) => x.rec.pageSlug).join(', ')}`);
    }
  }

  console.log('\n3. COUNTRY_BASELINES.DEFAULT usage for indexed cities');
  {
    const onDefault = cities.filter((c) => !COUNTRY_BASELINES[c.countryCode]);
    console.log(`     cities without a country baseline: ${onDefault.length}`);
    check(
      'COUNTRY_BASELINES.DEFAULT usage is 0',
      onDefault.length === 0,
      onDefault.map((c) => `${c.pageSlug}(${c.countryCode})`).slice(0, 20).join(', ')
    );
  }

  console.log('\n4. Country integrity — no silent US (or any) substitution');
  {
    const mismatched = resolved.filter((x) => x.r.countryCode && x.r.countryCode !== x.rec.countryCode);
    check(
      'engine country equals catalog country for every city',
      mismatched.length === 0,
      mismatched.map((x) => `${x.rec.pageSlug}: ${x.rec.countryCode}->${x.r.countryCode}`).slice(0, 20).join(', ')
    );
    const blank = resolved.filter((x) => !x.r.countryCode);
    check('every city resolves to a country code', blank.length === 0, `${blank.length} blank`);
    // Currency is checked against an INDEPENDENT authority, not against
    // getCurrencyForCountry(). Comparing the engine's currency to the same
    // function that produced it is a tautology that can never fail, and it hid a
    // real defect: getCurrencyForCountry() covered only 58 countries and returned
    // its USD fallback for the rest, so 261 of 498 indexed cities were priced in
    // US dollars. country-state-city ships an ISO currency per country and is
    // wholly separate from our FX table.
    const isoCurrency = new Map(
      Country.getAllCountries().map((c) => [c.isoCode, (c as { currency?: string }).currency || ''])
    );

    // The packaged ISO data lags a few real-world changes. Each override is a
    // documented fact, not a way to silence a failure.
    const ISO_OVERRIDES: Record<string, string> = {
      HR: 'EUR', // Croatia adopted the euro on 2023-01-01; package still says HRK
      VE: 'VES', // bolivar soberano redenomination; package still says VEF
      ZW: 'ZWG', // ZiG replaced ZWL in April 2024; package still says ZWL
      MR: 'MRU', // ouguiya redenominated in 2018; package still says MRO
      ST: 'STN', // dobra redenominated in 2018; package still says STD
      SL: 'SLE', // leone redenominated in 2022; package still says SLL
    };

    const wrongCurrency = resolved.filter((x) => {
      const want = ISO_OVERRIDES[x.rec.countryCode] || isoCurrency.get(x.rec.countryCode);
      return Boolean(want) && x.r.currency !== want;
    });
    check(
      'currency matches the country ISO currency (independent source)',
      wrongCurrency.length === 0,
      wrongCurrency
        .map((x) => `${x.rec.pageSlug}(${x.rec.countryCode}): ${x.r.currency}`)
        .slice(0, 20)
        .join(', ')
    );

    const strayUsd = resolved.filter((x) => {
      const want = ISO_OVERRIDES[x.rec.countryCode] || isoCurrency.get(x.rec.countryCode);
      return x.r.currency === 'USD' && Boolean(want) && want !== 'USD';
    });
    check(
      'no city is priced in USD unless its own country uses USD',
      strayUsd.length === 0,
      strayUsd.map((x) => `${x.rec.pageSlug}(${x.rec.countryCode})`).slice(0, 20).join(', ')
    );

    // Order-of-magnitude guard on the static FX table. A wrong rate does not show
    // up as a wrong currency code — it shows up as an absurd price — so convert a
    // 1-bedroom city-centre rent back to USD and require a plausible band. This
    // is deliberately wide: it catches a 10x/1000x rate typo, not a bad estimate.
    const implausible = resolved.filter((x) => {
      const rent = x.r.prices.find(
        (pr) => pr.item_name === 'Apartment (1 bedroom) in City Centre'
      )?.average_price;
      if (!rent || rent <= 0) return false;
      const rate = getCurrencyForCountry(x.rec.countryCode).rate || 1;
      const usd = rent / rate;
      return usd < 30 || usd > 8000;
    });
    check(
      'FX rates give a plausible USD-equivalent rent everywhere',
      implausible.length === 0,
      implausible
        .map((x) => {
          const rent = x.r.prices.find(
            (pr) => pr.item_name === 'Apartment (1 bedroom) in City Centre'
          )!.average_price;
          const rate = getCurrencyForCountry(x.rec.countryCode).rate || 1;
          return `${x.rec.pageSlug}(${x.r.currency}) ${rent} -> $${Math.round(rent / rate)}`;
        })
        .slice(0, 20)
        .join(', ')
    );
  }

  console.log('\n5. Provenance labelling — modelled data never claims to be surveyed');
  {
    const modelledLabels = new Set(['Regional', 'Country', 'Estimated']);
    const bad = resolved.filter((x) => {
      const modelled = modelledLabels.has(String(x.r.data_source_label));
      return (
        modelled &&
        (x.r.is_verified === true ||
          /surveyed|numbeo|verified/i.test(x.r.confidence_label || '') ||
          /surveyed|numbeo/i.test(String(x.r.data_source_label)))
      );
    });
    check(
      'no modelled result is labelled surveyed / Numbeo / verified',
      bad.length === 0,
      bad.map((x) => x.rec.pageSlug).slice(0, 20).join(', ')
    );

    const bySource = new Map<string, number>();
    for (const x of resolved) bySource.set(x.r.data_source, (bySource.get(x.r.data_source) || 0) + 1);
    console.log(`     sources: ${[...bySource.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);

    const estimatedFlagWrong = resolved.filter(
      (x) => x.r.is_estimated === x.r.is_verified
    );
    check(
      'is_estimated and is_verified never agree',
      estimatedFlagWrong.length === 0,
      `${estimatedFlagWrong.length} rows`
    );
  }

  console.log('\n6. Sync (city page) vs async (/api/city_prices) — all cities');
  {
    let disagreements = 0;
    const examples: string[] = [];
    for (const { rec, r } of resolved) {
      const api = await resolveCityCostByQuery(cityLabelFor(rec));
      const same =
        JSON.stringify(r.indices) === JSON.stringify(api.indices) &&
        r.currency === api.currency &&
        r.tier === api.tier &&
        r.countryCode === api.countryCode &&
        JSON.stringify(r.prices.map((p) => [p.item_name, p.average_price])) ===
          JSON.stringify(api.prices.map((p) => [p.item_name, p.average_price]));
      if (!same) {
        disagreements++;
        if (examples.length < 10) examples.push(rec.pageSlug);
      }
    }
    console.log(`     compared ${resolved.length} cities across both resolvers`);
    check(
      'city page and API agree for every indexed city',
      disagreements === 0,
      `${disagreements} disagree: ${examples.join(', ')}`
    );
  }

  console.log(failures === 0 ? '\nFull city audit passed.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
