import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PRIVACY_MODE_RESTRICTED,
  conversationPrivacyClauseSql,
  decorateConversationsWithPrivacy,
  getConversationPrivacy,
  hiddenKeysAreEmpty,
  customerPhoneKeysForIdentifier,
  invalidateConversationPrivacyCache,
  isConversationVisibleToViewer,
  isCustomerVisibleToViewer,
  loadHiddenKeysForViewer,
  resetConversationPrivacySchemaForTests,
  resetCustomerPhoneColumnsForTests,
  setConversationPrivacy,
  tenantUsesConversationPrivacy,
} from "../server/modules/aiInboxPrivacy/conversationPrivacy.js";
import {
  conversationIdFromPath,
  customerIdentifierFromPath,
  runAiInboxPrivacyBoundary,
} from "../server/modules/aiInboxPrivacy/aiInboxPrivacyBoundary.js";
import { notifyPortalInboxEmployees } from "../server/modules/aiInboxPortal/portalInboxPush.js";

// Conversation privacy: the owner hides a thread from every employee, or names the
// few who may see it. The rule has to hold in THREE places — the inbox list, every
// conversation route, and the portal push — so each one is pinned here.

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// `whatsapp:201068005338` → canonical phone key 1068005338.
const PRIVATE = {
  id: 7,
  phone_key: "1068005338",
  external_key: "",
  session_key: "whatsapp:201068005338",
  customer_label: "صاحب المحل",
  employee_ids: [3],
};

const fakeDb = (rows = [PRIVATE], identity = null) => {
  const calls = [];
  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.startsWith("CREATE") || sql.startsWith("ALTER")) return { rows: [] };
      if (sql.includes("FROM ai_conversation_privacy pr")) {
        return { rows: rows.map((row) => ({ ...row, employee_ids: row.employee_ids || [] })) };
      }
      if (sql.includes("FROM ai_support_sessions s")) {
        return { rows: identity ? [identity] : [] };
      }
      if (sql.startsWith("DELETE") || sql.startsWith("UPDATE") || sql.startsWith("INSERT")) {
        return { rows: [{ id: 7 }] };
      }
      return { rows: [] };
    },
  };
  return { client, calls };
};

const session = (sessionId = "whatsapp:201068005338") => ({
  session_id: sessionId,
  channel: "whatsapp",
  external_customer_id: "",
  profile_phone: "01068005338",
  label: "صاحب المحل",
});

test.beforeEach(() => {
  resetConversationPrivacySchemaForTests();
  invalidateConversationPrivacyCache();
});

test("a shop that hides nothing pays nothing: no keys, no SQL clause", async () => {
  const { client } = fakeDb([]);
  assert.equal(await tenantUsesConversationPrivacy({ tenantId: 1, client }), false);
  const keys = await loadHiddenKeysForViewer({ tenantId: 1, employeeId: 3, client });
  assert.equal(hiddenKeysAreEmpty(keys), true);
});

test("an admin is never filtered; a listed employee is not, an unlisted one is", async () => {
  const { client } = fakeDb();
  assert.equal(hiddenKeysAreEmpty(await loadHiddenKeysForViewer({ tenantId: 1, isAdmin: true, client })), true);

  invalidateConversationPrivacyCache();
  const allowed = await loadHiddenKeysForViewer({ tenantId: 1, employeeId: 3, client });
  assert.equal(hiddenKeysAreEmpty(allowed), true, "employee 3 is on the allowlist");

  invalidateConversationPrivacyCache();
  const blocked = await loadHiddenKeysForViewer({ tenantId: 1, employeeId: 9, client });
  assert.deepEqual(blocked.phones, ["1068005338"]);
  assert.deepEqual(blocked.sessions, ["whatsapp:201068005338"]);
});

test("a viewer with no employee identity is nobody, so the thread stays hidden", async () => {
  const { client } = fakeDb();
  const keys = await loadHiddenKeysForViewer({ tenantId: 1, employeeId: null, client });
  assert.equal(hiddenKeysAreEmpty(keys), false, "fail closed: an unknown viewer sees less, never more");
});

test("the list clause matches the phone, the channel id and the session id", () => {
  const sql = conversationPrivacyClauseSql({ phonesIdx: "$4", externalsIdx: "$5", sessionsIdx: "$6" });
  assert.match(sql, /^NOT \(/);
  assert.match(sql, /p\.phone/, "the customer profile phone");
  assert.match(sql, /s\.session_id LIKE 'whatsapp:%'/, "the phone a WhatsApp thread is named after");
  assert.match(sql, /c\.external_customer_id = ANY\(\$5::text\[\]\)/);
  assert.match(sql, /s\.session_id = ANY\(\$6::text\[\]\)/);
  // Reusing a parameter in a list without a cast lets Postgres deduce its type
  // from the first use only.
  for (const index of ["$4", "$5", "$6"]) {
    assert.ok(sql.includes(`${index}::text[]`), `${index} is cast on use`);
  }
});

test("the inbox list applies the clause even to a targeted sessionKeys lookup", () => {
  const code = source("../server/services/aiSalesAgentService.js");
  const at = code.indexOf("if (!hiddenKeysAreEmpty(hiddenKeys))");
  assert.ok(at > 0, "loadAiInbox pushes the privacy clause");
  const block = code.slice(at, at + 700);
  assert.ok(
    !/sessionKeyList\.length/.test(block),
    "privacy must NOT be skipped for targeted lookups the way deleted_at is, or an id typed by hand opens the thread"
  );
  assert.match(block, /conversationPrivacyClauseSql/);
});

test("the boundary reads the conversation id out of every route shape", () => {
  assert.equal(conversationIdFromPath("/api/ai-inbox/conversations/whatsapp%3A201068005338/messages"), "whatsapp:201068005338");
  assert.equal(conversationIdFromPath("/api/ai-agent/inbox/abc/private-message"), "abc");
  assert.equal(conversationIdFromPath("/api/ai-inbox/conversations/abc/send?x=1"), "abc");
  assert.equal(conversationIdFromPath("/api/ai-inbox/conversations/read-all"), "", "a collection action is not an id");
  assert.equal(conversationIdFromPath("/api/ai-inbox/conversations"), "");
  assert.equal(conversationIdFromPath("/api/orders/9"), "");
});

const runBoundary = async (overrides = {}, path = "/api/ai-inbox/conversations/whatsapp%3A201068005338/send", method = "POST") => {
  const req = { headers: { authorization: "Bearer token" }, originalUrl: path, method, body: {} };
  const result = { next: false, status: null, body: null };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await runAiInboxPrivacyBoundary(req, res, () => { result.next = true; }, {
    verify: () => ({ id: 1, tenant_id: 1, role: "cashier" }),
    usesPrivacy: async () => true,
    resolveViewer: async () => ({ isAdmin: false, employeeId: 9 }),
    isVisible: async () => false,
    ...overrides,
  });
  return result;
};

test("a route on a private conversation answers 403 for the wrong viewer", async () => {
  const denied = await runBoundary();
  assert.equal(denied.next, false);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "CONVERSATION_PRIVATE");
});

test("the boundary lets the admin, the named employee and every other route through", async () => {
  assert.equal((await runBoundary({ resolveViewer: async () => ({ isAdmin: true }) })).next, true);
  assert.equal((await runBoundary({ isVisible: async () => true })).next, true);
  assert.equal((await runBoundary({}, "/api/ai-inbox/conversations")).next, true);
  assert.equal((await runBoundary({}, "/api/orders/9")).next, true);
  assert.equal((await runBoundary({ usesPrivacy: async () => false })).next, true, "a shop that hides nothing is never checked");
  assert.equal((await runBoundary({ verify: () => { throw new Error("bad token"); } })).next, true, "protect owns the 401");
});

test("the conversation id in a request BODY is checked too", async () => {
  const req = {
    headers: { authorization: "Bearer token" },
    originalUrl: "/api/ai-inbox/orders/draft",
    method: "POST",
    body: { conversation_id: "whatsapp:201068005338" },
  };
  const result = { next: false, status: null };
  const res = { status(code) { result.status = code; return this; }, json() { return this; } };
  await runAiInboxPrivacyBoundary(req, res, () => { result.next = true; }, {
    verify: () => ({ id: 1, tenant_id: 1 }),
    usesPrivacy: async () => true,
    resolveViewer: async () => ({ isAdmin: false, employeeId: 9 }),
    isVisible: async () => false,
  });
  assert.equal(result.status, 403);
});

test("visibility is decided by the customer's identity, not by the session row", async () => {
  // A second session for the same human (another channel, or a rebuilt id) carries
  // the same phone, so it is hidden without the owner touching it again.
  const { client } = fakeDb([PRIVATE], { ...session("instagram:17841400000000000"), profile_phone: "+201068005338", channel: "instagram" });
  assert.equal(
    await isConversationVisibleToViewer({ tenantId: 1, conversationId: "instagram:17841400000000000", employeeId: 9, client }),
    false
  );
  invalidateConversationPrivacyCache();
  assert.equal(
    await isConversationVisibleToViewer({ tenantId: 1, conversationId: "instagram:17841400000000000", employeeId: 3, client }),
    true,
    "the named employee still sees it on the other channel"
  );
});

test("an id that resolves to no conversation is not treated as private", async () => {
  const { client } = fakeDb([PRIVATE], null);
  assert.equal(await isConversationVisibleToViewer({ tenantId: 1, conversationId: "nope", employeeId: 9, client }), true);
});

test("hiding from everyone is an empty allowlist, and clearing it deletes the row", async () => {
  const { client, calls } = fakeDb([], session());
  const hidden = await setConversationPrivacy({ tenantId: 1, conversationId: "whatsapp:201068005338", mode: "restricted", employeeIds: [], client });
  assert.equal(hidden.mode, PRIVACY_MODE_RESTRICTED);
  assert.deepEqual(hidden.employee_ids, []);
  assert.equal(hidden.identity.phoneKey, "1068005338", "the row is keyed on the customer");

  const cleared = await setConversationPrivacy({ tenantId: 1, conversationId: "whatsapp:201068005338", mode: "everyone", client });
  assert.equal(cleared.mode, "everyone");
  assert.ok(calls.some(({ sql }) => sql.startsWith("DELETE FROM ai_conversation_privacy\n")), "going public removes the rule");
});

test("the owner's list is tagged so the lock on the card shows the real state", async () => {
  const { client } = fakeDb();
  const list = await decorateConversationsWithPrivacy({
    tenantId: 1,
    conversations: [{ session_id: "whatsapp:201068005338" }, { session_id: "whatsapp:201111111111" }],
    client,
  });
  assert.equal(list[0].privacy_mode, PRIVACY_MODE_RESTRICTED);
  assert.equal(list[0].privacy_viewer_count, 1);
  assert.equal(list[1].privacy_mode, "everyone");
});

test("reading the rule back tells the owner which mode the sheet should open in", async () => {
  const { client } = fakeDb([PRIVATE], session());
  const privacy = await getConversationPrivacy({ tenantId: 1, conversationId: "whatsapp:201068005338", client });
  assert.equal(privacy.mode, PRIVACY_MODE_RESTRICTED);
  assert.deepEqual(privacy.employee_ids, [3]);
});

test("the portal push skips the phones that may not open the thread", async () => {
  const sent = [];
  const employees = [{ id: 3, tenant_id: 1, employee_portal_token: "t3" }, { id: 9, tenant_id: 1, employee_portal_token: "t9" }];
  const client = {
    query: async (sql) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ ok: 1 }] };
      if (sql.includes("FROM employees")) return { rows: employees };
      if (sql.includes("FROM ai_conversation_privacy pr")) return { rows: [{ ...PRIVATE, employee_ids: [3] }] };
      if (sql.includes("FROM ai_support_sessions s")) return { rows: [session()] };
      return { rows: [] };
    },
  };
  const result = await notifyPortalInboxEmployees({
    tenantId: 1,
    sessionId: "whatsapp:201068005338",
    message: { customer_message: "عايز أشتري" },
    channel: "whatsapp",
    client,
    send: async ({ employeeId }) => { sent.push(employeeId); return { sent: 1 }; },
  });
  assert.deepEqual(sent, [3], "only the employee the owner allowed is notified");
  assert.equal(result.blocked, 1);
});

test("the portal inbox boundary keeps the privacy endpoints away from a portal session", () => {
  const code = source("../server/modules/aiInboxPortal/portalInboxBoundary.js");
  assert.match(code, /privacy\|conversation-privacy/, "the allowlist denies them outright, on top of the admin gate");
});

test("mark-all-read cannot clear the unread badge on a thread it cannot see", () => {
  const code = source("../server/services/aiSupportLogService.js");
  const at = code.indexOf("export const markAllAiSupportConversationsRead");
  const block = code.slice(at, at + 3000);
  assert.match(block, /excludeSessionIds/);
  assert.match(block, /AND NOT \(s\.session_id = ANY\(\$4::text\[\]\)\)/);
  assert.match(block, /safeExcludedPhoneKeys/);
});

// --- the second half: the customer behind the thread ---------------------------
// Closing the conversation while leaving its customer open publishes the name, the
// spend and the order history — most of what the thread would have shown.

test("a bare phone where a session id goes resolves to the same customer", async () => {
  // /ai-agent/conversations/<phone>/orders is a real route shape: the orders panel
  // sends the phone when it has no session id.
  const seen = [];
  const client = {
    query: async (sql, params = []) => {
      seen.push({ sql, params });
      if (sql.includes("FROM ai_conversation_privacy pr")) return { rows: [{ ...PRIVATE, employee_ids: [3] }] };
      if (sql.includes("FROM ai_support_sessions s")) return { rows: [session()] };
      return { rows: [] };
    },
  };
  assert.equal(
    await isConversationVisibleToViewer({ tenantId: 1, conversationId: "01068005338", employeeId: 9, client }),
    false
  );
  const lookup = seen.find(({ sql }) => sql.includes("FROM ai_support_sessions s"));
  assert.equal(lookup.params[2], "1068005338", "the phone is canonicalised before it reaches SQL");
  assert.match(lookup.sql, /s\.session_id LIKE 'whatsapp:%'/);
});

test("a row id is not mistaken for a phone", async () => {
  resetCustomerPhoneColumnsForTests();
  const client = {
    query: async (sql) => {
      if (sql.includes("FROM ai_conversation_privacy pr")) return { rows: [{ ...PRIVATE, employee_ids: [3] }] };
      if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "phone" }] };
      if (sql.includes("FROM customers")) return { rows: [{ phone: "" }] };
      return { rows: [] };
    },
  };
  const keys = await customerPhoneKeysForIdentifier({ tenantId: 1, identifier: "42", client });
  assert.deepEqual(keys, [], "customer #42 is a row id, not the number 42");
});

test("the customer profile of a hidden thread is closed to the same people", async () => {
  resetCustomerPhoneColumnsForTests();
  const client = {
    query: async (sql) => {
      if (sql.includes("FROM ai_conversation_privacy pr")) return { rows: [{ ...PRIVATE, employee_ids: [3] }] };
      if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "phone" }, { column_name: "whatsapp" }] };
      if (sql.includes("FROM customers")) return { rows: [{ phone: "01068005338", whatsapp: "" }] };
      return { rows: [] };
    },
  };
  // By row id, and by the phone itself.
  assert.equal(await isCustomerVisibleToViewer({ tenantId: 1, identifier: "512", employeeId: 9, client }), false);
  invalidateConversationPrivacyCache();
  assert.equal(await isCustomerVisibleToViewer({ tenantId: 1, identifier: "+201068005338", employeeId: 9, client }), false);
  invalidateConversationPrivacyCache();
  assert.equal(await isCustomerVisibleToViewer({ tenantId: 1, identifier: "512", employeeId: 3, client }), true, "the named employee keeps it");
  invalidateConversationPrivacyCache();
  assert.equal(await isCustomerVisibleToViewer({ tenantId: 1, identifier: "512", isAdmin: true, client }), true);
});

test("an ordinary customer's profile is untouched", async () => {
  resetCustomerPhoneColumnsForTests();
  const client = {
    query: async (sql) => {
      if (sql.includes("FROM ai_conversation_privacy pr")) return { rows: [{ ...PRIVATE, employee_ids: [3] }] };
      if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "phone" }] };
      if (sql.includes("FROM customers")) return { rows: [{ phone: "01111111111" }] };
      return { rows: [] };
    },
  };
  assert.equal(await isCustomerVisibleToViewer({ tenantId: 1, identifier: "900", employeeId: 9, client }), true);
});

test("the boundary reaches the customer profile route, and nothing else under /customers", () => {
  assert.equal(customerIdentifierFromPath("/api/customers/512/profile"), "512");
  assert.equal(customerIdentifierFromPath("/api/customers/%2B201068005338/profile?x=1"), "+201068005338");
  assert.equal(customerIdentifierFromPath("/api/customers/512"), "", "the customers list and record stay operational");
  assert.equal(customerIdentifierFromPath("/api/customers/512/orders"), "");
  assert.equal(customerIdentifierFromPath("/api/orders/512/profile"), "");
});

test("the customer profile of a hidden thread answers 403 through the boundary", async () => {
  const req = { headers: { authorization: "Bearer token" }, originalUrl: "/api/customers/512/profile", method: "GET", body: {} };
  const result = { next: false, status: null, body: null };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await runAiInboxPrivacyBoundary(req, res, () => { result.next = true; }, {
    verify: () => ({ id: 1, tenant_id: 1 }),
    usesPrivacy: async () => true,
    resolveViewer: async () => ({ isAdmin: false, employeeId: 9 }),
    isVisible: async () => { throw new Error("the conversation check must not run for a customer path"); },
    isCustomerVisible: async () => false,
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "CONVERSATION_PRIVATE");
});
