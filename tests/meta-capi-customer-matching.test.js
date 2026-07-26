import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const eventsSource = fs.readFileSync(new URL("../src/storefront/lib/metaPixelEvents.js", import.meta.url), "utf8");
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

test("browser ClickID and stable visitor identity are forwarded to CAPI", () => {
  assert.match(eventsSource, /new URLSearchParams\(window\.location\.search\)\.get\("fbclid"\)/);
  assert.match(eventsSource, /fb\.1\.\$\{Date\.now\(\)\}\.\$\{fbclid\}/);
  assert.match(eventsSource, /META_VISITOR_ID_KEY/);
  assert.match(capiSource, /text\(event\.fbc\) \|\| cookieValue\(req, "_fbc"\)/);
  assert.match(capiSource, /text\(event\.fbp\) \|\| cookieValue\(req, "_fbp"\)/);
});
