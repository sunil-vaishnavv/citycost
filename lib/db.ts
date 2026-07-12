import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let pool: mysql.Pool | null = null;

const host = process.env.MYSQL_HOST || 'localhost';
const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
const user = process.env.MYSQL_USER || 'root';
const password = process.env.MYSQL_PASSWORD || '';
const database = process.env.MYSQL_DATABASE || 'citycost_global';

try {
  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT || '10', 10),
    queueLimit: parseInt(process.env.MYSQL_QUEUE_LIMIT || '0', 10),
    charset: 'utf8mb4',
    timezone: '+00:00',
    // Don't let connection errors crash the process
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  // Unhandled pool "error" events terminate Node — always attach a listener
  (pool as unknown as NodeJS.EventEmitter).on('error', (err: Error) => {
    console.warn('⚠️  MySQL pool error (non-fatal):', err.message);
  });
} catch (err) {
  console.warn('⚠️  MySQL pool creation failed — DB features disabled:', (err as Error).message);
  pool = null;
}

/**
 * Test the database connection.
 * Returns true on success, false on failure (never throws).
 */
async function testConnection(): Promise<boolean> {
  if (!pool) return false;
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ MySQL connection established');
    return true;
  } catch (err: any) {
    // ECONNREFUSED means MySQL just isn't running — expected in dev without DB
    if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.warn(`⚠️  MySQL unavailable (${err.code}) — will use Groq without DB caching`);
    } else {
      console.warn('⚠️  MySQL test connection failed:', err.message);
    }
    // Fully tear down the failed pool so idle reconnects cannot crash the process
    const failedPool = pool;
    pool = null;
    await failedPool.end().catch(() => {});
    return false;
  }
}

export { pool, testConnection };
export default pool;
