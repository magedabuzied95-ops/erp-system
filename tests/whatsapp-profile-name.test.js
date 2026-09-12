/*
 * The WhatsApp profile name.
 *
 * This is the shop's own name on the account Evolution drives — the one a customer who has
 * NOT saved the number sees in notifications and on the contact card. It is not the verified
 * business display name that replaces the number in the chat header; only Meta grants that,
 * and these tests exist partly to keep the two from being conflated in code.
 *
 * The write reaches a live socket, so the rules that matter are: refuse a dead session before
 * Baileys can turn it into "Connection Closed", refuse a Cloud number that this transport does
 * not own, and never let a name WhatsApp would silently truncate through.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.EVOLUTION_API_URL = "http://evolution.test";
process.env.EVOLUTION_API_KEY = "test-key";
process.env.WHATSAPP_INSTANCE_NAME = "m1_business_v237";
process.env.WHATSAPP_GATEWAY_PROVIDER = "evolution";

const { getWhatsappProfile, updateWhatsappProfileName } = await import("../server/services/whatsappGatewayService.js");

const jsonResponse = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

// A gateway double that answers the three paths this feature touches and records every call,
// so a test can assert on the request that was actually made rather than on a return value
// the service could have produced without ever reaching Evolution.
const stubGateway = ({ state = "open", profileName = "old name" } = {}) => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url).replace("http://evolution.test", "");
    calls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (path.startsWith("/instance/connectionState/")) return jsonResponse({ instance: { state } });
    if (path.startsWith("/instance/fetchInstances")) {
      return jsonResponse([{ name: "m1_business_v237", profileName, ownerJid: "201024960585@s.whatsapp.net", connectionStatus: state }]);
    }
    if (path.startsWith("/chat/updateProfileName/")) return jsonResponse({ update: "success" });
    throw new Error(`unexpected gateway call: ${path}`);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
};

test("the name is written to the instance Evolution actually drives", async () => {
  const gateway = stubGateway({ profileName: "M1 Store" });
  try {
    const result = await updateWhatsappProfileName({ name: "M1 Store" });
    const write = gateway.calls.find((call) => call.path.startsWith("/chat/updateProfileName/"));
    assert.ok(write, "the update endpoint was called");
    assert.equal(write.method, "POST");
    assert.equal(write.path, "/chat/updateProfileName/m1_business_v237");
    assert.deepEqual(write.body, { name: "M1 Store" });
    assert.equal(result.requested_name, "M1 Store");
    assert.equal(result.profile_name, "M1 Store");
  } finally {
    gateway.restore();
  }
});

test("a dead session is refused before Baileys can turn it into Connection Closed", async () => {
  const gateway = stubGateway({ state: "close" });
  try {
    await assert.rejects(
      () => updateWhatsappProfileName({ name: "M1 Store" }),
      (error) => error.code === "WHATSAPP_NOT_CONNECTED"
    );
    // The point of the guard: nothing was written to a socket that cannot carry it.
    assert.equal(gateway.calls.some((call) => call.path.startsWith("/chat/updateProfileName/")), false);
  } finally {
    gateway.restore();
  }
});

test("a name WhatsApp would truncate is refused instead of silently cut", async () => {
  const gateway = stubGateway();
  try {
    await assert.rejects(
      () => updateWhatsappProfileName({ name: "M".repeat(26) }),
      (error) => error.code === "WHATSAPP_PROFILE_NAME_TOO_LONG"
    );
    assert.equal(gateway.calls.length, 0, "the gateway is never called for a name it would mangle");
    // 25 is the boundary, not a rejection.
    await updateWhatsappProfileName({ name: "M".repeat(25) });
  } finally {
    gateway.restore();
  }
});

test("an empty name is refused", async () => {
  const gateway = stubGateway();
  try {
    await assert.rejects(
      () => updateWhatsappProfileName({ name: "   " }),
      (error) => error.code === "WHATSAPP_PROFILE_NAME_REQUIRED"
    );
  } finally {
    gateway.restore();
  }
});

test("a Cloud number is refused, because its display name is Meta's to grant", async () => {
  const gateway = stubGateway();
  try {
    for (const call of [
      () => updateWhatsappProfileName({ instance: "cloud:4410867005694052", name: "M1 Store" }),
      () => getWhatsappProfile({ instance: "cloud:4410867005694052" }),
    ]) {
      await assert.rejects(call, (error) => error.code === "WHATSAPP_PROFILE_CLOUD_UNSUPPORTED");
    }
    assert.equal(gateway.calls.length, 0);
  } finally {
    gateway.restore();
  }
});

test("reading the profile reports the instance's own identity", async () => {
  const gateway = stubGateway({ profileName: "M1 Store" });
  try {
    const profile = await getWhatsappProfile({});
    assert.equal(profile.instanceName, "m1_business_v237");
    assert.equal(profile.profile_name, "M1 Store");
    assert.equal(profile.owner_jid, "201024960585@s.whatsapp.net");
    assert.equal(profile.connection_status, "open");
  } finally {
    gateway.restore();
  }
});
