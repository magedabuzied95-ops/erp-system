-- TikTok integration: OAuth connection, durable webhook intake, publish jobs.
-- Additive only: no existing table, column, index, or data is removed or rewritten.
-- NOT APPLIED TO PRODUCTION. Runs idempotently via ensureTikTokIntegrationSchema()
-- at boot, exactly like the Meta and Telegram schemas.

-- One TikTok creator connection per tenant. Tokens are stored encrypted
-- (AES-256-GCM envelope, see tiktokCryptoService.js); plaintext never lands here.
CREATE TABLE IF NOT EXISTS tiktok_integration_configs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  open_id TEXT NOT NULL DEFAULT '',
  union_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT NOT NULL DEFAULT '',
  refresh_token_encrypted TEXT NOT NULL DEFAULT '',
  access_token_expires_at TIMESTAMP NULL,
  refresh_token_expires_at TIMESTAMP NULL,
  granted_scopes TEXT NOT NULL DEFAULT '',
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'not_connected',
  last_error TEXT NOT NULL DEFAULT '',
  last_sync_at TIMESTAMP NULL,
  last_refresh_at TIMESTAMP NULL,
  refresh_lock_token TEXT NOT NULL DEFAULT '',
  refresh_lock_at TIMESTAMP NULL,
  connected_by_user_id BIGINT NULL,
  connected_at TIMESTAMP NULL,
  disconnected_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);

-- open_id is the webhook routing key: TikTok events carry user_openid, not tenant_id.
CREATE INDEX IF NOT EXISTS idx_tiktok_configs_open_id
  ON tiktok_integration_configs (open_id)
  WHERE open_id <> '';

-- Short-lived CSRF/replay guard for the OAuth handshake. Single-use: a callback
-- flips status away from 'started', so a replayed code cannot be consumed twice.
CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  user_id BIGINT NULL,
  state_token TEXT NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL DEFAULT '',
  requested_scopes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'started',
  error_message TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tiktok_oauth_states_tenant_created
  ON tiktok_oauth_states (tenant_id, created_at DESC);

-- Durable webhook intake. TikTok delivers at-least-once and retries for 72h, so
-- the endpoint persists + acks fast and a worker processes asynchronously.
-- TikTok sends no event id, so event_signature is a content hash of
-- (event, user_openid, create_time, content) and is the idempotency key.
CREATE TABLE IF NOT EXISTS tiktok_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  event_signature TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL DEFAULT '',
  user_openid TEXT NOT NULL DEFAULT '',
  event_create_time BIGINT NULL,
  payload JSONB NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMP NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tiktok_webhook_events_pending
  ON tiktok_webhook_events (processing_status, next_attempt_at, received_at)
  WHERE processing_status IN ('pending', 'failed', 'processing');

-- One row per publish attempt. idempotency_key prevents a double-click or a
-- retried job from creating two TikTok posts for the same publisher post.
CREATE TABLE IF NOT EXISTS tiktok_publish_jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  social_publisher_post_id BIGINT NULL,
  idempotency_key TEXT NOT NULL,
  post_mode TEXT NOT NULL DEFAULT 'DIRECT_POST',
  publish_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  media_url TEXT NOT NULL DEFAULT '',
  media_bytes BIGINT NULL,
  privacy_level TEXT NOT NULL DEFAULT '',
  post_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_post_id TEXT NOT NULL DEFAULT '',
  fail_reason TEXT NOT NULL DEFAULT '',
  last_status_checked_at TIMESTAMP NULL,
  created_by_user_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_publish_jobs_publish_id
  ON tiktok_publish_jobs (publish_id)
  WHERE publish_id <> '';

CREATE INDEX IF NOT EXISTS idx_tiktok_publish_jobs_open
  ON tiktok_publish_jobs (tenant_id, status, created_at DESC);
