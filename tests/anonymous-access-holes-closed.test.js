/**
 * Three routes answered anyone on the internet (growth audit, 2026-09-14):
 *
 *   POST /api/auth/register        took role/role_id from the body and returned a token,
 *                                  so an anonymous caller could mint an Admin account
 *   POST /api/ai-agent/orders/*    created and confirmed orders at a price from the body
 *   /api/debug/*                   customer conversations, raw webhooks, DDL, Graph budget
 *
 * The router tests below mount the real routers and send real requests with no token.
 * The debug gate lives inline in server.js (importing it boots the whole server), so that
 * one is checked in source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const withRouter = async (mountPath, router, run) => {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}${mountPath}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const postJson = (url, body) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("an anonymous register call is refused before any account is written", async () => {
  const { default: authRoutes } = await import("../server/routes/auth.js");
  await withRouter("/api/auth", authRoutes, async (base) => {
    const res = await postJson(`${base}/register`, {
      name: "x",
      email: "anonymous-admin@example.invalid",
      password: "x",
      role: "Admin",
    });
    assert.equal(res.status, 401);
  });
});

test("anonymous AI order draft and confirm are refused", async () => {
  const { default: aiAgentOrderRoutes } = await import("../server/routes/aiAgentOrders.js");
  await withRouter("/api/ai-agent", aiAgentOrderRoutes, async (base) => {
    const draft = await postJson(`${base}/orders/draft`, { tenant_id: 1, unit_price: 1, product: { id: 1 } });
    assert.equal(draft.status, 401);
    const confirm = await postJson(`${base}/orders/confirm`, { tenant_id: 1, order_id: 1 });
    assert.equal(confirm.status, 401);
  });
});

test("every /api/debug route sits behind the admin gate, registered before the first one", async () => {
  const source = await read("../server/server.js");
  const gateAt = source.indexOf('app.use("/api/debug", (req, res, next) => {');
  assert.ok(gateAt > -1, "the /api/debug gate must exist");

  const gate = source.slice(gateAt, gateAt + 400);
  assert.match(gate, /protect\(req, res, \(\) => requireAdmin\(req, res, next\)\)/);

  const firstDebugRoute = source.search(/app\.(get|post|put|patch|delete|use)\("\/api\/debug\/[^"]/);
  assert.ok(firstDebugRoute > gateAt, "the gate must be registered before any /api/debug route");

  // The exemptions stay exactly these three; widening the list reopens the hole.
  assert.match(source, /const DEBUG_PATHS_WITH_OWN_GATE = \["\/pwa", "\/whatsapp\/", "\/display-refill-alerts"\];/);
});
