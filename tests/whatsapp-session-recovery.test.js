import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { isWhatsappSessionDown, isWhatsappStateConnected } from "../src/modules/aiSupport/services/whatsappSession.js";
import { whenWorkerActive } from "../src/modules/aiSupport/services/serviceWorkerActivation.js";

const readSource = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

// --- the alert gate ----------------------------------------------------------

test("the alert fires only for a configured gateway that is not connected", () => {
  // The failure it exists for: 2026-08-30, state "close" for 37 hours.
  assert.equal(isWhatsappSessionDown({ configured: true, connected: false, state: "close" }), true);
  assert.equal(isWhatsappSessionDown({ configured: true, connected: false, state: "connecting" }), true);

  // A healthy session says nothing.
  assert.equal(isWhatsappSessionDown({ configured: true, connected: true, state: "open" }), false);

  // Neither does a deployment with no gateway at all — that is not a fault.
  assert.equal(isWhatsappSessionDown({ configured: false, connected: false, state: "not_configured" }), false);

  // Nor a status the browser could not read: staff accounts get 403 on
  // /whatsapp/status, and "I don't know" must never render an alarm.
  assert.equal(isWhatsappSessionDown(null), false);
  assert.equal(isWhatsappSessionDown(undefined), false);
  assert.equal(isWhatsappSessionDown({}), false);
});

test("connected states match the gateway's own vocabulary", () => {
  for (const state of ["open", "connected", "online", "OPEN", " Open "]) {
    assert.equal(isWhatsappStateConnected(state), true, `${state} is connected`);
  }
  for (const state of ["close", "closed", "connecting", "", null, undefined]) {
    assert.equal(isWhatsappStateConnected(state), false, `${state} is not connected`);
  }
});

// --- push subscribes only once the worker is running -------------------------

const fakeWorker = () => {
  const listeners = new Set();
  return {
    state: "installing",
    addEventListener: (_type, handler) => listeners.add(handler),
    removeEventListener: (_type, handler) => listeners.delete(handler),
    moveTo(state) {
      this.state = state;
      listeners.forEach((handler) => handler());
    },
    listenerCount: () => listeners.size,
  };
};

test("an already-active registration resolves immediately", async () => {
  const registration = { active: { state: "activated" } };
  assert.equal(await whenWorkerActive(registration), registration);
});

test("a still-installing worker is waited on until it activates", async () => {
  const installing = fakeWorker();
  const registration = { installing, active: null };

  let settled = false;
  const pending = whenWorkerActive(registration, { timeoutMs: 1000 }).then((value) => {
    settled = true;
    return value;
  });

  // Subscribing here is exactly the bug: "Subscription failed - no active
  // Service Worker". Nothing may resolve while the worker is still installing.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false);

  registration.active = installing;
  installing.moveTo("activated");
  assert.equal(await pending, registration);
  assert.equal(installing.listenerCount(), 0, "the statechange listener is removed");
});

test("a worker that goes redundant resolves null instead of hanging", async () => {
  const installing = fakeWorker();
  const registration = { installing, active: null };
  const pending = whenWorkerActive(registration, { timeoutMs: 1000 });
  installing.moveTo("redundant");
  assert.equal(await pending, null);
});

test("a worker that never activates gives up instead of hanging the caller", async () => {
  const registration = { installing: fakeWorker(), active: null };
  assert.equal(await whenWorkerActive(registration, { timeoutMs: 20 }), null);
});

test("no registration at all resolves null", async () => {
  assert.equal(await whenWorkerActive(null), null);
  assert.equal(await whenWorkerActive({ active: null }), null);
});

test("the push path waits for activation before subscribing", () => {
  const source = readSource("../src/modules/aiSupport/services/inboxNotifications.js");
  // register() alone is what shipped, and it is what failed.
  assert.match(source, /return whenWorkerActive\(registration\);/);
  assert.match(source, /import \{ whenWorkerActive \} from "\.\/serviceWorkerActivation"/);
});

// --- re-pairing a dropped session -------------------------------------------

const withEvolutionEnv = async (run) => {
  const previous = {
    url: process.env.EVOLUTION_API_URL,
    key: process.env.EVOLUTION_API_KEY,
    instance: process.env.WHATSAPP_INSTANCE_NAME,
    fetch: globalThis.fetch,
  };
  process.env.EVOLUTION_API_URL = "http://gateway.test:8080";
  process.env.EVOLUTION_API_KEY = "test-key";
  process.env.WHATSAPP_INSTANCE_NAME = "m1_business_v237";
  try {
    return await run();
  } finally {
    process.env.EVOLUTION_API_URL = previous.url;
    process.env.EVOLUTION_API_KEY = previous.key;
    process.env.WHATSAPP_INSTANCE_NAME = previous.instance;
    globalThis.fetch = previous.fetch;
  }
};

const stubEvolution = (payload) => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method || "GET" });
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify(payload),
    };
  };
  return calls;
};

test("pairing material is read from every shape Evolution returns", async () => {
  const { connectInstance } = await import("../server/services/whatsappGatewayService.js");

  await withEvolutionEnv(async () => {
    // Flat, Evolution 2.x.
    stubEvolution({ base64: "QRPAYLOAD", code: "2@abc", pairingCode: "WXYZ1234" });
    let result = await connectInstance({});
    assert.equal(result.qr_image, "data:image/png;base64,QRPAYLOAD", "a bare payload becomes a usable <img> src");
    assert.equal(result.qr_code, "2@abc");
    assert.equal(result.pairing_code, "WXYZ1234");
    assert.equal(result.already_connected, false);

    // Nested under `qrcode` on other builds — same answer.
    stubEvolution({ qrcode: { base64: "data:image/png;base64,ALREADYURL", code: "2@def" } });
    result = await connectInstance({});
    assert.equal(result.qr_image, "data:image/png;base64,ALREADYURL", "a full data URL is left alone");
    assert.equal(result.qr_code, "2@def");

    // Already live: no pairing material, and the UI must not show an empty box.
    stubEvolution({ instance: { instanceName: "m1_business_v237", state: "open" } });
    result = await connectInstance({});
    assert.equal(result.already_connected, true);
    assert.equal(result.qr_image, "");
    assert.equal(result.pairing_code, "");
  });
});

test("a shop number asks for a pairing code, since a phone cannot scan its own screen", async () => {
  const { connectInstance } = await import("../server/services/whatsappGatewayService.js");

  await withEvolutionEnv(async () => {
    let calls = stubEvolution({ pairingCode: "ABCD1234" });
    await connectInstance({ number: "01006367628" });
    assert.match(calls[0].url, /\/instance\/connect\/m1_business_v237\?number=201006367628$/);

    // No number: a QR for scanning from another device, and no stray query.
    calls = stubEvolution({ base64: "QR" });
    await connectInstance({});
    assert.match(calls[0].url, /\/instance\/connect\/m1_business_v237$/);
  });
});

test("both inbox surfaces raise the alert, not just one", () => {
  // /inbox and /admin/ai-inbox are separate implementations; a fix landing on
  // one and not the other is this codebase's most repeated defect.
  for (const page of ["../src/modules/aiSupport/pages/AiInbox.jsx", "../src/modules/aiSupport/pages/AiInboxPwa.jsx"]) {
    const source = readSource(page);
    assert.match(source, /import WhatsappSessionAlert from "\.\.\/components\/WhatsappSessionAlert"/, `${page} imports the alert`);
    assert.match(source, /<WhatsappSessionAlert/, `${page} renders the alert`);
  }
});
