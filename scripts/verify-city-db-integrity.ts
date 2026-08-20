/**
 * Database-side integrity check for the city cost cache.
 *
 * The resolver-level audits (verify-city-uniqueness-audit) prove the ENGINE is
 * correct. This proves what is actually stored in Postgres is correct too —
 * the two drifted apart once already, which is what left Zug holding Bangkok's
 * indices and Andorra stamped United States / USD.
 *
 * Safe to run against production: read-only, no writes, no schema changes.
 * Pair it with `cleanup-stale-city-cache.ts` (dry run), which reports 0 repairs
 * when every stored row agrees with the resolver.
 *
 * Run: npx tsx scripts/verify-city-db-integrity.ts
 */

import { pool } from '../lib/db.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Countries that genuinely circulate the US dollar. */
const USD_COUNTRIES = [
  'united states',
  'ecuador',
  'el salvador',
  'panama',
  'zimbabwe',
  'timor-leste',
  'east timor',
  'puerto rico',
  'marshall islands',
  'micronesia',
  'palau',
];

async function main(): Promise<void> {
  if (!pool) {
    console.error('No database pool configured (DATABASE_URL missing).');
    process.exit(1);
  }

  console.log('\nCity cache — database integrity\n');

  const [usCc] = await pool.query(
    `SELECT id, city_name, country, country_code FROM cities
      WHERE country_code = 'US' AND lower(country) <> 'united states'`
  );
  check(
    'no non-US city stamped country_code = US',
    (usCc as unknown[]).length === 0,
    JSON.stringify(usCc)
  );

  const [usd] = await pool.query(
    `SELECT id, city_name, country, currency FROM cities
      WHERE currency = 'USD' AND lower(country) <> ALL($1::text[])`,
    [USD_COUNTRIES]
  );
  check(
    'no row priced in USD outside a USD country',
    (usd as unknown[]).length === 0,
    JSON.stringify(usd)
  );

  // The pre-fix DEFAULT baseline produced this exact triple for ~400 cities.
  const [dflt] = await pool.query(
    `SELECT count(*)::int AS n FROM city_indices
      WHERE cpi_index = 29.30 AND rent_index = 10.50 AND local_purchasing_power_index = 36.00`
  );
  const dfltN = Number((dflt as Array<{ n: number }>)[0].n);
  check('no row carries the old DEFAULT-baseline signature', dfltN === 0, `${dfltN} rows`);

  const [clusters] = await pool.query(
    `SELECT cpi_index, rent_index, local_purchasing_power_index, count(*)::int AS n
       FROM city_indices
      GROUP BY 1, 2, 3 HAVING count(*) > 15 ORDER BY n DESC LIMIT 5`
  );
  check(
    'no oversized identical-index cluster stored',
    (clusters as unknown[]).length === 0,
    JSON.stringify(clusters)
  );

  const [orphanIdx] = await pool.query(
    `SELECT count(*)::int AS n FROM city_indices i
      LEFT JOIN cities c ON c.id = i.city_id WHERE c.id IS NULL`
  );
  check(
    'no orphaned city_indices rows',
    Number((orphanIdx as Array<{ n: number }>)[0].n) === 0,
    JSON.stringify(orphanIdx)
  );

  console.log('\n  Reference cities:');
  const [targets] = await pool.query(
    `SELECT c.city_name, c.country, c.country_code, c.currency, c.data_source, c.is_verified,
            i.cpi_index, i.rent_index, i.local_purchasing_power_index
       FROM cities c JOIN city_indices i ON i.city_id = c.id
      WHERE (lower(c.city_name), lower(c.country)) IN
            (('bangkok', 'thailand'),
             ('warsaw', 'poland'),
             ('zug', 'switzerland'),
             ('sydney', 'australia'),
             ('sant julià de lòria', 'andorra'),
             ('san pedro de macorís', 'dominican republic'))
      ORDER BY c.city_name`
  );
  const rows = targets as Array<Record<string, unknown>>;
  for (const r of rows) {
    console.log(
      `    ${String(r.city_name).padEnd(22)} ${r.country_code}/${r.currency}  ` +
        `cpi=${r.cpi_index} rent=${r.rent_index} ppi=${r.local_purchasing_power_index}  ` +
        `src=${r.data_source}`
    );
  }
  const expected: Record<string, [string, string]> = {
    Bangkok: ['TH', 'THB'],
    Warsaw: ['PL', 'PLN'],
    Zug: ['CH', 'CHF'],
    'Sant Julià de Lòria': ['AD', 'EUR'],
    'San Pedro de Macorís': ['DO', 'DOP'],
  };
  for (const [name, [cc, cur]] of Object.entries(expected)) {
    const row = rows.find((r) => r.city_name === name);
    check(
      `${name} stored as ${cc}/${cur}`,
      Boolean(row) && row!.country_code === cc && row!.currency === cur,
      row ? `${row.country_code}/${row.currency}` : 'row missing'
    );
  }

  // Zug and Bangkok shared a row verbatim before the fix.
  const bangkok = rows.find((r) => r.city_name === 'Bangkok');
  const zug = rows.find((r) => r.city_name === 'Zug');
  check(
    'Bangkok and Zug no longer store identical indices',
    Boolean(bangkok && zug) &&
      !(
        String(bangkok!.cpi_index) === String(zug!.cpi_index) &&
        String(bangkok!.rent_index) === String(zug!.rent_index)
      ),
    `${bangkok?.cpi_index}/${bangkok?.rent_index} vs ${zug?.cpi_index}/${zug?.rent_index}`
  );

  console.log(
    failures === 0 ? '\nDatabase integrity verified.\n' : `\n${failures} check(s) FAILED.\n`
  );
  await pool.end().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
