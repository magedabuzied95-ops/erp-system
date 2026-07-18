import db from '../database/db.js';
import { validateStagingIsolation } from '../../services/shared/stagingIsolation.js';

validateStagingIsolation(process.env);

try {
  await db.query(`
    INSERT INTO tenants (id, name, slug, company_name)
    VALUES (1, 'M1 Staging Test', 'm1-staging-test', 'M1 Staging Test')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.query(`SELECT setval(pg_get_serial_sequence('tenants', 'id'), GREATEST((SELECT MAX(id) FROM tenants), 1), true)`);
  process.stdout.write(`${JSON.stringify({ event: 'staging.seed.ready', tenant_id: 1 })}\n`);
} finally {
  await db.end();
}
