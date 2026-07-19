import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultDirectory = join(here, '..', '..', 'migrations');

export async function checkMigrationState(pool, directory = defaultDirectory) {
  const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/i.test(name)).sort();
  const applied = await pool.query('SELECT filename, checksum FROM channel_gateway_schema_migrations');
  const appliedMap = new Map(applied.rows.map((item) => [item.filename, item.checksum]));
  const pending = [];
  const modified = [];
  for (const filename of files) {
    const sql = await readFile(join(directory, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (!appliedMap.has(filename)) pending.push(filename);
    else if (appliedMap.get(filename) !== checksum) modified.push(filename);
  }
  return { ready: pending.length === 0 && modified.length === 0, pending, modified };
}
