// Surveillance Center — schema bootstrap.
//
// RUN ORDER AND THE RULE THIS FILE OBEYS
// --------------------------------------
// This runs inside server.js's bootstrapStartup(), which calls process.exit(1)
// on ANY thrown error. A failure here does not degrade the surveillance
// feature; it crash-loops the entire backend and takes the storefront, POS and
// every integration down with it.
//
// The project has been bitten by exactly that before: a backfill inside startup
// hit a duplicate key and the backend refused to boot. So this module obeys one
// rule without exception:
//
//     DDL ONLY. NO DATA MIGRATION. NO BACKFILL. NO UPDATE.
//
// The single INSERT below writes permission DEFINITIONS — rows in `permissions`
// naming a module and an action. It grants them to nobody. It cannot collide
// with existing data because `permissions` has UNIQUE (module, action) and the
// statement is ON CONFLICT DO NOTHING, and it cannot conflict with another
// tenant's data because permission definitions are global.
//
// DENY BY DEFAULT, INCLUDING FOR ADMINS
// -------------------------------------
// Note what is deliberately absent: the `INSERT INTO role_permissions ... WHERE
// role name IN ('admin', ...)` block that every other feature in
// permissionMiddleware.js uses to grant itself to administrators.
//
// Surveillance does not do that. A camera feed is not a report. Nobody — not
// admin, not a manager, not a previously all-powerful role — gets surveillance
// access as a side effect of a deploy. Every grant is a deliberate action taken
// in the Permissions screen by the owner. There is no prior access to preserve,
// so deny-by-default costs nothing and prevents the worst failure mode: rolling
// out a build that silently hands live store video to fifteen staff accounts.
//
// This is also why the permission rows are seeded HERE and not by adding them
// to CORE_PERMISSIONS in permissionMiddleware.js — that array is auto-granted
// to admin roles by an existing block, which is the opposite of what is wanted.

import db from "../../database/db.js";

let schemaReadyPromise = null;

/**
 * Permission definitions. Seeded, never granted.
 *
 * The split between `surveillance.*` and `surveillance.device.*` matters:
 * viewing a camera and reconfiguring a recorder are different jobs held by
 * different people, and the requirement is that a shop employee can be given
 * the first without ever getting near the second.
 */
export const SURVEILLANCE_PERMISSIONS = Object.freeze([
  ["surveillance", "view", "See the surveillance section"],
  ["surveillance", "live", "Watch live camera streams"],
  ["surveillance", "playback", "Watch recorded footage"],
  ["surveillance", "snapshot", "Capture a still image from a camera"],
  ["surveillance", "ptz", "Pan, tilt and zoom a supported camera"],
  ["surveillance.device", "view", "See recorder details and health"],
  ["surveillance.device", "settings", "Change recorder and channel settings"],
  ["surveillance.device", "restart", "Restart a recorder"],
  ["surveillance.recording", "settings", "Change recording mode and schedule"],
  ["surveillance.storage", "view", "See disk status and capacity"],
  ["surveillance.storage", "manage", "Perform storage operations"],
  ["surveillance.network", "view", "See recorder network configuration"],
  ["surveillance.network", "manage", "Change recorder network configuration"],
  ["surveillance.admin", "manage", "Administer the surveillance subsystem"],
]);

const createTables = async (client) => {
  // ---- devices --------------------------------------------------------
  //
  // `serial_hash`, not `serial`: a recorder's serial number is the identifier
  // vendor P2P clouds key on, so storing it in full creates a credential-like
  // artefact we do not need. We only ever ask "is this the same physical unit
  // as before?", which a hash answers.
  await client.query(`
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
    )
  `);
  // ON DELETE RESTRICT on branch_id is intentional. Cascading would silently
  // delete a recorder's configuration (and orphan its recordings) because
  // someone tidied up a branch record.
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_surveillance_devices_tenant ON surveillance_devices (tenant_id, branch_id, is_active)`,
  );
  // One recorder per address per tenant. Prevents the same unit being added
  // twice and then reported as two different health states.
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_surveillance_devices_endpoint ON surveillance_devices (tenant_id, host, port)`,
  );

  // ---- credentials ----------------------------------------------------
  //
  // A separate table, not columns on surveillance_devices. The reason is
  // mundane and important: `SELECT * FROM surveillance_devices` appears in
  // every codebase eventually, and if the password lives there it ends up in a
  // response body. It cannot leak from a table nothing joins by default.
  await client.query(`
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
    )
  `);
  // The column is named `password_encrypted`, never `password`. A plaintext
  // column simply does not exist, so there is nowhere for a plaintext write to
  // land even by mistake.

  // ---- capabilities ---------------------------------------------------
  await client.query(`
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
    )
  `);
  // Default '{}' is safe because normalizeCapabilitySet() reads a missing key
  // as `unknown`, and `unknown` hides the control. An empty row therefore means
  // "nothing proven, nothing shown" rather than "everything allowed".

  // ---- channels -------------------------------------------------------
  await client.query(`
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
    )
  `);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_surveillance_channels_device_index ON surveillance_channels (device_id, channel_index)`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_surveillance_channels_tenant ON surveillance_channels (tenant_id, device_id)`,
  );

  // ---- saved layouts --------------------------------------------------
  await client.query(`
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
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_surveillance_layouts_user ON surveillance_user_layouts (tenant_id, user_id)`,
  );

  // ---- audit ----------------------------------------------------------
  //
  // Dedicated rather than reusing `audit_logs`, which has no branch_id and no
  // device_id. Adding those columns to a shared table to serve one feature
  // muddies every other reader of it; a purpose-built table keeps the recorder
  // history queryable ("everything that happened to DVR 3") without a JSONB
  // scan, and keeps its retention independent.
  await client.query(`
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
    )
  `);
  // No foreign keys on device_id / channel_id, and this is deliberate. An audit
  // record must survive the deletion of the thing it describes — "who removed
  // recorder 7 and when" is worthless if removing recorder 7 cascades the
  // evidence away. Same reason tenant_id is not an FK here.
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_surveillance_audit_device ON surveillance_audit_logs (tenant_id, device_id, created_at DESC)`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_surveillance_audit_user ON surveillance_audit_logs (tenant_id, user_id, created_at DESC)`,
  );

  // ---- branch access --------------------------------------------------
  //
  // Scoped to surveillance on purpose. The platform has no user↔branch model,
  // and inventing one here would silently change access rules for POS,
  // attendance and reports. This table answers one question for one feature.
  await client.query(`
    CREATE TABLE IF NOT EXISTS surveillance_user_branch_access (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_surveillance_branch_access ON surveillance_user_branch_access (tenant_id, user_id, branch_id)`,
  );

  // ---- tenant network grants -----------------------------------------
  //
  // The allowlist the SSRF guard consults. A CIDR here is an operator saying
  // "this tenant's transport may reach this range". Empty means the tenant can
  // reach nothing, which is the correct state before a transport is provisioned.
  await client.query(`
    CREATE TABLE IF NOT EXISTS surveillance_network_grants (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      cidr VARCHAR(64) NOT NULL,
      transport_type VARCHAR(40) NOT NULL DEFAULT 'direct',
      note VARCHAR(200) NOT NULL DEFAULT '',
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_surveillance_network_grants ON surveillance_network_grants (tenant_id, cidr, transport_type)`,
  );
};

const seedPermissionDefinitions = async (client) => {
  for (const [moduleName, action, description] of SURVEILLANCE_PERMISSIONS) {
    await client.query(
      `
      INSERT INTO permissions (module, action, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (module, action) DO NOTHING
      `,
      [moduleName, action, description],
    );
  }
  // Intentionally nothing else. No role_permissions rows are created by this
  // deploy — see the file header.
};

/**
 * Idempotent. Safe to call on every boot and safe to call concurrently: every
 * statement is IF NOT EXISTS or ON CONFLICT DO NOTHING.
 */
export const ensureSurveillanceSchema = async (client = db) => {
  if (schemaReadyPromise) return schemaReadyPromise;
  schemaReadyPromise = (async () => {
    await createTables(client);
    await seedPermissionDefinitions(client);
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });
  return schemaReadyPromise;
};

export default ensureSurveillanceSchema;
