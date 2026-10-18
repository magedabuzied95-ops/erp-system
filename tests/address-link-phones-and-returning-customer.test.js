import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The /addr page (owner, 2026-10-18): the main number must be on WhatsApp, a second number is
// optional and reaches Bosta, and a returning customer's last address comes back when they type
// their number — but only from THIS conversation, because the page is public.

const service = fs.readFileSync(new URL("../server/services/conversationAddressRequestService.js", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../server/routes/publicAddressRequest.js", import.meta.url), "utf8");
const meta = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../src/storefront/pages/CustomerAddressPage.jsx", import.meta.url), "utf8");

test("localEgyptMobile reads every way a customer types a number", async () => {
  const { localEgyptMobile } = await import("../server/services/conversationAddressRequestService.js");
  assert.equal(localEgyptMobile("01024960585"), "01024960585");
  assert.equal(localEgyptMobile("+20 102 496 0585"), "01024960585");
  assert.equal(localEgyptMobile("00201024960585"), "01024960585");
  assert.equal(localEgyptMobile("٠١٠٢٤٩٦٠٥٨٥"), "01024960585");
  assert.equal(localEgyptMobile("0102496058"), "");
  assert.equal(localEgyptMobile("0221234567"), "");
});

test("the submit refuses a main number that is definitely not on WhatsApp, and keeps a second number", () => {
  assert.match(service, /if \(await mainPhoneHasWhatsapp\(customerPhone\) === false\) \{/);
  assert.match(service, /code: "ADDRESS_REQUEST_NOT_ON_WHATSAPP"/);
  assert.match(service, /\.\.\.\(secondaryPhoneKept \? \{ secondary_phone: secondaryPhoneKept \} : \{\}\)/);
  assert.match(meta, /customer_secondary_phone: text\(structuredAddress\?\.secondary_phone \|\| ""\)/);
});

test("the returning-customer lookup only reads this link's own conversation", () => {
  const lookup = service.slice(service.indexOf("export const lookupReturningCustomerAddress"));
  assert.ok(lookup.length > 0);
  // Earlier links: same session, never a phone-only search.
  assert.match(lookup, /AND session_id = \$2\s+AND status = 'submitted'/);
  // Orders: placed from this same conversation.
  assert.match(lookup, /WHERE ai_agent_conversation_id = \$1/);
  assert.doesNotMatch(lookup, /WHERE customer_phone =|WHERE regexp_replace\(customer_phone/);
  // And the number must match what that conversation used.
  assert.match(lookup, /sameMobile\(item\.customer_phone, local\)/);
  // Capped per IP on top.
  assert.match(route, /router\.get\("\/:code\/returning"/);
  assert.match(route, /if \(!allowLookup\(ipKey\)\) return res\.json\(\{ success: true, found: false, reason: "rate_limited" \}\);/);
});

test("the page checks WhatsApp, sends the second number and fills only empty fields", () => {
  assert.match(page, /\/storefront\/checkout\/whatsapp-check\?phone=/);
  assert.match(page, /secondary_phone: text\(secondaryPhone\)/);
  assert.match(page, /setStreetAddress\(\(current\) => text\(current\) \|\| text\(payload\.street_address\)\)/);
  assert.match(page, /if \(whatsappState === "missing"\) \{/);
});
