import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import jwt from "jsonwebtoken";

import {
  PORTAL_INBOX_PERMISSIONS,
  employeePortalInboxEnabled,
  mintPortalInboxSession,
  portalTokenFingerprint,
  resetPortalInboxColumnCacheForTests,
  setEmployeePortalInboxAccess,
} from "../server/modules/aiInboxPortal/portalInboxAccess.js";
import { portalInboxApiBoundary, portalInboxPathAllowed } from "../server/modules/aiInboxPortal/portalInboxBoundary.js";

// الرسائل in the employee portal: AI Inbox messages for switched-on employees, and
// never the comments. The boundary is the only thing standing between a borrowed
// inbox session and the rest of the ERP, so its allowlist is pinned here.

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the portal session reaches the message routes", () => {
  for (const [method, path] of [
    ["GET", "/api/ai-inbox/conversations?channel_filter=whatsapp&limit=40"],
    ["GET", "/api/ai-inbox/conversations/whatsapp%3A123/messages"],
    ["POST", "/api/ai-inbox/conversations/abc/send"],
    ["POST", "/api/ai-inbox/conversations/abc/attachment"],
    ["POST", "/api/ai-inbox/conversations/abc/product-card/send"],
    ["POST", "/api/ai-inbox/conversations/abc/create-draft-order"],
    ["POST", "/api/ai-inbox/conversations/read-all"],
    ["PATCH", "/api/ai-agent/inbox/abc/favorite"],
    ["GET", "/api/ai-inbox/quick-replies"],
    ["GET", "/api/products/with-variants"],
    ["GET", "/api/products/pos-catalog-version"],
    ["GET", "/api/shipping/cities"],
    ["GET", "/api/customers/55/profile"],
  ]) {
    assert.equal(portalInboxPathAllowed(method, path), true, `${method} ${path}`);
  }
});

test("comments, settings and the rest of the ERP stay closed to it", () => {
  for (const [method, path] of [
    ["GET", "/api/social-comments/fast-list"],
    ["GET", "/api/social-comments/posts/1/comments"],
    ["POST", "/api/ai-inbox/comments/9/reply"],
    ["POST", "/api/ai-agent/comments/9/private-message"],
    ["POST", "/api/ai-agent/inbox/abc/private-message"],
    ["GET", "/api/ai-agent/settings/ai-assistant-global"],
    ["GET", "/api/ai-agent/channel-accounts"],
    ["POST", "/api/ai-inbox/sync-meta-conversations"],
    ["POST", "/api/ai-inbox/quick-replies"],
    ["GET", "/api/ai-inbox/conversations/abc/ai-debug"],
    ["POST", "/api/ai-inbox/conversations/abc/force-send-last-ai-reply"],
    ["POST", "/api/products"],
    ["GET", "/api/orders"],
    ["GET", "/api/users"],
    ["GET", "/api/employees"],
    ["GET", "/api/whatsapp/status"],
  ]) {
    assert.equal(portalInboxPathAllowed(method, path), false, `${method} ${path}`);
  }
});

const runBoundary = async (token, originalUrl, method = "GET") => {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, originalUrl, method };
  const result = { next: false, status: null, body: null };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await portalInboxApiBoundary(req, res, () => { result.next = true; });
  return result;
};

test("the boundary leaves staff sessions alone and fences portal sessions in", async () => {
  const secret = process.env.JWT_SECRET || "SECRET_KEY";
  const staff = jwt.sign({ id: 1, role: "admin", tenant_id: 1 }, secret);
  assert.equal((await runBoundary(staff, "/api/orders")).next, true);
  assert.equal((await runBoundary("", "/api/orders")).next, true);

  const portal = jwt.sign({ id: 44, role: "portal_inbox", tenant_id: 1, portal_inbox_employee_id: 5, portal_token_fp: "x" }, secret);
  const denied = await runBoundary(portal, "/api/social-comments/fast-list");
  assert.equal(denied.next, false);
  assert.equal(denied.status, 403);
  assert.equal((await runBoundary(portal, "/api/orders")).status, 403);
});

const fakeDb = ({ enabled = false, existingUserId = null } = {}) => {
  const calls = [];
  const state = { enabled, userActive: null, insertedUser: null, columns: false };
  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns") && sql.includes("employees")) return { rows: [{ count: state.columns ? 2 : 0 }] };
      if (sql.includes("information_schema.columns")) return { rows: [] };
      if (sql.startsWith("ALTER TABLE")) { state.columns = true; return { rows: [] }; }
      if (sql.startsWith("SELECT portal_inbox_enabled")) return { rows: [{ enabled: state.enabled }] };
      if (sql.includes("FROM employees") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: 5, tenant_id: 1, full_name: "Mona", portal_inbox_user_id: existingUserId }] };
      }
      if (sql.startsWith("INSERT INTO roles")) return { rows: [{ id: 9 }] };
      if (sql.startsWith("INSERT INTO permissions")) return { rows: [{ id: calls.length }] };
      if (sql.startsWith("SELECT id FROM users")) return { rows: [] };
      if (sql.startsWith("INSERT INTO users")) { state.insertedUser = params; return { rows: [{ id: 44 }] }; }
      if (sql.startsWith("UPDATE users SET is_active = FALSE")) { state.userActive = false; return { rows: [] }; }
      if (sql.startsWith("UPDATE employees SET portal_inbox_enabled")) { state.enabled = params[0]; return { rows: [] }; }
      return { rows: [] };
    },
  };
  return { client, calls, state };
};

test("the switch reads 'off' without DDL; switching on creates an inbox-only user, off deactivates it", async () => {
  resetPortalInboxColumnCacheForTests();
  const { client, calls, state } = fakeDb();
  assert.equal(await employeePortalInboxEnabled({ employeeId: 5, tenantId: 1, client }), false);
  assert.ok(!calls.some(({ sql }) => sql.startsWith("ALTER")), "a portal read must never run DDL");

  await setEmployeePortalInboxAccess({ employeeId: 5, tenantId: 1, enabled: true, client });
  assert.equal(state.enabled, true);
  assert.ok(state.insertedUser, "a hidden user is created for the employee");
  assert.match(String(state.insertedUser[3]), /^portal-inbox-5@employee-portal\.invalid$/);
  const selectEmployee = calls.find(({ sql }) => sql.includes("FROM employees") && sql.includes("FOR UPDATE"));
  assert.match(selectEmployee.sql, /tenant_id = \$2::bigint/, "an admin can only switch employees of their own shop");

  const granted = PORTAL_INBOX_PERMISSIONS.map(([module, action]) => `${module}.${action}`);
  assert.ok(granted.includes("ai_inbox_messenger.reply"));
  assert.ok(!granted.some((key) => /settings|social|comment|orders|employees/.test(key)), `role grants only inbox reads/replies: ${granted}`);

  const { client: offClient, state: offState } = fakeDb({ enabled: true, existingUserId: 44 });
  await setEmployeePortalInboxAccess({ employeeId: 5, tenantId: 1, enabled: false, client: offClient });
  assert.equal(offState.enabled, false);
  assert.equal(offState.userActive, false, "closing the switch deactivates the user, which protect checks per request");
});

test("a session is minted only for a switched-on employee and is bound to the portal link", async () => {
  resetPortalInboxColumnCacheForTests();
  const off = fakeDb({ enabled: false });
  off.state.columns = true;
  await assert.rejects(
    mintPortalInboxSession({ employee: { id: 5, tenant_id: 1 }, portalToken: "link", client: off.client }),
    (error) => error.status === 403 && error.code === "PORTAL_INBOX_DISABLED"
  );

  resetPortalInboxColumnCacheForTests();
  const on = fakeDb({ enabled: true, existingUserId: null });
  on.state.columns = true;
  const session = await mintPortalInboxSession({ employee: { id: 5, tenant_id: 1, full_name: "Mona" }, portalToken: "link", client: on.client });
  const claims = jwt.verify(session.token, process.env.JWT_SECRET || "SECRET_KEY");
  assert.equal(claims.id, 44);
  assert.equal(claims.role, "portal_inbox");
  assert.equal(claims.portal_inbox_employee_id, 5);
  assert.equal(claims.portal_token_fp, portalTokenFingerprint("link"));
  assert.ok(!claims.type && !claims.scope, "must still pass isStaffSessionToken");
  assert.ok(!session.user.permissions.some((key) => /settings|comment/.test(key)));
});

test("wiring: boundary mounted before the routes, login refuses the role, portal PWA drops comments", () => {
  const server = source("../server/server.js");
  assert.ok(server.indexOf("app.use(portalInboxApiBoundary)") > 0);
  assert.ok(server.indexOf("app.use(portalInboxApiBoundary)") < server.indexOf('app.use("/api/ai-inbox"'));

  const auth = source("../server/controllers/authController.js");
  assert.match(auth, /isPortalInboxRole\(getRoleName\(user\)\)/);

  const pwa = source("../src/modules/aiSupport/pages/AiInboxPwa.jsx");
  const navBlock = pwa.slice(pwa.indexOf("const PORTAL_NAV_ITEMS"), pwa.indexOf("];", pwa.indexOf("const PORTAL_NAV_ITEMS")));
  assert.ok(navBlock.length > 0);
  assert.doesNotMatch(navBlock, /social_comments|config|"more"/);
  assert.match(pwa, /isSocialMode && !portalMode \?/);
  assert.match(pwa, /onReplyComment=\{portalMode \? null : sendLeadCommentReply\}/);
});

import {
  buildPortalInboxPush,
  invalidatePortalInboxPushRecipients,
  isCommentThreadMessage,
  notifyPortalInboxEmployees,
} from "../server/modules/aiInboxPortal/portalInboxPush.js";

test("push: a customer message rings each switched-on employee in their portal; comments never do", async () => {
  invalidatePortalInboxPushRecipients();
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("information_schema.columns")) return { rows: [{ "?column?": 1 }] };
      return { rows: [{ id: "8", tenant_id: "1", employee_portal_token: "abc123" }] };
    },
  };
  const sends = [];
  const send = async (args) => { sends.push(args); return { sent: 1 }; };
  const message = { id: 91, sender_type: "customer", customer_name: "Hana", customer_message: "عندك مقاس 42؟" };

  const result = await notifyPortalInboxEmployees({ tenantId: 1, sessionId: "whatsapp:2010", message, channel: "whatsapp", client, send });
  assert.equal(result.sent, 1);
  assert.equal(sends[0].employeeId, 8);
  assert.equal(sends[0].persist, false, "a chat message must not fill the portal bell list");
  assert.equal(sends[0].url, "/employee-app/abc123/inbox/whatsapp%3A2010");
  assert.match(sends[0].tag, /^[A-Za-z0-9_-]{1,32}$/, "the tag becomes the push Topic header");
  assert.equal(sends[0].title, "Hana · واتساب");
  const listQuery = queries.find(({ sql }) => sql.includes("portal_inbox_enabled = TRUE"));
  assert.match(listQuery.sql, /tenant_id = \$1::bigint/);

  sends.length = 0;
  for (const [sessionId, extra] of [
    ["facebook_post:123_456", {}],
    ["social_comment:instagram:77", {}],
    ["facebook_messenger:1", { comment_id: "c1" }],
    ["facebook_messenger:1", { thread_kind: "comment" }],
  ]) {
    const skipped = await notifyPortalInboxEmployees({ tenantId: 1, sessionId, message: { ...message, ...extra }, client, send });
    assert.equal(skipped.reason, "comment", sessionId);
  }
  assert.equal(sends.length, 0);
  assert.equal((await notifyPortalInboxEmployees({ tenantId: null, sessionId: "whatsapp:1", message, client, send })).reason, "no-tenant");
  assert.equal(isCommentThreadMessage({ sessionId: "instagram:55", message }), false);
  assert.equal(buildPortalInboxPush({ employee: { employee_portal_token: "t" }, sessionId: "", message: {} }).body, "رسالة جديدة");
});

test("push wiring: the inbox push hands off to the portal after its dedupe; the admin toggle refreshes recipients", () => {
  const service = source("../server/services/aiInboxPushService.js");
  const dedupeAt = service.indexOf("if (alreadyPushed(dedupeKey))");
  const portalAt = service.indexOf("notifyPortalInboxEmployees(");
  assert.ok(dedupeAt > 0 && portalAt > dedupeAt, "portal push must come after the duplicate guard");
  const routes = source("../server/routes/employees.js");
  const block = routes.slice(routes.indexOf('router.patch("/:employeeId/portal-inbox-access"'));
  assert.ok(block.indexOf("invalidatePortalInboxPushRecipients()") > 0);
});
