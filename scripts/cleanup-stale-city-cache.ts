/**
 * One-time (but repeatable) repair of pre-fix estimate rows in the city cache.
 *
 * WHY
 * ---
 * Rows in `cities` / `city_indices` / `city_prices` are written from whatever
 * the COL engine produced at the time of the request. Rows written before the
 * resolver was unified therefore carry the old engine's output:
 *
 *   - Zug held Bangkok's exact indices (29.30 / 10.50 / 36.00), because every
 *     non-surveyed city collapsed onto COUNTRY_BASELINES.DEFAULT;
 *   - Sant Julia de Loria and San Pedro de Macoris were stamped
 *     country_code = 'US' + currency = 'USD' by the old `countryCode || 'US'`
 *     fallback;
 *   - Warsaw was stored under country 'United States'.
 *
 * /api/city_prices no longer READS non-verified rows, so these cannot reach a
 * visitor any more. They are still wrong at rest, they still misreport in the
 * admin/list surfaces that query the table directly, and they would resurface
 * if anything ever trusted the estimate cache again. This script brings them
 * back in line with the unified resolver.
 *
 * SAFETY
 * ------
 *   - Dry run by default. Pass --apply to write.
 *   - Never DELETEs a city row; it only updates values in place.
 *   - Verified rows (is_verified, or data_source surveyed/numbeo/api/real/
 *     government/cache_verified) are skipped untouched — real data always wins.
 *   - Each repair is a single transaction keyed on the row's primary key, so the
 *     row inspected is exactly the row written (a name-keyed upsert would miss
 *     spelling variants such as 'Zurich' vs the resolver's 'Zurich' with umlaut).
 *   - Deterministic and idempotent: it compares the stored row against the
 *     resolver and rewrites only on a real difference, so a second run reports
 *     zero changes. Running it twice cannot duplicate or corrupt anything.
 *   - Every change is logged field by field.
 *
 * USAGE
 *   npx tsx scripts/cleanup-stale-city-cache.ts             # dry run (default)
 *   npx tsx scripts/cleanup-stale-city-cache.ts --apply     # perform repair
 *   npx tsx scripts/cleanup-stale-city-cache.ts --apply --limit 25
 */

import { pool } from '../lib/db.js';
import { getCityIndices, getCityPrices } from '../lib/city-repository.js';
import { resolveCityCostByQuery } from '../lib/city-cost-resolve.js';
import { warmGeoCityIndex } from '../lib/geo-cities.js';
import type { ColEngineResult } from '../lib/col-engine/types.js';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) || 0 : 0;

/** Same predicate the repository uses, kept in sync deliberately. */
function isVerifiedSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = String(source).toLowerCase();
  return ['surveyed', 'real', 'numbeo', 'api', 'government', 'cache_verified'].some((k) =>
    s.includes(k)
  );
}

function num(v: unknown): number {
  return Math.round(Number(v ?? 0) * 100) / 100;
}

interface Row {
  id: number;
  city_name: string;
  country: string | null;
  country_code: string | null;
  currency: string | null;
  data_source: string | null;
  is_verified: boolean | null;
}

/**
 * Rewrite one city's cached values in place, by primary key, in a transaction.
 * Only ever called for rows already established as non-verified estimates.
 */
async function repairRowById(cityId: number, engine: ColEngineResult): Promise<void> {
  const conn = await pool!.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE cities SET
         country = $2, state = $3, country_code = $4,
         currency = $5, symbol = $6, exchange_rate = $7,
         data_source = $8, confidence = $9, is_verified = $10,
         tier = $11, population = $12, estimation_note = $13,
         updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $1`,
      [
        cityId,
        engine.country,
        engine.state || null,
        engine.countryCode,
        engine.currency,
        engine.symbol,
        engine.exchange_rate,
        engine.data_source,
        engine.confidence,
        engine.is_verified,
        engine.tier,
        engine.population,
        engine.estimation_note,
      ]
    );

    await conn.query(
      `INSERT INTO city_indices
         (city_id, cpi_index, rent_index, groceries_index, restaurant_price_index, local_purchasing_power_index)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (city_id) DO UPDATE SET
         cpi_index = EXCLUDED.cpi_index,
         rent_index = EXCLUDED.rent_index,
         groceries_index = EXCLUDED.groceries_index,
         restaurant_price_index = EXCLUDED.restaurant_price_index,
         local_purchasing_power_index = EXCLUDED.local_purchasing_power_index,
         updated_at = (NOW() AT TIME ZONE 'UTC')`,
      [
        cityId,
        engine.indices.cpi_index,
        engine.indices.rent_index,
        engine.indices.groceries_index,
        engine.indices.restaurant_price_index,
        engine.indices.local_purchasing_power_index,
      ]
    );

    for (const p of engine.prices) {
      await conn.query(
        `INSERT INTO city_prices
           (city_id, item_id, item_name, average_price, highest_price, lowest_price, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (city_id, item_id) DO UPDATE SET
           item_name = EXCLUDED.item_name,
           average_price = EXCLUDED.average_price,
           highest_price = EXCLUDED.highest_price,
           lowest_price = EXCLUDED.lowest_price,
           currency = EXCLUDED.currency,
           updated_at = (NOW() AT TIME ZONE 'UTC')`,
        [cityId, p.item_id, p.item_name, p.average_price, p.highest_price, p.lowest_price, p.currency]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function main(): Promise<void> {
  if (!pool) {
    console.error('No database pool configured (DATABASE_URL missing). Nothing to do.');
    process.exit(1);
  }

  warmGeoCityIndex();

  console.log(
    `\nStale city-cache repair — mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}\n`
  );

  const [rowsRaw] = await pool.query(
    `SELECT id, city_name, country, country_code, currency, data_source, is_verified
       FROM cities
      ORDER BY id ASC`
  );
  const rows = rowsRaw as Row[];
  const scope = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;

  let verifiedSkipped = 0;
  let unresolvable = 0;
  let alreadyCorrect = 0;
  let repaired = 0;
  let failed = 0;
  const changeLog: string[] = [];

  for (const row of scope) {
    // 1. Preserve genuine surveyed / Numbeo / verified data untouched.
    if (row.is_verified || isVerifiedSource(row.data_source)) {
      verifiedSkipped++;
      continue;
    }

    // 2. Resolve this city through the single unified resolver.
    const query = [row.city_name, row.country].filter(Boolean).join(', ');
    let engine;
    try {
      engine = await resolveCityCostByQuery(query);
    } catch (err) {
      console.warn(`  ?? ${query}: resolver failed — ${(err as Error).message}`);
      unresolvable++;
      continue;
    }

    // 3. Validate identity. If the resolver cannot place the row in a country at
    //    all, leave it alone rather than guess — that is exactly the failure mode
    //    this whole change set exists to remove.
    if (!engine.countryCode || !engine.currency) {
      console.warn(`  ?? ${query}: resolver returned no country/currency — left untouched`);
      unresolvable++;
      continue;
    }

    // 4. Compare stored values against the resolver.
    const [indices, prices] = await Promise.all([
      getCityIndices(row.id),
      getCityPrices(row.id),
    ]);

    const diffs: string[] = [];
    if (String(row.country_code || '').toUpperCase() !== engine.countryCode.toUpperCase()) {
      diffs.push(`country_code ${row.country_code ?? 'null'} -> ${engine.countryCode}`);
    }
    if (String(row.currency || '').toUpperCase() !== engine.currency.toUpperCase()) {
      diffs.push(`currency ${row.currency ?? 'null'} -> ${engine.currency}`);
    }
    if (String(row.data_source || '') !== engine.data_source) {
      diffs.push(`data_source ${row.data_source ?? 'null'} -> ${engine.data_source}`);
    }
    if (!indices) {
      diffs.push('indices missing -> regenerate');
    } else {
      for (const [k, engineValue] of [
        ['cpi_index', engine.indices.cpi_index],
        ['rent_index', engine.indices.rent_index],
        ['groceries_index', engine.indices.groceries_index],
        ['restaurant_price_index', engine.indices.restaurant_price_index],
        ['local_purchasing_power_index', engine.indices.local_purchasing_power_index],
      ] as Array<[string, number]>) {
        const stored = num((indices as Record<string, unknown>)[k]);
        if (stored !== num(engineValue)) diffs.push(`${k} ${stored} -> ${num(engineValue)}`);
      }
    }
    if (!prices?.length) {
      diffs.push('prices missing -> regenerate');
    } else {
      const storedBasket = new Map(prices.map((p) => [p.item_name, num(p.average_price)]));
      const changed = engine.prices.filter(
        (p) => storedBasket.get(p.item_name) !== num(p.average_price)
      );
      if (changed.length) diffs.push(`${changed.length}/${engine.prices.length} basket prices`);
    }

    if (!diffs.length) {
      alreadyCorrect++;
      continue;
    }

    changeLog.push(`  #${row.id} ${query}\n      ${diffs.join('\n      ')}`);

    if (!APPLY) {
      repaired++;
      continue;
    }

    // 5. Repair the row we actually inspected, by id, inside one transaction.
    //
    //    Deliberately NOT saveCityData(): that upserts on (city_name, country),
    //    and the resolver canonicalises spellings — 'Zurich' resolves to
    //    'Zürich', so the name-keyed write lands on a different row and leaves
    //    the one we inspected stale forever. Repairing by id makes the script
    //    deterministic: the row read is the row written. The stored city_name is
    //    left alone, both because renaming could collide with the canonical row's
    //    unique key and because the spelling variant is a legitimate alias.
    try {
      await repairRowById(row.id, engine);
      repaired++;
    } catch (err) {
      failed++;
      console.warn(`  !! ${query}: repair failed — ${(err as Error).message}`);
    }
  }

  if (changeLog.length) {
    console.log(`${APPLY ? 'Repaired' : 'Would repair'} ${changeLog.length} row(s):\n`);
    console.log(changeLog.join('\n'));
  }

  console.log('\n--- summary ---');
  console.log(`  rows inspected      ${scope.length}`);
  console.log(`  verified, preserved ${verifiedSkipped}`);
  console.log(`  already correct     ${alreadyCorrect}`);
  console.log(`  ${APPLY ? 'repaired          ' : 'would repair      '}  ${repaired}`);
  console.log(`  unresolvable        ${unresolvable}`);
  console.log(`  failed              ${failed}`);
  if (!APPLY) console.log('\nDry run only — re-run with --apply to write these changes.');
  console.log('');

  await pool.end().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
