import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStagingIsolation } from '../services/shared/stagingIsolation.js';

const safe = {
  STAGING_ISOLATION_REQUIRED: 'true', APP_ENV: 'staging', DOCKER_PROJECT: 'm1-staging',
  CHANNEL_ACCOUNT_TYPE: 'test', DATABASE_NAME: 'erp_staging',
  DATABASE_URL: 'postgresql://staging-only-user:test@postgres-staging:5432/erp_staging',
  STAGING_PUBLIC_ORIGIN: 'http://localhost:3100', INSTAGRAM_CHANNEL_ACCOUNT_ID: 'instagram-test-account',
};

test('staging isolation accepts the isolated staging identity', () => {
  assert.equal(validateStagingIsolation(safe).valid, true);
});

for (const [name, override] of [
  ['production app environment', { APP_ENV: 'production' }],
  ['production docker project', { DOCKER_PROJECT: 'erp' }],
  ['production database name', { DATABASE_NAME: 'erp_db' }],
  ['production database url', { DATABASE_URL: 'postgresql://user:test@db:5432/erp_db' }],
  ['production channel account', { INSTAGRAM_CHANNEL_ACCOUNT_ID: 'm1-store' }],
  ['production domain', { STAGING_PUBLIC_ORIGIN: 'https://m1store-egy.com' }],
]) {
  test(`staging isolation rejects ${name}`, () => {
    assert.throws(() => validateStagingIsolation({ ...safe, ...override }), { code: 'staging_isolation_violation' });
  });
}

test('bridge can validate staging identity without a database connection', () => {
  const env = { ...safe };
  delete env.DATABASE_URL;
  assert.equal(validateStagingIsolation(env, { requireDatabaseUrl: false }).valid, true);
});
