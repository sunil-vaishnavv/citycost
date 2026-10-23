import { pool } from '../../db.js';
import type { StoragePort } from '../types.js';

export function createPostgresStorage(): StoragePort {
  return {
    async ping() {
      if (!pool) return false;
      try {
        const conn = await pool.getConnection();
        await conn.ping();
        conn.release();
        return true;
      } catch {
        return false;
      }
    },
  };
}
