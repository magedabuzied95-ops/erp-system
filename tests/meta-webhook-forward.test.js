import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  forwardForeignMetaWebhookEntries,
  metaWebhookForwardIds,
  metaWebhookForwardUrl,
  splitMetaWebhookEntries,
} from "../server/modules/wholesaleBridge/metaWebhookForward.js";

// One Meta app = one webhook URL, pointed at the retail backend. The wholesale page's
// events are handed to the wholesale backend untouched (same raw bytes, same signature)
// and stripped here, so retail never files a wholesale customer under its own tenant.

const ENV = {
  META_WEBHOOK_FORWARD_IDS: "111, 222",
  META_WEBHOOK_FORWARD_URL: "https://api-jomla.m1store-egy.com/api/meta/webhook",
};

const fakeReq = (body) => {
  const raw = Buffer.from(JSON.stringify(body));
  return {
    body,
    rawBody: raw,
    headers: { "x-hub-signature-256": "sha256=abc" },
    get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : ""),
  };
};

const recordingFetch = (status = 200) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status };
  };
  return { calls, impl };
};

test("env parsing: ids split on commas/spaces, URL must be http(s)", () => {
  assert.deepEqual([...metaWebhookForwardIds(ENV)], ["111", "222"]);
  assert.equal(metaWebhookForwardUrl({ META_WEBHOOK_FORWARD_URL: "javascript:alert(1)" }), "");
  assert.equal(metaWebhookForwardUrl({}), "");
});

test("entries split by the account they belong to", () => {
  const { forwarded, kept } = splitMetaWebhookEntries({ entry: [{ id: "111" }, { id: "999" }, { id: 222 }] }, new Set(["111", "222"]));
  assert.deepEqual(forwarded.map((e) => String(e.id)), ["111", "222"]);
  assert.deepEqual(kept.map((e) => e.id), ["999"]);
});

test("not configured: nothing forwarded, body untouched", async () => {
  const body = { object: "page", entry: [{ id: "111" }] };
  const req = fakeReq(body);
  const { calls, impl } = recordingFetch();
  const result = await forwardForeignMetaWebhookEntries({ req, env: {}, fetchImpl: impl });
  assert.equal(result.forwarded, 0);
  assert.equal(calls.length, 0);
  assert.equal(req.body, body);
});

test("a wholesale-only event is forwarded with the raw bytes and Meta's signature", async () => {
  const req = fakeReq({ object: "page", entry: [{ id: "111", messaging: [{}] }] });
  const raw = req.rawBody;
  const { calls, impl } = recordingFetch();
  const result = await forwardForeignMetaWebhookEntries({ req, env: ENV, fetchImpl: impl });
  assert.deepEqual(result, { forwarded: 1, kept: 0, failed: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENV.META_WEBHOOK_FORWARD_URL);
  assert.equal(calls[0].init.body, raw);
  assert.equal(calls[0].init.headers["X-Hub-Signature-256"], "sha256=abc");
  assert.deepEqual(req.body.entry, []);
});

test("a mixed batch: retail keeps only its own entries", async () => {
  const req = fakeReq({ object: "page", entry: [{ id: "111" }, { id: "999" }] });
  const { impl } = recordingFetch();
  const result = await forwardForeignMetaWebhookEntries({ req, env: ENV, fetchImpl: impl });
  assert.equal(result.kept, 1);
  assert.deepEqual(req.body.entry.map((e) => e.id), ["999"]);
});

test("a failed forward is reported so the route can ask Meta to redeliver", async () => {
  const req = fakeReq({ object: "instagram", entry: [{ id: "222" }] });
  const { impl } = recordingFetch(503);
  const result = await forwardForeignMetaWebhookEntries({ req, env: ENV, fetchImpl: impl });
  assert.equal(result.failed, true);
  assert.equal(result.kept, 0);
});

test("the Meta webhook route forwards before processing and answers 502 on a failed hand-off", () => {
  const route = fs.readFileSync(new URL("../server/routes/metaIntegration.js", import.meta.url), "utf8");
  const handler = route.slice(route.indexOf('webhookRouter.post("/webhook"'));
  const forwardAt = handler.indexOf("forwardForeignMetaWebhookEntries({ req })");
  const processAt = handler.indexOf("processMetaWebhook({ req })");
  assert.ok(forwardAt > 0 && processAt > forwardAt, "forward must run before local processing");
  assert.match(handler, /forward\.failed\) return res\.status\(502\)/);
});
