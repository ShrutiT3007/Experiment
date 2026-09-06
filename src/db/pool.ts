import mysql, { Pool } from 'mysql2/promise';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

/**
 * Lazily creates a singleton MySQL pool from DATABASE_URL.
 * Never log the connection string -- mysql2 accepts a URI directly so we
 * never need to parse out or print the credentials ourselves.
 */
export function getPool(): Pool {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!pool) {
    pool = mysql.createPool({
      uri: env.databaseUrl,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    logger.info({ msg: 'MySQL pool created' });
  }
  return pool;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    const p = getPool();
    const conn = await p.getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch (err) {
    logger.warn({ msg: 'Database ping failed', error: (err as Error).message });
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
