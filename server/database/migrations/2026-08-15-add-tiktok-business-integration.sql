-- TikTok API for Business: connection, authorization state, webhook intake,
-- and the mapping tables that bind TikTok identifiers to the canonical stores.
--
-- SCOPE
-- Additive only. No existing table, column, index, constraint, or row is
-- dropped, renamed, or rewritten. Every statement is IF NOT EXISTS.
--
-- NOT APPLIED. There is no ensure*Schema() bootstrap calling this file yet, and
-- it has not been run against any database. It is wired in only when the TikTok
-- API for Business app is approved and TIKTOK_BUSINESS_ENABLED is turned on.
--
-- SEPARATION FROM 2026-08-14-add-tiktok-integration.sql
-- That migration serves the TikTok *for Developers* app (Login Kit / Content
-- Posting) and owns tiktok_integration_configs, tiktok_oauth_states,
-- tiktok_webhook_events, tiktok_publish_jobs. Nothing here touches those tables.
-- The two integrations share no row, no token, and no encryption namespace:
-- tokens below are "tkb:v1" envelopes (tiktokBusinessCryptoService.js), which
-- the Content Posting decryptor rejects by construction.
--
-- WHY MAPPING TABLES AND NOT A PARALLEL INBOX
-- Messages land in the canonical ai_channel_conversations store and comments in
-- the canonical Social Comments Center model, exactly like Messenger, Instagram,
-- WhatsApp, and Telegram. A second inbox would fork unread state, AI modes,
-- automation rules, and customer identity. These tables therefore hold only the
-- TikTok-side identifiers, dedupe keys, and cursors that the canonical model has
-- nowhere to put.


-- One TikTok Business Account connection per tenant.
-- Tokens are stored encrypted; plaintext never lands here.
CREATE TABLE IF NOT EXISTS tiktok_business_connections (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,

  -- business_id is the organic Business Account key used by business/* endpoints.
  -- advertiser_id is the ads key used by the /open_api/v1.3/comment/* family.
  -- Kept as separate columns precisely so the two can never be confused: an
  -- advertiser_id sent to an organic endpoint fails in ways that are hard to
  -- diagnose from logs.
  business_id TEXT NOT NULL DEFAULT '',
  advertiser_id TEXT NOT NULL DEFAULT '',
  tiktok_account_id TEXT NOT NULL DEFAULT '',

  display_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',

  -- "tkb:v1" envelopes only. A "tk:v1" value here is a cross-namespace leak and
  -- is rejected at read time by decryptTikTokBusinessSecret().
  access_token_encrypted TEXT NOT NULL DEFAULT '',
  refresh_token_encrypted TEXT NOT NULL DEFAULT '',
  access_token_expires_at TIMESTAMP NULL,
  refresh_token_expires_at TIMESTAMP NULL,

  granted_scopes TEXT NOT NULL DEFAULT '',
  -- Per-feature grant state (messaging, comments, catalog), so the UI can say
  -- which capability is missing rather than a blanket "not connected".
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'not_connected',
  last_error TEXT NOT NULL DEFAULT '',
  last_sync_at TIMESTAMP NULL,
  last_refresh_at TIMESTAMP NULL,
  -- Single-flight refresh lock, mirroring tiktok_integration_configs: TikTok
  -- rotates the refresh token, so two concurrent refreshes race and one of them
  -- persists a token the other already invalidated.
  refresh_lock_token TEXT NOT NULL DEFAULT '',
  refresh_lock_at TIMESTAMP NULL,

  -- Safe, non-secret fields only (region, account type, review state).
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  connected_by_user_id BIGINT NULL,
  connected_at TIMESTAMP NULL,
  disconnected_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);

-- Webhook and API payloads carry business_id, not tenant_id — this is the
-- routing key back to a tenant.
CREATE INDEX IF NOT EXISTS idx_tiktok_business_connections_business_id
  ON tiktok_business_connections (business_id)
  WHERE business_id <> '';


-- Short-lived CSRF/state tokens for the Business authorization redirect.
-- Mirrors tiktok_oauth_states and meta_oauth_states.
CREATE TABLE IF NOT EXISTS tiktok_business_oauth_states (
  id BIGSERIAL PRIMARY KEY,
  state_token TEXT NOT NULL,
  tenant_id BIGINT NOT NULL,
  user_id BIGINT NULL,
  -- Which redirect the flow started from. TikTok registers two distinct URLs
  -- (advertiser vs TikTok account holder) and the callback must be validated
  -- against the one that was actually used.
  redirect_kind TEXT NOT NULL DEFAULT 'advertiser',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (state_token)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_business_oauth_states_expiry
  ON tiktok_business_oauth_states (expires_at);


-- Durable webhook intake. Rows are written on receipt and processed by a worker,
-- so a slow handler can never make us miss TikTok's response deadline.
-- event_key is the dedupe key: delivery is assumed at-least-once.
CREATE TABLE IF NOT EXISTS tiktok_business_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,
  tenant_id BIGINT NULL,
  business_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  UNIQUE (event_key)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_business_webhook_events_pending
  ON tiktok_business_webhook_events (status, received_at)
  WHERE status = 'pending';


-- Messaging: TikTok identifiers <-> canonical AI Inbox rows.
-- conversation_id maps to ai_channel_conversations; no message body is stored
-- here, only the identity and dedupe key.
CREATE TABLE IF NOT EXISTS tiktok_business_message_map (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  business_id TEXT NOT NULL DEFAULT '',

  tiktok_conversation_id TEXT NOT NULL,
  tiktok_message_id TEXT NOT NULL,
  tiktok_participant_id TEXT NOT NULL DEFAULT '',

  -- FK is intentionally omitted: the canonical conversation may be created
  -- after intake, and a hard FK would drop inbound messages on a race. The
  -- worker reconciles instead.
  conversation_id BIGINT NULL,
  message_id BIGINT NULL,

  direction TEXT NOT NULL DEFAULT 'inbound',
  -- Delivery lifecycle, if TikTok reports one. 'unknown' rather than 'sent'
  -- so an absent status is never displayed as a successful delivery.
  delivery_status TEXT NOT NULL DEFAULT 'unknown',
  sent_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  read_at TIMESTAMP NULL,

  -- Dedupe key for at-least-once intake AND the send-side idempotency key.
  idempotency_key TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_business_message_map_conversation
  ON tiktok_business_message_map (tenant_id, tiktok_conversation_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_business_message_map_canonical
  ON tiktok_business_message_map (conversation_id)
  WHERE conversation_id IS NOT NULL;


-- Comments: TikTok identifiers <-> canonical Social Comments Center rows.
CREATE TABLE IF NOT EXISTS tiktok_business_comment_map (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  business_id TEXT NOT NULL DEFAULT '',

  tiktok_video_id TEXT NOT NULL,
  tiktok_comment_id TEXT NOT NULL,
  tiktok_parent_comment_id TEXT NOT NULL DEFAULT '',
  tiktok_author_id TEXT NOT NULL DEFAULT '',

  conversation_id BIGINT NULL,
  message_id BIGINT NULL,

  -- Tri-state via NULL: unknown until the corresponding TikTok field is
  -- confirmed to exist. NULL must render as a disabled control, never as "off".
  is_hidden BOOLEAN NULL,
  is_pinned BOOLEAN NULL,
  is_liked_by_owner BOOLEAN NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,

  -- Set when WE post the reply, so our own reply coming back from a later poll
  -- is recognised instead of being ingested as a new customer comment.
  is_own_reply BOOLEAN NOT NULL DEFAULT FALSE,

  idempotency_key TEXT NOT NULL,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  comment_created_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_business_comment_map_video
  ON tiktok_business_comment_map (tenant_id, tiktok_video_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_business_comment_map_parent
  ON tiktok_business_comment_map (tenant_id, tiktok_parent_comment_id)
  WHERE tiktok_parent_comment_id <> '';


-- Polling cursors. There is no comment webhook on either TikTok surface, so
-- comments must be polled; this is where each video's pagination position and
-- backoff live. One row per (tenant, video, resource).
CREATE TABLE IF NOT EXISTS tiktok_business_sync_cursors (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  resource TEXT NOT NULL,
  resource_key TEXT NOT NULL DEFAULT '',
  cursor TEXT NOT NULL DEFAULT '',
  has_more BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at TIMESTAMP NULL,
  last_error TEXT NOT NULL DEFAULT '',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, resource, resource_key)
);
