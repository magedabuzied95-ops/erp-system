import { createRequestRateLimit, createSlidingWindowCounter, rateLimitClientKey } from "./requestRateLimit.js";

// Staff login had no ceiling at all. Two layers, same shape as the storefront login:
// - per client IP: 30 attempts / 15 min, whatever the outcome;
// - per account (email): 5 wrong passwords / 15 min locks that email for the rest of the window,
//   from any IP. A correct password clears the count.
const MINUTE_MS = 60_000;

export const STAFF_LOGIN_FAILURE_WINDOW_MS = 15 * MINUTE_MS;
export const STAFF_LOGIN_MAX_FAILURES = 5;

export const staffLoginIpRateLimit = createRequestRateLimit({
  windowMs: 15 * MINUTE_MS,
  max: 30,
  keysOf: (req) => [rateLimitClientKey(req) && `staff-login-ip:${rateLimitClientKey(req)}`],
});

export const staffLoginFailuresByEmail = createSlidingWindowCounter({
  windowMs: STAFF_LOGIN_FAILURE_WINDOW_MS,
  max: STAFF_LOGIN_MAX_FAILURES,
});

export const staffLoginEmailKey = (email) => {
  const normalized = String(email ?? "").trim().toLowerCase();
  return normalized ? `staff-login-email:${normalized}` : "";
};
