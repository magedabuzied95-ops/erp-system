CREATE TABLE IF NOT EXISTS erp_channel_outbox_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  event_type VARCHAR(120) NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id VARCHAR(255) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  payload_fingerprint VARCHAR(64) NOT NULL,
  correlation_id VARCHAR(255),
  causation_id VARCHAR(255),
  source VARCHAR(80) NOT NULL DEFAULT 'erp-backend',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 7,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by VARCHAR(255),
  locked_at TIMESTAMPTZ,
  last_error_code VARCHAR(120),
  last_error TEXT,
  failed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT erp_channel_outbox_event_version_positive CHECK (event_version > 0),
  CONSTRAINT erp_channel_outbox_attempts_valid CHECK (attempts >= 0 AND max_attempts > 0),
  CONSTRAINT erp_channel_outbox_status_valid CHECK (status IN (
    'pending', 'processing', 'processed', 'retrying', 'failed', 'dead_letter', 'cancelled'
  ))
);

CREATE INDEX IF NOT EXISTS idx_erp_channel_outbox_status_next
  ON erp_channel_outbox_events (status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS idx_erp_channel_outbox_claim
  ON erp_channel_outbox_events (next_attempt_at, id)
  WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_erp_channel_outbox_aggregate
  ON erp_channel_outbox_events (tenant_id, aggregate_type, aggregate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_channel_outbox_event_type
  ON erp_channel_outbox_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_channel_outbox_created
  ON erp_channel_outbox_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_channel_outbox_locked
  ON erp_channel_outbox_events (locked_at)
  WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS channel_shadow_comparison_results (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES erp_channel_outbox_events(event_id) ON DELETE CASCADE,
  event_type VARCHAR(120) NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  internal_entity_id VARCHAR(255),
  shadow_status VARCHAR(24) NOT NULL,
  expected_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  actual_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  difference JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(120),
  error TEXT,
  processing_latency_ms INTEGER,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_shadow_comparison_event_unique UNIQUE (event_id),
  CONSTRAINT channel_shadow_status_valid CHECK (shadow_status IN (
    'matched', 'mismatched', 'skipped', 'unsupported', 'failed'
  ))
);

CREATE INDEX IF NOT EXISTS idx_channel_shadow_results_status
  ON channel_shadow_comparison_results (shadow_status, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_shadow_results_event_type
  ON channel_shadow_comparison_results (event_type, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_shadow_results_entity
  ON channel_shadow_comparison_results (tenant_id, internal_entity_id, processed_at DESC);

CREATE TABLE IF NOT EXISTS channel_outbox_attempt_history (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES erp_channel_outbox_events(event_id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  worker_id VARCHAR(255) NOT NULL,
  result VARCHAR(24) NOT NULL,
  error_code VARCHAR(120),
  error TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_outbox_attempt_positive CHECK (attempt > 0),
  CONSTRAINT channel_outbox_attempt_unique UNIQUE (event_id, attempt),
  CONSTRAINT channel_outbox_attempt_result_valid CHECK (result IN (
    'processed', 'retrying', 'failed', 'dead_letter', 'recovered'
  ))
);

CREATE INDEX IF NOT EXISTS idx_channel_outbox_attempt_history_event
  ON channel_outbox_attempt_history (event_id, attempt DESC);
CREATE INDEX IF NOT EXISTS idx_channel_outbox_attempt_history_created
  ON channel_outbox_attempt_history (created_at DESC);
