import pg from 'pg';

const { Pool } = pg;

export function createPool(config = {}) {
  const connectionString = config.connectionString || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  return new Pool({
    connectionString,
    max: Number(config.max ?? process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(config.idleTimeoutMillis ?? 30_000),
    connectionTimeoutMillis: Number(config.connectionTimeoutMillis ?? 8_000),
    ssl: config.ssl ?? (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined),
  });
}

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
