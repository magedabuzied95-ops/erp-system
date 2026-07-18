export function loadConfig(env = process.env) {
  const enabled = (value, fallback = false) => {
    if (value == null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
  };
  return Object.freeze({
    port: Number(env.PORT || 4080),
    databaseUrl: env.DATABASE_URL || '',
    redisUrl: env.REDIS_URL || '',
    hmacSecret: env.CHANNEL_GATEWAY_HMAC_SECRET || '',
    hmacMaxSkewMs: Number(env.CHANNEL_GATEWAY_HMAC_MAX_SKEW_MS || 300_000),
    gatewayEnabled: enabled(env.CHANNEL_GATEWAY_ENABLED, false),
    shadowMode: enabled(env.CHANNEL_GATEWAY_SHADOW_MODE, true),
    outboundEnabled: enabled(env.CHANNEL_GATEWAY_OUTBOUND_ENABLED, false),
    inboundEnabled: enabled(env.CHANNEL_GATEWAY_INBOUND_ENABLED, false),
    compareEnabled: enabled(env.CHANNEL_GATEWAY_COMPARE_ENABLED, true),
    workerEnabled: enabled(env.CHANNEL_GATEWAY_WORKER_ENABLED, false),
    pollIntervalMs: Math.max(100, Number(env.CHANNEL_GATEWAY_POLL_INTERVAL_MS || 750)),
    staleAfterSeconds: Math.max(30, Number(env.CHANNEL_GATEWAY_STALE_AFTER_SECONDS || 120)),
    healthIntervalMs: Math.max(10_000, Number(env.CHANNEL_GATEWAY_HEALTH_INTERVAL_MS || 60_000)),
    shadowProcessingTimeoutMs: Math.max(1_000, Number(env.CHANNEL_GATEWAY_SHADOW_PROCESSING_TIMEOUT_MS || 15_000)),
    shutdownTimeoutMs: Math.max(1_000, Number(env.CHANNEL_GATEWAY_SHUTDOWN_TIMEOUT_MS || 15_000)),
    instagramBridgeEnabled: enabled(env.INSTAGRAM_BRIDGE_ENABLED, false),
    instagramBridgeInboundEnabled: enabled(env.INSTAGRAM_BRIDGE_INBOUND_ENABLED, false),
    instagramBridgeOutboundEnabled: enabled(env.INSTAGRAM_BRIDGE_OUTBOUND_ENABLED, false),
    instagramBridgeUrl: String(env.INSTAGRAM_BRIDGE_URL || 'http://instagram-bridge:4090').replace(/\/$/, ''),
    instagramBridgeHmacSecret: env.INSTAGRAM_BRIDGE_HMAC_SECRET || '',
    instagramConnectionId: String(env.INSTAGRAM_CHANNEL_CONNECTION_ID || '').trim(),
    erpInboundPublishEnabled: enabled(env.CHANNEL_GATEWAY_ERP_INBOUND_PUBLISH_ENABLED, false),
    erpBackendUrl: String(env.ERP_BACKEND_URL || 'http://erp-backend:5000').replace(/\/$/, ''),
    erpHmacSecret: env.ERP_CHANNEL_GATEWAY_HMAC_SECRET || env.CHANNEL_GATEWAY_HMAC_SECRET || '',
    erpOutboundConsumeEnabled: enabled(env.CHANNEL_GATEWAY_ERP_OUTBOUND_CONSUME_ENABLED, false),
  });
}
