import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('staging seed is protected by the shared isolation guard', async () => {
  const source = await readFile(new URL('../server/scripts/stagingSeed.js', import.meta.url), 'utf8');
  assert.match(source, /validateStagingIsolation\(process\.env\)/);
  assert.match(source, /m1-staging-test/);
  assert.doesNotMatch(source, /m1store-egy\.com|erp_db|production/i);
});
