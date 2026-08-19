// The Edge Agent's control protocol.
//
// THE ONE PROPERTY THIS FILE EXISTS TO GUARANTEE
// ----------------------------------------------
// An Edge Agent runs inside a customer's shop, on their LAN, and holds a
// persistent outbound connection to our cloud. That connection is, structurally,
// a hole through their firewall that we control. The single question that
// decides whether this feature is safe is: what can the cloud make the agent do?
//
// The wrong answer — the one that takes an afternoon to build — is a relay:
// `{ method, url, body }` forwarded to the LAN. That hands anyone who can reach
// our control plane a fully authenticated proxy into a customer's internal
// network: their router, their NAS, their point-of-sale, their other tenants'
// equipment. A compromised cloud account would become a foothold in every shop
// that ever enrolled an agent.
//
// So the agent accepts a CLOSED SET of named commands. There is no field
// anywhere in this protocol that carries a URL, a host, a port or a path. The
// agent resolves each command against the device record IT holds, and a command
// it does not recognise is refused without being interpreted.
//
// Adding a capability means adding a command here, with its own typed
// parameters, and that is a reviewable diff rather than a configuration change.

import crypto from "node:crypto";

/**
 * Every command an agent will execute, and the shape of its parameters.
 *
 * `deviceId` is always resolved by the AGENT against its own enrolled device
 * list — the cloud names a device by id, never by address. An agent asked about
 * a device it was not enrolled for refuses, which is what stops one tenant's
 * control plane reaching another tenant's recorder even if ids were guessed.
 */
export const EDGE_COMMANDS = Object.freeze({
  // ---- health ----------------------------------------------------------
  "agent.ping": { params: {}, mutates: false },
  "agent.describe": { params: {}, mutates: false },

  // ---- device reads ----------------------------------------------------
  "device.testConnection": { params: { deviceId: "id" }, mutates: false },
  "device.probe": { params: { deviceId: "id" }, mutates: false },
  "device.info": { params: { deviceId: "id" }, mutates: false },
  "device.channels": { params: { deviceId: "id" }, mutates: false },
  "device.storage": { params: { deviceId: "id" }, mutates: false },
  "device.network": { params: { deviceId: "id" }, mutates: false },
  "device.time": { params: { deviceId: "id" }, mutates: false },
  "channel.encoder": { params: { deviceId: "id", channelIndex: "index" }, mutates: false },
  "channel.recording": { params: { deviceId: "id", channelIndex: "index" }, mutates: false },
  "channel.motion": { params: { deviceId: "id", channelIndex: "index" }, mutates: false },
  "channel.snapshot": { params: { deviceId: "id", channelIndex: "index" }, mutates: false },

  // ---- media -----------------------------------------------------------
  // The agent starts a LOCAL relay and returns a loopback URL on its own host.
  // The cloud never receives the recorder's address or credential; the agent
  // holds those and never sends them anywhere.
  "media.openStream": {
    params: { deviceId: "id", channelIndex: "index", profileKey: "token" },
    mutates: false,
  },
  "media.closeStream": { params: { deviceId: "id", sessionId: "token" }, mutates: false },

  // ---- playback --------------------------------------------------------
  "playback.search": {
    params: { deviceId: "id", channelIndex: "index", from: "timestamp", to: "timestamp" },
    mutates: false,
  },
  "playback.open": {
    params: { deviceId: "id", channelIndex: "index", from: "timestamp", to: "timestamp", recordingToken: "token" },
    mutates: false,
  },

  // ---- writes ----------------------------------------------------------
  // Present so the shape is designed, and DISABLED at the agent by default.
  // A write reaching a recorder over a cloud-controlled tunnel deserves its own
  // approval, separate from approving the tunnel.
  "channel.setEncoderBitrate": {
    params: { deviceId: "id", channelIndex: "index", bitrateKbps: "int" },
    mutates: true,
  },
});

/** Parameter validators. Each is total: it returns a value or throws. */
const VALIDATORS = {
  id: (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new Error("expected a positive integer id");
    return n;
  },
  index: (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 256) throw new Error("expected a channel index 0-256");
    return n;
  },
  int: (value) => {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error("expected an integer");
    return n;
  },
  // Deliberately narrow. A token that permitted "/" or ":" could carry a path
  // or a host into a command that is supposed to name neither.
  token: (value) => {
    const s = String(value ?? "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new Error("expected an opaque token");
    return s;
  },
  timestamp: (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("expected an ISO timestamp");
    return date.toISOString();
  },
};

/**
 * Validate a command before it is sent, and again before it is executed.
 *
 * Both ends validate. The cloud validating alone would mean a compromised
 * cloud can send anything; the agent validating alone would mean malformed
 * commands travel. Neither side trusts the other's checking.
 */
export const validateCommand = (name, params = {}) => {
  const spec = EDGE_COMMANDS[name];
  if (!spec) {
    // The refusal names the command but does not echo the parameters — an
    // unknown command's payload is attacker-controlled.
    const error = new Error(`unknown edge command: ${String(name).slice(0, 64)}`);
    error.code = "EDGE_COMMAND_UNKNOWN";
    throw error;
  }

  const validated = {};
  for (const [key, kind] of Object.entries(spec.params)) {
    if (!(key in params)) {
      const error = new Error(`missing parameter ${key} for ${name}`);
      error.code = "EDGE_COMMAND_INVALID";
      throw error;
    }
    try {
      validated[key] = VALIDATORS[kind](params[key]);
    } catch (cause) {
      const error = new Error(`invalid ${key} for ${name}: ${cause.message}`);
      error.code = "EDGE_COMMAND_INVALID";
      throw error;
    }
  }

  // Anything the caller supplied that the command does not declare is dropped,
  // not passed through. This is what stops a `url` or `host` field riding along
  // inside an otherwise-valid command.
  return { name, params: validated, mutates: spec.mutates };
};

/**
 * A command envelope, signed for the agent that will run it.
 *
 * Bound to ONE agent, ONE tenant and ONE branch. An envelope minted for the
 * Dokki shop is meaningless at the Maadi shop even if both agents are ours,
 * because the agent verifies the binding against its own enrolment before it
 * looks at the command.
 */
export const buildCommandEnvelope = ({
  agentId, tenantId, branchId, name, params, ttlSeconds = 30, nonce,
}) => {
  const command = validateCommand(name, params);
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    agent: String(agentId),
    tenant: Number(tenantId),
    // null means tenant-wide; a number binds the command to one branch.
    branch: branchId === null || branchId === undefined ? null : Number(branchId),
    cmd: command.name,
    params: command.params,
    iat: now,
    // Short by design. A control command is executed immediately or not at all;
    // a long-lived envelope is a replayable instruction sitting in a log.
    exp: now + Math.max(5, Math.min(300, Number(ttlSeconds) || 30)),
    nonce: nonce || crypto.randomBytes(12).toString("base64url"),
  };
};

/** Canonical serialisation, so both ends sign the same bytes. */
export const canonicalise = (envelope) =>
  JSON.stringify([
    envelope.v, envelope.agent, envelope.tenant, envelope.branch,
    envelope.cmd,
    // Object key order must not change the signature.
    Object.keys(envelope.params).sort().map((k) => [k, envelope.params[k]]),
    envelope.iat, envelope.exp, envelope.nonce,
  ]);
