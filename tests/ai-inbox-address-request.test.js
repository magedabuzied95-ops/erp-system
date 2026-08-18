import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../server/services/conversationAddressRequestService.js", import.meta.url), "utf8");
const publicRoutes = readFileSync(new URL("../server/routes/publicAddressRequest.js", import.meta.url), "utf8");
const inboxRoutes = readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
const serverEntry = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
const appRoutes = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const publicPage = readFileSync(new URL("../src/storefront/pages/CustomerAddressPage.jsx", import.meta.url), "utf8");
const inbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaComposer = readFileSync(new URL("../src/modules/aiSupport/components/PwaOrderComposer.jsx", import.meta.url), "utf8");
const pwaInbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
const arLocale = readFileSync(new URL("../src/locales/ar/aiSupport.json", import.meta.url), "utf8");
const enLocale = readFileSync(new URL("../src/locales/en/aiSupport.json", import.meta.url), "utf8");

test("address-request service is allowlisted past the server/services gitignore", () => {
  assert.match(gitignore, /!server\/services\/conversationAddressRequestService\.js/);
});

test("public address-request routes exist and are mounted", () => {
  assert.match(publicRoutes, /router\.get\("\/:code"/);
  assert.match(publicRoutes, /router\.post\("\/:code\/submit"/);
  assert.match(serverEntry, /app\.use\("\/api\/public\/address-request", publicAddressRequestRoutes\)/);
});

test("the service validates the Bosta hierarchy before trusting anonymous ids", () => {
  assert.match(service, /FROM shipping_districts d/);
  assert.match(service, /JOIN shipping_zones z ON z\.id = d\.zone_id/);
  assert.match(service, /JOIN shipping_cities c ON c\.id = d\.city_id/);
  assert.match(service, /dropoff_available IS TRUE/);
  // One pending link per conversation is a DATABASE invariant, with the losing
  // side of a create race recovering the winner's row instead of erroring.
  assert.match(service, /conversation_address_requests_one_pending/);
  assert.match(service, /WHERE status = 'pending'\s*`\)/);
  assert.match(service, /23505/);
  // The thread note carries a request-keyed idempotency key so no retry or
  // race can duplicate it, and the phone is only ever masked.
  assert.match(service, /address-request-note:\$\{row\.id\}/);
  assert.match(service, /customer_phone_masked: maskPhone/);
  // The submit fans out: saved address, thread note, socket refresh.
  assert.match(service, /saveCustomerAddress\(\{ tenantId: row\.tenant_id/);
  assert.match(service, /appendManualAiSupportReply\(/);
  assert.match(service, /customer_address_submitted/);
});

test("the inbox exposes authenticated create/status endpoints for the link", () => {
  assert.match(inboxRoutes, /router\.post\("\/conversations\/:conversationId\/address-request"/);
  assert.match(inboxRoutes, /router\.get\("\/conversations\/:conversationId\/address-request"/);
  assert.match(inboxRoutes, /createAddressRequest\(\{/);
  assert.match(inboxRoutes, /getLatestAddressRequest\(\{/);
  // The 7s poll and the create button must never pay for a full inbox load:
  // the session resolves through one indexed read, with the slow
  // loadLeadConversationForAction kept only as the alias fallback.
  assert.match(inboxRoutes, /resolveAddressRequestSession/);
  assert.match(inboxRoutes, /SELECT session_id, channel FROM ai_support_sessions WHERE tenant_id = \$1 AND session_id = \$2 LIMIT 1/);
});

test("the public page is routed at /addr/:code and drives the Bosta pickers", () => {
  assert.match(appRoutes, /path="\/addr\/:code"/);
  assert.match(appRoutes, /CustomerAddressPage/);
  assert.match(publicPage, /\/public\/address-request\//);
  assert.match(publicPage, /\/shipping\/locations\/search\?provider=bosta/);
  assert.match(publicPage, /\/shipping\/cities\?provider=bosta&dropoff=1/);
  assert.match(publicPage, /street_address: text\(streetAddress\)/);
});

test("both order composers send the link through the chat and absorb the reply", () => {
  for (const source of [inbox, pwaComposer]) {
    assert.match(source, /address-request/);
    assert.match(source, /applyAddressRequest/);
    assert.match(source, /addressLinkBusy/);
    assert.match(source, /aiSupport\.inbox\.order\.addressLinkSend/);
    assert.match(source, /aiSupport\.inbox\.order\.addressLinkUse/);
  }
  // The link message travels through the existing manual send path.
  assert.match(inbox, /onSendMessage=\{sendManualReply\}/);
  assert.match(pwaInbox, /onSendMessage=\{sendManualReply\}/);
  // Auto-fill fires only on the pending→submitted transition seen while open.
  assert.match(inbox, /previous\?\.status === "pending"/);
  assert.match(pwaComposer, /previous\?\.status === "pending"/);
});

test("address-link locale keys exist in both dictionaries", () => {
  for (const key of ["addressLinkHint", "addressLinkSend", "addressLinkResend", "addressLinkPending", "addressLinkSubmitted", "addressLinkUse"]) {
    assert.match(arLocale, new RegExp(`"${key}"`));
    assert.match(enLocale, new RegExp(`"${key}"`));
  }
});
