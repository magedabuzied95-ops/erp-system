// Edge Agent identity and the typed control channel.
//
// THE THREAT THESE TESTS ARE ABOUT
// --------------------------------
// An Edge Agent is a persistent hole through a customer's firewall that our
// cloud controls. If the cloud can tell it "fetch this URL", then anyone who
// compromises our control plane has an authenticated proxy into every shop
// that ever enrolled one — their router, their NAS, their till.
//
// So the property under test is not "does the agent work" but "what is the
// worst thing the cloud can make it do".

import test from "node:test";
import assert from "node:assert/strict";

process.env.SURVEILLANCE_ENCRYPTION_KEY ||= "0".repeat(64);

const { EDGE_COMMANDS, buildCommandEnvelope, canonicalise, validateCommand } = await import(
  "../../server/services/surveillance/edge/edgeCommandProtocol.js"
);
const {
  agentLiveness, assertAgentUsable, createEnrolment, reconnectDelayMs,
  signEnvelope, verifyEnrolmentSecret, verifyEnvelope,
} = await import("../../server/services/surveillance/edge/edgeAgentIdentity.js");

const caught = (fn) => { try { fn(); return null; } catch (error) { return error; } };

/* ------------------------------------------------------------------ *
 * No arbitrary LAN proxy — the whole point
 * ------------------------------------------------------------------ */

test("no command anywhere in the protocol accepts a URL, host, port or path", async () => {
  // The relay design this forbids would be one field. Its absence has to be
  // asserted, not assumed, because adding it later would look harmless.
  for (const [name, spec] of Object.entries(EDGE_COMMANDS)) {
    for (const key of Object.keys(spec.params)) {
      assert.doesNotMatch(key, /url|uri|host|port|path|addr|endpoint|target/i,
        `${name} declares a parameter "${key}" that can name a network location`);
    }
  }

  const source = await (await import("node:fs/promises")).readFile(
    new URL("../../server/services/surveillance/edge/edgeCommandProtocol.js", import.meta.url), "utf8");
  // And no validator that would accept one.
  assert.doesNotMatch(source, /VALIDATORS\s*=\s*\{[\s\S]*?\burl\b\s*:/);
});

test("unknown commands are refused without being interpreted", () => {
  for (const attempt of ["http.get", "shell.exec", "proxy", "device.testConnection2", "", null]) {
    const error = caught(() => validateCommand(attempt, { url: "http://192.168.1.1/" }));
    assert.ok(error, `must refuse ${String(attempt)}`);
    assert.equal(error.code, "EDGE_COMMAND_UNKNOWN");
  }
});

test("undeclared parameters are dropped, not forwarded", () => {
  // The smuggling route: a valid command carrying an extra field the agent
  // might helpfully honour.
  const command = validateCommand("device.info", {
    deviceId: 3,
    url: "http://192.168.1.1/admin",
    host: "10.0.0.1",
    cmd: "rm -rf /",
  });
  assert.deepEqual(command.params, { deviceId: 3 });
  assert.equal("url" in command.params, false);
});

test("an opaque token cannot carry a path or a host", () => {
  for (const bad of ["../../etc/passwd", "http://x", "a/b", "a:b", "a b", "x".repeat(65)]) {
    assert.ok(caught(() => validateCommand("media.closeStream", { deviceId: 1, sessionId: bad })),
      `token validator must reject ${bad}`);
  }
  assert.ok(validateCommand("media.closeStream", { deviceId: 1, sessionId: "abc_DEF-123" }));
});

test("writes exist in the protocol but are marked as mutating", () => {
  // Designed, so the shape is reviewable — and flagged, so an agent can refuse
  // every mutating command by default. Approving the tunnel is not the same as
  // approving writes through it.
  const mutating = Object.entries(EDGE_COMMANDS).filter(([, spec]) => spec.mutates).map(([name]) => name);
  assert.deepEqual(mutating, ["channel.setEncoderBitrate"]);
});

/* ------------------------------------------------------------------ *
 * Enrolment and revocation
 * ------------------------------------------------------------------ */

test("the enrolment secret is returned once and never stored", () => {
  const { enrolmentSecret, record } = createEnrolment({ tenantId: 7, branchId: 2, label: "Dokki shop" });
  assert.ok(enrolmentSecret.length >= 32);
  const serialised = JSON.stringify(record);
  assert.ok(!serialised.includes(enrolmentSecret), "the record must not contain the secret");
  assert.ok(record.secret_verifier && record.secret_verifier !== enrolmentSecret);
  assert.ok(verifyEnrolmentSecret(record, enrolmentSecret));
  assert.ok(!verifyEnrolmentSecret(record, `${enrolmentSecret}x`));
});

test("a revoked agent is refused, and revocation is a stored fact", () => {
  // The scenario: the laptop running the agent is stolen. A stolen agent will
  // not honour a "please stop" message, so refusal must be decided by us on
  // every command.
  const { record } = createEnrolment({ tenantId: 7, branchId: null, label: "x" });
  assert.ok(assertAgentUsable(record, { tenantId: 7 }));

  const revoked = { ...record, status: "revoked", revoked_at: new Date().toISOString() };
  const error = caught(() => assertAgentUsable(revoked, { tenantId: 7 }));
  assert.ok(error);
  assert.equal(error.status, 403);
  assert.equal(error.details.reason, "revoked");
});

test("an agent cannot act for another tenant", () => {
  const { record } = createEnrolment({ tenantId: 7, branchId: null, label: "x" });
  const error = caught(() => assertAgentUsable(record, { tenantId: 8 }));
  assert.ok(error);
  assert.equal(error.code, "SURVEILLANCE_TENANT_MISMATCH");
});

test("a branch-bound agent cannot serve another branch, even for its own tenant", () => {
  // A tenant admin can see every branch in the ERP. That must not turn into
  // reaching the Maadi shop's cameras through the Dokki shop's agent.
  const { record } = createEnrolment({ tenantId: 7, branchId: 2, label: "Dokki" });
  assert.ok(assertAgentUsable(record, { tenantId: 7, branchId: 2 }));
  const error = caught(() => assertAgentUsable(record, { tenantId: 7, branchId: 5 }));
  assert.ok(error);
  assert.equal(error.code, "SURVEILLANCE_BRANCH_FORBIDDEN");
});

test("a tenant-wide agent may serve any branch", () => {
  const { record } = createEnrolment({ tenantId: 7, branchId: null, label: "central" });
  assert.ok(assertAgentUsable(record, { tenantId: 7, branchId: 5 }));
});

/* ------------------------------------------------------------------ *
 * Command envelopes
 * ------------------------------------------------------------------ */

const envelopeFor = (overrides = {}) =>
  buildCommandEnvelope({
    agentId: "ea_test", tenantId: 7, branchId: 2,
    name: "device.info", params: { deviceId: 3 }, ...overrides,
  });

test("an envelope minted for one agent is refused by another", () => {
  const secret = "s".repeat(32);
  const envelope = envelopeFor();
  const signature = signEnvelope(envelope, secret);

  assert.ok(verifyEnvelope(envelope, signature, secret, { agentId: "ea_test", tenantId: 7, branchId: 2 }));
  const error = caught(() => verifyEnvelope(envelope, signature, secret, { agentId: "ea_other" }));
  assert.ok(error);
  assert.equal(error.status, 403);
});

test("editing the command invalidates the signature", () => {
  const secret = "s".repeat(32);
  const envelope = envelopeFor();
  const signature = signEnvelope(envelope, secret);
  const tampered = { ...envelope, cmd: "channel.setEncoderBitrate" };
  assert.ok(caught(() => verifyEnvelope(tampered, signature, secret, {})));
});

test("parameter order does not change the signature", () => {
  // Canonicalisation must be stable, or a JSON round-trip breaks every command.
  const secret = "s".repeat(32);
  const a = envelopeFor({ name: "channel.encoder", params: { deviceId: 3, channelIndex: 1 } });
  const b = { ...a, params: { channelIndex: 1, deviceId: 3 } };
  assert.equal(canonicalise(a), canonicalise(b));
  assert.equal(signEnvelope(a, secret), signEnvelope(b, secret));
});

test("an expired envelope is refused", () => {
  const secret = "s".repeat(32);
  const now = Math.floor(Date.now() / 1000);
  const stale = { ...envelopeFor(), iat: now - 600, exp: now - 1 };
  const signature = signEnvelope(stale, secret);
  const error = caught(() => verifyEnvelope(stale, signature, secret, {}));
  assert.ok(error);
  assert.match(error.message, /expired/i);
});

test("envelope lifetime is bounded regardless of what the caller asks for", () => {
  // A long-lived control envelope is a replayable instruction sitting in a log.
  for (const ttl of [0, -1, 99999, NaN, undefined]) {
    const envelope = envelopeFor({ ttlSeconds: ttl });
    const life = envelope.exp - envelope.iat;
    assert.ok(life >= 5 && life <= 300, `ttl ${String(ttl)} produced ${life}s`);
  }
});

test("two envelopes for the same command are distinct", () => {
  assert.notEqual(envelopeFor().nonce, envelopeFor().nonce);
});

/* ------------------------------------------------------------------ *
 * Liveness and reconnect
 * ------------------------------------------------------------------ */

test("an agent that has never connected is not reported as online", () => {
  assert.equal(agentLiveness({ last_seen_at: null }).state, "never-connected");
});

test("a brief outage does not deregister an agent, but is visible as stale", () => {
  const now = Date.now();
  assert.equal(agentLiveness({ last_seen_at: new Date(now - 30_000).toISOString() }, now).state, "online");
  // A switched-off laptop must not show a green dot.
  assert.equal(agentLiveness({ last_seen_at: new Date(now - 600_000).toISOString() }, now).state, "stale");
});

test("reconnect backoff grows and is jittered", () => {
  // Without jitter, every agent in the estate reconnects in lockstep after a
  // cloud restart, and the reconnect storm keeps the cloud down.
  assert.ok(reconnectDelayMs(0, () => 0) < reconnectDelayMs(5, () => 0));
  assert.ok(reconnectDelayMs(20, () => 1) <= 30_000, "must be capped");
  assert.notEqual(reconnectDelayMs(5, () => 0), reconnectDelayMs(5, () => 0.99));
});
