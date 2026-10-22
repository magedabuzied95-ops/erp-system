import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMetaAdvancedMatching,
  normalizeMetaCustomer,
  normalizeMetaEgyptPhone,
} from "../shared/metaEventMatching.js";
import {
  buildHashedMetaUserData,
  sha256MetaValue,
  uniqueMetaAccessTokens,
} from "../server/services/metaConversionsApiService.js";
import { buildMetaEventPayload, purchaseEventId } from "../src/storefront/lib/metaPixelEventPayload.js";

test("Egyptian phones normalize to Meta international format", () => {
  for (const input of ["010 1234 5678", "+20 10 1234 5678", "00201012345678", "١٠١٢٣٤٥٦٧٨"]) {
    assert.equal(normalizeMetaEgyptPhone(input), "201012345678");
  }
  assert.equal(normalizeMetaEgyptPhone("123"), "");
  assert.equal(normalizeMetaEgyptPhone("00000000000"), "");
});

test("advanced matching normalizes real customer data and drops empty values", () => {
  assert.deepEqual(
    buildMetaAdvancedMatching({
      id: 77,
      email: "  USER@Example.COM ",
      phone: "011 2345 6789",
      full_name: "  Ahmed   Ali ",
      city: " Cairo ",
      governorate: " Giza ",
    }),
    {
      em: "user@example.com",
      ph: "201123456789",
      fn: "ahmed",
      ln: "ali",
      ct: "cairo",
      st: "giza",
      country: "eg",
      external_id: "77",
    }
  );
  assert.deepEqual(buildMetaAdvancedMatching({}), {});
});

test("CAPI hashes PII only after normalization and leaves browser/network identifiers unhashed", () => {
  const req = {
    ip: "203.0.113.9",
    socket: { remoteAddress: "10.0.0.5" },
    headers: {
      "user-agent": "Browser Agent",
      cookie: "_fbp=fb.1.123.abc; _fbc=fb.1.456.click",
    },
  };
  const userData = buildHashedMetaUserData({
    req,
    event: {
      email: " USER@Example.COM ",
      phone: "010 1234 5678",
      first_name: " Ahmed ",
      last_name: " Ali ",
      city: " Cairo ",
      state: " Giza ",
      country: "eg",
      external_id: "77",
    },
  });
  assert.deepEqual(userData.em, [sha256MetaValue("user@example.com")]);
  assert.deepEqual(userData.ph, [sha256MetaValue("201012345678")]);
  assert.deepEqual(userData.ct, [sha256MetaValue("cairo")]);
  assert.deepEqual(userData.st, [sha256MetaValue("giza")]);
  assert.deepEqual(userData.country, [sha256MetaValue("eg")]);
  assert.deepEqual(userData.external_id, [sha256MetaValue("77")]);
  assert.equal(userData.client_ip_address, "203.0.113.9");
  assert.equal(userData.client_user_agent, "Browser Agent");
  assert.equal(userData.fbp, "fb.1.123.abc");
  assert.equal(userData.fbc, "fb.1.456.click");
  assert.equal(JSON.stringify(userData).includes("user@example.com"), false);
  assert.equal(JSON.stringify(userData).includes("201012345678"), false);
});

test("behind Cloudflare without the trust flag, CAPI sends the shopper's IP and never the container hop", () => {
  // Events Manager showed every server event with no IP: the trusted address was the Docker hop.
  const previous = process.env.TRUST_CLOUDFLARE_PROXY;
  delete process.env.TRUST_CLOUDFLARE_PROXY;
  try {
    const behindCloudflare = buildHashedMetaUserData({
      req: { ip: "172.18.0.5", headers: { "cf-connecting-ip": "41.33.20.7", "user-agent": "UA" } },
    });
    assert.equal(behindCloudflare.client_ip_address, "41.33.20.7");
    const internalOnly = buildHashedMetaUserData({ req: { ip: "172.18.0.5", headers: { "user-agent": "UA" } } });
    assert.equal("client_ip_address" in internalOnly, false);
  } finally {
    if (previous === undefined) delete process.env.TRUST_CLOUDFLARE_PROXY;
    else process.env.TRUST_CLOUDFLARE_PROXY = previous;
  }
});

test("anonymous events contain no empty or placeholder customer matching fields", () => {
  const customer = normalizeMetaCustomer({});
  assert.deepEqual(customer, {});
  const payload = buildMetaEventPayload({
    contentIds: ["SKU-1"],
    value: 500,
    eventId: "m1_viewcontent_test",
    customer,
  });
  for (const field of ["email", "phone", "first_name", "last_name", "city", "state", "country", "external_id"]) {
    assert.equal(Object.hasOwn(payload, field), false);
  }
});

test("Purchase event id is stable for refresh deduplication", () => {
  assert.equal(purchaseEventId({ id: 9001 }), "m1_purchase_order_9001");
  assert.equal(purchaseEventId({ id: 9001 }), "m1_purchase_order_9001");
});

test("CAPI token candidates discard empty values and duplicate fallbacks", () => {
  assert.deepEqual(
    uniqueMetaAccessTokens(["", "user-token", "user-token", "page-token"]),
    ["user-token", "page-token"]
  );
});
