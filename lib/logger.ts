import * as dbModule from './db.js';

interface LogData {
  request_method?: string;
  request_path?: string;
  city_query?: string;
  response_time_ms?: number;
  groq_token_usage?: number;
  groq_model_used?: string;
  error_message?: string;
  cache_hit?: boolean;
  cache_type?: string;
  ip_address?: string;
}

async function logEvent(data: LogData): Promise<void> {
  const pool = dbModule.pool;
  if (!pool) {
    // No DB available, silently skip
    return;
  }
  try {
    await pool.query(
      `INSERT INTO logs (
        request_method, request_path, city_query, response_time_ms,
        groq_token_usage, groq_model_used, error_message,
        cache_hit, cache_type, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.request_method || null,
        data.request_path || null,
        data.city_query || null,
        data.response_time_ms || null,
        data.groq_token_usage || 0,
        data.groq_model_used || null,
        data.error_message || null,
        data.cache_hit || false,
        data.cache_type || null,
        data.ip_address || null
      ]
    );
  } catch (err) {
    // Silently fail, don't log to console (already know DB is unavailable)
  }
}

export { logEvent };
export default logEvent;
