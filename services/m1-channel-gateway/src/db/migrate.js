import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'migrations');
const lockId = 719_103_421;

export async function migrate(pool, directory = migrationsDir) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockId]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS channel_gateway_schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(directory))
      .filter((name) => /^\d+.*\.sql$/i.test(name))
      .sort((a, b) => a.localeCompare(b, 'en'));

    for (const filename of files) {
      const sql = await readFile(join(directory, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await client.query(
        'SELECT checksum FROM channel_gateway_schema_migrations WHERE filename = $1',
        [filename],
      );

      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration was modified: ${filename}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO channel_gateway_schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => {});
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  migrate(pool)
    .then(() => process.stdout.write('Channel Gateway migrations applied successfully.\n'))
    .finally(() => pool.end());
}
