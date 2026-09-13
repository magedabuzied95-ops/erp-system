import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

const { isStaffSessionToken, protect } = await import("../server/middleware/authMiddleware.js");
const { verifyPaymobHmac } = await import("../server/services/paymobPosService.js");

const runProtect = async (token) => {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const outcome = { status: 200, body: null, nextCalled: false };
  const res = {
    status(code) {
      outcome.status = code;
      return this;
    },
    json(body) {
      outcome.body = body;
      return this;
    },
  };
  await protect(req, res, () => {
    outcome.nextCalled = true;
  });
  return outcome;
};

test("only a staff login token counts as a staff session", () => {
  assert.equal(isStaffSessionToken({ id: 7, role: "cashier", tenant_id: 1 }), true);
  assert.equal(isStaffSessionToken({ type: "storefront_customer", tenant_id: 1, phone: "01000000000" }), false);
  assert.equal(isStaffSessionToken({ type: "storefront_customer", tenant_id: 1, customer_id: 9 }), false);
  assert.equal(isStaffSessionToken({ scope: "manager_profit_unlock", mid: "3", tid: "1" }), false);
  assert.equal(isStaffSessionToken({ id: 7, type: "storefront_customer" }), false);
  assert.equal(isStaffSessionToken({ role: "admin" }), false);
  assert.equal(isStaffSessionToken({ id: "" }), false);
  assert.equal(isStaffSessionToken(null), false);
});

test("protect refuses a storefront shopper token before touching the database", async () => {
  const shopperToken = jwt.sign({ type: "storefront_customer", tenant_id: 1, phone: "01000000000" }, process.env.JWT_SECRET);
  const outcome = await runProtect(shopperToken);
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.status, 401);
});

test("protect refuses the manager profit-lock token", async () => {
  const profitToken = jwt.sign({ scope: "manager_profit_unlock", mid: "3", tid: "1", jti: "x" }, process.env.JWT_SECRET);
  const outcome = await runProtect(profitToken);
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.status, 401);
});

test("protect no longer lets a token without a database account through", () => {
  const source = readFileSync(new URL("../server/middleware/authMiddleware.js", import.meta.url), "utf8");
  assert.match(source, /if \(!databaseUser\) \{\s*\/\/[^\n]*\n\s*return res\.status\(401\)/);
});

test("the realtime socket applies the same staff-session gate", () => {
  const source = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
  assert.match(source, /if \(!isStaffSessionToken\(decoded\)\) throw new Error/);
  assert.match(source, /if \(!userResult\.rows\[0\]\) throw new Error\("socket account no longer exists"\)/);
  assert.doesNotMatch(source, /const user = userResult\.rows\[0\] \|\| decoded;/);
});

const withHmacSecret = (secret, callback) => {
  const previous = { PAYMOB_HMAC_SECRET: process.env.PAYMOB_HMAC_SECRET, PAYMOB_HMAC_KEY: process.env.PAYMOB_HMAC_KEY };
  delete process.env.PAYMOB_HMAC_KEY;
  if (secret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
  else process.env.PAYMOB_HMAC_SECRET = secret;
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("an unsigned Paymob webhook is rejected", () => {
  withHmacSecret("paymob-secret", () => {
    const result = verifyPaymobHmac({ body: { local_order_id: 812, success: true, amount_cents: 99999900 } });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_hmac");
  });
});

test("a Paymob webhook is rejected when no HMAC secret is configured", () => {
  withHmacSecret(undefined, () => {
    const result = verifyPaymobHmac({ body: { obj: { success: true } }, query: { hmac: "ab".repeat(64) } });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_secret");
  });
});

test("a wrongly signed Paymob webhook is rejected and a correctly signed one passes", () => {
  withHmacSecret("paymob-secret", () => {
    const obj = { amount_cents: 15000, success: true, id: 55, order: { id: 99 } };
    const forged = verifyPaymobHmac({ body: { obj }, query: { hmac: "ab".repeat(64) } });
    assert.equal(forged.valid, false);

    const fields = [
      "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id",
      "integration_id", "is_3d_secure", "is_auth", "is_capture", "is_refunded", "is_standalone_payment",
      "is_voided", "order.id", "owner", "pending", "source_data.pan", "source_data.sub_type",
      "source_data.type", "success",
    ];
    const source = readFileSync(new URL("../server/services/paymobPosService.js", import.meta.url), "utf8");
    const declared = source.match(/const PAYMOB_HMAC_FIELDS = \[([\s\S]*?)\];/);
    assert.ok(declared, "PAYMOB_HMAC_FIELDS must stay declared");
    const declaredFields = [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(declaredFields, fields);

    const read = (path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), obj);
    const message = fields.map((field) => {
      const value = read(field);
      return value === undefined || value === null ? "" : String(value);
    }).join("");
    const hmac = crypto.createHmac("sha512", "paymob-secret").update(message).digest("hex");
    const signed = verifyPaymobHmac({ body: { obj }, query: { hmac } });
    assert.equal(signed.valid, true);
  });
});

test("the webhook handler refuses anything that is not a valid signature", () => {
  const source = readFileSync(new URL("../server/controllers/posController.js", import.meta.url), "utf8");
  assert.match(source, /const signature = verifyPaymobHmac\([^)]*\);\s*if \(!signature\.valid\) \{/);
});

test("a Paymob confirmation locks its transaction and only confirms the amount that was charged", () => {
  const source = readFileSync(new URL("../server/controllers/posController.js", import.meta.url), "utf8");
  const finder = source.slice(source.indexOf("const findPaymobTransaction"), source.indexOf("const applyPaymobConfirmation"));
  assert.match(finder, /LIMIT 1\s*FOR UPDATE/);
  const apply = source.slice(source.indexOf("const applyPaymobConfirmation"), source.indexOf("const applyPaymobConfirmation") + 3000);
  assert.match(apply, /rejected: "amount_mismatch"/);
  assert.match(apply, /const confirmedCents = nextStatus === "success" \? expectedCents \|\|/);
});
