// Foundation suite: capability model, abstractions, error model, validation,
// and the Phase 1 dormancy claim.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CAPABILITY_KEYS,
  CAPABILITY_STATES,
  DANGEROUS_CAPABILITIES,
  assertCapability,
  capabilityState,
  describeCapabilities,
  isCapabilityEnabled,
  normalizeCapabilitySet,
  unknownCapabilitySet,
} from "../../server/services/surveillance/surveillanceCapabilities.js";
import {
  SurveillanceError,
  UnsupportedCapabilityError,
  errorStatus,
  toErrorResponse,
} from "../../server/services/surveillance/surveillanceErrors.js";
import { SurveillanceProvider } from "../../server/services/surveillance/providers/SurveillanceProvider.js";
import {
  __resetProviderRegistry,
  createProvider,
  getProviderClass,
  listProviders,
  registerProvider,
} from "../../server/services/surveillance/providers/providerRegistry.js";
import { DeviceTransport } from "../../server/services/surveillance/transports/DeviceTransport.js";
import {
  __resetTransportRegistry,
  getTransportClass,
  listTransports,
} from "../../server/services/surveillance/transports/transportRegistry.js";
import { MediaGateway, buildTicketClaims, signTicket, verifyTicket } from "../../server/services/surveillance/media/MediaGateway.js";
import { getMediaGateway, listMediaGateways } from "../../server/services/surveillance/media/mediaGatewayRegistry.js";
import {
  validateCredentialPayload,
  validateDevicePayload,
  validatePlaybackRequest,
  validateProbedCapabilities,
} from "../../server/services/surveillance/surveillanceValidation.js";

const caught = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, but it did not");
};

/* ------------------------------------------------------------------ *
 * Capability model — three states
 * ------------------------------------------------------------------ */

test("a device with nothing probed has every capability unknown", () => {
  const set = unknownCapabilitySet();
  assert.equal(Object.keys(set).length, CAPABILITY_KEYS.length);
  for (const key of CAPABILITY_KEYS) {
    assert.equal(set[key], CAPABILITY_STATES.UNKNOWN, key);
  }
});

test("unknown hides the control, exactly like unsupported", () => {
  // The entire point of the third state: an undetected capability behaves like
  // an absent one at the gate. Anything else is a button that throws.
  const set = normalizeCapabilitySet({ ptz: "unknown", audio: false });
  assert.equal(isCapabilityEnabled(set, "ptz"), false);
  assert.equal(isCapabilityEnabled(set, "audio"), false);
  assert.equal(isCapabilityEnabled(set, "ptz", "read"), false);
});

test("unknown and unsupported are distinguishable for diagnostics", () => {
  const set = normalizeCapabilitySet({ ptz: "unknown", audio: "unsupported" });
  assert.equal(capabilityState(set, "ptz"), "unknown");
  assert.equal(capabilityState(set, "audio"), "unsupported");
  // "this device can't" and "we didn't find out" are very different bug reports.
  const ptzError = caught(() => assertCapability(set, "ptz"));
  const audioError = caught(() => assertCapability(set, "audio"));
  assert.equal(ptzError.code, "SURVEILLANCE_CAPABILITY_UNKNOWN");
  assert.equal(audioError.code, "SURVEILLANCE_CAPABILITY_UNSUPPORTED");
});

test("read-only allows reads and refuses writes", () => {
  const set = normalizeCapabilitySet({ networkSettings: "read-only" });
  assert.equal(isCapabilityEnabled(set, "networkSettings", "read"), true);
  assert.equal(isCapabilityEnabled(set, "networkSettings", "write"), false);
  assert.equal(caught(() => assertCapability(set, "networkSettings", "write")).code, "SURVEILLANCE_CAPABILITY_READ_ONLY");
  assert.equal(assertCapability(set, "networkSettings", "read"), true);
});

test("a corrupted or partial capability row cannot open a control", () => {
  // A junk value must degrade to `unknown`, never to `supported`.
  for (const junk of [{ ptz: "yes" }, { ptz: 1 }, { ptz: null }, { ptz: {} }, {}, null, "nonsense", []]) {
    const set = normalizeCapabilitySet(junk);
    assert.equal(isCapabilityEnabled(set, "ptz"), false, JSON.stringify(junk));
  }
});

test("an adapter cannot smuggle in a capability the UI has no gate for", () => {
  const set = normalizeCapabilitySet({ ptz: true, secretBackdoor: true });
  assert.equal(set.secretBackdoor, undefined);
  assert.equal(caught(() => assertCapability(set, "secretBackdoor")).code, "SURVEILLANCE_CAPABILITY_UNSUPPORTED");
  assert.throws(() => validateProbedCapabilities({ secretBackdoor: true }), /unknown capability keys/);
});

test("booleans from an adapter map onto the two definite states", () => {
  const set = normalizeCapabilitySet({ ptz: true, audio: false });
  assert.equal(set.ptz, CAPABILITY_STATES.SUPPORTED);
  assert.equal(set.audio, CAPABILITY_STATES.UNSUPPORTED);
});

test("the dangerous list matches the actions requiring hard confirmation", () => {
  for (const key of ["deviceRestart", "networkSettings", "storageManagement", "recordingDeletion", "firmwareUpdate", "credentialRotation"]) {
    assert.ok(DANGEROUS_CAPABILITIES.includes(key), key);
  }
  for (const key of ["liveView", "playback", "snapshot", "ptz"]) {
    assert.ok(!DANGEROUS_CAPABILITIES.includes(key), key);
  }
});

test("the client-facing description reports how much is still unknown", () => {
  const described = describeCapabilities({ liveView: true, playback: true });
  assert.equal(described.probe_status, "never");
  assert.equal(described.unknown_count, CAPABILITY_KEYS.length - 2);
  assert.deepEqual(described.dangerous, DANGEROUS_CAPABILITIES);
});

/* ------------------------------------------------------------------ *
 * Error model
 * ------------------------------------------------------------------ */

test("a public error body carries a code and never the operator message", () => {
  const error = new SurveillanceError("connect ETIMEDOUT 192.168.1.108:37777", {
    code: "SURVEILLANCE_DEVICE_TIMEOUT",
    status: 504,
    details: { deviceId: 3 },
  });
  const body = error.toPublicJSON();
  assert.deepEqual(body, { success: false, code: "SURVEILLANCE_DEVICE_TIMEOUT", details: { deviceId: 3 } });
  assert.ok(!JSON.stringify(body).includes("192.168.1.108"));
  assert.equal(errorStatus(error), 504);
});

test("an unexpected error collapses to an opaque code", () => {
  // A pg error naming a column, or an axios error carrying auth headers, must
  // not reach the client just because a handler forgot to type it.
  const pgError = new Error('column "password_encrypted" does not exist');
  pgError.detail = "some internal detail";
  const body = toErrorResponse(pgError);
  assert.equal(body.code, "SURVEILLANCE_INTERNAL_ERROR");
  assert.deepEqual(body.details, {});
  assert.ok(!JSON.stringify(body).includes("password_encrypted"));
  assert.equal(errorStatus(pgError), 500);
});

test("an unsupported capability answers 409 with a usable code, not 500", () => {
  // Requirement #33: "the device is connected but this model does not support
  // that", rather than Error 500.
  const error = new UnsupportedCapabilityError("networkSettings", "unsupported");
  assert.equal(error.status, 409);
  assert.equal(error.toPublicJSON().details.capability, "networkSettings");
});

/* ------------------------------------------------------------------ *
 * Abstractions
 * ------------------------------------------------------------------ */

test("the provider base class cannot be instantiated directly", () => {
  assert.throws(() => new SurveillanceProvider({}), /abstract/);
  assert.throws(() => new DeviceTransport({}), /abstract/);
  assert.throws(() => new MediaGateway({}), /abstract/);
});

test("an unimplemented provider method fails loudly rather than returning undefined", async () => {
  class BareAdapter extends SurveillanceProvider {
    static vendorKey = "bare";
    static displayName = "Bare";
  }
  const adapter = new BareAdapter({ credentials: { username: "u", password: "p" } });

  await assert.rejects(adapter.ptzControl(1, {}), (error) => error.code === "SURVEILLANCE_NOT_IMPLEMENTED");
  await assert.rejects(adapter.restartDevice(), (error) => error.code === "SURVEILLANCE_NOT_IMPLEMENTED");
  assert.throws(() => adapter.buildStreamSource(1, {}), (error) => error.code === "SURVEILLANCE_NOT_IMPLEMENTED");
});

test("serialising a provider or transport does not expose its credentials", () => {
  class BareAdapter extends SurveillanceProvider {
    static vendorKey = "bare";
  }
  const adapter = new BareAdapter({
    credentials: { username: "erp_surveillance", password: "Hunter2" },
    device: { id: 9, host: "192.168.1.108" },
  });

  const serialised = JSON.stringify(adapter);
  assert.ok(!serialised.includes("Hunter2"), serialised);
  assert.ok(!serialised.includes("192.168.1.108"), serialised);
  assert.deepEqual(JSON.parse(serialised), { vendorKey: "bare", deviceId: 9 });
});

test("a transport with no allowlist can resolve nothing", async () => {
  class TestTransport extends DeviceTransport {
    static transportKey = "test";
  }
  const transport = new TestTransport({ device: { id: 1, host: "192.168.1.108", port: 80 } });
  // Empty allowlist is the state of a tenant whose transport is not provisioned.
  await assert.rejects(transport.resolveDestination(), (error) => error.reason === "not-in-tenant-allowlist");
});

test("a transport resolves through the guard and memoises the pinned address", async () => {
  class TestTransport extends DeviceTransport {
    static transportKey = "test";
  }
  const transport = new TestTransport({
    device: { id: 1, host: "192.168.1.108", port: 554 },
    allowedCidrs: ["192.168.1.0/24"],
  });

  const first = await transport.resolveDestination();
  const second = await transport.resolveDestination();
  assert.equal(first.address, "192.168.1.108");
  // One logical operation must not end up dialling two different addresses.
  assert.equal(first, second);
});

test("a transport refuses a redirect through the shared helper", () => {
  class TestTransport extends DeviceTransport {
    static transportKey = "test";
  }
  const transport = new TestTransport({ device: { id: 1, host: "192.168.1.1", port: 80 } });
  assert.throws(() => transport.assertSafeResponse(302), /redirect/);
  assert.equal(transport.assertSafeResponse(200), 200);
});

/* ------------------------------------------------------------------ *
 * Registries — Phase 1 is dormant
 * ------------------------------------------------------------------ */

test("no vendor, transport or media gateway is registered in this build", () => {
  // The dormancy claim. Nothing in Phase 1 can reach a device or a media
  // server, because there is nothing registered to do it with.
  assert.deepEqual(listProviders(), []);
  assert.deepEqual(listTransports(), []);
  assert.deepEqual(listMediaGateways(), []);

  assert.throws(() => getProviderClass("dahua"), (error) => error.code === "SURVEILLANCE_PROVIDER_UNKNOWN");
  assert.throws(() => getTransportClass("direct"), (error) => error.code === "SURVEILLANCE_TRANSPORT_UNKNOWN");
  assert.throws(() => getMediaGateway("mediamtx"), (error) => error.code === "SURVEILLANCE_MEDIA_GATEWAY_UNAVAILABLE");
});

test("registering a vendor makes it selectable without touching the core", (t) => {
  t.after(__resetProviderRegistry);

  class DemoAdapter extends SurveillanceProvider {
    static vendorKey = "demo";
    static displayName = "Demo";
    static defaultPort = 8080;
  }
  registerProvider(DemoAdapter);

  assert.deepEqual(listProviders(), [{ vendor_key: "demo", display_name: "Demo", default_port: 8080 }]);
  assert.ok(createProvider("demo", {}) instanceof DemoAdapter);
  // Lookup is case-insensitive so a stored vendor_key cannot miss on casing.
  assert.equal(getProviderClass("DEMO"), DemoAdapter);
  // Double registration is a wiring bug and must fail at boot.
  assert.throws(() => registerProvider(DemoAdapter), /already registered/);
});

test("a registry entry without a key is refused", (t) => {
  t.after(() => {
    __resetProviderRegistry();
    __resetTransportRegistry();
  });
  assert.throws(() => registerProvider(class {}), /vendorKey/);
});

/* ------------------------------------------------------------------ *
 * Media tickets
 * ------------------------------------------------------------------ */

const TICKET_KEY = "b7f3c1a95e2d4806af17bc3d9e05128647aa3f9c02bd5e7148936cf20ab4dd51";

const withKey = (fn) => {
  const original = process.env.SURVEILLANCE_ENCRYPTION_KEY;
  process.env.SURVEILLANCE_ENCRYPTION_KEY = TICKET_KEY;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.SURVEILLANCE_ENCRYPTION_KEY;
    else process.env.SURVEILLANCE_ENCRYPTION_KEY = original;
  }
};

const claimsFor = (overrides = {}) =>
  buildTicketClaims({ tenantId: 7, userId: 3, deviceId: 4, channelId: 11, stream: "sub", ttlSeconds: 60, ...overrides });

test("a stream ticket is bound to its exact stream and viewer", () => {
  withKey(() => {
    const ticket = signTicket(claimsFor());
    // The ticket it was minted for.
    assert.equal(verifyTicket(ticket, { tenantId: 7, userId: 3, deviceId: 4, channelId: 11, stream: "sub" }).c, 11);

    // Replaying it for a different channel, device, tenant, user or stream.
    for (const wrong of [
      { channelId: 12 },
      { deviceId: 5 },
      { tenantId: 8 },
      { userId: 4 },
      { stream: "main" },
    ]) {
      assert.throws(
        () => verifyTicket(ticket, { tenantId: 7, userId: 3, deviceId: 4, channelId: 11, stream: "sub", ...wrong }),
        (error) => error.code === "SURVEILLANCE_PERMISSION_DENIED",
        JSON.stringify(wrong),
      );
    }
  });
});

test("a tampered or forged ticket is refused", () => {
  withKey(() => {
    const ticket = signTicket(claimsFor());
    const [payload, signature] = ticket.split(".");

    // Re-sign nothing: swap the payload for one claiming another channel.
    const forgedPayload = Buffer.from(JSON.stringify({ ...claimsFor(), c: 12 })).toString("base64url");
    for (const bad of [`${forgedPayload}.${signature}`, `${payload}.AAAA`, payload, "", "nonsense"]) {
      assert.throws(() => verifyTicket(bad, {}), (error) => error.code === "SURVEILLANCE_PERMISSION_DENIED", bad);
    }
  });
});

test("an expired ticket is refused", () => {
  withKey(() => {
    const expired = signTicket({ ...claimsFor(), exp: Math.floor(Date.now() / 1000) - 1 });
    assert.throws(() => verifyTicket(expired, {}), /expired/);
  });
});

test("a media path name is opaque and not enumerable from ids", () => {
  withKey(() => {
    class DemoGateway extends MediaGateway {
      static gatewayKey = "demo";
    }
    const gateway = new DemoGateway({});
    const name = gateway.pathNameFor({ tenantId: 7, deviceId: 4, channelId: 11, stream: "sub" });

    // Path names appear in the media server's own logs and metrics; an
    // id-shaped name is enumerable by anyone who reaches the gateway.
    assert.match(name, /^s[0-9a-f]{24}$/);
    // Opaque: none of the ids appear in it in any recoverable arrangement, and
    // a neighbouring channel produces an unrelated name rather than an
    // adjacent one.
    assert.ok(!name.includes("7411"));
    assert.notEqual(name, gateway.pathNameFor({ tenantId: 7, deviceId: 4, channelId: 12, stream: "sub" }));
    assert.notEqual(name, gateway.pathNameFor({ tenantId: 8, deviceId: 4, channelId: 11, stream: "sub" }));
    // Deterministic, so re-requesting a stream reuses the path instead of
    // starting a second copy of it.
    assert.equal(name, gateway.pathNameFor({ tenantId: 7, deviceId: 4, channelId: 11, stream: "sub" }));
    assert.notEqual(name, gateway.pathNameFor({ tenantId: 7, deviceId: 4, channelId: 11, stream: "main" }));
  });
});

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

test("device payloads drop unknown fields instead of passing them through", () => {
  // Mass assignment: a caller must not be able to set discovered facts or
  // capabilities by adding them to the body.
  const result = validateDevicePayload({
    name: "Store DVR",
    branch_id: 1,
    vendor_key: "Dahua",
    transport_type: "Direct",
    host: "192.168.1.108",
    port: "80",
    protocol: "http",
    capabilities: { deviceRestart: true },
    status: "online",
    tenant_id: 999,
    is_super_admin: true,
  });

  assert.deepEqual(Object.keys(result).sort(), [
    "branch_id", "host", "name", "port", "protocol", "transport_type", "vendor_key",
  ]);
  assert.equal(result.vendor_key, "dahua");
  assert.equal(result.port, 80);
});

test("a port is rejected rather than coerced during validation", () => {
  // Surrounding whitespace is trimmed (benign); an internal space is not.
  for (const port of ["80abc", "8 0", "8e1", "0x50", "", null, -1, 70000]) {
    assert.throws(
      () => validateDevicePayload({ name: "x", branch_id: 1, vendor_key: "d", transport_type: "t", host: "a.b", port, protocol: "http" }),
      /validation failed/,
      JSON.stringify(port),
    );
  }
});

test("control characters are refused in a device name", () => {
  // They end up in log lines and in the media path namespace.
  const CONTROL_CHARS = ["\u0007", "\u0000", "\u001b", "\u007f"];
  for (const ch of CONTROL_CHARS) {
    const name = `Store${ch}DVR`;
    assert.throws(
      () => validateDevicePayload({ name, branch_id: 1, vendor_key: "d", transport_type: "t", host: "a.b", port: 80, protocol: "http" }),
      /control characters/,
      JSON.stringify(name),
    );
  }
});

test("credential validation accepts whatever the device already accepts", () => {
  // Rejecting a password the recorder itself uses would make devices unaddable.
  const result = validateCredentialPayload({ username: "erp_surveillance", password: "p@ss:word/with@ats" });
  assert.equal(result.password, "p@ss:word/with@ats");
  assert.throws(() => validateCredentialPayload({ username: "u", password: "" }), /validation failed/);
  assert.throws(() => validateCredentialPayload({ username: "u", password: "x".repeat(300) }), /validation failed/);
});

test("a playback window must be ordered and bounded", () => {
  const ok = validatePlaybackRequest({ from: "2026-08-16T00:00:00Z", to: "2026-08-16T23:59:00Z" });
  assert.ok(ok.from instanceof Date);
  assert.throws(() => validatePlaybackRequest({ from: "2026-08-16T10:00:00Z", to: "2026-08-16T09:00:00Z" }), /after/);
  assert.throws(() => validatePlaybackRequest({ from: "2026-01-01T00:00:00Z", to: "2026-08-01T00:00:00Z" }), /7 days/);
  assert.throws(() => validatePlaybackRequest({ from: "not a date", to: "2026-08-16T00:00:00Z" }), /ISO 8601/);
});

/* ------------------------------------------------------------------ *
 * Deploy-safety invariants
 * ------------------------------------------------------------------ */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The module explains in prose which operations it refuses to perform, and
 *  those explanations name the very keywords being searched for. */
const stripLineComments = (source) => source.replace(/^[^\S\n]*\/\/.*$/gm, "");

test("the schema bootstrap contains no backfill that could crash the boot", () => {
  // bootstrapStartup() calls process.exit(1) on any throw, so a data migration
  // here would take the whole backend down, not just this feature.
  const source = read("../../server/services/surveillance/surveillanceSchema.js");
  const body = stripLineComments(source.slice(source.indexOf("const createTables")));

  assert.doesNotMatch(body, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(body, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(body, /\bDROP\b/i);
  assert.doesNotMatch(body, /\bTRUNCATE\b/i);

  // ALTER is narrowed, not forbidden. ADD COLUMN IF NOT EXISTS cannot fail on
  // existing rows, cannot lose data, and cannot rewrite the table — and it is
  // the only way to reach an environment whose tables already exist, since
  // CREATE TABLE IF NOT EXISTS is a no-op there. Every other form (type
  // changes, NOT NULL without a default, column drops) stays forbidden.
  for (const statement of body.match(/ALTER\s+TABLE[^`]*/gi) || []) {
    assert.match(
      statement,
      /^ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i,
      `only ADD COLUMN IF NOT EXISTS is allowed here: ${statement}`,
    );
  }

  // The one INSERT is permission definitions, and it is conflict-proof.
  const inserts = body.match(/INSERT INTO (\w+)/g) || [];
  assert.deepEqual(inserts, ["INSERT INTO permissions"]);
  assert.match(body, /ON CONFLICT \(module, action\) DO NOTHING/);
});

test("the deploy grants surveillance access to nobody, including admins", () => {
  // Every other feature backfills itself to admin roles. This one must not:
  // rolling out a build that silently hands live store video to fifteen staff
  // accounts is the worst available failure mode.
  // Match the code body, not the header: the module explains in prose exactly
  // which backfill it is choosing not to perform.
  const source = read("../../server/services/surveillance/surveillanceSchema.js");
  const body = source.slice(source.indexOf("const createTables"));
  const migration = read("../../server/database/migrations/2026-08-17-add-surveillance-center.sql");
  const migrationBody = migration.replace(/^--.*$/gm, "");
  for (const [name, text] of [["schema", body], ["migration", migrationBody]]) {
    assert.doesNotMatch(text, /INSERT INTO role_permissions/i, name);
  }

  // And the permissions must not have been added to CORE_PERMISSIONS, which is
  // auto-granted to admin roles by an existing block in that file.
  const middleware = read("../../server/middleware/permissionMiddleware.js");
  const coreStart = middleware.indexOf("const CORE_PERMISSIONS");
  const coreEnd = middleware.indexOf("];", coreStart);
  assert.doesNotMatch(middleware.slice(coreStart, coreEnd), /surveillance/i);
});

test("no surveillance route is mounted in this build", () => {
  const server = read("../../server/server.js");
  assert.doesNotMatch(server, /app\.use\("\/api\/surveillance/);
  assert.match(server, /await ensureSurveillanceSchema\(db\)/);
});

test("the frontend permission matrix mirrors the backend permission list", () => {
  const schema = read("../../server/services/surveillance/surveillanceSchema.js");
  const rbac = read("../../src/modules/permissions/lib/rbacStore.js");

  const backend = [...schema.matchAll(/\["(surveillance[\w.]*)", "(\w+)",/g)].map(
    ([, moduleName, action]) => `${moduleName}.${action}`,
  );
  assert.ok(backend.length >= 14, `expected the full permission list, got ${backend.length}`);

  for (const permission of backend) {
    const moduleName = permission.slice(0, permission.lastIndexOf("."));
    const action = permission.slice(permission.lastIndexOf(".") + 1);
    const key = moduleName === "surveillance" ? "surveillance" : `"${moduleName}"`;
    const block = rbac.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
    assert.ok(block, `missing rbacStore entry for ${moduleName}`);
    assert.ok(block[1].includes(`"${action}"`), `missing ${permission} in rbacStore`);
  }
});
