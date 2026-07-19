import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadConfig, assertSafePilotConfig } from '../src/config.js';

test('all Instagram pilot capabilities are disabled by default', () => {
  const config = loadConfig({});
  assert.equal(config.enabled, false); assert.equal(config.inboundEnabled, false); assert.equal(config.outboundEnabled, false);
  assert.equal(config.mediaEnabled, false); assert.equal(config.aiAutoSendEnabled, false); assert.equal(config.recoverySyncEnabled, false);
  assert.equal(config.aiMode, 'draft_only'); assert.equal(config.testAccountOnly, true); assertSafePilotConfig(config);
  assert.equal(config.expectedUsername, 'm.one.store.pro');
  assert.equal(config.storageStatePath, '');
});

test('production guard normalizes and locks the explicit Instagram test username', () => {
  const config = loadConfig({ INSTAGRAM_EXPECTED_USERNAME: '@M.One.Store.Pro' });
  assert.equal(config.expectedUsername, 'm.one.store.pro');
  assertSafePilotConfig(config);
});

test('dedicated storage-state path is opt-in and resolved without using a personal browser profile', () => {
  const config = loadConfig({
    INSTAGRAM_PROFILE_PATH: './data/test-profile',
    INSTAGRAM_STORAGE_STATE_PATH: './data/storage-state.instagram-test.json',
  });
  assert.match(config.storageStatePath, /storage-state\.instagram-test\.json$/);
  assertSafePilotConfig(config);
});

test('unsafe production account, media, AI auto-send, and personal Chrome profiles are rejected', () => {
  assert.throws(() => assertSafePilotConfig(loadConfig({ INSTAGRAM_CHANNEL_ACCOUNT_ID: 'm1-store' })), /test_account_id_required/);
  assert.throws(() => assertSafePilotConfig(loadConfig({ INSTAGRAM_BRIDGE_MEDIA_ENABLED: 'true' })), /media_must_be_disabled/);
  assert.throws(() => assertSafePilotConfig(loadConfig({ INSTAGRAM_BRIDGE_AI_AUTO_SEND_ENABLED: 'true' })), /ai_auto_send_must_be_disabled/);
  assert.throws(() => assertSafePilotConfig(loadConfig({ INSTAGRAM_PROFILE_PATH: 'C:\\Users\\X\\AppData\\Local\\Google\\Chrome\\User Data' })), /personal_chrome_profile_forbidden/);
});

test('Docker browser image matches the locked Playwright runtime', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, new RegExp(`playwright:v${packageJson.dependencies.playwright.replaceAll('.', '\\.')}-noble`));
  assert.match(dockerfile, /npm ci --omit=dev/);
});
