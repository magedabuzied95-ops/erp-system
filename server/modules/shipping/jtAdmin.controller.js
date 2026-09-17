import db from "../../database/db.js";
import { isExternalMarketplaceOrder } from "../amazon/amazonOrderGuards.js";
import { jtRuntimeConfig } from "./jtConfig.js";
import { jtSandboxFields, jtSignedRequest } from "./jtSandbox.js";
import { ensureJtSchema } from "./jtStore.js";
import { parseJtRegionMap, prepareM1JtOrder } from "./jtOrderMapping.js";

const text = (value) => String(value ?? "").trim();
const issue = (status, code, message) => Object.assign(new Error(message), { status, code });
const errorCategory = (jtCode) => ({
  "145003030": "header_signature", "145003031": "business_signature",
  "145003060": "address", "145003061": "address", "145003062": "address",
  "145003050": "parameters", "145003083": "parameters", "145003084": "parameters",
  "145003087": "parameters", "145003092": "parameters", "145003101": "duplicate",
  "145003040": "jt_server", "145005000": "jt_server", "99900560": "jt_server",
})[text(jtCode)] || "jt_error";

const fail = (res, error) => {
  const status = error.status >= 400 && error.status < 600 ? error.status : 502;
  const category = error.jtCode ? errorCategory(error.jtCode) : (error.code === "JT_NETWORK_ERROR" ? "network" : "configuration");
  return res.status(status).json({ success: false, code: error.code || "JT_FAILED", category,
    jt_code: error.jtCode || null,
    message: error.code === "JT_SANDBOX_REJECTED" ? `J&T rejected the request (${category})` : error.message || "J&T request failed",
  });
};
const run = (handler) => async (req, res) => { try { return await handler(req, res); } catch (error) { return fail(res, error); } };
const tenantId = (req) => Number(req.user?.tenant_id || req.user?.tenantId);
const loadOrder = async (req, database = db) => {
  const id = Number(req.params.id);
  const tenant = tenantId(req);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(tenant) || tenant <= 0) throw issue(400, "JT_INVALID_ORDER", "Invalid order or tenant");
  const { rows } = await database.query("SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 LIMIT 1", [id, tenant]);
  if (!rows[0]) throw issue(404, "JT_ORDER_NOT_FOUND", "Order not found");
  return rows[0];
};
const shipmentFor = async (orderId, database = db) => {
  await ensureJtSchema(database);
  const { rows } = await database.query("SELECT * FROM jt_shipments WHERE order_id = $1 LIMIT 1", [orderId]);
  return rows[0] || null;
};
const orderItems = async (orderId) => (await db.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderId])).rows;
const publicShipment = (row) => row && ({
  txlogisticId: row.txlogistic_id, billCode: row.bill_code, status: row.shipping_status,
  jtStatus: row.jt_order_status, tracking: row.tracking, createdAt: row.created_at,
  updatedAt: row.updated_at, lastSyncedAt: row.last_synced_at, lastCallbackAt: row.last_callback_at,
  cancelledAt: row.cancelled_at,
});
const demandProduction = () => {
  const config = jtRuntimeConfig();
  if (config.environment !== "production") throw issue(409, "JT_SANDBOX_ONLY", "J&T is in Sandbox. M1 customer orders cannot be sent.");
  return config;
};

export const getOrderJtStatus = run(async (req, res) => {
  const order = await loadOrder(req);
  const shipment = await shipmentFor(order.id);
  let preview;
  try {
    const config = jtRuntimeConfig();
    preview = prepareM1JtOrder({ order, items: await orderItems(order.id), config,
      weightKg: req.query.weightKg, regionMap: parseJtRegionMap(process.env.JT_REGION_MAP_JSON),
      codEnabled: process.env.JT_COD_ENABLED === "1" });
  } catch { preview = { ready: false, missing: ["jt_configuration"] }; }
  return res.json({ success: true, environment: process.env.JT_ENV || "sandbox", shipment: publicShipment(shipment),
    createAllowed: process.env.JT_ENV === "production" && Boolean(preview.ready) && !shipment,
    missing: preview.missing || [], txlogisticId: preview.txlogisticId || null });
});

export const createOrderJtShipment = run(async (req, res) => {
  const config = demandProduction();
  const order = await loadOrder(req);
  if (isExternalMarketplaceOrder(order)) throw issue(409, "JT_MARKETPLACE_ORDER", "Marketplace orders cannot be shipped through M1");
  if (text(order.shipment_id || order.shipping_tracking_number) && text(order.shipping_provider).toLowerCase() !== "jt") {
    throw issue(409, "JT_OTHER_SHIPMENT_EXISTS", "This order already has a courier shipment");
  }
  const mapped = prepareM1JtOrder({ order, items: await orderItems(order.id), config,
    weightKg: req.body?.weightKg, regionMap: parseJtRegionMap(process.env.JT_REGION_MAP_JSON),
    codEnabled: process.env.JT_COD_ENABLED === "1" });
  if (!mapped.ready) return res.status(422).json({ success: false, code: "JT_FIELDS_MISSING", missing: mapped.missing });
  await ensureJtSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT id, shipment_id, shipping_tracking_number, shipping_provider FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [order.id, tenantId(req)]);
    if (!lock.rows.length) throw issue(404, "JT_ORDER_NOT_FOUND", "Order not found");
    if (text(lock.rows[0].shipment_id || lock.rows[0].shipping_tracking_number) && text(lock.rows[0].shipping_provider).toLowerCase() !== "jt") throw issue(409, "JT_OTHER_SHIPMENT_EXISTS", "This order already has a courier shipment");
    const existing = await client.query("SELECT id FROM jt_shipments WHERE order_id = $1", [order.id]);
    if (existing.rows.length) throw issue(409, "JT_SHIPMENT_EXISTS", "A J&T shipment already exists for this order");
    await client.query(`INSERT INTO jt_shipments (order_id, environment, txlogistic_id, shipping_status)
      VALUES ($1, 'production', $2, 'pending')`, [order.id, mapped.txlogisticId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  // A pending row survives an ambiguous timeout. Never blindly retry create.
  const response = await jtSignedRequest("create", { ...jtSandboxFields(config), ...mapped.payload }, { config, baseUrl: config.baseUrl });
  const billCode = text(response.data?.billCode);
  await db.query(`UPDATE jt_shipments SET bill_code = $2, sorting_code = $3, shipping_status = 'created',
    last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
  [order.id, billCode || null, text(response.data?.sortingCode) || null]);
  await db.query(`UPDATE orders SET shipping_provider = 'jt', shipping_provider_id = 'jt',
    shipping_tracking_number = $2, tracking_number = $2, shipment_id = $2,
    shipment_status = 'created', shipping_status = 'created', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $3`,
  [order.id, billCode || null, tenantId(req)]);
  return res.json({ success: true, shipment: publicShipment(await shipmentFor(order.id)) });
});

export const queryOrderJtShipment = run(async (req, res) => {
  const order = await loadOrder(req);
  const shipment = await shipmentFor(order.id);
  if (!shipment) throw issue(404, "JT_SHIPMENT_MISSING", "No J&T shipment for this order");
  const config = demandProduction();
  const result = await jtSignedRequest("query", { command: 1, serialNumber: [shipment.txlogistic_id], ...jtSandboxFields(config) }, { config, baseUrl: config.baseUrl });
  const found = Array.isArray(result.data) ? result.data.find((row) => text(row.txlogisticId) === shipment.txlogistic_id) : null;
  if (found) await db.query(`UPDATE jt_shipments SET bill_code = COALESCE(bill_code, NULLIF($2, '')),
    jt_order_status = $3, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
  [shipment.id, text(found.billCode), text(found.orderStatus)]);
  if (found?.billCode && shipment.shipping_status === "pending") {
    await db.query("UPDATE jt_shipments SET shipping_status = 'created' WHERE id = $1", [shipment.id]);
    await db.query(`UPDATE orders SET shipping_provider = 'jt', shipping_provider_id = 'jt',
      shipping_tracking_number = $2, tracking_number = $2, shipment_id = $2,
      shipment_status = 'created', shipping_status = 'created', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $3`, [order.id, text(found.billCode), tenantId(req)]);
  }
  return res.json({ success: true, shipment: publicShipment(await shipmentFor(order.id)), found: Boolean(found) });
});

export const trackOrderJtShipment = run(async (req, res) => {
  const order = await loadOrder(req);
  const shipment = await shipmentFor(order.id);
  if (!shipment?.bill_code) throw issue(404, "JT_BILL_MISSING", "J&T waybill is not available");
  const config = demandProduction();
  const result = await jtSignedRequest("trace", { billCodes: shipment.bill_code }, { config, baseUrl: config.baseUrl });
  await db.query("UPDATE jt_shipments SET tracking = $2::jsonb, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
  [shipment.id, JSON.stringify(result.data || [])]);
  return res.json({ success: true, shipment: publicShipment(await shipmentFor(order.id)) });
});

export const printOrderJtLabel = run(async (req, res) => {
  const order = await loadOrder(req);
  const shipment = await shipmentFor(order.id);
  if (!shipment?.bill_code) throw issue(404, "JT_BILL_MISSING", "J&T waybill is not available");
  const config = demandProduction();
  const result = await jtSignedRequest("label", { ...jtSandboxFields(config), billCode: shipment.bill_code, printSize: 0, printCod: 0 }, { config, baseUrl: config.baseUrl });
  const encoded = result.data?.base64EncodeContent;
  if (typeof encoded !== "string" || encoded.length > 12000000 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) throw issue(502, "JT_LABEL_INVALID", "J&T label was not a valid PDF");
  const pdf = Buffer.from(encoded, "base64");
  if (pdf.subarray(0, 5).toString() !== "%PDF-") throw issue(502, "JT_LABEL_INVALID", "J&T label was not a valid PDF");
  await db.query("UPDATE jt_shipments SET label_generated_at = CURRENT_TIMESTAMP WHERE id = $1", [shipment.id]);
  return res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="JT-${shipment.bill_code}.pdf"`, "Cache-Control": "no-store" }).send(pdf);
});

export const cancelOrderJtShipment = run(async (req, res) => {
  const order = await loadOrder(req);
  const shipment = await shipmentFor(order.id);
  if (!shipment) throw issue(404, "JT_SHIPMENT_MISSING", "No J&T shipment for this order");
  if (shipment.shipping_status === "cancelled") return res.json({ success: true, shipment: publicShipment(shipment) });
  if (["picked_up", "in_transit", "delivered"].includes(shipment.shipping_status)) throw issue(409, "JT_CANCEL_NOT_ALLOWED", "The courier has already collected this shipment");
  const config = demandProduction();
  await jtSignedRequest("cancel", { txlogisticId: shipment.txlogistic_id, orderType: 2,
    reason: text(req.body?.reason).slice(0, 50) || "Customer request", ...jtSandboxFields(config) }, { config, baseUrl: config.baseUrl });
  await db.query(`UPDATE jt_shipments SET shipping_status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [shipment.id]);
  await db.query("UPDATE orders SET shipping_status = 'cancelled', shipment_status = 'cancelled' WHERE id = $1 AND tenant_id = $2", [order.id, tenantId(req)]);
  return res.json({ success: true, shipment: publicShipment(await shipmentFor(order.id)) });
});
