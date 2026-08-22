import assert from "node:assert/strict";
import test from "node:test";

import {
  createPaymentIntention,
  detectPaymobInstrument,
  isPaymobOnlineReady,
  paymobOnlineAvailability,
  paymobOnlineIntegrationIds,
} from "../server/services/paymobOnlineService.js";

const LIVE_ENV = {
  PAYMOB_ONLINE_ENABLED: "true",
  PAYMOB_SECRET_KEY: "egy_sk_test_secret",
  PAYMOB_PUBLIC_KEY: "egy_pk_test_public",
  PAYMOB_CARD_INTEGRATION_ID: "1234",
  PAYMOB_APPLE_PAY_INTEGRATION_ID: "5678",
  STOREFRONT_URL: "https://m1store-egy.com",
  PUBLIC_API_URL: "https://api.m1store-egy.com",
};

const withEnv = async (values, callback) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const withStubbedFetch = async (responder, callback) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return responder(String(url), options);
  };
  try {
    return await callback(calls);
  } finally {
    globalThis.fetch = original;
  }
};

const okIntention = () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ id: "int_1", client_secret: "cs_test_123", intention_order_id: "77123" }),
});

test("online payments stay dormant until every credential is present", async () => {
  await withEnv(
    { ...LIVE_ENV, PAYMOB_ONLINE_ENABLED: "false" },
    async () => assert.equal(isPaymobOnlineReady(), false, "disabled flag must win")
  );
  await withEnv(
    { ...LIVE_ENV, PAYMOB_SECRET_KEY: "" },
    async () => assert.equal(isPaymobOnlineReady(), false, "missing secret key must fail closed")
  );
  await withEnv(
    { ...LIVE_ENV, PAYMOB_CARD_INTEGRATION_ID: "", PAYMOB_APPLE_PAY_INTEGRATION_ID: "" },
    async () => assert.equal(isPaymobOnlineReady(), false, "no integration id means nothing to charge")
  );
  await withEnv(LIVE_ENV, async () => assert.equal(isPaymobOnlineReady(), true));
});

test("availability never leaks the Paymob keys to the public settings endpoint", async () => {
  await withEnv(LIVE_ENV, async () => {
    const availability = paymobOnlineAvailability();
    assert.deepEqual(Object.keys(availability).sort(), ["apple_pay", "card", "enabled"]);
    for (const value of Object.values(availability)) assert.equal(typeof value, "boolean");
    const serialized = JSON.stringify(availability);
    assert.ok(!serialized.includes("egy_sk_test_secret"), "secret key must never be serialized");
    assert.ok(!serialized.includes("egy_pk_test_public"), "public key must not be echoed either");
  });
});

test("Apple Pay is only offered when its own integration id is configured", async () => {
  await withEnv({ ...LIVE_ENV, PAYMOB_APPLE_PAY_INTEGRATION_ID: "" }, async () => {
    assert.equal(paymobOnlineAvailability().apple_pay, false);
    assert.deepEqual(paymobOnlineIntegrationIds(), ["1234"], "card alone still works");
  });
  await withEnv(LIVE_ENV, async () => {
    assert.equal(paymobOnlineAvailability().apple_pay, true);
    assert.deepEqual(paymobOnlineIntegrationIds(), ["1234", "5678"]);
  });
});

test("the intention carries both integration ids so the Apple Pay button can render", async () => {
  await withEnv(LIVE_ENV, async () => {
    await withStubbedFetch(okIntention, async (calls) => {
      await createPaymentIntention({
        tenantId: 1,
        orderId: 42,
        amountCents: 150000,
        items: [{ product_name: "Shoe", quantity: 1, price: 1500 }],
        billing: { full_name: "Maged Helal", phone: "01000000000" },
        specialReference: "erp-1-42-abc",
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://accept.paymob.com/v1/intention/");
      assert.equal(calls[0].options.headers.Authorization, "Token egy_sk_test_secret");
      const body = JSON.parse(calls[0].options.body);
      assert.deepEqual(body.payment_methods, [1234, 5678], "numeric ids must be sent as numbers");
      assert.equal(body.amount, 150000);
      assert.equal(body.notification_url, "https://api.m1store-egy.com/api/paymob/webhook");
    });
  });
});

test("checkout URL is built from the public key and the returned client secret", async () => {
  await withEnv(LIVE_ENV, async () => {
    await withStubbedFetch(okIntention, async () => {
      const result = await createPaymentIntention({
        tenantId: 1,
        orderId: 42,
        amountCents: 1000,
        specialReference: "erp-1-42-abc",
      });
      assert.equal(
        result.checkoutUrl,
        "https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_public&clientSecret=cs_test_123"
      );
      assert.equal(result.providerOrderId, "77123", "the webhook can only be matched by this id");
    });
  });
});

test("billing gaps become NA rather than empty strings Paymob would reject", async () => {
  await withEnv(LIVE_ENV, async () => {
    await withStubbedFetch(okIntention, async (calls) => {
      await createPaymentIntention({ tenantId: 1, orderId: 7, amountCents: 500, billing: { full_name: "Sara" } });
      const billing = JSON.parse(calls[0].options.body).billing_data;
      assert.equal(billing.first_name, "Sara");
      assert.equal(billing.last_name, "NA", "a single-word name must still fill last_name");
      for (const [field, value] of Object.entries(billing)) {
        assert.notEqual(String(value).trim(), "", `${field} must never be empty`);
      }
    });
  });
});

test("item lines that do not sum to the order total collapse to one line", async () => {
  await withEnv(LIVE_ENV, async () => {
    await withStubbedFetch(okIntention, async (calls) => {
      // Total is discounted below the sum of the lines, which is what a coupon
      // or a delivery fee does on every real order.
      await createPaymentIntention({
        tenantId: 1,
        orderId: 9,
        amountCents: 90000,
        items: [{ product_name: "A", quantity: 2, price: 600 }],
      });
      const items = JSON.parse(calls[0].options.body).items;
      assert.equal(items.length, 1);
      assert.equal(items[0].amount, 90000, "the single line must equal the charged amount");
    });
  });
});

test("a rejected intention surfaces as an error instead of a broken checkout URL", async () => {
  await withEnv(LIVE_ENV, async () => {
    await withStubbedFetch(
      () => ({ ok: false, status: 422, text: async () => JSON.stringify({ detail: "duplicate special_reference" }) }),
      async () => {
        await assert.rejects(
          () => createPaymentIntention({ tenantId: 1, orderId: 3, amountCents: 100 }),
          (error) => error.status === 422 && /duplicate/i.test(error.message)
        );
      }
    );
  });
});

test("an unpaid wallet order blocks the shipment instead of turning into cash on delivery", async () => {
  const { resolveBostaCollection } = await import("../server/modules/shipping/shipping.service.js");
  const order = (overrides) => ({ total_amount: 1200, paid_amount: 0, payment_status: "unpaid", cod_amount: 0, ...overrides });

  // The prepaid matcher is substring based and "apple_pay" does not contain
  // "card", so without an explicit entry this silently shipped as COD and the
  // courier asked a customer who already chose to pay online for cash.
  const unpaidApplePay = resolveBostaCollection({ order: order({ payment_method: "apple_pay" }) });
  assert.equal(unpaidApplePay.amount, 0, "an unpaid wallet order must never be handed to the courier to collect");
  assert.equal(unpaidApplePay.blocked, true);

  const unpaidCard = resolveBostaCollection({ order: order({ payment_method: "card" }) });
  assert.equal(unpaidCard.blocked, true, "wallet orders must behave exactly like card orders");

  const paidApplePay = resolveBostaCollection({
    order: order({ payment_method: "apple_pay", paid_amount: 1200, payment_status: "paid" }),
  });
  assert.equal(paidApplePay.amount, 0);
  assert.equal(paidApplePay.blocked, false, "a settled wallet order still has to be shippable");

  const cod = resolveBostaCollection({ order: order({ payment_method: "cod", cod_amount: 1200 }) });
  assert.equal(cod.amount, 1200, "cash on delivery must be untouched by this change");
});

test("Apple Pay transactions are told apart from plain card transactions", () => {
  assert.equal(detectPaymobInstrument({ obj: { source_data: { sub_type: "ApplePay", type: "card" } } }), "apple_pay");
  assert.equal(detectPaymobInstrument({ obj: { source_data: { sub_type: "MasterCard", type: "card" } } }), "card");
  assert.equal(detectPaymobInstrument({ source_data: { wallet_type: "GooglePay" } }), "google_pay");
  assert.equal(detectPaymobInstrument({}), "card", "an unknown shape must not be guessed as a wallet");
});
