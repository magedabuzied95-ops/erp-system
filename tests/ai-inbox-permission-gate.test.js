import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { permissionSatisfies } from "../server/middleware/permissionMiddleware.js";

const routes = readFileSync("server/routes/aiAgentOrders.js", "utf8");
const middleware = readFileSync("server/middleware/permissionMiddleware.js", "utf8");
const matrix = readFileSync("src/modules/permissions/lib/rbacStore.js", "utf8");

// Route lines, without the gate helper definitions at the top of the file.
const routeLines = routes.split("\n").filter((line) => /^router\.(get|post|put|patch|delete)\(/.test(line));

const routePath = (line) => /^router\.[a-z]+\("([^"]+)"/.exec(line)?.[1] || "";

test("conversation routes no longer run on the settings permission", () => {
  // `settings` is what an administrator holds to reconfigure the shop. It was
  // also, until this change, what let anyone send a WhatsApp message as the
  // business. Conversation traffic must not be reachable through it.
  const leaked = routeLines
    .filter((line) => line.includes('permit("settings"'))
    .map(routePath)
    .filter((path) => /^\/(inbox|conversations|comments|social-comments|followups)/.test(path));

  assert.deepEqual(leaked, [], `these conversation routes still run on settings: ${leaked.join(", ")}`);
});

test("channel configuration deliberately stays on the settings permission", () => {
  // The other direction: an inbox agent must not inherit the ability to
  // repoint the WhatsApp credentials just because they can answer customers.
  const configured = routeLines
    .filter((line) => /^router\.[a-z]+\("\/(channels|settings)/.test(line))
    .filter((line) => line.includes("permit("));

  assert.ok(configured.length > 0, "expected channel/settings routes to exist");
  for (const line of configured) {
    assert.match(line, /permit\("settings"/, `${routePath(line)} must stay on settings`);
  }
});

test("every inbox gate is strict", () => {
  // A non-strict ai_inbox_messenger:view gate is decorative — see the alias
  // test below. If the helpers ever lose { strict: true }, reads reopen to
  // every role in the ERP without a single route line changing.
  const helpers = routes.match(/^const inbox(View|Reply) = \(\) => permit\([^;]+;$/gm) || [];
  assert.equal(helpers.length, 2, "expected the two inbox gate helpers");
  for (const helper of helpers) {
    assert.match(helper, /permit\("ai_inbox_messenger", "(view|reply)", \{ strict: true \}\)/);
  }
  // And nothing bypasses the helpers with a loose inline gate.
  assert.doesNotMatch(
    routes.replace(/^const inbox(View|Reply) = .*$/gm, ""),
    /permit\("ai_inbox_messenger"[^)]*\)(?!\s*,\s*\{ strict)/
  );
});

test("an unrelated view grant does not open the inbox", () => {
  // The legacy matcher intersected alias sets that both contained the bare
  // action "view", so any <module>:view satisfied any permit(..., "view") —
  // and dashboard:view is backfilled to every role. That is now the rollback
  // path only; see tests/permission-canonical-matching.test.js.
  assert.equal(permissionSatisfies("products", "view", "ai_inbox_messenger", "view", { legacy: true }), true);
  assert.equal(permissionSatisfies("dashboard", "view", "ai_inbox_messenger", "view", { legacy: true }), true);

  assert.equal(permissionSatisfies("products", "view", "ai_inbox_messenger", "view"), false);
  assert.equal(permissionSatisfies("dashboard", "view", "ai_inbox_messenger", "view"), false);
  assert.equal(permissionSatisfies("settings", "view", "ai_inbox_messenger", "view"), false);

  // The real grant still works.
  assert.equal(permissionSatisfies("ai_inbox_messenger", "view", "ai_inbox_messenger", "view"), true);
  assert.equal(permissionSatisfies("ai_inbox_messenger", "reply", "ai_inbox_messenger", "reply"), true);

  // view does not imply reply: reading the inbox is not permission to answer it.
  assert.equal(permissionSatisfies("ai_inbox_messenger", "view", "ai_inbox_messenger", "reply"), false);
});

test("the inbox gates opt out of the legacy rollback", () => {
  // PERMISSION_LEGACY_ALIASES restores loose matching everywhere it is not
  // explicitly refused. These two refuse it: the backfill already granted
  // ai_inbox_messenger to every role that could reach the inbox, so there is no
  // access for a rollback to restore — only message-sending to hand back to
  // every settings administrator.
  const routes = readFileSync("server/routes/aiAgentOrders.js", "utf8");
  assert.match(routes, /const inboxView = \(\) => permit\("ai_inbox_messenger", "view", \{ strict: true \}\)/);
  assert.match(routes, /const inboxReply = \(\) => permit\("ai_inbox_messenger", "reply", \{ strict: true \}\)/);
  assert.match(middleware, /const legacy = legacyAliasesEnabled\(\) && options\?\.strict !== true/);
});

test("the backfill preserves today's access exactly once", () => {
  // Gating on a permission nobody holds would revoke the inbox from every
  // non-admin role on deploy. The migration grants it from the settings
  // permission it replaced, and the sentinel stops a later revocation from
  // being undone on the next boot.
  assert.match(middleware, /source\.module = 'settings'/);
  assert.match(middleware, /target\.module = 'ai_inbox_messenger'/);
  assert.match(middleware, /CASE source\.action WHEN 'view' THEN 'view' ELSE 'reply' END/);
  assert.match(middleware, /permissions\.ai_inbox_messenger_backfilled/);

  const backfill = middleware.slice(
    middleware.indexOf("AI Inbox permission split"),
    middleware.indexOf("permissions.ai_inbox_messenger_backfilled', 'true'::jsonb")
  );
  assert.match(backfill, /NOT EXISTS \(\s*SELECT 1\s*FROM system_settings/, "backfill must be sentinel-guarded");
  assert.match(backfill, /NOT EXISTS \(\s*SELECT 1\s*FROM role_permissions existing/, "backfill must be idempotent");
});

test("the permission is grantable from the Roles screen", () => {
  // A gate that cannot be granted from the UI is a gate that gets worked around
  // by handing the user `settings` again.
  assert.match(matrix, /ai_inbox_messenger: \["view", "reply"\]/);
  assert.match(matrix, /\{ key: "ai_inbox_messenger", label: "AI Inbox" \}/);
});
