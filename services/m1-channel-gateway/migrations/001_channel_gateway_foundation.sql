CREATE TABLE IF NOT EXISTS channel_connections (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel VARCHAR(40) NOT NULL,
  account_external_id VARCHAR(255) NOT NULL,
  connection_type VARCHAR(40) NOT NULL DEFAULT 'official',
  status VARCHAR(32) NOT NULL DEFAULT 'disconnected',
  session_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  config_ciphertext BYTEA,
  config_iv BYTEA,
  config_auth_tag BYTEA,
  config_key_version VARCHAR(40),
  health JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error_code VARCHAR(120),
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_connections_channel_not_blank CHECK (BTRIM(channel) <> ''),
  CONSTRAINT channel_connections_account_not_blank CHECK (BTRIM(account_external_id) <> ''),
  CONSTRAINT channel_connections_unique_account UNIQUE (tenant_id, channel, account_external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_connections_health
  ON channel_connections (tenant_id, channel, status, session_status);

CREATE TABLE IF NOT EXISTS channel_conversation_map (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id BIGINT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  external_conversation_id VARCHAR(512) NOT NULL,
  internal_conversation_id VARCHAR(255),
  external_customer_id VARCHAR(512),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_conversation_map_external_not_blank CHECK (BTRIM(external_conversation_id) <> ''),
  CONSTRAINT channel_conversation_map_unique_external UNIQUE (connection_id, external_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_conversation_map_internal
  ON channel_conversation_map (tenant_id, internal_conversation_id)
  WHERE internal_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_conversation_map_customer
  ON channel_conversation_map (connection_id, external_customer_id)
  WHERE external_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_message_map (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id BIGINT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  conversation_map_id BIGINT REFERENCES channel_conversation_map(id) ON DELETE SET NULL,
  external_conversation_id VARCHAR(512) NOT NULL,
  external_message_id VARCHAR(512),
  internal_message_id VARCHAR(255),
  direction VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'accepted',
  dedupe_hash VARCHAR(64),
  idempotency_key VARCHAR(255),
  provider_timestamp TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_message_map_direction CHECK (direction IN ('inbound', 'outbound'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_message_map_external
  ON channel_message_map (connection_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_message_map_idempotency
  ON channel_message_map (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_message_map_fallback_dedupe
  ON channel_message_map (connection_id, external_conversation_id, direction, dedupe_hash)
  WHERE external_message_id IS NULL AND dedupe_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_message_map_conversation
  ON channel_message_map (connection_id, external_conversation_id, provider_timestamp DESC, id DESC);

CREATE TABLE IF NOT EXISTS channel_inbound_events (
  id BIGSERIAL PRIMARY KEY,
  event_key VARCHAR(255) NOT NULL UNIQUE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id BIGINT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  channel VARCHAR(40) NOT NULL,
  external_conversation_id VARCHAR(512) NOT NULL,
  external_message_id VARCHAR(512),
  dedupe_hash VARCHAR(64) NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'accepted',
  process_attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code VARCHAR(120),
  last_error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_inbound_events_attempts_nonnegative CHECK (process_attempts >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_inbound_events_external
  ON channel_inbound_events (connection_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_inbound_events_fallback
  ON channel_inbound_events (connection_id, external_conversation_id, dedupe_hash);

CREATE INDEX IF NOT EXISTS idx_channel_inbound_events_processing
  ON channel_inbound_events (status, received_at)
  WHERE status IN ('accepted', 'retrying');

CREATE TABLE IF NOT EXISTS outbound_message_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_key VARCHAR(255) NOT NULL UNIQUE,
  idempotency_key VARCHAR(255) NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id BIGINT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  external_conversation_id VARCHAR(512) NOT NULL,
  internal_conversation_id VARCHAR(255),
  payload JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  priority SMALLINT NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 7,
  locked_by VARCHAR(255),
  locked_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id VARCHAR(512),
  last_error_code VARCHAR(120),
  last_error_message TEXT,
  last_error_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbound_message_jobs_unique_idempotency UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT outbound_message_jobs_attempts_valid CHECK (attempts >= 0 AND max_attempts > 0),
  CONSTRAINT outbound_message_jobs_status CHECK (status IN (
    'queued', 'processing', 'sent', 'confirmed', 'retrying', 'failed', 'cancelled', 'needs_manual_review'
  ))
);

CREATE INDEX IF NOT EXISTS idx_outbound_message_jobs_claim
  ON outbound_message_jobs (priority, next_retry_at, id)
  WHERE status IN ('queued', 'retrying');

CREATE INDEX IF NOT EXISTS idx_outbound_message_jobs_conversation
  ON outbound_message_jobs (connection_id, external_conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_message_jobs_manual_review
  ON outbound_message_jobs (tenant_id, updated_at DESC)
  WHERE status = 'needs_manual_review';

CREATE TABLE IF NOT EXISTS channel_queue_lanes (
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id BIGINT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  external_conversation_id VARCHAR(512) NOT NULL,
  job_id BIGINT REFERENCES outbound_message_jobs(id) ON DELETE SET NULL,
  locked_by VARCHAR(255),
  locked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, connection_id, external_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_queue_lanes_stale
  ON channel_queue_lanes (locked_at)
  WHERE locked_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS bridge_events (
  id BIGSERIAL PRIMARY KEY,
  event_key VARCHAR(255) NOT NULL UNIQUE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id BIGINT REFERENCES channel_connections(id) ON DELETE SET NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'info',
  event_type VARCHAR(120) NOT NULL,
  external_conversation_id VARCHAR(512),
  job_key VARCHAR(255),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bridge_events_severity CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_bridge_events_timeline
  ON bridge_events (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_events_connection
  ON bridge_events (connection_id, occurred_at DESC)
  WHERE connection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_gateway_outbox_events (
  id BIGSERIAL PRIMARY KEY,
  event_key VARCHAR(255) NOT NULL UNIQUE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by VARCHAR(255),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_gateway_outbox_status CHECK (status IN ('pending', 'publishing', 'published', 'retrying', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_channel_gateway_outbox_claim
  ON channel_gateway_outbox_events (next_attempt_at, id)
  WHERE status IN ('pending', 'retrying');

CREATE TABLE IF NOT EXISTS channel_gateway_request_nonces (
  nonce VARCHAR(255) PRIMARY KEY,
  request_timestamp TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_gateway_request_nonces_expiry
  ON channel_gateway_request_nonces (expires_at);

-- These indexes remove the previous need to scan hundreds of Inbox conversations
-- when an exact external conversation identifier is already known.
DO $$
BEGIN
  IF CURRENT_SCHEMA() = 'public' AND TO_REGCLASS('public.ai_channel_conversations') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_ai_channel_conversations_exact_external
      ON public.ai_channel_conversations (tenant_id, channel, external_conversation_id)
      WHERE external_conversation_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_ai_channel_conversations_exact_customer
      ON public.ai_channel_conversations (tenant_id, channel, external_customer_id)
      WHERE external_customer_id IS NOT NULL;
  END IF;
END $$;
