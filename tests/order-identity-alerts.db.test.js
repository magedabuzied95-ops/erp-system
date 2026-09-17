/*
 * Same address, another name and phone.
 *
 * The rules that matter live in SQL (the trigger that re-queues an edited order, the candidate
 * search, the per-pair upsert), so this runs against a REAL database inside its own schema,
 * which shadows orders / notifications so the test cannot reach a real table. The schema is
 * dropped when it finishes, and the whole file skips itself when no database is reachable.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAddressFingerprint,
  compareAddressTokens,
  isDifferentIdentity,
  namesLookDifferent,
  resolveGovernorateKey,
} from "../server/modules/orders/addressIdentity.js";

test("one house typed three ways lands on the same tokens", () => {
  const typed = buildAddressFingerprint({ customer_address: "ش التحرير عمارة ٥ الدور الثالث شقة 7", governorate: "القاهرة" });
  const split = buildAddressFingerprint({ street_address: "شارع التحرير", building_number: "5", floor_number: "3", apartment_number: "٧", governorate_id: "cairo-city" });
  const short = buildAddressFingerprint({ customer_address: "التحرير، عماره 5 - دور 3", governorate: "Cairo" });
  assert.equal(typed.key, split.key);
  assert.equal(typed.region, "cairo");
  assert.deepEqual(compareAddressTokens(typed.tokens, split.tokens), { kind: "exact", score: 1 });
  assert.equal(compareAddressTokens(short.tokens, split.tokens)?.kind, "similar");
});

test("another house number on the same street is not a match", () => {
  const five = buildAddressFingerprint({ customer_address: "شارع التحرير عمارة 5 الدور 3" });
  const seven = buildAddressFingerprint({ customer_address: "شارع التحرير عمارة 7 الدور 3" });
  assert.equal(compareAddressTokens(five.tokens, seven.tokens), null);
  // A street alone is not a house.
  const street = buildAddressFingerprint({ customer_address: "شارع التحرير" });
  assert.equal(street.tokens, null);
});

test("identity: both the name and every phone must differ", () => {
  const base = { customer_name: "أحمد علي", customer_phone: "01011111111" };
  assert.equal(isDifferentIdentity(base, { customer_name: "محمود حسن", customer_phone: "+201222222222" }), true);
  assert.equal(isDifferentIdentity(base, { customer_name: "محمود حسن", customer_phone: "+201011111111" }), false);
  assert.equal(isDifferentIdentity(base, { customer_name: "احمد علي", customer_phone: "01222222222" }), false);
  assert.equal(isDifferentIdentity(base, { customer_name: "محمود", customer_phone: "01222222222", customer_secondary_phone: "01011111111" }), false);
  assert.equal(namesLookDifferent("أحمد علي", "احمد علي محمد"), false);
  assert.equal(resolveGovernorateKey("alex-city"), resolveGovernorateKey("الإسكندرية"));
});

const SCHEMA = "order_identity_alerts_test";
const CONNECT_TIMEOUT_MS = 3000;

const pgConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "erp_db",
  password: process.env.PGPASSWORD || "065342",
  port: Number(process.env.PGPORT) || 5432,
  connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
};

const reachable = async () => {
  try {
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const pool = new Pool(pgConfig);
    await pool.query("SELECT 1");
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.end();
    return true;
  } catch {
    return false;
  }
};

const ready = await reachable();

if (!ready) {
  test("order identity alerts (skipped: no database)", { skip: true }, () => {});
} else {
  // Set before db.js is imported: the pool reads PGOPTIONS once, at module load.
  process.env.PGOPTIONS = `-c client_encoding=UTF8 -c search_path=${SCHEMA},public`;

  const { default: db } = await import("../server/database/db.js");
  const alerts = await import("../server/modules/orders/addressIdentityAlerts.js");

  const insertOrder = async (fields) => {
    const row = {
      tenant_id: 1,
      channel: "website",
      status: "pending",
      shipping_status: "pending",
      governorate: "القاهرة",
      ...fields,
    };
    const columns = Object.keys(row);
    const result = await db.query(
      `INSERT INTO orders (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      columns.map((column) => row[column])
    );
    return Number(result.rows[0].id);
  };

  const sweep = () => alerts.runOrderIdentitySweep({ budgetMs: 10_000 });

  test("order identity alerts against a real database", async (t) => {
    t.after(async () => {
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
      await db.end().catch(() => {});
    });

    await db.query(`
      CREATE TABLE ${SCHEMA}.orders (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT, branch_id BIGINT, customer_id BIGINT,
        invoice_number VARCHAR(80), channel VARCHAR(50) NOT NULL DEFAULT 'pos',
        status VARCHAR(50), shipping_status VARCHAR(80), shipment_status VARCHAR(80),
        customer_name VARCHAR(255), customer_phone VARCHAR(80),
        customer_address TEXT, shipping_address_line TEXT, street_address TEXT,
        building_number VARCHAR(80), floor_number VARCHAR(80), apartment_number VARCHAR(80),
        governorate VARCHAR(120), governorate_id VARCHAR(160), city_area VARCHAR(160),
        deleted_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await alerts.ensureOrderIdentityAlertsSchema(db);
    // Twice: a second boot must not fail on the trigger that already exists.
    await alerts.ensureOrderIdentityAlertsSchema(db);

    const refused = await insertOrder({
      invoice_number: "WEB-1", customer_name: "أحمد علي", customer_phone: "01011111111",
      customer_address: "ش التحرير عمارة ٥ الدور ٣", status: "returned",
      created_at: new Date(Date.now() - 20 * 86400000),
    });
    const samePhone = await insertOrder({
      invoice_number: "WEB-2", customer_name: "سيد", customer_phone: "+201011111111",
      customer_address: "شارع التحرير عماره 5 دور 3",
    });
    const pos = await insertOrder({
      channel: "pos", invoice_number: "POS-1", customer_name: "كريم", customer_phone: "01555555555",
      customer_address: "شارع التحرير عماره 5 دور 3",
    });
    const otherHouse = await insertOrder({
      invoice_number: "WEB-3", customer_name: "هاني", customer_phone: "01033333333",
      customer_address: "شارع التحرير عمارة 9 الدور 3",
    });
    const comeback = await insertOrder({
      invoice_number: "WEB-4", customer_name: "محمود حسن", customer_phone: "01222222222",
      street_address: "شارع التحرير", building_number: "5", floor_number: "الثالث", apartment_number: "7",
      governorate_id: "cairo-city", governorate: null,
    });

    const first = await sweep();
    assert.equal(first.processed, 4, "the POS order is never looked at");

    const levels = await alerts.getOrderIdentityAlertLevels({ orderIds: [refused, samePhone, pos, otherHouse, comeback], tenantId: 1 });
    assert.deepEqual(Object.keys(levels).map(Number), [comeback]);
    assert.equal(levels[comeback].level, "red");
    // WEB-2 shares WEB-1's phone, so it is WEB-1's buyer and is not flagged — but it is still
    // another identity from WEB-4's point of view.
    assert.equal(levels[comeback].count, 2);

    const onComeback = await alerts.getOrderIdentityAlerts({ orderId: comeback, tenantId: 1 });
    assert.equal(onComeback.level, "red");
    assert.equal(onComeback.alerts[0].other_order.invoice_number, "WEB-1");
    assert.equal(onComeback.alerts[0].direction, "earlier_order");
    const onRefused = await alerts.getOrderIdentityAlerts({ orderId: refused, tenantId: 1 });
    assert.equal(onRefused.alerts[0].direction, "later_order");
    assert.equal(onRefused.level, null, "the earlier order is not the one flagged");

    // Another tenant sees nothing.
    assert.deepEqual(await alerts.getOrderIdentityAlertLevels({ orderIds: [comeback], tenantId: 2 }), {});

    const notes = await db.query(`SELECT * FROM notifications WHERE type = 'order_identity_alert'`);
    assert.equal(notes.rowCount, 1);
    assert.equal(notes.rows[0].action_url, `/orders/${comeback}`);

    // Nothing changed: the next pass has nothing to do and notifies nobody again.
    assert.equal((await sweep()).processed || 0, 0);

    // A status change is not an address change.
    await db.query(`UPDATE orders SET status = 'confirmed' WHERE id = $1`, [comeback]);
    assert.equal((await sweep()).processed || 0, 0);

    // A decision survives a re-check; "different person" drops the badge.
    await alerts.reviewOrderIdentityAlerts({ orderId: comeback, tenantId: 1, decision: "different_person", user: { id: 9, name: "Manager" } });
    assert.deepEqual(await alerts.getOrderIdentityAlertLevels({ orderIds: [comeback], tenantId: 1 }), {});
    await db.query(`UPDATE orders SET customer_name = 'محمود حسن السيد' WHERE id = $1`, [comeback]);
    assert.equal((await sweep()).processed, 1, "a name edit re-queues the order");
    const reviewed = await alerts.getOrderIdentityAlerts({ orderId: comeback, tenantId: 1 });
    assert.equal(reviewed.alerts[0].status, "different_person");
    assert.equal(reviewed.alerts[0].reviewed_by_name, "Manager");
    await alerts.reviewOrderIdentityAlerts({ orderId: comeback, tenantId: 1, decision: "open" });

    // Moving the order to another address removes the open alert.
    await db.query(`UPDATE orders SET street_address = 'شارع الهرم', building_number = '40' WHERE id = $1`, [comeback]);
    await sweep();
    assert.deepEqual(await alerts.getOrderIdentityAlertLevels({ orderIds: [comeback], tenantId: 1 }), {});

    // Back again, and the earlier order was DELIVERED this time: a yellow alert, no notification.
    await db.query(`UPDATE orders SET status = 'delivered' WHERE id = $1`, [refused]);
    await db.query(`UPDATE orders SET street_address = 'شارع التحرير', building_number = '5' WHERE id = $1`, [comeback]);
    await sweep();
    const yellow = await alerts.getOrderIdentityAlertLevels({ orderIds: [comeback], tenantId: 1 });
    assert.equal(yellow[comeback].level, "yellow");
    assert.equal((await db.query(`SELECT 1 FROM notifications WHERE type = 'order_identity_alert'`)).rowCount, 1);

    // Severity is live: the earlier order coming back turns the same alert red.
    await db.query(`UPDATE orders SET status = 'pending', shipping_status = 'returned' WHERE id = $1`, [refused]);
    const red = await alerts.getOrderIdentityAlertLevels({ orderIds: [comeback], tenantId: 1 });
    assert.equal(red[comeback].level, "red");

    // Re-checking the EARLIER order (its name was corrected) must not flag it against the later
    // ones: a pair is stored once, on the order that repeated the address.
    await db.query(`UPDATE orders SET customer_name = 'أحمد علي محمد' WHERE id = $1`, [refused]);
    await sweep();
    assert.deepEqual(await alerts.getOrderIdentityAlertLevels({ orderIds: [refused], tenantId: 1 }), {});
    assert.equal((await alerts.getOrderIdentityAlerts({ orderId: refused, tenantId: 1 })).alerts.length, 1);

    // An order from long ago that repeats an address is flagged but never notifies.
    await insertOrder({
      invoice_number: "WEB-OLD", customer_name: "عادل", customer_phone: "01044444444",
      customer_address: "التحرير 5 الدور 3", created_at: new Date(Date.now() - 10 * 86400000),
    });
    await sweep();
    assert.equal((await db.query(`SELECT 1 FROM notifications WHERE type = 'order_identity_alert'`)).rowCount, 1);
  });
}
