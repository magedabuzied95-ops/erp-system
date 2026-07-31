import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const eventsSource = fs.readFileSync(new URL("../src/storefront/lib/metaPixelEvents.js", import.meta.url), "utf8");
const attributionSource = fs.readFileSync(new URL("../src/shared/lib/metaBrowserAttribution.js", import.meta.url), "utf8");
const authSource = fs.readFileSync(new URL("../server/middleware/storefrontCustomerAuth.js", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("../server/routes/storefront.js", import.meta.url), "utf8");
const capiSource = fs.readFileSync(new URL("../server/services/metaConversionsApiService.js", import.meta.url), "utf8");

test("storefront CAPI event sends the signed-in customer authorization header", () => {
  assert.match(eventsSource, /storefrontCustomerRequest\("\/storefront\/meta\/events"/);
});

test("optional storefront authentication enriches Meta matching without blocking guests", () => {
  assert.match(routeSource, /router\.post\("\/meta\/events", storefrontCustomerTransitionAuth/);
  assert.match(routeSource, /authenticatedCustomer\.email/);
  assert.match(routeSource, /authenticatedCustomer\.phone/);
  assert.match(routeSource, /authenticatedNameParts/);
  assert.match(routeSource, /last_name: authenticatedNameParts\.slice\(1\)/);
});

test("storefront customer token resolves the canonical customer name", () => {
  assert.match(authSource, /SELECT name, phone, email, tenant_id/);
  assert.match(authSource, /name = customer\.name/);
});

test("browser ClickID is forwarded while guests are not assigned a fake customer external_id", () => {
  assert.match(attributionSource, /new URLSearchParams\(window\.location\.search\)\.get\("fbclid"\)/);
  assert.match(attributionSource, /fb\.1\.\$\{Date\.now\(\)\}\.\$\{fbclid\}/);
  assert.doesNotMatch(eventsSource, /META_VISITOR_ID_KEY|metaVisitorId/);
  assert.match(capiSource, /cookieValue\(req, "_fbc"\)/);
  assert.match(capiSource, /cookieValue\(req, "_fbp"\)/);
});

test("browser and server event paths share the exact event id for Meta deduplication", () => {
  assert.match(eventsSource, /window\.fbq\("track", eventName, browserPayload, \{ eventID: id \}\)/);
  assert.match(eventsSource, /sendCapi\(eventName, \{ \.\.\.eventPayload, event_source_url:/);
  assert.match(capiSource, /const metaEventId = text\(event\.event_id\)/);
  assert.match(capiSource, /event_id: metaEventId/);
});

test("Meta Test Events code is server-side and environment controlled", () => {
  assert.doesNotMatch(eventsSource, /VITE_META_TEST_EVENT_CODE|test_event_code/);
  assert.match(capiSource, /M1_META_TEST_EVENT_CODE \|\| process\.env\.META_TEST_EVENT_CODE/);
  assert.match(capiSource, /if \(isProduction\) return ""/);
});

test("CAPI tries the connected user token before page-token fallbacks", () => {
  assert.match(capiSource, /SELECT long_lived_user_token AS token, 1 AS priority/);
  assert.match(capiSource, /SELECT access_token_encrypted AS token, 2 AS priority/);
  assert.match(capiSource, /SELECT page_access_token AS token, 3 AS priority/);
  assert.match(capiSource, /for \(const token of tokens\)/);
});
