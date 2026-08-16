// Surveillance Center — tenant resolution.
//
// WHY THIS EXISTS INSTEAD OF utils/requestScope.js#getTenantId
// ------------------------------------------------------------
// The platform-wide resolver reads, in order:
//
//   req.tenantId → req.tenant.id → req.user.tenant_id
//     → req.headers["x-tenant-id"] → req.query.tenant_id → req.body.tenant_id
//
// The first three are server-derived and trustworthy. The last three are
// attacker-controlled. The fallback only fires when the trustworthy sources are
// empty — which is uncommon — so in practice it is harmless for product reads
// and it is why the pattern has survived.
//
// It is not harmless here. A surveillance tenant id selects which store's
// cameras you may watch and whose DVR password gets decrypted. A request that
// resolved its tenant from a header the caller typed is a request that chose
// its own victim. There is no acceptable frequency for that.
//
// So this module reads the authenticated identity and NOTHING else. It does not
// look at headers, query or body — not to validate them, not to compare them,
// not at all. Code that cannot see a value cannot be tricked into trusting it.
//
// SUPER ADMINS FAIL CLOSED
// ------------------------
// Elsewhere a super admin with a NULL tenant_id means "all tenants", and reads
// widen to every row. Surveillance refuses that: "all tenants" applied to a
// live camera grid is a cross-customer video leak, and applied to credentials
// it is a bulk password export. A super admin whose account carries no tenant
// gets TENANT_CONTEXT_MISSING, the same as anyone else.
//
// A future platform-admin console that legitimately needs to act inside a
// chosen tenant must do it through an explicit, audited impersonation grant
// stored server-side — never by widening this function.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "./surveillanceErrors.js";

/**
 * The authenticated tenant, or null.
 *
 * `req.user` is populated by `protect` from the `users` row keyed by the JWT
 * subject, so `tenant_id` here is a database fact about the caller, not an
 * assertion the caller made.
 */
export const resolveSurveillanceTenantId = (req) => {
  const raw = req?.user?.tenant_id ?? req?.user?.tenantId ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const tenantId = Number(raw);
  return Number.isInteger(tenantId) && tenantId > 0 ? tenantId : null;
};

/**
 * The authenticated tenant, or throw.
 *
 * Every surveillance repository call takes a tenant id as its first argument
 * and every one of them comes from here. That is the single choke point the
 * isolation tests assert against.
 */
export const requireSurveillanceTenantId = (req) => {
  const tenantId = resolveSurveillanceTenantId(req);
  if (!tenantId) {
    throw new SurveillanceError("no authenticated tenant on this request", {
      code: SURVEILLANCE_ERROR_CODES.TENANT_CONTEXT_MISSING,
      status: 400,
    });
  }
  return tenantId;
};

/**
 * Second-line check for a row already fetched from the database.
 *
 * Belt and braces: the query that produced `row` should already have carried
 * `WHERE tenant_id = $1`. This catches the case where someone later adds a
 * lookup that forgets it. A cross-tenant row is reported as NOT FOUND rather
 * than FORBIDDEN — "forbidden" would confirm to the caller that a device with
 * that id exists in some other tenant, which is exactly the enumeration signal
 * the isolation requirement is meant to deny.
 */
export const assertRowTenant = (row, tenantId, entity = "resource") => {
  if (!row) {
    throw new SurveillanceError(`${entity} not found`, {
      code:
        entity === "channel"
          ? SURVEILLANCE_ERROR_CODES.CHANNEL_NOT_FOUND
          : SURVEILLANCE_ERROR_CODES.DEVICE_NOT_FOUND,
      status: 404,
    });
  }
  const rowTenant = Number(row.tenant_id);
  if (!Number.isInteger(rowTenant) || rowTenant !== Number(tenantId)) {
    throw new SurveillanceError(`${entity} not found`, {
      code:
        entity === "channel"
          ? SURVEILLANCE_ERROR_CODES.CHANNEL_NOT_FOUND
          : SURVEILLANCE_ERROR_CODES.DEVICE_NOT_FOUND,
      status: 404,
    });
  }
  return row;
};

/**
 * Branch visibility for a caller inside their own tenant.
 *
 * The platform has no `user_branches` table, so today every user sees every
 * branch of their tenant. Rather than invent a platform-wide model as a side
 * effect of this feature, surveillance keeps its own narrow grant table
 * (surveillance_user_branch_access) and treats "no rows for this user" as
 * "all branches in the tenant" — preserving current behaviour for the
 * single-branch deployment while making per-branch restriction possible the
 * moment a second branch exists.
 *
 * @param {number[]} grantedBranchIds rows from surveillance_user_branch_access
 */
export const branchAccessFilter = (grantedBranchIds = []) => {
  const ids = grantedBranchIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return ids.length ? { restricted: true, branchIds: ids } : { restricted: false, branchIds: [] };
};

export const assertBranchAllowed = (branchId, filter) => {
  if (!filter?.restricted) return true;
  if (filter.branchIds.includes(Number(branchId))) return true;
  throw new SurveillanceError("branch not visible to this user", {
    code: SURVEILLANCE_ERROR_CODES.BRANCH_FORBIDDEN,
    status: 403,
  });
};
