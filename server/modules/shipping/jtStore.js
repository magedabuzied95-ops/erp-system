import { createHash } from "node:crypto";
import db from "../../database/db.js";

let schemaPromise;
export const ensureJtSchema = async (database = db) => {
  if (database === db && schemaPromise) return schemaPromise;
  const migrate = async () => {
    await database.query(`CREATE TABLE IF NOT EXISTS jt_shipments (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NULL,
      environment VARCHAR(16) NOT NULL CHECK (environment IN ('sandbox', 'production')),
      txlogistic_id VARCHAR(50) NOT NULL,
      bill_code VARCHAR(50) NULL,
      jt_order_status VARCHAR(80) NULL,
      shipping_status VARCHAR(40) NOT NULL DEFAULT 'created',
      tracking JSONB NOT NULL DEFAULT '[]'::jsonb,
      sorting_code VARCHAR(100) NULL,
      last_synced_at TIMESTAMPTZ NULL,
      last_callback_at TIMESTAMPTZ NULL,
      last_event_time TIMESTAMP WITHOUT TIME ZONE NULL,
      label_generated_at TIMESTAMPTZ NULL,
      cancelled_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (environment, txlogistic_id)
    )`);
    await database.query("CREATE UNIQUE INDEX IF NOT EXISTS jt_shipments_one_per_order ON jt_shipments (order_id) WHERE order_id IS NOT NULL");
    await database.query("ALTER TABLE jt_shipments ADD COLUMN IF NOT EXISTS last_event_time TIMESTAMP WITHOUT TIME ZONE NULL");
    await database.query(`CREATE TABLE IF NOT EXISTS jt_callback_events (
      id BIGSERIAL PRIMARY KEY,
      shipment_id BIGINT NOT NULL REFERENCES jt_shipments(id),
      event_key CHAR(64) NOT NULL UNIQUE,
      scan_type VARCHAR(40) NOT NULL,
      event_time TIMESTAMP WITHOUT TIME ZONE NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  };
  if (database !== db) return migrate();
  schemaPromise = migrate().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
};

export const recordJtSandboxCreate = async ({ txlogisticId, billCode, sortingCode }, database = db) => {
  await ensureJtSchema(database);
  const { rows } = await database.query(`INSERT INTO jt_shipments
    (environment, txlogistic_id, bill_code, sorting_code, shipping_status)
    VALUES ('sandbox', $1, $2, $3, 'created')
    ON CONFLICT (environment, txlogistic_id) DO UPDATE SET
      bill_code = COALESCE(jt_shipments.bill_code, EXCLUDED.bill_code),
      sorting_code = COALESCE(jt_shipments.sorting_code, EXCLUDED.sorting_code),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`, [txlogisticId, billCode || null, sortingCode || null]);
  return rows[0];
};

export const getJtShipment = async (txlogisticId, database = db) => {
  await ensureJtSchema(database);
  const { rows } = await database.query("SELECT * FROM jt_shipments WHERE txlogistic_id = $1 LIMIT 1", [txlogisticId]);
  return rows[0] || null;
};

export const markJtSandboxCancelled = async (txlogisticId, database = db) => {
  await ensureJtSchema(database);
  await database.query(`UPDATE jt_shipments SET shipping_status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE environment = 'sandbox' AND txlogistic_id = $1`, [txlogisticId]);
};

export const J_AND_T_SCAN_STATUS = Object.freeze({
  "已调派业务员": "assigned",
  "已揽收": "picked_up",
  "已取件": "picked_up",
  "已入仓": "in_transit",
  "已取消": "cancelled",
});

export const validateJtCallbackEvent = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const txlogisticId = String(payload.txlogisticId || "").trim();
  const billCode = String(payload.billCode || "").trim();
  const scanType = String(payload.scanType || "").trim();
  const rawTime = String(payload.time || "").trim();
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(txlogisticId) || !/^[A-Za-z0-9_-]{0,50}$/.test(billCode)) return null;
  if (!Object.hasOwn(J_AND_T_SCAN_STATUS, scanType)) return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawTime)) return null;
  const [date, clock] = rawTime.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = clock.split(":").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (parsed.toISOString().slice(0, 19) !== `${date}T${clock}`) return null;
  const eventKey = createHash("sha256").update([txlogisticId, billCode, scanType, rawTime].join("|"), "utf8").digest("hex");
  return { txlogisticId, billCode, scanType, eventTime: rawTime, eventKey, shippingStatus: J_AND_T_SCAN_STATUS[scanType] };
};

export const applyJtCallbackEvent = async (event, database = db, environment = "sandbox") => {
  await ensureJtSchema(database);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM jt_shipments WHERE txlogistic_id = $1 AND environment = $2 FOR UPDATE", [event.txlogisticId, environment]);
    const shipment = rows[0];
    if (!shipment) { await client.query("ROLLBACK"); return { found: false, duplicate: false }; }
    if (event.billCode && shipment.bill_code && event.billCode !== shipment.bill_code) {
      await client.query("ROLLBACK"); return { found: true, billMismatch: true, duplicate: false };
    }
    const inserted = await client.query(`INSERT INTO jt_callback_events (shipment_id, event_key, scan_type, event_time)
      VALUES ($1, $2, $3, $4) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
    [shipment.id, event.eventKey, event.scanType, event.eventTime]);
    if (!inserted.rows.length) { await client.query("COMMIT"); return { found: true, duplicate: true }; }
    const update = await client.query(`UPDATE jt_shipments SET bill_code = COALESCE(bill_code, NULLIF($2::varchar, '')),
        jt_order_status = $3::varchar, shipping_status = $4::varchar, last_event_time = $5::timestamp,
        last_callback_at = CURRENT_TIMESTAMP,
        cancelled_at = CASE WHEN $4::varchar = 'cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
        updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND (last_event_time IS NULL OR last_event_time <= $5::timestamp)`,
      [shipment.id, event.billCode, event.scanType, event.shippingStatus, event.eventTime]);
    if (update.rowCount > 0) {
      if (environment === "production" && shipment.order_id) {
        await client.query("UPDATE orders SET shipping_status = $2, shipment_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [shipment.order_id, event.shippingStatus]);
      }
    }
    await client.query("COMMIT");
    return { found: true, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
};
