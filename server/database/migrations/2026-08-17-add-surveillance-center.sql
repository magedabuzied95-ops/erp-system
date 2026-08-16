-- Surveillance Center — Phase 1 foundation.
--
-- This file is a RECORD of the schema, not the mechanism that applies it.
-- The authoritative source is ensureSurveillanceSchema() in
-- server/services/surveillance/surveillanceSchema.js, which runs on every boot
-- from bootstrapStartup(). Keep the two in sync; the ensure function wins.
--
-- Safe to run by hand against an existing database: every statement is
-- IF NOT EXISTS or ON CONFLICT DO NOTHING, and nothing here modifies, moves or
-- deletes existing data.
--
-- NOTE ON GRANTS: this migration creates permission DEFINITIONS only. It does
-- not insert a single row into role_permissions — not even for admin roles.
-- Surveillance is deny-by-default for everyone; access is granted deliberately
-- from the Permissions screen. See the schema module header for why.

CREATE TABLE IF NOT EXISTS surveillance_devices (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  vendor_key VARCHAR(40) NOT NULL,
  transport_type VARCHAR(40) NOT NULL DEFAULT 'direct',
  host VARCHAR(253) NOT NULL,
  port INTEGER NOT NULL,
  protocol VARCHAR(10) NOT NULL DEFAULT 'http',
  model VARCHAR(120) NOT NULL DEFAULT '',
  firmware VARCHAR(120) NOT NULL DEFAULT '',
  serial_hash VARCHAR(64) NOT NULL DEFAULT '',
  channel_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'unknown',
  last_seen_at TIMESTAMP NULL,
  last_error_code VARCHAR(80) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_surveillance_devices_tenant
  ON surveillance_devices (tenant_id, branch_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_surveillance_devices_endpoint
  ON surveillance_devices (tenant_id, host, port);

-- Credentials live apart from the device row so that no join, and no
-- `SELECT *`, can pick them up incidentally. There is no plaintext column.
CREATE TABLE IF NOT EXISTS surveillance_device_credentials (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id BIGINT NOT NULL UNIQUE REFERENCES surveillance_devices(id) ON DELETE CASCADE,
  username VARCHAR(64) NOT NULL DEFAULT '',
  password_encrypted TEXT NOT NULL DEFAULT '',
  auth_method VARCHAR(24) NOT NULL DEFAULT 'digest',
  rotated_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS surveillance_device_capabilities (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id BIGINT NOT NULL UNIQUE REFERENCES surveillance_devices(id) ON DELETE CASCADE,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  probe_status VARCHAR(24) NOT NULL DEFAULT 'never',
  probe_error VARCHAR(120) NOT NULL DEFAULT '',
  probed_at TIMESTAMP NULL,
  firmware_at_probe VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS surveillance_channels (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id BIGINT NOT NULL REFERENCES surveillance_devices(id) ON DELETE CASCADE,
  channel_index INTEGER NOT NULL,
  display_name VARCHAR(120) NOT NULL DEFAULT '',
  vendor_name VARCHAR(120) NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ptz_supported BOOLEAN NOT NULL DEFAULT FALSE,
  audio_supported BOOLEAN NOT NULL DEFAULT FALSE,
  main_codec VARCHAR(24) NOT NULL DEFAULT '',
  sub_codec VARCHAR(24) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'unknown',
  last_seen_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_surveillance_channels_device_index
  ON surveillance_channels (device_id, channel_index);
CREATE INDEX IF NOT EXISTS idx_surveillance_channels_tenant
  ON surveillance_channels (tenant_id, device_id);

CREATE TABLE IF NOT EXISTS surveillance_user_layouts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  layout VARCHAR(4) NOT NULL DEFAULT '4',
  slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_surveillance_layouts_user
  ON surveillance_user_layouts (tenant_id, user_id);

-- No foreign keys on device_id / channel_id / tenant_id: an audit record must
-- outlive the thing it describes. "Who deleted recorder 7" is worthless if
-- deleting recorder 7 cascades the evidence away.
CREATE TABLE IF NOT EXISTS surveillance_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  branch_id BIGINT NULL,
  device_id BIGINT NULL,
  channel_id BIGINT NULL,
  user_id BIGINT NULL,
  action VARCHAR(80) NOT NULL,
  old_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_code VARCHAR(80) NOT NULL DEFAULT '',
  ip_address INET NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_surveillance_audit_device
  ON surveillance_audit_logs (tenant_id, device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_surveillance_audit_user
  ON surveillance_audit_logs (tenant_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS surveillance_user_branch_access (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_surveillance_branch_access
  ON surveillance_user_branch_access (tenant_id, user_id, branch_id);

-- The allowlist consulted by the SSRF guard. Empty means the tenant may reach
-- no address at all, which is the correct state before a transport exists.
CREATE TABLE IF NOT EXISTS surveillance_network_grants (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cidr VARCHAR(64) NOT NULL,
  transport_type VARCHAR(40) NOT NULL DEFAULT 'direct',
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_surveillance_network_grants
  ON surveillance_network_grants (tenant_id, cidr, transport_type);

-- Permission definitions. Granted to nobody.
INSERT INTO permissions (module, action, description) VALUES
  ('surveillance',            'view',     'See the surveillance section'),
  ('surveillance',            'live',     'Watch live camera streams'),
  ('surveillance',            'playback', 'Watch recorded footage'),
  ('surveillance',            'snapshot', 'Capture a still image from a camera'),
  ('surveillance',            'ptz',      'Pan, tilt and zoom a supported camera'),
  ('surveillance.device',     'view',     'See recorder details and health'),
  ('surveillance.device',     'settings', 'Change recorder and channel settings'),
  ('surveillance.device',     'restart',  'Restart a recorder'),
  ('surveillance.recording',  'settings', 'Change recording mode and schedule'),
  ('surveillance.storage',    'view',     'See disk status and capacity'),
  ('surveillance.storage',    'manage',   'Perform storage operations'),
  ('surveillance.network',    'view',     'See recorder network configuration'),
  ('surveillance.network',    'manage',   'Change recorder network configuration'),
  ('surveillance.admin',      'manage',   'Administer the surveillance subsystem')
ON CONFLICT (module, action) DO NOTHING;
