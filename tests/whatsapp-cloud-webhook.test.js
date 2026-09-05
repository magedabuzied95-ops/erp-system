import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import router, { isWhatsappCloudWebhookPayload } from "../server/routes/whatsappGateway.js";

/*
 * Driven over real HTTP rather than by calling the handlers, because the requirement is about the
 * WIRE: Meta compares the response body byte for byte, refuses a redirect, and disables a
 * subscription that answers anything but 200. A handler unit test would pass while express
 * quietly answered a numeric challenge as JSON.
 */
const withServer = async (run) => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use("/api/whatsapp", router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
};

const call = async (base, path, init = {}) => {
  const response = await fetch(`${base}${path}`, { redirect: "manual", ...init });
  return { status: response.status, type: response.headers.get("content-type") || "", body: await response.text() };
};

const VERIFY_PATH = "/api/whatsapp/webhook";
const TOKEN = "M1_WHATSAPP_VERIFY_2026";

const metaBody = (extra = {}) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA",
    changes: [{
      field: "messages",
      value: {
        metadata: { phone_number_id: "999" },
        messages: [{ from: "201095339666", type: "text", text: { body: "MESSAGE_TEXT_MUST_NOT_BE_LOGGED" } }],
      },
    }],
  }],
  ...extra,
});

test("a valid verification answers 200 with the raw challenge and nothing else", async () => {
  await withServer(async (base) => {
    const result = await call(base, `${VERIFY_PATH}?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=123456`);
    assert.equal(result.status, 200);
    // The body must BE the challenge — not JSON, not an object, not a redirect.
    assert.equal(result.body, "123456");
    assert.match(result.type, /text\/plain/);
    assert.ok(!result.body.startsWith("{"), "the challenge must not be wrapped in JSON");
  });
});

test("a challenge that looks like a number is still returned as text", async () => {
  // express answers res.send(123456) as JSON unless the type is set first, which would fail
  // verification while looking correct in a log.
  await withServer(async (base) => {
    const result = await call(base, `${VERIFY_PATH}?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=0987654321`);
    assert.equal(result.body, "0987654321");
    assert.match(result.type, /text\/plain/);
  });
});

test("a wrong token, a wrong mode or a missing challenge is refused with 403", async () => {
  await withServer(async (base) => {
    for (const query of [
      `hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=123456`,
      `hub.mode=unsubscribe&hub.verify_token=${TOKEN}&hub.challenge=123456`,
      `hub.mode=subscribe&hub.verify_token=&hub.challenge=123456`,
      `hub.mode=subscribe&hub.verify_token=${TOKEN}`,
    ]) {
      const result = await call(base, `${VERIFY_PATH}?${query}`);
      assert.equal(result.status, 403, `expected 403 for ${query}`);
    }
  });
});

test("no verification response is ever a redirect", async () => {
  await withServer(async (base) => {
    for (const query of [`hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1`, `hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=1`]) {
      const result = await call(base, `${VERIFY_PATH}?${query}`);
      assert.ok(result.status < 300 || result.status >= 400, `a 3xx would break verification: ${result.status}`);
    }
  });
});

test("a Meta delivery is acknowledged with 200 even when the Evolution secret is set", async () => {
  /*
   * The ordering that matters. This path is shared with the live Evolution webhook, whose first
   * act is to answer 401 to anything without its secret — and Meta carries no such secret. If the
   * Meta branch ever moves below that check, Meta gets a 401 and disables the subscription.
   */
  const previous = process.env.WHATSAPP_WEBHOOK_SECRET;
  process.env.WHATSAPP_WEBHOOK_SECRET = "evolution-only-secret";
  try {
    await withServer(async (base) => {
      const result = await call(base, VERIFY_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(metaBody()),
      });
      assert.equal(result.status, 200, "Meta must never be answered 401 by the Evolution secret check");
    });
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_WEBHOOK_SECRET;
    else process.env.WHATSAPP_WEBHOOK_SECRET = previous;
  }
});

test("an Evolution delivery still reaches the Evolution handler untouched", async () => {
  // The existing integration must not be hijacked: a body without Meta's object key has to fall
  // through to the handler that has been serving it all along.
  await withServer(async (base) => {
    const result = await call(base, VERIFY_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert", instance: "m1_business_v237", data: {} }),
    });
    assert.equal(result.status, 200);
    const parsed = JSON.parse(result.body);
    assert.ok("skipReason" in parsed, "an Evolution body must be answered by the Evolution handler, which reports a skipReason");
  });
});

test("only Meta's own object key routes to the Meta branch", () => {
  assert.equal(isWhatsappCloudWebhookPayload({ object: "whatsapp_business_account" }), true);
  // Messenger and Instagram deliveries carry different objects and belong to /api/meta/webhook.
  assert.equal(isWhatsappCloudWebhookPayload({ object: "page" }), false);
  assert.equal(isWhatsappCloudWebhookPayload({ object: "instagram" }), false);
  assert.equal(isWhatsappCloudWebhookPayload({ event: "messages.upsert" }), false);
  assert.equal(isWhatsappCloudWebhookPayload(null), false);
  assert.equal(isWhatsappCloudWebhookPayload("whatsapp_business_account"), false);
});

test("the webhook log carries structure, never the customer's message", async () => {
  const lines = [];
  const original = console.info;
  console.info = (...args) => { lines.push(args.map((arg) => JSON.stringify(arg)).join(" ")); };
  try {
    await withServer(async (base) => {
      await call(base, VERIFY_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(metaBody()),
      });
    });
  } finally {
    console.info = original;
  }
  const logged = lines.join("\n");
  assert.ok(logged.includes("whatsapp:cloud-webhook-event"), "the delivery must be logged");
  assert.ok(!logged.includes("MESSAGE_TEXT_MUST_NOT_BE_LOGGED"), "the customer's message must never reach the logs");
  assert.ok(!logged.includes("201095339666"), "the customer's full number must never reach the logs");
  assert.ok(logged.includes("9666"), "the last digits are kept so a delivery can still be traced");
});

test("a malformed Meta body is still acknowledged rather than retried forever", async () => {
  await withServer(async (base) => {
    const result = await call(base, VERIFY_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object: "whatsapp_business_account", entry: "not-an-array" }),
    });
    assert.equal(result.status, 200);
  });
});
