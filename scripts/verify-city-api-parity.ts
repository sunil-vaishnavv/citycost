/**
 * End-to-end parity check: /city/<slug> vs /api/city_prices.
 *
 * Boots the real server and compares the two public surfaces over HTTP. This is
 * deliberately NOT a resolver-level test — scripts/verify-seo-canonical.ts
 * already calls resolveCityCost()/resolveCityCostByQuery() directly, and that
 * check passed while production still disagreed, because /api/city_prices sits
 * behind a Postgres cache the SSR page never consults. Only a real request
 * exercises that layer.
 *
 * Guards three regressions:
 *   1. sync/async divergence — the async path must receive the same
 *      ColResolveHints the city page uses (Bangkok read CPI 32.8 on its page and
 *      21.6 in the calculator).
 *   2. stale estimate cache — a modelled row is a snapshot of an older engine
 *      run, not data; serving it re-opened (1) even after the engine was fixed.
 *   3. country-code fallback — an unmatched country name must not become the US.
 *
 * Run: npx tsx scripts/verify-city-api-parity.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { warmGeoCityIndex } from '../lib/geo-cities.js';
import { listIndexableCities } from '../lib/seo-catalog.js';
import { cityLabelFor } from '../lib/city-cost-resolve.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Cities the audit flagged, plus the two that resolved as United States. */
const TARGETS = [
  'bangkok-bangkok-thailand',
  'warsaw-masovian-voivodeship-poland',
  'zug-zug-switzerland',
  'sant-julia-de-loria-sant-julia-de-loria-andorra',
  'san-pedro-de-macoris-san-pedro-de-macoris-dominican-republic',
];

/** Expected country/currency for the two pages that used to price as US/USD. */
const COUNTRY_EXPECTATIONS: Record<string, { currency: string; country: string }> = {
  'sant-julia-de-loria-sant-julia-de-loria-andorra': { currency: 'EUR', country: 'Andorra' },
  'san-pedro-de-macoris-san-pedro-de-macoris-dominican-republic': {
    currency: 'DOP',
    country: 'Dominican Republic',
  },
};

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(base: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

/** Pull the SSR "Key metrics" list out of the prerendered city page. */
function parseCityPage(html: string): {
  currency: string;
  cpi: number;
  rent_index: number;
  ppi: number;
  rent_1br: string;
  salary: string;
  restaurant_meal: string;
  utilities: string;
} {
  const li = (label: string): string => {
    const m = html.match(new RegExp(`<li>${label}[^<]*?:\\s*([^<]*)</li>`, 'i'));
    return (m?.[1] || '').trim();
  };
  const num = (label: string): number => {
    const raw = li(label).replace(/[^0-9.]/g, '');
    return raw ? Number(raw) : NaN;
  };
  return {
    currency: li('Currency'),
    cpi: num('Cost of living index \\(CPI\\)'),
    rent_index: num('Rent index'),
    ppi: num('Purchasing power index'),
    rent_1br: li('Avg 1BR rent \\(centre\\)'),
    salary: li('Avg net salary'),
    restaurant_meal: li('Restaurant meal'),
    utilities: li('Utilities \\(85m²\\)'),
  };
}

/** Format an API price exactly the way the SSR page formats it. */
function fmtPrice(symbol: string, n: number): string {
  return n > 0 ? `${symbol}${Math.round(n).toLocaleString('en-US')}` : '—';
}

async function main(): Promise<void> {
  warmGeoCityIndex();

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  console.log(`\nBooting server on ${base} …`);

  const child: ChildProcess = spawn('npx', ['tsx', 'server.ts'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const serverLog: string[] = [];
  child.stdout?.on('data', (d) => serverLog.push(String(d)));
  child.stderr?.on('data', (d) => serverLog.push(String(d)));

  try {
    await waitForServer(base);
    console.log('Server ready.\n');

    const cities = listIndexableCities();

    console.log('1. /city/<slug> and /api/city_prices report the same numbers');
    for (const slug of TARGETS) {
      const rec = cities.find((c) => c.pageSlug === slug);
      if (!rec) {
        check(`${slug} is indexed`, false);
        continue;
      }

      const pageRes = await fetch(`${base}/city/${slug}`);
      if (!pageRes.ok) {
        check(`${slug} page 200`, false, `status ${pageRes.status}`);
        continue;
      }
      const page = parseCityPage(await pageRes.text());

      // Exactly the query the calculator UI sends for this city.
      const label = cityLabelFor(rec);
      const apiRes = await fetch(`${base}/api/city_prices?query=${encodeURIComponent(label)}`);
      if (!apiRes.ok) {
        check(`${slug} api 200`, false, `status ${apiRes.status}`);
        continue;
      }
      const api = (await apiRes.json()) as {
        currency: string;
        symbol: string;
        indices: Record<string, number>;
        prices: Array<{ item_name: string; average_price: number }>;
        data_source: string;
      };

      // Guard against a vacuous pass: if the SSR parse silently returned blanks,
      // both sides would compare equal on the string fields below.
      check(
        `${slug} page exposes real metrics`,
        Boolean(page.currency) &&
          Number.isFinite(page.cpi) &&
          page.cpi > 0 &&
          Number.isFinite(page.rent_index) &&
          page.rent_1br !== '' &&
          page.rent_1br !== '—' &&
          page.salary !== '' &&
          page.salary !== '—',
        JSON.stringify(page)
      );
      check(
        `${slug} api exposes real metrics`,
        Boolean(api.currency) && Number(api.indices.cpi_index) > 0 && api.prices.length > 0,
        `${api.currency} cpi=${api.indices?.cpi_index} prices=${api.prices?.length}`
      );

      check(`${slug} currency`, page.currency === api.currency, `page ${page.currency} vs api ${api.currency}`);
      check(
        `${slug} CPI index`,
        page.cpi === Number(api.indices.cpi_index),
        `page ${page.cpi} vs api ${api.indices.cpi_index}`
      );
      check(
        `${slug} rent index`,
        page.rent_index === Number(api.indices.rent_index),
        `page ${page.rent_index} vs api ${api.indices.rent_index}`
      );
      check(
        `${slug} purchasing power index`,
        page.ppi === Number(api.indices.local_purchasing_power_index),
        `page ${page.ppi} vs api ${api.indices.local_purchasing_power_index}`
      );

      const priced = (item: string): number =>
        api.prices.find((p) => p.item_name === item)?.average_price ?? 0;
      const basketChecks: Array<[string, string, string]> = [
        ['1BR rent', page.rent_1br, fmtPrice(api.symbol, priced('Apartment (1 bedroom) in City Centre'))],
        ['net salary', page.salary, fmtPrice(api.symbol, priced('Average Monthly Net Salary (After Tax)'))],
        ['restaurant meal', page.restaurant_meal, fmtPrice(api.symbol, priced('Meal, Inexpensive Restaurant'))],
        [
          'utilities',
          page.utilities,
          fmtPrice(
            api.symbol,
            priced('Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment')
          ),
        ],
      ];
      for (const [what, onPage, fromApi] of basketChecks) {
        check(`${slug} ${what}`, onPage === fromApi, `page ${onPage} vs api ${fromApi}`);
      }
    }

    console.log('\n2. Country / currency preserved (no silent US fallback)');
    for (const [slug, expect] of Object.entries(COUNTRY_EXPECTATIONS)) {
      const rec = cities.find((c) => c.pageSlug === slug);
      if (!rec) {
        check(`${slug} is indexed`, false);
        continue;
      }
      const api = (await (
        await fetch(`${base}/api/city_prices?query=${encodeURIComponent(cityLabelFor(rec))}`)
      ).json()) as { currency: string; name: string };
      check(`${slug} api currency is ${expect.currency}`, api.currency === expect.currency, api.currency);
      check(`${slug} api is not USD`, api.currency !== 'USD', api.currency);
      check(`${slug} api names ${expect.country}`, api.name.includes(expect.country), api.name);

      const html = await (await fetch(`${base}/city/${slug}`)).text();
      const page = parseCityPage(html);
      check(`${slug} page currency is ${expect.currency}`, page.currency === expect.currency, page.currency);
      check(
        `${slug} page links its own country`,
        html.includes(`>${expect.country}</a>`),
        'country link missing'
      );
    }

    console.log('\n3. Repeat requests stay stable (cache cannot reintroduce drift)');
    {
      const rec = cities.find((c) => c.pageSlug === 'bangkok-bangkok-thailand')!;
      const url = `${base}/api/city_prices?query=${encodeURIComponent(cityLabelFor(rec))}`;
      const first = (await (await fetch(url)).json()) as { indices: unknown; currency: string };
      const second = (await (await fetch(url)).json()) as { indices: unknown; currency: string };
      check(
        'second /api/city_prices call matches the first',
        JSON.stringify(first.indices) === JSON.stringify(second.indices) &&
          first.currency === second.currency,
        `${JSON.stringify(first.indices)} vs ${JSON.stringify(second.indices)}`
      );

      const page = parseCityPage(await (await fetch(`${base}/city/bangkok-bangkok-thailand`)).text());
      check(
        'page still matches after the API warmed the cache',
        page.cpi === Number((second.indices as Record<string, number>).cpi_index),
        `page ${page.cpi} vs api ${(second.indices as Record<string, number>).cpi_index}`
      );
    }

    console.log('\n4. Two cities that once shared a cached profile are distinct');
    {
      const read = async (slug: string) => {
        const rec = cities.find((c) => c.pageSlug === slug)!;
        return (await (
          await fetch(`${base}/api/city_prices?query=${encodeURIComponent(cityLabelFor(rec))}`)
        ).json()) as { indices: Record<string, number>; currency: string };
      };
      const bangkok = await read('bangkok-bangkok-thailand');
      const zug = await read('zug-zug-switzerland');
      check(
        'Bangkok and Zug no longer return identical indices',
        JSON.stringify(bangkok.indices) !== JSON.stringify(zug.indices),
        JSON.stringify(bangkok.indices)
      );
      check('Zug is priced in CHF', zug.currency === 'CHF', zug.currency);
      check('Bangkok is priced in THB', bangkok.currency === 'THB', bangkok.currency);
    }
  } finally {
    child.kill();
  }

  if (failures > 0) {
    console.log(`\n--- server output (tail) ---\n${serverLog.join('').split('\n').slice(-25).join('\n')}`);
  }
  console.log(failures === 0 ? '\nCity page / API parity verified.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
