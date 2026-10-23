/**
 * City data repository — cache-first over the COL engine.
 * Never overwrites verified/real rows with estimates.
 * SQL: PostgreSQL.
 */

import * as dbModule from './db.js';
import { resolveCityCostByQuery } from './city-cost-resolve.js';
import { logEvent } from './logger.js';
import type { CityData, PriceItem } from '../src/types.js';
import type { GeneratedCityData } from './groq.js';
import type { ColEngineResult } from './col-engine/types.js';

function getPool() {
  return dbModule.pool;
}

async function getCityByName(cityName: string, country?: string): Promise<any | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    let query =
      'SELECT * FROM cities WHERE LOWER(city_name) = LOWER($1) ';
    const params: any[] = [cityName.trim()];
    if (country) {
      query += 'AND LOWER(country) = LOWER($2) ';
      params.push(country.trim());
    }
    query += 'LIMIT 1';
    const [rows] = await pool.query(query, params);
    const cities = rows as any[];
    return cities.length ? cities[0] : null;
  } catch (err) {
    console.warn('[DB] getCityByName failed:', (err as Error).message);
    return null;
  }
}

async function getCityById(id: number): Promise<any | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const [rows] = await pool.query('SELECT * FROM cities WHERE id = $1 LIMIT 1', [id]);
    const cities = rows as any[];
    return cities.length ? cities[0] : null;
  } catch (err) {
    console.warn('[DB] getCityById failed:', (err as Error).message);
    return null;
  }
}

async function getCityIndices(cityId: number): Promise<any | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const [rows] = await pool.query(
      'SELECT * FROM city_indices WHERE city_id = $1 LIMIT 1',
      [cityId]
    );
    const indices = rows as any[];
    return indices.length ? indices[0] : null;
  } catch (err) {
    console.warn('[DB] getCityIndices failed:', (err as Error).message);
    return null;
  }
}

async function getCityPrices(cityId: number): Promise<PriceItem[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [rows] = await pool.query(
      'SELECT item_id, item_name, average_price, highest_price, lowest_price, currency FROM city_prices WHERE city_id = $1 ORDER BY item_id ASC',
      [cityId]
    );
    return rows as PriceItem[];
  } catch (err) {
    console.warn('[DB] getCityPrices failed:', (err as Error).message);
    return [];
  }
}

/** Does a DB row describe the same country the engine resolved? */
function sameCountryRow(row: { country_code?: string | null; country?: string | null }, engine: ColEngineResult): boolean {
  const rowCode = String(row.country_code || '').trim().toUpperCase();
  if (rowCode && engine.countryCode) return rowCode === engine.countryCode.toUpperCase();
  const rowCountry = String(row.country || '').trim().toLowerCase();
  return Boolean(rowCountry) && rowCountry === String(engine.country || '').trim().toLowerCase();
}

function isVerifiedSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return ['surveyed', 'real', 'numbeo', 'api', 'government', 'cache_verified'].some((k) =>
    s.includes(k)
  );
}

async function saveCityData(
  data: GeneratedCityData & {
    state?: string;
    country_code?: string;
    data_source?: string;
    confidence?: number;
    is_verified?: boolean;
    tier?: number;
    population?: number | null;
    estimation_note?: string;
  }
): Promise<number | null> {
  const pool = getPool();
  if (!pool) return null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    try {
      const [existingRows] = await conn.query(
        'SELECT id, data_source, is_verified FROM cities WHERE LOWER(city_name)=LOWER($1) AND LOWER(country)=LOWER($2) LIMIT 1',
        [data.city, data.country]
      );
      const existing = (existingRows as any[])[0];
      if (existing && (existing.is_verified || isVerifiedSource(existing.data_source))) {
        if (!data.is_verified && !isVerifiedSource(data.data_source)) {
          await conn.rollback();
          return existing.id;
        }
      }
    } catch {
      // older schema without is_verified — continue
    }

    let cityId: number | null = null;

    try {
      const [cityResult] = await conn.query(
        `INSERT INTO cities
          (city_name, country, currency, symbol, exchange_rate, is_ai_generated,
           state, country_code, data_source, confidence, is_verified, tier, population, estimation_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (city_name, country) DO UPDATE SET
           currency = EXCLUDED.currency,
           symbol = EXCLUDED.symbol,
           exchange_rate = EXCLUDED.exchange_rate,
           -- Refresh the descriptive columns too. These used to be INSERT-only, so
           -- rows written by the old engine kept country_code = 'US' for Andorra
           -- and the Dominican Republic even after the currency had been corrected
           -- on a later write. The verified-row guard above already prevents an
           -- estimate from overwriting real surveyed data.
           state = EXCLUDED.state,
           country_code = EXCLUDED.country_code,
           data_source = EXCLUDED.data_source,
           confidence = EXCLUDED.confidence,
           is_verified = EXCLUDED.is_verified,
           tier = EXCLUDED.tier,
           population = EXCLUDED.population,
           estimation_note = EXCLUDED.estimation_note,
           updated_at = (NOW() AT TIME ZONE 'UTC')
         RETURNING id`,
        [
          data.city,
          data.country,
          data.currency,
          data.symbol,
          data.exchange_rate,
          false,
          data.state || null,
          data.country_code || null,
          data.data_source || 'estimated',
          data.confidence ?? null,
          Boolean(data.is_verified),
          data.tier ?? null,
          data.population ?? null,
          data.estimation_note || null,
        ]
      );
      const header = cityResult as any;
      if (header.insertId) cityId = header.insertId;
    } catch {
      // Fallback for narrower column set
      const [cityResult] = await conn.query(
        `INSERT INTO cities (city_name, country, currency, symbol, exchange_rate, is_ai_generated)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (city_name, country) DO UPDATE SET
           currency = EXCLUDED.currency,
           symbol = EXCLUDED.symbol,
           exchange_rate = EXCLUDED.exchange_rate,
           updated_at = (NOW() AT TIME ZONE 'UTC')
         RETURNING id`,
        [data.city, data.country, data.currency, data.symbol, data.exchange_rate, false]
      );
      const header = cityResult as any;
      if (header.insertId) cityId = header.insertId;
    }

    if (!cityId) {
      const row = await getCityByName(data.city, data.country);
      cityId = row?.id ?? null;
    }
    if (!cityId) {
      await conn.rollback();
      return null;
    }

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
        data.indices.cpi_index,
        data.indices.rent_index,
        data.indices.groceries_index,
        data.indices.restaurant_price_index,
        data.indices.local_purchasing_power_index,
      ]
    );

    for (const p of data.prices) {
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
        [
          cityId,
          p.item_id,
          p.item_name,
          p.average_price,
          p.highest_price,
          p.lowest_price,
          p.currency,
        ]
      );
    }

    await conn.commit();
    return cityId;
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.warn('[DB] saveCityData failed:', (err as Error).message);
    return null;
  } finally {
    conn.release();
  }
}

function toCityData(engine: ColEngineResult, cityId: number): CityData & { city_id: number } {
  return {
    city_id: cityId,
    name: engine.name,
    currency: engine.currency,
    symbol: engine.symbol,
    indices: engine.indices,
    exchange_rate: engine.exchange_rate,
    prices: engine.prices,
    data_source: engine.data_source_label || engine.data_source,
    confidence: engine.confidence,
    confidence_label: engine.confidence_label,
    estimation_note: engine.estimation_note,
  };
}

/**
 * Resolution order:
 *  1. Verified DB row (real surveyed data; never discarded for an estimate)
 *  2. COL engine (surveyed → Numbeo → nearby → regional)
 *  3. Persist (without overwriting verified)
 *
 * Modelled (non-verified) rows are deliberately NOT read back. Such a row is a
 * snapshot of a previous engine run, not data: serving it made
 * /api/city_prices report whatever the engine produced the first time a city
 * was ever requested, while /city/<slug> rendered the current engine output, so
 * the two surfaces disagreed for the same city. The live cache still held Zug
 * carrying Bangkok's exact indices, and Warsaw / Sant Julià de Lòria /
 * San Pedro de Macorís stamped United States + USD by the old country-code
 * fallback. Modelled resolution is deterministic and fully in-process, so there
 * is nothing to cache — recomputing beats a round trip to Postgres, and the
 * write below re-persists the row so stale estimates self-heal on first request.
 */
async function getOrGenerateCityData(query: string): Promise<CityData & { city_id: number }> {
  const startTime = Date.now();
  // Same resolver the city pages use, so /api/city_prices and /city/<slug>
  // never report different numbers for the same city.
  const engine = await resolveCityCostByQuery(query, {
    numbeoKey: process.env.NUMBEO_API_KEY,
  });

  const cityPart = engine.city;
  const countryPart = engine.country;

  if (getPool()) {
    try {
      let existing = await getCityByName(cityPart, countryPart);
      if (!existing && countryPart) {
        // Name-only fallback: 'San José' matches Costa Rica AND California,
        // 'Warsaw' matches Poland AND Indiana. Accept the row only when it is
        // the same country, otherwise this hands one country's prices to
        // another — the same class of bug as the old US country-code fallback.
        const loose = await getCityByName(cityPart);
        if (loose && sameCountryRow(loose, engine)) existing = loose;
      }

      const verified =
        existing != null && (existing.is_verified || isVerifiedSource(existing.data_source));

      if (existing && verified) {
        const [indices, prices] = await Promise.all([
          getCityIndices(existing.id),
          getCityPrices(existing.id),
        ]);

        if (prices?.length && indices) {
          await logEvent({
            city_query: query,
            cache_hit: true,
            cache_type: 'city_data',
            response_time_ms: Date.now() - startTime,
          }).catch(() => {});

          return {
            city_id: existing.id,
            name: engine.name,
            currency: existing.currency,
            symbol: existing.symbol,
            indices: {
              cpi_index: Number(indices.cpi_index),
              rent_index: Number(indices.rent_index),
              groceries_index: Number(indices.groceries_index),
              restaurant_price_index: Number(indices.restaurant_price_index),
              local_purchasing_power_index: Number(indices.local_purchasing_power_index),
            },
            exchange_rate: Number(existing.exchange_rate),
            prices,
            data_source: 'Cached',
            confidence: Number(existing.confidence ?? 0.9),
            confidence_label: '★★★★★ Cached verified data',
            estimation_note: existing.estimation_note || 'Served from verified database cache.',
          };
        }
      }
    } catch (err) {
      console.warn('[Cache] lookup failed:', (err as Error).message);
    }
  }

  console.log(
    `[COL] ${engine.data_source_label}/${engine.data_source} → ${engine.name} ` +
      `${engine.currency} CPI=${engine.indices.cpi_index} rent=${engine.indices.rent_index} ` +
      `(${engine.confidence_label})`
  );

  const payload = {
    city: engine.city,
    country: engine.country,
    currency: engine.currency,
    symbol: engine.symbol,
    exchange_rate: engine.exchange_rate,
    indices: engine.indices,
    prices: engine.prices,
    state: engine.state,
    country_code: engine.countryCode,
    data_source: engine.data_source,
    confidence: engine.confidence,
    is_verified: engine.is_verified,
    tier: engine.tier,
    population: engine.population,
    estimation_note: engine.estimation_note,
  };

  let cityId: number | null = null;
  if (getPool()) {
    try {
      cityId = await saveCityData(payload);
    } catch (err) {
      console.warn('[DB] save failed:', (err as Error).message);
    }
  }
  if (!cityId) cityId = engine.city_id;

  await logEvent({
    city_query: query,
    cache_hit: false,
    cache_type: 'city_data',
    response_time_ms: Date.now() - startTime,
  }).catch(() => {});

  return toCityData(engine, cityId);
}

async function getAllCitiesForList(): Promise<Array<{ city_id: number; city: string; country: string }>> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [rows] = await pool.query(
      'SELECT id as city_id, city_name as city, country FROM cities ORDER BY country, city_name'
    );
    return rows as Array<{ city_id: number; city: string; country: string }>;
  } catch (err) {
    console.warn('[DB] getAllCitiesForList failed:', (err as Error).message);
    return [];
  }
}

export {
  getCityByName,
  getCityById,
  getCityIndices,
  getCityPrices,
  saveCityData,
  getOrGenerateCityData,
  getAllCitiesForList,
};
