// Owner-protection regression suite.
//
// Requirement #22: device management is visible to the system owner only.
// Staff — including staff holding a role named "admin" — do not get it unless
// the owner explicitly grants it.
//
// The obstacle is that permit() short-circuits on the role NAME:
//
//     if (isAdmin || isSuperAdmin || hasWildcard) return next();
//
// so a permission-based gate would be satisfied by every admin automatically.
// These tests prove requireSurveillanceOwner does not inherit that bypass.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  __resetSurveillanceRateLimits,
  isSurveillanceOwner,
  requireSurveillanceOwner,
  surveillanceRateLimit,
} from "../../server/middleware/surveillanceGuards.js";

const fakeRes = () => {
  const res = { statusCode: null, body: null, headers: {} };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  res.setHeader = (key, value) => {
    res.headers[key] = value;
  };
  return res;
};

const run = (middleware, req) => {
  const res = fakeRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
};

/** The rate limiter is async; await it before reading the verdict. */
const runAsync = async (middleware, req) => {
  const res = fakeRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
};

/* ------------------------------------------------------------------ *
 * Who gets through
 * ------------------------------------------------------------------ */

test("the owner passes", () => {
  const { nextCalled } = run(requireSurveillanceOwner, {
    user: { id: 1, tenant_id: 7, is_super_admin: true, role: "owner" },
  });
  assert.equal(nextCalled, true);
  assert.equal(isSurveillanceOwner({ is_super_admin: true }), true);
});

test("a role named admin is NOT enough", () => {
  // The central claim. permit("surveillance.device", "settings") would let all
  // of these through; this guard does not.
  for (const role of ["admin", "Admin", "ADMIN", "super admin", "super_admin", "superadmin", "platform_admin"]) {
    const { res, nextCalled } = run(requireSurveillanceOwner, {
      user: { id: 2, tenant_id: 7, role, is_super_admin: false },
    });
    assert.equal(nextCalled, false, role);
    assert.equal(res.statusCode, 403, role);
    assert.equal(res.body.code, "SURVEILLANCE_OWNER_REQUIRED", role);
  }
});

test("a wildcard permission is NOT enough", () => {
  const { nextCalled, res } = run(requireSurveillanceOwner, {
    user: { id: 3, tenant_id: 7, role: "admin", permissions: ["*"], is_super_admin: false },
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("holding every surveillance permission is NOT enough", () => {
  // Permissions govern watching cameras. They do not govern adding recorders,
  // reading their addresses, or storing their credentials.
  const { nextCalled } = run(requireSurveillanceOwner, {
    user: {
      id: 4,
      tenant_id: 7,
      role: "manager",
      is_super_admin: false,
      permissions: [
        "surveillance.view",
        "surveillance.live",
        "surveillance.device.view",
        "surveillance.device.settings",
        "surveillance.admin.manage",
      ],
    },
  });
  assert.equal(nextCalled, false);
});

test("a truthy-but-not-true is_super_admin is NOT enough", () => {
  // pg returns a real boolean, but a JWT-only fallback path or a hand-built
  // object could carry a string. Loose equality here would be a bypass.
  for (const value of ["true", 1, "1", "yes", {}, []]) {
    const { nextCalled } = run(requireSurveillanceOwner, {
      user: { id: 5, tenant_id: 7, is_super_admin: value },
    });
    assert.equal(nextCalled, false, JSON.stringify(value));
  }
});

test("a missing or anonymous user is refused", () => {
  for (const req of [{}, { user: null }, { user: {} }]) {
    const { nextCalled, res } = run(requireSurveillanceOwner, req);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  }
});

/* ------------------------------------------------------------------ *
 * Why the check reads a column, not a role string
 * ------------------------------------------------------------------ */

test("the guard reads users.is_super_admin and never a role name", () => {
  // `roles` is per-tenant with UNIQUE (tenant_id, name), so a tenant admin can
  // create a role literally called "super_admin". Any name-based check is
  // therefore self-service escalation. Asserted structurally because the
  // absence of a code path cannot be proven by calling it.
  const source = readFileSync(
    new URL("../../server/middleware/surveillanceGuards.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export const requireSurveillanceOwner");
  const end = source.indexOf("export const isSurveillanceOwner");
  const guard = source.slice(start, end);

  assert.match(guard, /req\?\.user\?\.is_super_admin === true/);
  assert.doesNotMatch(guard, /role/i);
  assert.doesNotMatch(guard, /permit\(/);
  assert.doesNotMatch(guard, /isSuperAdminUser/);
  assert.doesNotMatch(guard, /permissions/);
});

test("the guard module does not import the platform permission middleware", () => {
  const source = readFileSync(
    new URL("../../server/middleware/surveillanceGuards.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from "\.\/permissionMiddleware\.js"/);
  assert.doesNotMatch(source, /requestScope/);
});

/* ------------------------------------------------------------------ *
 * Rate limiting on dangerous commands
 * ------------------------------------------------------------------ */

test("a second restart within the window is refused", async (t) => {
  t.after(__resetSurveillanceRateLimits);
  __resetSurveillanceRateLimits();

  const limiter = surveillanceRateLimit("restart");
  const req = { user: { id: 1, tenant_id: 7 }, surveillanceTenantId: 7, params: { id: "3" } };

  assert.equal((await runAsync(limiter, req)).nextCalled, true);

  const second = await runAsync(limiter, req);
  assert.equal(second.nextCalled, false);
  assert.equal(second.res.statusCode, 429);
  assert.equal(second.res.body.code, "SURVEILLANCE_RATE_LIMITED");
  assert.ok(Number(second.res.headers["Retry-After"]) > 0);
});

test("rate limit budgets do not leak between devices or tenants", async (t) => {
  t.after(__resetSurveillanceRateLimits);
  __resetSurveillanceRateLimits();

  const limiter = surveillanceRateLimit("restart");
  const deviceThree = { user: { id: 1, tenant_id: 7 }, surveillanceTenantId: 7, params: { id: "3" } };
  const deviceFour = { user: { id: 1, tenant_id: 7 }, surveillanceTenantId: 7, params: { id: "4" } };
  const otherTenant = { user: { id: 2, tenant_id: 99 }, surveillanceTenantId: 99, params: { id: "3" } };

  assert.equal((await runAsync(limiter, deviceThree)).nextCalled, true);
  // A different device has its own budget.
  assert.equal((await runAsync(limiter, deviceFour)).nextCalled, true);
  // A different tenant with the same device id must neither consume ours nor be
  // blocked by ours.
  assert.equal((await runAsync(limiter, otherTenant)).nextCalled, true);
  // The original is still spent.
  assert.equal((await runAsync(limiter, deviceThree)).nextCalled, false);
});

test("PTZ allows a burst but stops a flood", async (t) => {
  t.after(__resetSurveillanceRateLimits);
  __resetSurveillanceRateLimits();

  const limiter = surveillanceRateLimit("ptz");
  const req = { user: { id: 1, tenant_id: 7 }, surveillanceTenantId: 7, params: { id: "3" } };

  // Holding a direction button legitimately emits a burst.
  for (let index = 0; index < 30; index += 1) {
    assert.equal((await runAsync(limiter, req)).nextCalled, true, `command ${index}`);
  }
  assert.equal((await runAsync(limiter, req)).nextCalled, false);
});

test("an unknown rate limit name fails at wiring time, not at request time", () => {
  // A typo in a route definition must break the boot, not silently disable the
  // limit on a dangerous command.
  assert.throws(() => surveillanceRateLimit("restrat"), /unknown surveillance rate limit/);
});
