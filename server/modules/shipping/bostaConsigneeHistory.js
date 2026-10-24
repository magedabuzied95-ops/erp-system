// Bosta consignee (customer) cross-merchant delivery record.
//
// Bosta's dashboard shows, for a customer phone, how many parcels that customer
// received vs returned across ALL merchants (GET /api/v2/consignee/ranking).
// That endpoint only accepts the dashboard's login token, NOT the business API
// key (tested 2026-10-24: API key -> 401 errorCode 1028). So the record cannot
// be pulled server-side with BOSTA_API_KEY.
//
// Instead the record is fetched client-side by the "Bosta <-> ERP" Chrome
// extension, which reads it inside the already-logged-in Bosta dashboard tab and
// POSTs it here. This module just stores the last-synced snapshot per phone and
// reads it back. No Bosta credentials ever touch the server.
//
// See docs/bosta-consignee-history-endpoint.md and tools/bosta-erp-extension/.

import db from "../../database/db.js";
import { canonicalPhoneKey } from "../../utils/phoneSearch.js";

let schemaReady = null;
export const ensureBostaConsigneeSchema = async () => {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS bosta_consignee_history (
        tenant_key BIGINT NOT NULL DEFAULT 0,
        phone_key VARCHAR(32) NOT NULL,
        phone VARCHAR(40) NOT NULL DEFAULT '',
        full_name VARCHAR(160) NOT NULL DEFAULT '',
        delivered INTEGER,
        returned INTEGER,
        consecutive_returned INTEGER,
        success_rate NUMERIC(5,2),
        high_unpaid_returns BOOLEAN,
        raw JSONB,
        synced_by VARCHAR(160) NOT NULL DEFAULT '',
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_key, phone_key)
      )
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

const intOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const numOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const boolOrNull = (value) => (value === null || value === undefined ? null : Boolean(value));

const rowToRecord = (row) => {
  if (!row) return null;
  return {
    phone: row.phone || "",
    phone_key: row.phone_key || "",
    full_name: row.full_name || "",
    delivered: intOrNull(row.delivered),
    returned: intOrNull(row.returned),
    consecutive_returned: intOrNull(row.consecutive_returned),
    success_rate: numOrNull(row.success_rate),
    high_unpaid_returns: boolOrNull(row.high_unpaid_returns),
    synced_by: row.synced_by || "",
    synced_at: row.synced_at instanceof Date ? row.synced_at.toISOString() : row.synced_at || null,
  };
};

export const getBostaConsigneeHistory = async ({ tenantId = null, phone = "" } = {}) => {
  await ensureBostaConsigneeSchema();
  const phoneKey = canonicalPhoneKey(phone);
  if (!phoneKey) return null;
  const { rows } = await db.query(
    `SELECT * FROM bosta_consignee_history WHERE tenant_key = $1 AND phone_key = $2`,
    [Number(tenantId) || 0, phoneKey]
  );
  return rowToRecord(rows[0]);
};

export const saveBostaConsigneeHistory = async ({ tenantId = null, syncedBy = "", payload = {} } = {}) => {
  await ensureBostaConsigneeSchema();
  const phone = String(payload.phone || "").trim();
  const phoneKey = canonicalPhoneKey(phone);
  if (!phoneKey) {
    const error = new Error("A valid phone is required to save a Bosta consignee record.");
    error.status = 400;
    error.code = "BOSTA_CONSIGNEE_PHONE_REQUIRED";
    throw error;
  }
  // Keep only the ranking block of the raw payload, and cap its size so a
  // surprise shape never bloats the row.
  let raw = null;
  try {
    const rawSource = payload.raw && typeof payload.raw === "object" ? payload.raw : null;
    if (rawSource) raw = JSON.parse(JSON.stringify(rawSource).slice(0, 8000));
  } catch {
    raw = null;
  }
  const { rows } = await db.query(
    `INSERT INTO bosta_consignee_history
       (tenant_key, phone_key, phone, full_name, delivered, returned,
        consecutive_returned, success_rate, high_unpaid_returns, raw, synced_by, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
     ON CONFLICT (tenant_key, phone_key) DO UPDATE SET
       phone = EXCLUDED.phone,
       full_name = CASE WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name ELSE bosta_consignee_history.full_name END,
       delivered = EXCLUDED.delivered,
       returned = EXCLUDED.returned,
       consecutive_returned = EXCLUDED.consecutive_returned,
       success_rate = EXCLUDED.success_rate,
       high_unpaid_returns = EXCLUDED.high_unpaid_returns,
       raw = EXCLUDED.raw,
       synced_by = EXCLUDED.synced_by,
       synced_at = NOW()
     RETURNING *`,
    [
      Number(tenantId) || 0,
      phoneKey,
      phone,
      String(payload.full_name || "").slice(0, 160),
      intOrNull(payload.delivered),
      intOrNull(payload.returned),
      intOrNull(payload.consecutive_returned),
      numOrNull(payload.success_rate),
      boolOrNull(payload.high_unpaid_returns),
      raw,
      String(syncedBy || "").slice(0, 160),
    ]
  );
  return rowToRecord(rows[0]);
};
