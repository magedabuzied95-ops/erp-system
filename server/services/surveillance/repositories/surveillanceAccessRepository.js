// Surveillance Center — network grants and branch access.
//
// These two tables answer the two "may this reach that?" questions that are not
// role questions:
//
//   surveillance_network_grants       which IP ranges may this tenant's devices
//                                     live in — the allowlist the SSRF guard
//                                     consults
//   surveillance_user_branch_access   which branches may this user see
//
// Both are deliberately empty by default, and both fail closed when empty in
// the direction that matters:
//
//   * no network grant   => the tenant can reach NO address. A device cannot be
//                           probed or streamed until an operator provisions a
//                           transport and records what it may reach. This is
//                           what stops a newly-added device from being usable
//                           as an SSRF probe the moment it is created.
//   * no branch grant    => the user sees ALL branches of their own tenant.
//                           The opposite default, because the platform has no
//                           user↔branch model today and denying everything
//                           would make the feature unusable on day one for the
//                           single-branch deployment. Tenant isolation is
//                           unaffected either way; this only narrows within a
//                           tenant that has already been established.
//
// Those two defaults point in opposite directions on purpose. The network
// allowlist guards against reaching machines that are not the customer's; the
// branch list only sorts a customer's own cameras among their own staff.

import db from "../../../database/db.js";

import { parseCidr } from "../surveillanceNetworkGuard.js";
import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";

/* ------------------------------------------------------------------ *
 * Network grants
 * ------------------------------------------------------------------ */

/**
 * The CIDRs the guard will accept for this tenant.
 *
 * Returns plain strings so the caller can hand them straight to
 * classifyAddress(). Rows whose CIDR no longer parses are dropped rather than
 * passed through — an unparseable range must never widen anything, and
 * cidrContains() would return false for it anyway, so dropping it early just
 * makes the behaviour explicit.
 */
export const listNetworkGrants = async (tenantId, { transportType = null } = {}, client = db) => {
  const params = [tenantId];
  let sql = `SELECT id, cidr, transport_type, note, created_at FROM surveillance_network_grants WHERE tenant_id = $1`;
  if (transportType) {
    params.push(String(transportType).toLowerCase());
    sql += ` AND transport_type = $${params.length}`;
  }
  sql += ` ORDER BY cidr`;
  const result = await client.query(sql, params);
  return result.rows.filter((row) => parseCidr(row.cidr));
};

export const listAllowedCidrs = async (tenantId, transportType = null, client = db) => {
  const rows = await listNetworkGrants(tenantId, { transportType }, client);
  return rows.map((row) => row.cidr);
};

export const addNetworkGrant = async (tenantId, { cidr, transportType = "direct", note = "" }, { userId = null } = {}, client = db) => {
  const parsed = parseCidr(cidr);
  if (!parsed) {
    throw new SurveillanceError("network grant is not a valid CIDR", {
      code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
      status: 400,
      details: { field: "cidr" },
    });
  }
  // A grant of 0.0.0.0/0 or ::/0 would nominally allow everything. It still
  // could not reach loopback or metadata — those are hard-denied above the
  // allowlist — but it defeats the point of having an allowlist, and an
  // operator who wants it almost certainly typed it by mistake.
  if (parsed.hostBits >= BigInt(parsed.bits)) {
    throw new SurveillanceError("a default-route grant is not accepted; list the actual device subnet", {
      code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
      status: 400,
      details: { field: "cidr", rule: "too-broad" },
    });
  }

  const result = await client.query(
    `
    INSERT INTO surveillance_network_grants (tenant_id, cidr, transport_type, note, created_by)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (tenant_id, cidr, transport_type) DO NOTHING
    RETURNING id, cidr, transport_type, note, created_at
    `,
    [tenantId, String(cidr).trim(), String(transportType).toLowerCase(), String(note).slice(0, 200), userId],
  );
  return result.rows[0] || null;
};

export const removeNetworkGrant = async (tenantId, grantId, client = db) => {
  const result = await client.query(
    `DELETE FROM surveillance_network_grants WHERE tenant_id = $1 AND id = $2 RETURNING id, cidr`,
    [tenantId, grantId],
  );
  return result.rows[0] || null;
};

/* ------------------------------------------------------------------ *
 * Branch access
 * ------------------------------------------------------------------ */

export const listUserBranchAccess = async (tenantId, userId, client = db) => {
  const result = await client.query(
    `SELECT branch_id FROM surveillance_user_branch_access WHERE tenant_id = $1 AND user_id = $2 ORDER BY branch_id`,
    [tenantId, userId],
  );
  return result.rows.map((row) => Number(row.branch_id));
};

export const setUserBranchAccess = async (tenantId, userId, branchIds = [], client = db) => {
  const ids = [...new Set(branchIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];

  // Delete-then-insert inside one statement pair. Not wrapped in an explicit
  // transaction here because the caller owns the transaction boundary — the
  // route that changes access also writes an audit row, and those two must
  // commit together.
  await client.query(
    `DELETE FROM surveillance_user_branch_access WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId],
  );
  if (!ids.length) return [];

  await client.query(
    `
    INSERT INTO surveillance_user_branch_access (tenant_id, user_id, branch_id)
    SELECT $1, $2, UNNEST($3::bigint[])
    ON CONFLICT (tenant_id, user_id, branch_id) DO NOTHING
    `,
    [tenantId, userId, ids],
  );
  return ids;
};
