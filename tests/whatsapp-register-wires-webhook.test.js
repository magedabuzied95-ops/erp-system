// Registering a second WhatsApp number also points its webhook at us.
//
// A number can be connected to WhatsApp and still be invisible to the ERP: the
// Evolution instance delivers every inbound message to whatever webhook it was
// told about, and a fresh instance was told about nothing. Setting it was a
// manual step in the Evolution manager that nothing enforced, so a registered
// number could sit in the accounts list looking healthy while every customer
// message it received was dropped.
//
// These guards exercise the sync against a stubbed gateway: it must address the
// instance it was asked about (not the env default), survive a name with a
// space in it, ask for the events the inbox depends on, and stay quiet when the
// webhook is already right.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

process.env.EVOLUTION_API_URL = "http://evolution.test";
process.env.EVOLUTION_API_KEY = "test-key";
process.env.EVOLUTION_INSTANCE_NAME = "env_default_line";
process.env.WEBHOOK_PUBLIC_URL = "https://api.example.com";

const { syncEvolutionWebhookForInstance } = await import("../server/services/evolutionWebhookSyncService.js");

const DESIRED_URL = "https://api.example.com/api/whatsapp/webhook";

// The service narrates every request it makes; the assertions below are the
// output that matters.
const withSilentConsole = async (run) => {
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  try {
    return await run();
  } finally {
    Object.assign(console, saved);
  }
};

// One stubbed Evolution gateway: it remembers what the webhook was set to, so a
// sync that only pretends to write is caught by the read that follows it.
const stubGateway = ({ instanceName, webhook = null }) => {
  const calls = [];
  let stored = webhook;
  const json = (body) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body ?? {}),
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method, body });
    const target = String(url).replace("http://evolution.test", "");
    if (target === "" || target === "/") return json({ status: 200, version: "2.4.0" });
    if (target.startsWith("/instance/fetchInstances")) {
      return json([{ name: instanceName, connectionStatus: "open" }]);
    }
    if (target.startsWith("/webhook/find/")) {
      return json(stored || { enabled: false, url: "", events: [] });
    }
    if (target.startsWith("/webhook/set/")) {
      stored = { ...body.webhook };
      return json({ webhook: stored });
    }
    return { ok: false, status: 404, text: async () => JSON.stringify({ message: `unstubbed ${method} ${target}` }) };
  };
  return {
    calls,
    stored: () => stored,
    restore: () => {
      globalThis.fetch = previousFetch;
    },
  };
};

test("a newly registered number gets OUR webhook, on its own instance", async () => {
  // The space is deliberate: the instance the owner created is "M1 Store2", and
  // a raw space in a gateway path is a 404 nobody would connect to a silent
  // number.
  const instanceName = "M1 Store2";
  const gateway = stubGateway({ instanceName });
  try {
    const result = await withSilentConsole(() => syncEvolutionWebhookForInstance(instanceName));
    assert.equal(result.updated, true);
    assert.equal(result.webhookUrl, DESIRED_URL);

    const set = gateway.calls.filter((call) => call.method === "POST" && call.url.includes("/webhook/set/"));
    assert.equal(set.length, 1, "the webhook must be written exactly once");
    assert.equal(set[0].url, `http://evolution.test/webhook/set/${encodeURIComponent(instanceName)}`);
    assert.equal(set[0].body.webhook.url, DESIRED_URL);
    assert.equal(set[0].body.webhook.enabled, true);

    // The env default must never be touched by a call about another number.
    for (const call of gateway.calls) {
      assert.ok(!call.url.includes("env_default_line"), `call leaked to the env instance: ${call.url}`);
    }
  } finally {
    gateway.restore();
  }
});

test("the events the inbox lives on are subscribed", async () => {
  const instanceName = "m1_line2";
  const gateway = stubGateway({ instanceName });
  try {
    await withSilentConsole(() => syncEvolutionWebhookForInstance(instanceName));
    const events = gateway.stored()?.events || [];
    // MESSAGES_UPSERT is the customer writing, CONNECTION_UPDATE is the session
    // dropping, MESSAGES_UPDATE carries the delivery ticks, and CALL is the
    // customer ringing the store — which reached nothing at all until it was
    // added to this list.
    for (const event of ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "CALL"]) {
      assert.ok(events.includes(event), `missing webhook event: ${event}`);
    }
  } finally {
    gateway.restore();
  }
});

test("a webhook that is already right is left alone", async () => {
  const instanceName = "m1_line2";
  const gateway = stubGateway({
    instanceName,
    webhook: {
      enabled: true,
      url: DESIRED_URL,
      events: [
        "MESSAGES_SET", "MESSAGES_UPSERT", "MESSAGES_EDITED", "MESSAGES_UPDATE", "MESSAGES_DELETE",
        "SEND_MESSAGE", "SEND_MESSAGE_UPDATE", "CONTACTS_SET", "CONTACTS_UPSERT", "CONTACTS_UPDATE",
        "CHATS_SET", "CHATS_UPSERT", "CHATS_UPDATE", "CHATS_DELETE", "PRESENCE_UPDATE",
        "CONNECTION_UPDATE", "CALL",
      ],
    },
  });
  try {
    const result = await withSilentConsole(() => syncEvolutionWebhookForInstance(instanceName));
    assert.equal(result.matched, true);
    assert.equal(result.updated, false);
    assert.equal(gateway.calls.filter((call) => call.url.includes("/webhook/set/")).length, 0);
  } finally {
    gateway.restore();
  }
});

test("boot still syncs the env default number", async () => {
  const service = read("server/services/evolutionWebhookSyncService.js");
  assert.match(service, /export const syncEvolutionWebhookOnStartup = \(\) => syncEvolutionWebhookForInstance\(\);/);
});

test("the register route wires the number it registered, non-fatally", () => {
  const routes = read("server/routes/aiAgentOrders.js");
  assert.match(routes, /import \{ syncEvolutionWebhookForInstance \} from "\.\.\/services\/evolutionWebhookSyncService\.js";/);
  // Called with the registered instance, and with a rejection handler: a
  // gateway that refuses the webhook must not lose the registration.
  assert.match(routes, /syncEvolutionWebhookForInstance\(instance\)\.then\(/);
  assert.match(routes, /webhook_wired: webhook\.wired/);
  assert.match(routes, /\r?\n      webhook,\r?\n/);
});

test("the panel calls a wired-less number a failure", () => {
  const panel = read("src/modules/aiSupport/components/integrations/WhatsAppIntegrationPanel.jsx");
  assert.match(panel, /const webhookWired = payload\?\.webhook\?\.wired !== false;/);
  assert.match(panel, /ok: connected && webhookWired,/);
  for (const locale of ["en", "ar"]) {
    const copy = JSON.parse(read(`src/locales/${locale}/aiSupport.json`));
    assert.ok(
      copy.integrations.whatsapp.instances.webhookFailed,
      `missing ${locale} copy for the failed webhook`
    );
  }
});
