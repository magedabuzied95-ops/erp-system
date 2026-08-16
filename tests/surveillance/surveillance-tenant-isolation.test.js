// Tenant isolation and header-spoofing regression suite.
//
// The claim under test: a user of tenant A cannot reach tenant B's devices,
// channels, streams, playback, settings or credentials — even knowing the exact
// ids, and even while sending whatever headers, query parameters and body
// fields they like.
//
// Two layers, tested two ways:
//
//   1. RESOLUTION (behavioural). The tenant comes from the authenticated user
//      row and from nowhere else. Asserted by calling the resolver and the
//      middleware with hostile requests.
//   2. QUERYING (structural). Every repository statement carries a tenant
//      predicate. Asserted by parsing the repository sources, because proving
//      it behaviourally needs a live Postgres with two seeded tenants — which
//      belongs in an integration environment, not the unit suite. This gap is
//      stated rather than papered over: see the final test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertBranchAllowed,
  assertRowTenant,
  branchAccessFilter,
  requireSurveillanceTenantId,
  resolveSurveillanceTenantId,
} from "../../server/services/surveillance/surveillanceTenantScope.js";
import { requireSurveillanceTenant } from "../../server/middleware/surveillanceGuards.js";

const TENANT_A = 7;
const TENANT_B = 99;

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

const runMiddleware = (middleware, req) => {
  const res = fakeRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled, req };
};

/* ------------------------------------------------------------------ *
 * Resolution comes only from the authenticated identity
 * ------------------------------------------------------------------ */

test("the tenant is read from the authenticated user row", () => {
  const req = { user: { id: 1, tenant_id: TENANT_A } };
  assert.equal(resolveSurveillanceTenantId(req), TENANT_A);
  assert.equal(requireSurveillanceTenantId(req), TENANT_A);
});

test("an x-tenant-id header cannot set or change the tenant", () => {
  // No user tenant at all: the header must not fill the gap.
  const spoofOnly = { user: { id: 1 }, headers: { "x-tenant-id": String(TENANT_B) } };
  assert.equal(resolveSurveillanceTenantId(spoofOnly), null);
  assert.throws(
    () => requireSurveillanceTenantId(spoofOnly),
    (error) => error.code === "SURVEILLANCE_TENANT_CONTEXT_MISSING",
  );

  // User in tenant A, header claiming tenant B: A wins, unconditionally.
  const override = { user: { id: 1, tenant_id: TENANT_A }, headers: { "x-tenant-id": String(TENANT_B) } };
  assert.equal(resolveSurveillanceTenantId(override), TENANT_A);
});

test("query and body tenant fields cannot set or change the tenant", () => {
  const fromQuery = { user: { id: 1 }, query: { tenant_id: TENANT_B, tenantId: TENANT_B } };
  const fromBody = { user: { id: 1 }, body: { tenant_id: TENANT_B, tenantId: TENANT_B } };
  assert.equal(resolveSurveillanceTenantId(fromQuery), null);
  assert.equal(resolveSurveillanceTenantId(fromBody), null);

  const override = {
    user: { id: 1, tenant_id: TENANT_A },
    query: { tenant_id: TENANT_B },
    body: { tenant_id: TENANT_B },
  };
  assert.equal(resolveSurveillanceTenantId(override), TENANT_A);
});

test("a pre-set req.tenantId from other middleware cannot change the tenant", () => {
  // The platform-wide resolver trusts req.tenantId first. Surveillance does
  // not: only the user row counts, so an upstream middleware that got its value
  // from a header cannot launder it through this field.
  const req = { user: { id: 1, tenant_id: TENANT_A }, tenantId: TENANT_B, tenant: { id: TENANT_B } };
  assert.equal(resolveSurveillanceTenantId(req), TENANT_A);
});

test("every hostile spelling of a tenant override is ignored together", () => {
  const req = {
    user: { id: 1, tenant_id: TENANT_A },
    tenantId: TENANT_B,
    tenant: { id: TENANT_B },
    headers: { "x-tenant-id": String(TENANT_B), "X-Tenant-Id": String(TENANT_B) },
    query: { tenant_id: TENANT_B, tenantId: TENANT_B },
    body: { tenant_id: TENANT_B, tenantId: TENANT_B },
    params: { tenant_id: TENANT_B },
  };
  assert.equal(resolveSurveillanceTenantId(req), TENANT_A);
});

test("a super admin with no tenant fails closed rather than seeing everything", () => {
  // Elsewhere a null tenant on a super admin widens reads to all tenants. For
  // live camera feeds and stored credentials that is a cross-customer leak.
  const req = { user: { id: 1, tenant_id: null, is_super_admin: true, role: "super_admin" } };
  assert.equal(resolveSurveillanceTenantId(req), null);
  assert.throws(
    () => requireSurveillanceTenantId(req),
    (error) => error.code === "SURVEILLANCE_TENANT_CONTEXT_MISSING",
  );
});

test("non-numeric and non-positive tenant values are rejected", () => {
  for (const value of ["abc", 0, -3, 1.5, "", null, undefined, {}, []]) {
    assert.equal(resolveSurveillanceTenantId({ user: { tenant_id: value } }), null, JSON.stringify(value));
  }
});

/* ------------------------------------------------------------------ *
 * The middleware
 * ------------------------------------------------------------------ */

test("the middleware pins the authenticated tenant onto the request", () => {
  const { req, nextCalled } = runMiddleware(requireSurveillanceTenant, {
    user: { id: 1, tenant_id: TENANT_A },
    headers: { "x-tenant-id": String(TENANT_B) },
  });
  assert.equal(nextCalled, true);
  assert.equal(req.surveillanceTenantId, TENANT_A);
});

test("the middleware refuses a request with no authenticated tenant", () => {
  const { res, nextCalled } = runMiddleware(requireSurveillanceTenant, {
    user: { id: 1 },
    headers: { "x-tenant-id": String(TENANT_B) },
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "SURVEILLANCE_TENANT_CONTEXT_MISSING");
});

/* ------------------------------------------------------------------ *
 * Row-level second line
 * ------------------------------------------------------------------ */

/** node:assert's throws() returns undefined, so capture the error directly. */
const caught = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, but it did not");
};

test("a row belonging to another tenant is reported as not found, not forbidden", () => {
  // "Forbidden" would confirm that a device with that id exists somewhere,
  // which is the enumeration oracle the isolation requirement forbids.
  const foreign = { id: 42, tenant_id: TENANT_B, name: "Tenant B DVR" };

  const error = caught(() => assertRowTenant(foreign, TENANT_A, "device"));
  assert.equal(error.code, "SURVEILLANCE_DEVICE_NOT_FOUND");
  assert.equal(error.status, 404);

  const channelError = caught(() => assertRowTenant(foreign, TENANT_A, "channel"));
  assert.equal(channelError.code, "SURVEILLANCE_CHANNEL_NOT_FOUND");

  // A missing row and a foreign row are indistinguishable from outside.
  const missingError = caught(() => assertRowTenant(undefined, TENANT_A, "device"));
  assert.equal(missingError.code, error.code);
  assert.equal(missingError.status, error.status);
});

test("a not-found response carries no detail about the other tenant's row", () => {
  const foreign = { id: 42, tenant_id: TENANT_B, name: "Tenant B DVR", host: "10.9.9.9" };
  const error = caught(() => assertRowTenant(foreign, TENANT_A, "device"));
  const body = JSON.stringify(error.toPublicJSON());
  assert.ok(!body.includes("10.9.9.9"), body);
  assert.ok(!body.includes("Tenant B"), body);
  assert.ok(!body.includes(String(TENANT_B)), body);
});

test("a matching row passes through unchanged", () => {
  const own = { id: 42, tenant_id: TENANT_A, name: "Store DVR" };
  assert.equal(assertRowTenant(own, TENANT_A, "device"), own);
  // String/number mismatch from pg BIGINT must not cause a false rejection.
  assert.equal(assertRowTenant({ ...own, tenant_id: String(TENANT_A) }, TENANT_A, "device").id, 42);
});

/* ------------------------------------------------------------------ *
 * Branch scoping (within a tenant)
 * ------------------------------------------------------------------ */

test("no branch grants means all branches of the caller's own tenant", () => {
  const filter = branchAccessFilter([]);
  assert.equal(filter.restricted, false);
  assert.equal(assertBranchAllowed(1, filter), true);
  assert.equal(assertBranchAllowed(999, filter), true);
});

test("branch grants restrict to exactly the granted branches", () => {
  const filter = branchAccessFilter([3, 5]);
  assert.equal(filter.restricted, true);
  assert.equal(assertBranchAllowed(3, filter), true);
  assert.throws(
    () => assertBranchAllowed(4, filter),
    (error) => error.code === "SURVEILLANCE_BRANCH_FORBIDDEN",
  );
});

/* ------------------------------------------------------------------ *
 * Query-level isolation (structural)
 * ------------------------------------------------------------------ */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const REPOSITORIES = [
  "../../server/services/surveillance/repositories/surveillanceDeviceRepository.js",
  "../../server/services/surveillance/repositories/surveillanceCredentialRepository.js",
  "../../server/services/surveillance/repositories/surveillanceAccessRepository.js",
];

/** Pull every SQL template literal out of a repository source. */
const extractStatements = (source) =>
  [...source.matchAll(/`([^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`/gi)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter((statement) => /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(statement))
    // Column lists assigned to constants are not statements.
    .filter((statement) => /\b(FROM|INTO|UPDATE)\s+surveillance_/i.test(statement));

test("every surveillance read and write is scoped by tenant_id in SQL", () => {
  for (const path of REPOSITORIES) {
    for (const statement of extractStatements(read(path))) {
      const isInsert = /^\s*INSERT/i.test(statement);
      if (isInsert) {
        // An INSERT is scoped by writing tenant_id as a column, and any
        // ON CONFLICT DO UPDATE must additionally re-assert it so an upsert
        // cannot cross a tenant boundary through a unique key collision.
        assert.match(statement, /tenant_id/, `${path}: ${statement}`);
        if (/ON CONFLICT/i.test(statement) && /DO UPDATE/i.test(statement)) {
          assert.match(
            statement,
            /WHERE surveillance_\w+\.tenant_id = \$1/i,
            `upsert must re-assert tenant: ${path}: ${statement}`,
          );
        }
        continue;
      }
      assert.match(statement, /WHERE[\s\S]*tenant_id = \$1/i, `${path}: ${statement}`);
    }
  }
});

test("tenantId is the first parameter of every exported repository function", () => {
  for (const path of REPOSITORIES) {
    const source = read(path);
    const exported = [...source.matchAll(/export const (\w+) = async \(([^)]*)\)/g)];
    assert.ok(exported.length > 0, path);
    for (const [, name, params] of exported) {
      const first = params.split(",")[0].trim();
      assert.equal(first, "tenantId", `${path}: ${name}(${params})`);
    }
  }
});

test("no repository filters by tenant in JavaScript after the query", () => {
  // `rows.filter(r => r.tenant_id === tenantId)` means the foreign row was
  // already read, and anything between the read and the filter can leak it.
  for (const path of REPOSITORIES) {
    const source = read(path);
    assert.doesNotMatch(source, /\.filter\([^)]*tenant_id/, path);
    assert.doesNotMatch(source, /if\s*\(\s*\w+\.tenant_id\s*[!=]==/, path);
  }
});

test("KNOWN GAP: cross-tenant isolation is not yet proven against a live database", () => {
  // Stated explicitly so it is not mistaken for coverage. The tests above prove
  // (a) the tenant cannot be influenced by the caller and (b) every statement
  // carries the predicate. They do NOT execute against Postgres with two seeded
  // tenants. That belongs in Phase 2, alongside the first route that can
  // actually be called, and is listed as an open item in the phase report.
  assert.ok(true);
});
