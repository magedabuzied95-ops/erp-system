// Surveillance Center — audit trail.
//
// WHAT THIS IS FOR
// ----------------
// "User X changed Camera 3 bitrate 2048 → 4096 on 17 Aug 2026 01:20." A camera
// system without that record is a system where nobody can answer why a camera
// stopped recording the week something went missing from the shop — and the
// people with the motive to change it are the people with access to it.
//
// TWO WRITE MODES, AND THE DIFFERENCE MATTERS
// -------------------------------------------
//   record()          best effort. If the insert fails, the operation still
//                     succeeded and we log the failure. Used for reads and
//                     low-stakes changes, where losing an audit row is worse
//                     than nothing but far better than failing a user's action.
//
//   recordCritical()  throws on failure, and is called BEFORE the action runs.
//                     Used for restart, network changes, storage operations and
//                     credential rotation. If we cannot write down that we are
//                     about to reboot a customer's recorder, we do not reboot
//                     the recorder. An unloggable privileged action is not a
//                     privileged action, it is an untraceable one.
//
// The critical path therefore writes twice: an `attempt` row before, and an
// outcome update after. That ordering is the whole point — a crash mid-action
// leaves an `attempt` row with success=false, which is exactly the state an
// investigator needs to see.
//
// VALUES ARE REDACTED BEFORE THEY ARE STORED
// ------------------------------------------
// old_value/new_value are diffs of device configuration, and device
// configuration objects contain credentials (a Dahua encoder config round-trip
// can carry the RTSP auth block). Redaction runs on the way IN, not on the way
// out, because a password written to an audit table is a password on disk in
// plaintext no matter how carefully the reader is written.

import db from "../../database/db.js";

import { redactSurveillance, surveillanceLogError } from "./surveillanceRedaction.js";

/** Action names. Stable strings — they are queried and reported on. */
export const SURVEILLANCE_ACTIONS = Object.freeze({
  DEVICE_CREATED: "device.created",
  DEVICE_UPDATED: "device.updated",
  DEVICE_DELETED: "device.deleted",
  DEVICE_PROBED: "device.probed",
  DEVICE_TESTED: "device.connection_tested",
  DEVICE_RESTARTED: "device.restarted",

  CREDENTIALS_SET: "credentials.set",
  CREDENTIALS_ROTATED: "credentials.rotated",

  CHANNEL_IMPORTED: "channel.imported",
  CHANNEL_RENAMED: "channel.renamed",
  CHANNEL_UPDATED: "channel.updated",

  LIVE_VIEWED: "stream.live_viewed",
  PLAYBACK_VIEWED: "stream.playback_viewed",
  SNAPSHOT_TAKEN: "stream.snapshot_taken",
  PTZ_COMMANDED: "stream.ptz_commanded",

  RECORDING_CONFIG_CHANGED: "config.recording_changed",
  ENCODER_CONFIG_CHANGED: "config.encoder_changed",
  MOTION_CONFIG_CHANGED: "config.motion_changed",
  TIME_CONFIG_CHANGED: "config.time_changed",
  NETWORK_CONFIG_CHANGED: "config.network_changed",
  STORAGE_OPERATION: "storage.operation",

  NETWORK_GRANT_ADDED: "network_grant.added",
  NETWORK_GRANT_REMOVED: "network_grant.removed",
  BRANCH_ACCESS_CHANGED: "branch_access.changed",
});

/**
 * Client IP for the record.
 *
 * Behind nginx and Vercel the socket address is a proxy, so X-Forwarded-For is
 * the only useful value — but it is client-supplied and trivially forged. It is
 * recorded because a forged value is still evidence of something, and the
 * leftmost entry is taken because that is the convention; it is NOT treated as
 * an authorisation input anywhere.
 */
const clientIp = (req) => {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const raw = forwarded || req?.socket?.remoteAddress || "";
  // Postgres INET rejects a malformed value and would abort the insert, so an
  // unparseable header must become NULL rather than an exception.
  return /^[0-9a-fA-F:.]+$/.test(raw) && raw.length <= 45 ? raw : null;
};

const userAgent = (req) => String(req?.headers?.["user-agent"] || "").slice(0, 500);

const jsonValue = (value) => {
  if (value === null || value === undefined) return {};
  const redacted = redactSurveillance(value);
  return redacted && typeof redacted === "object" && !Array.isArray(redacted)
    ? redacted
    : { value: redacted };
};

const insertRow = async (client, entry) => {
  const result = await client.query(
    `
    INSERT INTO surveillance_audit_logs
      (tenant_id, branch_id, device_id, channel_id, user_id, action,
       old_value, new_value, success, error_code, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::inet, $12)
    RETURNING id
    `,
    [
      entry.tenantId,
      entry.branchId ?? null,
      entry.deviceId ?? null,
      entry.channelId ?? null,
      entry.userId ?? null,
      entry.action,
      JSON.stringify(jsonValue(entry.oldValue)),
      JSON.stringify(jsonValue(entry.newValue)),
      entry.success !== false,
      String(entry.errorCode || "").slice(0, 80),
      entry.ipAddress ?? null,
      entry.userAgent ?? "",
    ],
  );
  return result.rows[0]?.id ?? null;
};

/**
 * Build an entry from a request plus the specifics.
 * Keeps every call site from re-deriving ip/user-agent/tenant the same way.
 */
export const auditEntryFromRequest = (req, entry = {}) => ({
  tenantId: entry.tenantId ?? req?.user?.tenant_id ?? null,
  userId: entry.userId ?? req?.user?.id ?? null,
  ipAddress: clientIp(req),
  userAgent: userAgent(req),
  ...entry,
});

/** Best effort. Never throws; a failed audit write must not fail the request. */
export const recordSurveillanceAudit = async (entry, client = db) => {
  try {
    return await insertRow(client, entry);
  } catch (error) {
    surveillanceLogError("audit_write_failed", error, {
      tenant_id: entry?.tenantId ?? null,
      action: entry?.action ?? "",
    });
    return null;
  }
};

/**
 * Write-ahead for a privileged action. Throws if it cannot be recorded.
 *
 * Returns the row id so the caller can settle it. Call this BEFORE performing
 * the action:
 *
 *   const auditId = await recordCriticalSurveillanceAudit({ ... });
 *   try   { await provider.restartDevice(); await settle(auditId, { success: true }); }
 *   catch (e) { await settle(auditId, { success: false, errorCode: e.code }); throw e; }
 */
export const recordCriticalSurveillanceAudit = async (entry, client = db) =>
  insertRow(client, { ...entry, success: entry.success ?? false });

/**
 * Close out a write-ahead entry.
 *
 * Best effort by design: the action has already happened, and throwing here
 * would report a failure for something that succeeded. A row stuck at
 * success=false with no settlement is itself informative.
 */
export const settleSurveillanceAudit = async (auditId, { success, errorCode = "", newValue } = {}, client = db) => {
  if (!auditId) return;
  try {
    await client.query(
      `
      UPDATE surveillance_audit_logs
      SET success = $2,
          error_code = $3,
          new_value = COALESCE($4::jsonb, new_value)
      WHERE id = $1
      `,
      [
        auditId,
        Boolean(success),
        String(errorCode || "").slice(0, 80),
        newValue === undefined ? null : JSON.stringify(jsonValue(newValue)),
      ],
    );
  } catch (error) {
    surveillanceLogError("audit_settle_failed", error, { audit_id: auditId });
  }
};

/**
 * Read the trail for one device, newest first.
 * Tenant-scoped in the query itself — never filtered in JavaScript afterwards.
 */
export const listDeviceAudit = async (tenantId, deviceId, { limit = 50, offset = 0 } = {}, client = db) => {
  const result = await client.query(
    `
    SELECT id, branch_id, device_id, channel_id, user_id, action,
           old_value, new_value, success, error_code, ip_address, created_at
    FROM surveillance_audit_logs
    WHERE tenant_id = $1 AND device_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3 OFFSET $4
    `,
    [tenantId, deviceId, Math.min(Number(limit) || 50, 200), Math.max(Number(offset) || 0, 0)],
  );
  return result.rows;
};
