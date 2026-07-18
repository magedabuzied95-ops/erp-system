import path from 'node:path';

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const number = (value, fallback, min = 0) => Math.max(min, Number(value || fallback));

export function loadConfig(env = process.env) {
  const profilePath = path.resolve(env.INSTAGRAM_PROFILE_PATH || '/data/browser-profiles/instagram-test-account');
  return Object.freeze({
    port: number(env.PORT, 4090, 1),
    enabled: bool(env.INSTAGRAM_BRIDGE_ENABLED, false),
    inboundEnabled: bool(env.INSTAGRAM_BRIDGE_INBOUND_ENABLED, false),
    outboundEnabled: bool(env.INSTAGRAM_BRIDGE_OUTBOUND_ENABLED, false),
    mediaEnabled: bool(env.INSTAGRAM_BRIDGE_MEDIA_ENABLED, false),
    aiAutoSendEnabled: bool(env.INSTAGRAM_BRIDGE_AI_AUTO_SEND_ENABLED, false),
    recoverySyncEnabled: bool(env.INSTAGRAM_BRIDGE_RECOVERY_SYNC_ENABLED, false),
    aiMode: String(env.INSTAGRAM_AI_MODE || 'draft_only').trim().toLowerCase(),
    testAccountOnly: bool(env.INSTAGRAM_TEST_ACCOUNT_ONLY, true),
    channelAccountId: String(env.INSTAGRAM_CHANNEL_ACCOUNT_ID || 'instagram-test-account').trim(),
    connectionId: String(env.INSTAGRAM_CHANNEL_CONNECTION_ID || '').trim(),
    tenantId: Number(env.INSTAGRAM_TENANT_ID || 0),
    profilePath,
    diagnosticsPath: path.resolve(env.INSTAGRAM_DIAGNOSTICS_PATH || '/data/diagnostics'),
    statePath: path.resolve(env.INSTAGRAM_STATE_PATH || '/data/state/instagram-bridge-state.json'),
    headless: bool(env.INSTAGRAM_HEADLESS, true),
    recoverySyncIntervalMs: number(env.INSTAGRAM_RECOVERY_SYNC_INTERVAL_MS, 120_000, 30_000),
    liveWatchIntervalMs: number(env.INSTAGRAM_LIVE_WATCH_INTERVAL_MS, 5_000, 2_000),
    maxConversationsPerMinute: number(env.INSTAGRAM_MAX_CONVERSATIONS_PER_MINUTE, 12, 1),
    operationDelayMinMs: number(env.INSTAGRAM_OPERATION_DELAY_MIN_MS, 350, 0),
    operationDelayMaxMs: number(env.INSTAGRAM_OPERATION_DELAY_MAX_MS, 900, 0),
    selectorFailurePauseThreshold: number(env.INSTAGRAM_SELECTOR_FAILURE_PAUSE_THRESHOLD, 3, 1),
    diagnosticsRetentionHours: number(env.INSTAGRAM_DIAGNOSTICS_RETENTION_HOURS, 72, 1),
    diagnosticsMaxFiles: number(env.INSTAGRAM_DIAGNOSTICS_MAX_FILES, 100, 1),
    bridgeHmacSecret: String(env.INSTAGRAM_BRIDGE_HMAC_SECRET || ''),
    gatewayUrl: String(env.CHANNEL_GATEWAY_URL || 'http://channel-gateway:4080').replace(/\/$/, ''),
    gatewayHmacSecret: String(env.CHANNEL_GATEWAY_HMAC_SECRET || ''),
  });
}

export function assertSafePilotConfig(config) {
  const violations = [];
  if (!config.testAccountOnly) violations.push('test_account_only_required');
  if (config.channelAccountId !== 'instagram-test-account') violations.push('test_account_id_required');
  if (config.mediaEnabled) violations.push('media_must_be_disabled');
  if (config.aiAutoSendEnabled) violations.push('ai_auto_send_must_be_disabled');
  if (config.aiMode !== 'draft_only') violations.push('ai_mode_must_be_draft_only');
  if (config.profilePath.toLowerCase().includes('google\\chrome\\user data')) violations.push('personal_chrome_profile_forbidden');
  if (violations.length) throw Object.assign(new Error(`Unsafe Instagram pilot configuration: ${violations.join(', ')}`), { code: 'UNSAFE_PILOT_CONFIG', violations });
  return true;
}
