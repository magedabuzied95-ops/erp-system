// Stream ticket security.
//
// A ticket is the ONLY thing standing between an authenticated ERP user and
// every camera in the tenant, because the media server does not know what a
// tenant is. Everything MediaMTX enforces, it enforces by asking us — so the
// interesting tests are not "does a good ticket work" but "what does a valid
// ticket, used somewhere it was not minted for, do".
//
// The answer must always be: nothing.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SURVEILLANCE_ENCRYPTION_KEY ||= "0".repeat(64);

const {
  buildTicketClaims,
  signTicket,
  verifyTicket,
  mediaPathName,
  mediaPathForClaims,
} = await import("../../server/services/surveillance/media/MediaGateway.js");

const { isLoopbackAddress } = await import(
  "../../server/services/surveillance/surveillanceNetworkGuard.js"
);

const caught = (fn) => {
  try { fn(); return null; } catch (error) { return error; }
};

const mint = (overrides = {}) =>
  signTicket(buildTicketClaims({
    tenantId: 7, userId: 42, deviceId: 3, channelId: 1, stream: "0", ttlSeconds: 60,
    ...overrides,
  }));

/* ------------------------------------------------------------------ *
 * The binding that matters most
 * ------------------------------------------------------------------ */

test("a ticket opens exactly one path and no other", () => {
  // The attack: a user legitimately entitled to channel 1 asks for channel 9.
  // The ticket is genuine, unexpired and correctly signed. Only the derived
  // path name stops it.
  const claims = buildTicketClaims({ tenantId: 7, userId: 42, deviceId: 3, channelId: 1, stream: "0" });
  const authorised = mediaPathForClaims(claims);
  const other = mediaPathName({ tenantId: 7, deviceId: 3, channelId: 9, stream: "0" });

  assert.notEqual(authorised, other);
  assert.equal(authorised, mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "0" }));
});

test("the same channel id in two tenants is two different paths", () => {
  // Channel ids are per-tenant. If the path did not include the tenant, tenant
  // B's ticket would name tenant A's stream.
  assert.notEqual(
    mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "0" }),
    mediaPathName({ tenantId: 8, deviceId: 3, channelId: 1, stream: "0" }),
  );
});

test("main and sub of one channel are different paths", () => {
  assert.notEqual(
    mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "0" }),
    mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "1" }),
  );
});

test("a path name leaks neither ids nor device address", () => {
  const name = mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "0" });
  // Opaque and non-enumerable: the media server's own logs and metrics carry
  // this string, and "tenant7_device3_channel1" would be a directory listing.
  assert.match(name, /^s[0-9a-f]{24}$/);
  for (const leak of ["7", "device", "channel", "192.168", "tenant"]) {
    assert.ok(!name.slice(1).includes(leak) || /^[0-9a-f]+$/.test(leak), `path leaks ${leak}`);
  }
});

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

test("a ticket minted for one channel fails verification for another", () => {
  const ticket = mint({ channelId: 1 });
  assert.equal(verifyTicket(ticket, { channelId: 1 }).c, 1);
  const error = caught(() => verifyTicket(ticket, { channelId: 9 }));
  assert.ok(error, "must reject a mismatched channel");
  assert.equal(error.status, 403);
});

test("a ticket minted for one user fails for another", () => {
  const error = caught(() => verifyTicket(mint({ userId: 42 }), { userId: 43 }));
  assert.ok(error);
  assert.equal(error.status, 403);
});

test("a ticket minted in one tenant fails in another", () => {
  const error = caught(() => verifyTicket(mint({ tenantId: 7 }), { tenantId: 8 }));
  assert.ok(error);
  assert.equal(error.status, 403);
});

test("an expired ticket is refused", () => {
  // Signed by us, structurally perfect, and one second stale. This has to be
  // hand-built: buildTicketClaims will not mint an already-dead ticket.
  const now = Math.floor(Date.now() / 1000);
  const expired = signTicket({
    v: 1, t: 7, u: 42, d: 3, c: 1, s: "0",
    iat: now - 120, exp: now - 1, jti: "expiredjti",
  });
  const error = caught(() => verifyTicket(expired));
  assert.ok(error, "a correctly signed but stale ticket must still fail");
  assert.match(error.message, /expired/i);
  assert.equal(error.status, 403);
});

test("a zero or negative TTL cannot mint an immortal ticket", () => {
  // The clamp is what makes the expiry test above need a hand-built ticket, so
  // pin it: a caller passing 0, -1 or nonsense must get the bounded default,
  // never a ticket that lives forever.
  const now = Math.floor(Date.now() / 1000);
  for (const ttl of [0, -1, -99999, NaN, undefined, "abc"]) {
    const claims = buildTicketClaims({ tenantId: 7, userId: 42, deviceId: 3, channelId: 1, stream: "0", ttlSeconds: ttl });
    const lifetime = claims.exp - claims.iat;
    assert.ok(lifetime > 0 && lifetime <= 60, `ttl ${String(ttl)} produced a ${lifetime}s ticket`);
    assert.ok(claims.exp > now, `ttl ${String(ttl)} produced an already-expired ticket`);
  }
});

test("editing the claims invalidates the signature", () => {
  const ticket = mint({ channelId: 1 });
  const [payload] = ticket.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  claims.c = 9;
  const forged = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${ticket.split(".")[1]}`;

  const error = caught(() => verifyTicket(forged));
  assert.ok(error, "a re-signed-nothing payload swap must fail");
  assert.match(error.message, /signature/i);
});

test("malformed tickets are refused rather than throwing something else", () => {
  for (const bad of ["", ".", "abc", "a.b.c", "....", null, undefined, "%%%.%%%"]) {
    const error = caught(() => verifyTicket(bad));
    assert.ok(error, `must reject ${JSON.stringify(bad)}`);
    assert.equal(error.status, 403, `wrong status for ${JSON.stringify(bad)}`);
  }
});

test("a signature of the wrong length does not throw from the comparison", () => {
  // timingSafeEqual throws on length mismatch, and an exception escaping the
  // comparison is itself a crude oracle. It must come back as a clean 403.
  const ticket = mint();
  const error = caught(() => verifyTicket(`${ticket.split(".")[0]}.short`));
  assert.equal(error.status, 403);
  assert.match(error.message, /signature/i);
});

test("a ticket signed with a different key is refused", () => {
  const ticket = mint();
  const original = process.env.SURVEILLANCE_ENCRYPTION_KEY;
  try {
    process.env.SURVEILLANCE_ENCRYPTION_KEY = "f".repeat(64);
    const error = caught(() => verifyTicket(ticket));
    assert.ok(error);
    assert.match(error.message, /signature/i);
  } finally {
    process.env.SURVEILLANCE_ENCRYPTION_KEY = original;
  }
});

test("rotating the key also rotates the path namespace", () => {
  // Paths are HMACed with the same derived key, so a rotation must not leave
  // old path names addressable by new tickets or vice versa.
  const before = mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "0" });
  const original = process.env.SURVEILLANCE_ENCRYPTION_KEY;
  try {
    process.env.SURVEILLANCE_ENCRYPTION_KEY = "f".repeat(64);
    assert.notEqual(before, mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "0" }));
  } finally {
    process.env.SURVEILLANCE_ENCRYPTION_KEY = original;
  }
});

test("two tickets for the same stream are still distinct values", () => {
  // jti is random, so an observer cannot tell from the ticket alone whether two
  // viewers are watching the same camera.
  assert.notEqual(mint(), mint());
});

/* ------------------------------------------------------------------ *
 * Publish authorisation
 * ------------------------------------------------------------------ */

test("only loopback may publish into a surveillance path", () => {
  // The one publisher is our own FFmpeg over loopback. Anything else pushing
  // video into a camera path is injecting footage into a security system.
  for (const local of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.5.5.5"]) {
    assert.equal(isLoopbackAddress(local), true, local);
  }
  for (const remote of ["192.168.1.108", "10.0.0.5", "::ffff:192.168.1.1", "8.8.8.8", "", "localhost"]) {
    assert.equal(isLoopbackAddress(remote), false, remote);
  }
});

test("a hostname that merely starts with 127.0.0.1 is not loopback", () => {
  assert.equal(isLoopbackAddress("127.0.0.1.evil.com"), false);
});

/* ------------------------------------------------------------------ *
 * The rule about proxies
 * ------------------------------------------------------------------ */

test("no route forwards an arbitrary URL or CGI path to a device", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(
    new URL("../../server/routes/surveillance.js", import.meta.url),
    "utf8",
  );
  for (const name of ["proxyVendorRequest", "req.body.url", "req.body.path", "req.query.url"]) {
    assert.ok(!source.includes(name), `routes must not contain ${name}`);
  }
});
