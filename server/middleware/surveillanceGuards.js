// Surveillance Center — route guards.
//
// These sit between `protect` (who are you) and the handlers. They exist
// because the platform's generic guards are not sufficient for this feature,
// and the reasons are specific.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError, errorStatus, toErrorResponse } from "../services/surveillance/surveillanceErrors.js";
import { requireSurveillanceTenantId } from "../services/surveillance/surveillanceTenantScope.js";
import { surveillanceLogError } from "../services/surveillance/surveillanceRedaction.js";
import {
  FAIL_CLOSED,
  SURVEILLANCE_RATE_LIMITS,
  consumeRateLimit,
} from "../services/surveillance/surveillanceRateLimitPolicy.js";
// The counter moved out of cacheService so a security control no longer
// inherits the storefront cache module. This reset seam follows it.
import { __resetRateCounters } from "../services/surveillance/surveillanceRateLimitCounter.js";

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
 * Distributed, per-action limits.
 *
 * Phase 1 used a per-process Map. That is a correct limit for one process and a
 * silent under-count by the replica factor for more, which for "one recorder
 * restart per ten minutes" is the difference between a control and the
 * appearance of one.
 *
 * The policy — limits, scopes, and what happens when the counter cannot be
 * trusted — lives in surveillanceRateLimitPolicy.js. This is only the Express
 * adapter: pull identifiers off the request, consume a unit, translate the
 * verdict into a response.
 *
 * NOTE: this middleware is now async. It still composes normally with Express,
 * but a route must not assume it completes synchronously.
 *
 * @param {string} action  a key of SURVEILLANCE_RATE_LIMITS
 */
export const surveillanceRateLimit = (action) => {
  // Resolved at wiring time so a typo in a route definition breaks the boot
  // rather than silently disabling the limit on a dangerous command.
  if (!SURVEILLANCE_RATE_LIMITS[action]) {
    throw new Error(`unknown surveillance rate limit "${action}"`);
  }

  return async (req, res, next) => {
    let verdict;
    try {
      verdict = await consumeRateLimit(action, {
        tenantId: req?.surveillanceTenantId ?? req?.user?.tenant_id ?? null,
        userId: req?.user?.id ?? null,
        deviceId: req?.params?.id ?? req?.params?.deviceId ?? null,
      });
    } catch (error) {
      // The limiter itself threw. For a dangerous action that is a refusal:
      // "we could not count this" must never resolve to "go ahead".
      surveillanceLogError("rate_limit_failed", error, { action });
      if (SURVEILLANCE_RATE_LIMITS[action].failMode === FAIL_CLOSED) {
        return res.status(503).json({
          success: false,
          code: SURVEILLANCE_ERROR_CODES.RATE_LIMITED,
          details: { action, reason: "counter-unavailable" },
        });
      }
      return next();
    }

    if (verdict.allowed) return next();

    if (verdict.reason === "counter-unavailable") {
      // 503, not 429: nothing is wrong with the caller's rate — the control
      // itself is unavailable. Telling them to slow down would be a lie, and
      // they would retry forever against a limit that is not being applied.
      return res.status(503).json({
        success: false,
        code: SURVEILLANCE_ERROR_CODES.RATE_LIMITED,
        details: { action, reason: "counter-unavailable" },
      });
    }

    res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
    return res.status(429).json({
      success: false,
      code: SURVEILLANCE_ERROR_CODES.RATE_LIMITED,
      details: { action, retry_after_seconds: verdict.retryAfterSeconds },
    });
  };
};

export { SURVEILLANCE_RATE_LIMITS };

/** Test-only. */
export const __resetSurveillanceRateLimits = () => {
  __resetRateCounters();
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
