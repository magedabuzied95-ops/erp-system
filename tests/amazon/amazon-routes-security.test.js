import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";

import db from "../../server/database/db.js";
import { ensureAmazonSchema } from "../../server/modules/amazon/amazonSchema.js";
import amazonRoutes from "../../server/modules/amazon/amazon.routes.js";
import { blockMarketplaceOrderMutations, isExternalMarketplaceOrder } from "../../server/modules/amazon/amazonOrderGuards.js";
import { assertAmazonWriteAllowed } from "../../server/modules/amazon/amazonWriteGuard.js";

process.env.JWT_SECRET ||= "test-secret-for-amazon-route-suite-0123456789";
const SECRET = process.env.JWT_SECRET;

const FAKE_CREDS = {
  AMAZON_SPAPI_REFRESH_TOKEN: "Atzr|IwEBIFAKE-route-test-refresh",
  AMAZON_SPAPI_LWA_CLIENT_ID: "amzn1.application-oa2-client.routetest0000000000",
  AMAZON_SPAPI_LWA_CLIENT_SECRET: "amzn1.oa2-cs.v1.routetestsecretvalue000000",
};

const USERS = {
  1: { id: 1, role: "cashier", mfa_enabled: true, permissions: [["orders", "view"]] },
  2: { id: 2, role: "amazon_viewer", mfa_enabled: false, permissions: [["amazon", "view"]] },
  3: { id: 3, role: "amazon_viewer", mfa_enabled: true, permissions: [["amazon", "view"]] },
  4: { id: 4, role: "admin", mfa_enabled: true, permissions: [] },
  5: { id: 5, role: "amazon_manager", mfa_enabled: true, permissions: [["amazon", "view"], ["amazon", "manage"]] },
};

const buildDb = () => {
  const audits = [];
  const orderOrigins = { 500: { id: 500, source: "amazon", channel: "amazon" }, 501: { id: 501, source: "website", channel: "storefront" } };
  const query = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (text.startsWith("INSERT INTO security_audit_events")) {
      audits.push({ event_type: params[3], outcome: params[4], user_id: params[1], details: params[7] ? JSON.parse(params[7]) : null });
      return { rows: [] };
    }
    if (text.includes("FROM users u") && text.includes("WHERE u.id = $1") && text.includes("u.*")) {
      const user = USERS[params[0]];
      return { rows: user ? [{ id: user.id, tenant_id: 1, role: user.role, role_name: user.role, is_active: true, mfa_enabled: user.mfa_enabled, token_version: null }] : [] };
    }
    if (text.startsWith("SELECT DISTINCT p.module, p.action")) {
      const user = USERS[params[0]];
      if (!user) return { rows: [] };
      const base = { role_name: user.role, user_role: user.role, is_super_admin: false };
      return { rows: user.permissions.length ? user.permissions.map(([module, action]) => ({ module, action, ...base })) : [{ module: null, action: null, ...base }] };
    }
    if (text.startsWith("SELECT id, source, channel FROM orders WHERE id = $1")) {
      return { rows: orderOrigins[params[0]] ? [orderOrigins[params[0]]] : [] };
    }
    if (text.includes("FROM pg_locks")) return { rows: [{ running: false }] };
    if (text.startsWith("WITH inserted AS") && text.includes("FROM tenants")) return { rows: [{ id: 1 }] };
    return { rows: [], rowCount: 0 };
  };
  return { query, connect: async () => ({ query, release() {} }), audits };
};

const startApp = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/amazon", amazonRoutes);
  const ordersRouter = express.Router();
  ordersRouter.use("/:id", blockMarketplaceOrderMutations());
  ordersRouter.use((req, res) => res.json({ reached: true }));
  app.use("/api/orders", ordersRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
};

const tokenFor = (id) => jwt.sign({ id, role: USERS[id]?.role || "x", tenant_id: 1 }, SECRET);

const withEnvironment = async (fn) => {
  const savedEnv = { ...process.env };
  Object.assign(process.env, FAKE_CREDS);
  delete process.env.AMAZON_WRITE_SYNC_ENABLED;
  const fake = buildDb();
  const originalQuery = db.query.bind(db);
  const originalConnect = db.connect.bind(db);
  db.query = fake.query;
  db.connect = fake.connect;
  try {
    await ensureAmazonSchema(fake);
    const app = await startApp();
    try {
      return await fn({ ...app, fake });
    } finally {
      await app.close();
    }
  } finally {
    db.query = originalQuery;
    db.connect = originalConnect;
    process.env = savedEnv;
  }
};

const call = (base, method, path, userId, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { authorization: `Bearer ${tokenFor(userId)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const ROUTES = [
  ["GET", "/api/amazon/status", "view"],
  ["GET", "/api/amazon/dashboard", "view"],
  ["GET", "/api/amazon/orders", "view"],
  ["GET", "/api/amazon/listings", "view"],
  ["GET", "/api/amazon/inventory", "view"],
  ["GET", "/api/amazon/pricing", "view"],
  ["GET", "/api/amazon/products", "view"],
  ["GET", "/api/amazon/sku-mappings", "view"],
  ["GET", "/api/amazon/sync-runs", "view"],
  ["POST", "/api/amazon/connection/test", "manage"],
  ["POST", "/api/amazon/sync/orders", "manage"],
  ["POST", "/api/amazon/sync/listings", "manage"],
  ["POST", "/api/amazon/sync/inventory", "manage"],
  ["POST", "/api/amazon/sync/pricing", "manage"],
  ["PUT", "/api/amazon/settings/seller-id", "manage"],
  ["GET", "/api/amazon/m1-variants?q=ab", "manage"],
  ["POST", "/api/amazon/sku-mappings/refresh-suggestions", "manage"],
  ["POST", "/api/amazon/sku-mappings/accept-exact", "manage"],
  ["PUT", "/api/amazon/sku-mappings/1", "manage"],
  ["DELETE", "/api/amazon/sku-mappings/1", "manage"],
  ["POST", "/api/amazon/orders/project-pending", "manage"],
  ["POST", "/api/amazon/write/inventory_update", "manage"],
];

test("every Amazon route requires a login, the amazon permission and MFA", async () => {
  await withEnvironment(async ({ base, fake }) => {
    for (const [method, path, level] of ROUTES) {
      const anonymous = await call(base, method, path, null);
      assert.equal(anonymous.status, 401, `${method} ${path} without login`);

      const cashier = await call(base, method, path, 1);
      assert.equal(cashier.status, 403, `${method} ${path} for a user without amazon permission`);

      const noMfa = await call(base, method, path, 2);
      assert.equal(noMfa.status, 403, `${method} ${path} without MFA`);
      if (level === "view") {
        const body = await noMfa.json();
        assert.equal(body.code, "MFA_REQUIRED_FOR_AMAZON");
      }

      if (level === "manage") {
        const viewer = await call(base, method, path, 3);
        assert.equal(viewer.status, 403, `${method} ${path} needs amazon.manage`);
      }
    }
    assert.ok(fake.audits.some((event) => event.event_type === "amazon_access" && event.outcome === "denied_mfa_missing"));
    assert.ok(fake.audits.some((event) => event.event_type === "amazon_access" && event.outcome === "denied_permission"));
  });
});

test("an MFA-enrolled viewer can read; status never contains a credential", async () => {
  await withEnvironment(async ({ base }) => {
    const response = await call(base, "GET", "/api/amazon/status", 3);
    assert.equal(response.status, 200);
    const raw = await response.text();
    for (const value of Object.values(FAKE_CREDS)) assert.equal(raw.includes(value), false, "credential leaked in /status");
    const body = JSON.parse(raw);
    assert.equal(body.status.configured, true);
    assert.deepEqual(body.status.credentials_present, { refresh_token: true, client_id: true, client_secret: true });
    assert.equal(body.status.marketplace.id, "ARBP9OOSHTCHU");
    assert.equal(body.status.flags.write_sync, false);
  });
});

test("write endpoints refuse while AMAZON_WRITE_SYNC_ENABLED is off, and the refusal is audited", async () => {
  await withEnvironment(async ({ base, fake }) => {
    const refused = await call(base, "POST", "/api/amazon/write/price_update", 5);
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, "AMAZON_WRITE_DISABLED");
    assert.ok(fake.audits.some((event) => event.event_type === "amazon.write_blocked"));
    const unknown = await call(base, "POST", "/api/amazon/write/delete_everything", 5);
    assert.equal(unknown.status, 400);

    process.env.AMAZON_WRITE_SYNC_ENABLED = "true";
    const enabled = await call(base, "POST", "/api/amazon/write/price_update", 5);
    assert.equal(enabled.status, 501, "even when enabled, nothing is implemented yet");
  });
});

test("assertAmazonWriteAllowed is false by default", async () => {
  const saved = process.env.AMAZON_WRITE_SYNC_ENABLED;
  delete process.env.AMAZON_WRITE_SYNC_ENABLED;
  const originalQuery = db.query.bind(db);
  db.query = async () => ({ rows: [] });
  try {
    await assert.rejects(assertAmazonWriteAllowed({ operation: "inventory_update" }), (error) => error.code === "AMAZON_WRITE_DISABLED");
  } finally {
    db.query = originalQuery;
    if (saved === undefined) delete process.env.AMAZON_WRITE_SYNC_ENABLED;
    else process.env.AMAZON_WRITE_SYNC_ENABLED = saved;
  }
});

test("Amazon orders in the M1 orders table cannot be cancelled, edited, returned or shipped", async () => {
  await withEnvironment(async ({ base }) => {
    for (const [method, path] of [["POST", "/api/orders/500/cancel"], ["PATCH", "/api/orders/500"], ["POST", "/api/orders/500/return"], ["POST", "/api/orders/500/shipping/bosta/create"], ["DELETE", "/api/orders/500"], ["POST", "/api/orders/500/exchange"]]) {
      const response = await call(base, method, path, 4);
      assert.equal(response.status, 409, `${method} ${path}`);
      assert.equal((await response.json()).code, "MARKETPLACE_ORDER_LOCKED");
    }
    assert.equal((await call(base, "GET", "/api/orders/500", 4)).status, 200, "reading stays allowed");
    assert.equal((await call(base, "POST", "/api/orders/500/reprint-log", 4)).status, 200, "reprint log stays allowed");
    assert.equal((await call(base, "POST", "/api/orders/501/cancel", 4)).status, 200, "website orders are untouched");
    assert.equal((await call(base, "POST", "/api/orders/returns", 4)).status, 200, "non-numeric paths pass through");
  });
  assert.equal(isExternalMarketplaceOrder({ source: "Amazon" }), true);
  assert.equal(isExternalMarketplaceOrder({ source: "pos", channel: "pos" }), false);
});
