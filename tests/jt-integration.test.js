import test from "node:test";
import assert from "node:assert/strict";
import { jtRuntimeConfig } from "../server/modules/shipping/jtConfig.js";
import { prepareM1JtOrder } from "../server/modules/shipping/jtOrderMapping.js";
import { applyJtCallbackEvent, validateJtCallbackEvent } from "../server/modules/shipping/jtStore.js";
import { jtHeaderDigest, jtSignedRequest, jtValidateCallback } from "../server/modules/shipping/jtSandbox.js";

const config = { environment: "sandbox", apiAccount: "test-account", privateKey: "test-key" };
const order = { id: 7, tenant_id: 3, customer_name: "Test Customer", customer_phone: "01012345678", governorate: "Cairo", city_area: "Nasr City", street_address: "Test street", cod_amount: 0 };
const sender = { name: "Test sender", mobile: "01012345678", countryCode: "EGY", prov: "Cairo", city: "Cairo", area: "Test", street: "Test street" };
const map = { "Cairo|Nasr City": { prov: "Cairo", city: "Cairo", area: "Nasr City" } };

test("production requires explicit enable, complete credentials, and matching host", () => {
  assert.throws(() => jtRuntimeConfig({ JT_ENV: "production" }), { code: "JT_PRODUCTION_LOCKED" });
  assert.throws(() => jtRuntimeConfig({ JT_ENV: "production", JT_PRODUCTION_ENABLED: "1" }), { code: "JT_PRODUCTION_INCOMPLETE" });
  assert.throws(() => jtRuntimeConfig({ JT_ENV: "sandbox", JT_BASE_URL: "https://openapi.jtjms-eg.com/webopenplatformapi/api" }), { code: "JT_HOST_MISMATCH" });
});

test("M1 mapping uses explicit J&T region, valid Egyptian address and fixed order identity", () => {
  const input = { order, items: [{ quantity: 2 }], config: { sender, payType: "PP_PM" }, weightKg: 0.5, regionMap: map };
  const ready = prepareM1JtOrder(input);
  assert.equal(ready.ready, true);
  assert.equal(ready.txlogisticId, "M1-3-7");
  assert.equal(ready.payload.goodsType, "ITN1");
  assert.equal(ready.payload.receiver.area, "Nasr City");
  assert.ok(prepareM1JtOrder({ ...input, regionMap: {} }).missing.includes("jt_region_mapping"));
  assert.ok(prepareM1JtOrder({ ...input, order: { ...order, customer_phone: "bad" } }).missing.includes("customer_phone"));
  assert.ok(prepareM1JtOrder({ ...input, order: { ...order, cod_amount: 100 } }).missing.includes("jt_cod_enabled"));
});

test("callback signature, time window, payload and replay key", () => {
  const now = 1750000000000;
  const bizContent = JSON.stringify({ txlogisticId: "M1SB123", billCode: "B123", scanType: "已入仓", time: "2026-09-17 12:00:00" });
  const headers = { apiAccount: config.apiAccount, timestamp: String(now), bizContent, digest: jtHeaderDigest(bizContent, config.privateKey) };
  assert.equal(jtValidateCallback(headers, config, now), true);
  assert.equal(jtValidateCallback({ ...headers, digest: "invalid" }, config, now), false);
  assert.equal(jtValidateCallback(headers, config, now + 301000), false);
  const event = validateJtCallbackEvent(JSON.parse(bizContent));
  assert.equal(event.shippingStatus, "in_transit");
  assert.equal(event.eventKey, validateJtCallbackEvent(JSON.parse(bizContent)).eventKey);
  assert.equal(validateJtCallbackEvent({ txlogisticId: "M1SB123", scanType: "made-up", time: "2026-09-17 12:00:00" }), null);
  assert.equal(validateJtCallbackEvent({ txlogisticId: "M1SB123", scanType: "已入仓", time: "bad" }), null);
});

test("callback storage is idempotent and refuses unknown shipments", async () => {
  const queries = [];
  const client = { async query(sql) { queries.push(sql); if (sql.includes("SELECT * FROM jt_shipments")) return { rows: [{ id: 1, bill_code: "B123", order_id: null }] }; if (sql.includes("INSERT INTO jt_callback_events")) return { rows: [] }; return { rows: [], rowCount: 0 }; }, release() {} };
  const db = { async query() { return { rows: [] }; }, async connect() { return client; } };
  const event = validateJtCallbackEvent({ txlogisticId: "M1SB123", billCode: "B123", scanType: "已入仓", time: "2026-09-17 12:00:00" });
  assert.deepEqual(await applyJtCallbackEvent(event, db), { found: true, duplicate: true });
  assert.equal(queries.some((sql) => sql.includes("UPDATE jt_shipments SET bill_code")), false);
  const unknownDb = { ...db, async connect() { return { ...client, async query(sql) { if (sql.includes("SELECT * FROM jt_shipments")) return { rows: [] }; return { rows: [] }; } }; } };
  assert.deepEqual(await applyJtCallbackEvent(event, unknownDb), { found: false, duplicate: false });
});

test("signed request retries read only, never create or cancel", async () => {
  let attempts = 0;
  const fetchImpl = async () => { attempts += 1; if (attempts === 1) throw new Error("network"); return { ok: true, status: 200, text: async () => JSON.stringify({ code: "1", msg: "success", data: [] }) }; };
  await jtSignedRequest("query", { sample: 1 }, { config, fetchImpl });
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(jtSignedRequest("create", { sample: 1 }, { config, fetchImpl }), { code: "JT_NETWORK_ERROR" });
  assert.equal(attempts, 1);
});
