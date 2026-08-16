// Surveillance Center — route guards.
//
// These sit between `protect` (who are you) and the handlers. They exist
// because the platform's generic guards are not sufficient for this feature,
// and the reasons are specific.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError, errorStatus, toErrorResponse } from "../services/surveillance/surveillanceErrors.js";
import { requireSurveillanceTenantId } from "../services/surveillance/surveillanceTenantScope.js";
import { surveillanceLogError } from "../services/surveillance/surveillanceRedaction.js";

const respond = (res, error) => res.status(errorStatus(error)).json(toErrorResponse(error));

/* ------------------------------------------------------------------ *
 * Tenant
 * ------------------------------------------------------------------ */

/**
 * Pin the tenant onto the request from the authenticated identity.
 *
 * After this runs, `req.surveillanceTenantId` is the ONLY tenant value any
 * surveillance handler may use. It is derived from the `users` row, never from
 * a header, a query parameter or a body field — see surveillanceTenantScope.js
 * for why the platform-wide resolver is not usable here.
 */
export const requireSurveillanceTenant = (req, res, next) => {
  try {
    req.surveillanceTenantId = requireSurveillanceTenantId(req);
    return next();
  } catch (error) {
    return respond(res, error);
  }
};

/* ------------------------------------------------------------------ *
 * Owner
 * ------------------------------------------------------------------ */

/**
 * Device management is owner-only.
 *
 * WHY THIS DOES NOT CALL permit()
 * -------------------------------
 * permit() short-circuits before it reads any permission:
 *
 *     if (isAdmin || isSuperAdmin || hasWildcard) return next();
 *
 * where `isAdmin` is true when the role's NAME normalises to "admin". So
 * gating device management on a permission would achieve nothing — every admin
 * would pass without ever holding it. Requirement #22 says the opposite: staff
 * do not see device management unless explicitly granted, and the owner decides.
 *
 * WHY IT CHECKS THE COLUMN, NOT THE ROLE STRING
 * ---------------------------------------------
 * `roles` is per-tenant with UNIQUE (tenant_id, name), so a tenant
 * administrator can create a role and call it whatever they like — including
 * "super_admin" or "platform_admin". Any check that trusts a role NAME is
 * therefore self-service privilege escalation. `users.is_super_admin` is a
 * boolean column on the user row that no role-management screen writes, which
 * makes it the only trustworthy signal available today.
 */
export const requireSurveillanceOwner = (req, res, next) => {
  if (req?.user?.is_super_admin === true) return next();

  return respond(
    res,
    new SurveillanceError("surveillance device management requires the system owner", {
      code: SURVEILLANCE_ERROR_CODES.OWNER_REQUIRED,
      status: 403,
    }),
  );
};

/** Predicate form, for handlers that vary their projection rather than refuse. */
export const isSurveillanceOwner = (user) => user?.is_super_admin === true;

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

/**
 * Token buckets, in memory.
 *
 * Matches the pattern already used in aiSupport.js and storefront.js. The
 * honest limitation: with more than one backend process the effective limit is
 * per process. That is acceptable here because these limits protect a DVR from
 * command flooding rather than protecting us from a distributed attacker, and
 * the production deployment runs a single backend container. If that changes,
 * the store swaps for the existing Redis-backed cacheService without touching
 * call sites.
 */
const buckets = new Map();

const BUCKET_SWEEP_MS = 60_000;
let lastSweep = 0;

const sweep = (now) => {
  if (now - lastSweep < BUCKET_SWEEP_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

/**
 * Per-action limits.
 *
 * PTZ is high because a directional pad legitimately emits a burst while a
 * button is held; restart is one per ten minutes per device because the second
 * press is never useful and a recorder rebooting in a loop records nothing.
 */
export const SURVEILLANCE_RATE_LIMITS = Object.freeze({
  ptz: { limit: 30, windowMs: 10_000, scope: "device" },
  snapshot: { limit: 30, windowMs: 60_000, scope: "device" },
  probe: { limit: 6, windowMs: 60_000, scope: "device" },
  connectionTest: { limit: 10, windowMs: 60_000, scope: "user" },
  stream: { limit: 60, windowMs: 60_000, scope: "user" },
  settingsWrite: { limit: 20, windowMs: 60_000, scope: "device" },
  storage: { limit: 3, windowMs: 3_600_000, scope: "device" },
  network: { limit: 3, windowMs: 3_600_000, scope: "device" },
  restart: { limit: 1, windowMs: 600_000, scope: "device" },
  deviceCreate: { limit: 20, windowMs: 3_600_000, scope: "user" },
});

const bucketKey = (action, scope, req) => {
  const tenantId = req?.surveillanceTenantId ?? req?.user?.tenant_id ?? "none";
  const userId = req?.user?.id ?? "anon";
  // Device scope still includes the tenant, so two tenants that somehow share a
  // device id cannot consume each other's budget.
  const target = scope === "device" ? req?.params?.id ?? req?.params?.deviceId ?? "none" : userId;
  return `${action}:${tenantId}:${scope}:${target}`;
};

/**
 * @param {keyof SURVEILLANCE_RATE_LIMITS} action
 */
export const surveillanceRateLimit = (action) => {
  const config = SURVEILLANCE_RATE_LIMITS[action];
  if (!config) throw new Error(`unknown surveillance rate limit "${action}"`);

  return (req, res, next) => {
    const now = Date.now();
    sweep(now);

    const key = bucketKey(action, config.scope, req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + config.windowMs });
      return next();
    }

    if (bucket.count >= config.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        code: SURVEILLANCE_ERROR_CODES.RATE_LIMITED,
        details: { action, retry_after_seconds: retryAfter },
      });
    }

    bucket.count += 1;
    return next();
  };
};

/** Test-only. */
export const __resetSurveillanceRateLimits = () => {
  buckets.clear();
  lastSweep = 0;
};

/* ------------------------------------------------------------------ *
 * Error boundary
 * ------------------------------------------------------------------ */

/**
 * Wrap an async handler so a thrown SurveillanceError becomes its typed
 * response and anything else becomes an opaque 500.
 *
 * The important half is the `else` branch: an unexpected error here could be a
 * pg error naming a column or an HTTP client error carrying the full request
 * config including auth headers. It is logged through the redactor and it is
 * NOT sent to the client.
 */
export const surveillanceHandler = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    if (!(error instanceof SurveillanceError)) {
      surveillanceLogError("unhandled_route_error", error, {
        tenant_id: req?.surveillanceTenantId ?? null,
        user_id: req?.user?.id ?? null,
        route: req?.originalUrl ? String(req.originalUrl).split("?")[0] : "",
      });
    }
    if (res.headersSent) return;
    respond(res, error);
  }
};
