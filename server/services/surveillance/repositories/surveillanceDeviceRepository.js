// Surveillance Center — device and channel persistence.
//
// THE INVARIANT
// -------------
// Every exported function takes `tenantId` as its FIRST parameter and every SQL
// statement it runs carries `tenant_id = $1`. No exceptions, including for
// lookups by primary key.
//
// "Fetch by id, then check the tenant in JavaScript" is the pattern that leaks.
// It leaks because the check is a separate statement someone can forget, and
// because the row has already been read — so a logging line, an error message,
// or an early `return row` between the fetch and the check exposes it. Putting
// the tenant in the WHERE clause means a cross-tenant id simply returns zero
// rows, and there is nothing to leak.
//
// A test asserts this file contains no SELECT/UPDATE/DELETE against a
// surveillance table without a tenant predicate.
//
// WHAT IS NOT HERE
// ----------------
// Credentials. They live in their own repository and their own table so that
// nothing joining devices can pick them up incidentally.

import db from "../../../database/db.js";

import { assertRowTenant } from "../surveillanceTenantScope.js";

/**
 * Columns safe to return from any device read.
 *
 * Written out rather than `SELECT *` on purpose: a future ALTER TABLE that adds
 * a sensitive column would otherwise start appearing in API responses with no
 * code change and no review.
 */
const DEVICE_COLUMNS = `
  id, tenant_id, branch_id, name, vendor_key, transport_type,
  host, port, protocol, model, firmware, channel_count,
  status, last_seen_at, last_error_code, is_active,
  created_by, updated_by, created_at, updated_at
`;

/**
 * The projection sent to the browser.
 *
 * `host` and `port` are dropped. A camera operator has no use for the recorder's
 * LAN address, and requirement #19 lists "knowing the IPs" as part of what
 * tenant isolation must prevent — so the address does not travel to any client,
 * not even its owner's. Device-management screens for the owner get it from a
 * dedicated call, not from the list.
 */
export const toPublicDevice = (row = {}) => ({
  id: row.id,
  branch_id: row.branch_id,
  name: row.name,
  vendor_key: row.vendor_key,
  transport_type: row.transport_type,
  model: row.model,
  firmware: row.firmware,
  channel_count: row.channel_count,
  status: row.status,
  last_seen_at: row.last_seen_at,
  is_active: row.is_active,
});

/* ------------------------------------------------------------------ *
 * Devices
 * ------------------------------------------------------------------ */

export const listDevices = async (tenantId, { branchIds = null, includeInactive = false } = {}, client = db) => {
  const params = [tenantId];
  let sql = `SELECT ${DEVICE_COLUMNS} FROM surveillance_devices WHERE tenant_id = $1`;

  if (Array.isArray(branchIds)) {
    // An empty branch grant list means "no branches", not "all branches". The
    // caller resolves that distinction (branchAccessFilter); if it hands us an
    // array we honour it literally, and an empty array correctly matches nothing.
    params.push(branchIds);
    sql += ` AND branch_id = ANY($${params.length}::bigint[])`;
  }
  if (!includeInactive) sql += ` AND is_active = TRUE`;

  sql += ` ORDER BY branch_id, name`;
  const result = await client.query(sql, params);
  return result.rows;
};

export const getDeviceById = async (tenantId, deviceId, client = db) => {
  const result = await client.query(
    `SELECT ${DEVICE_COLUMNS} FROM surveillance_devices WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, deviceId],
  );
  // Belt and braces on top of the WHERE clause. If this ever fires it means the
  // query above was edited badly, and failing here is far better than serving
  // the row.
  return assertRowTenant(result.rows[0], tenantId, "device");
};

export const createDevice = async (tenantId, payload, { userId = null } = {}, client = db) => {
  const result = await client.query(
    `
    INSERT INTO surveillance_devices
      (tenant_id, branch_id, name, vendor_key, transport_type, host, port, protocol, created_by, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    RETURNING ${DEVICE_COLUMNS}
    `,
    [
      tenantId,
      payload.branch_id,
      payload.name,
      payload.vendor_key,
      payload.transport_type,
      payload.host,
      payload.port,
      payload.protocol,
      userId,
    ],
  );
  return result.rows[0];
};

/**
 * Update the operator-editable fields only.
 *
 * `model`, `firmware`, `channel_count`, `status` and `capabilities` are
 * deliberately not settable here — they are facts about the device, written
 * only by the probe path below.
 */
export const updateDevice = async (tenantId, deviceId, payload, { userId = null } = {}, client = db) => {
  const fields = [];
  const params = [tenantId, deviceId];

  for (const column of ["branch_id", "name", "transport_type", "host", "port", "protocol", "is_active"]) {
    if (Object.prototype.hasOwnProperty.call(payload, column)) {
      params.push(payload[column]);
      fields.push(`${column} = $${params.length}`);
    }
  }
  if (!fields.length) return getDeviceById(tenantId, deviceId, client);

  params.push(userId);
  fields.push(`updated_by = $${params.length}`);
  fields.push(`updated_at = CURRENT_TIMESTAMP`);

  const result = await client.query(
    `
    UPDATE surveillance_devices
    SET ${fields.join(", ")}
    WHERE tenant_id = $1 AND id = $2
    RETURNING ${DEVICE_COLUMNS}
    `,
    params,
  );
  return assertRowTenant(result.rows[0], tenantId, "device");
};

export const deleteDevice = async (tenantId, deviceId, client = db) => {
  const result = await client.query(
    `DELETE FROM surveillance_devices WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, deviceId],
  );
  return Boolean(result.rows[0]);
};

/** Written by the probe path only. */
export const recordDeviceIdentity = async (tenantId, deviceId, identity = {}, client = db) => {
  const result = await client.query(
    `
    UPDATE surveillance_devices
    SET model = $3, firmware = $4, serial_hash = $5, channel_count = $6, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1 AND id = $2
    RETURNING ${DEVICE_COLUMNS}
    `,
    [
      tenantId,
      deviceId,
      String(identity.model || "").slice(0, 120),
      String(identity.firmware || "").slice(0, 120),
      String(identity.serialHash || "").slice(0, 64),
      Number(identity.channelCount) || 0,
    ],
  );
  return assertRowTenant(result.rows[0], tenantId, "device");
};

/** Written by health monitoring. Cheap and frequent, so it touches four columns. */
export const recordDeviceStatus = async (tenantId, deviceId, { status, errorCode = "" } = {}, client = db) => {
  await client.query(
    `
    UPDATE surveillance_devices
    SET status = $3,
        last_error_code = $4,
        last_seen_at = CASE WHEN $3 = 'online' THEN CURRENT_TIMESTAMP ELSE last_seen_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1 AND id = $2
    `,
    [tenantId, deviceId, String(status || "unknown").slice(0, 24), String(errorCode || "").slice(0, 80)],
  );
};

/* ------------------------------------------------------------------ *
 * Capabilities
 * ------------------------------------------------------------------ */

export const getCapabilities = async (tenantId, deviceId, client = db) => {
  const result = await client.query(
    `
    SELECT capabilities, probe_status, probe_error, probed_at, firmware_at_probe
    FROM surveillance_device_capabilities
    WHERE tenant_id = $1 AND device_id = $2
    LIMIT 1
    `,
    [tenantId, deviceId],
  );
  return result.rows[0] || null;
};

export const saveCapabilities = async (tenantId, deviceId, { capabilities, probeStatus, probeError = "", firmware = "" }, client = db) => {
  const result = await client.query(
    `
    INSERT INTO surveillance_device_capabilities
      (tenant_id, device_id, capabilities, probe_status, probe_error, probed_at, firmware_at_probe)
    VALUES ($1, $2, $3::jsonb, $4, $5, CURRENT_TIMESTAMP, $6)
    ON CONFLICT (device_id) DO UPDATE
    SET capabilities = EXCLUDED.capabilities,
        probe_status = EXCLUDED.probe_status,
        probe_error = EXCLUDED.probe_error,
        probed_at = EXCLUDED.probed_at,
        firmware_at_probe = EXCLUDED.firmware_at_probe,
        updated_at = CURRENT_TIMESTAMP
    WHERE surveillance_device_capabilities.tenant_id = $1
    RETURNING capabilities, probe_status, probed_at
    `,
    [
      tenantId,
      deviceId,
      JSON.stringify(capabilities || {}),
      String(probeStatus || "unknown").slice(0, 24),
      String(probeError || "").slice(0, 120),
      String(firmware || "").slice(0, 120),
    ],
  );
  return result.rows[0] || null;
};

/* ------------------------------------------------------------------ *
 * Channels
 * ------------------------------------------------------------------ */

const CHANNEL_COLUMNS = `
  id, tenant_id, device_id, channel_index, display_name, vendor_name,
  is_enabled, ptz_supported, audio_supported, main_codec, sub_codec,
  status, last_seen_at, created_at, updated_at
`;

export const toPublicChannel = (row = {}) => ({
  id: row.id,
  device_id: row.device_id,
  channel_index: row.channel_index,
  // Requirement #9: the ERP name wins, and falls back to the recorder's own
  // name only when the operator has not set one.
  name: row.display_name || row.vendor_name || `Channel ${row.channel_index}`,
  is_enabled: row.is_enabled,
  ptz_supported: row.ptz_supported,
  audio_supported: row.audio_supported,
  status: row.status,
  last_seen_at: row.last_seen_at,
});

export const listChannels = async (tenantId, deviceId, client = db) => {
  const result = await client.query(
    `
    SELECT ${CHANNEL_COLUMNS}
    FROM surveillance_channels
    WHERE tenant_id = $1 AND device_id = $2
    ORDER BY channel_index
    `,
    [tenantId, deviceId],
  );
  return result.rows;
};

export const getChannelById = async (tenantId, channelId, client = db) => {
  const result = await client.query(
    `SELECT ${CHANNEL_COLUMNS} FROM surveillance_channels WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, channelId],
  );
  return assertRowTenant(result.rows[0], tenantId, "channel");
};

export const upsertChannel = async (tenantId, deviceId, channel, client = db) => {
  const result = await client.query(
    `
    INSERT INTO surveillance_channels
      (tenant_id, device_id, channel_index, vendor_name, is_enabled, ptz_supported, audio_supported, main_codec, sub_codec)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (device_id, channel_index) DO UPDATE
    SET vendor_name = EXCLUDED.vendor_name,
        is_enabled = EXCLUDED.is_enabled,
        ptz_supported = EXCLUDED.ptz_supported,
        audio_supported = EXCLUDED.audio_supported,
        main_codec = EXCLUDED.main_codec,
        sub_codec = EXCLUDED.sub_codec,
        updated_at = CURRENT_TIMESTAMP
    WHERE surveillance_channels.tenant_id = $1
    RETURNING ${CHANNEL_COLUMNS}
    `,
    [
      tenantId,
      deviceId,
      Number(channel.index),
      String(channel.vendorName || "").slice(0, 120),
      channel.enabled !== false,
      Boolean(channel.ptz),
      Boolean(channel.audio),
      String(channel.mainCodec || "").slice(0, 24),
      String(channel.subCodec || "").slice(0, 24),
    ],
  );
  // The ON CONFLICT deliberately does NOT overwrite display_name. An import
  // re-run must never wipe the names the operator typed.
  return result.rows[0];
};

export const updateChannel = async (tenantId, channelId, payload, client = db) => {
  const fields = [];
  const params = [tenantId, channelId];

  for (const column of ["display_name", "is_enabled"]) {
    if (Object.prototype.hasOwnProperty.call(payload, column)) {
      params.push(payload[column]);
      fields.push(`${column} = $${params.length}`);
    }
  }
  if (!fields.length) return getChannelById(tenantId, channelId, client);
  fields.push(`updated_at = CURRENT_TIMESTAMP`);

  const result = await client.query(
    `
    UPDATE surveillance_channels
    SET ${fields.join(", ")}
    WHERE tenant_id = $1 AND id = $2
    RETURNING ${CHANNEL_COLUMNS}
    `,
    params,
  );
  return assertRowTenant(result.rows[0], tenantId, "channel");
};
