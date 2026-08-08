/**
 * Manager Portal — Profit Lock (Layer 2 authorization for sensitive profit data).
 *
 * Security model:
 *   Layer 1 (RBAC): canViewProfitForManager(manager)  [enforced in managerPortalService]
 *   Layer 2 (this): a dedicated Profit PIN must be verified server-side to mint a
 *                   short-lived, profit-scoped token. Profit values are only ever
 *                   returned when BOTH layers pass. No frontend-only hiding.
 *
 * - PIN is never stored in plaintext or in source: only a bcrypt hash in the env
 *   var MANAGER_PROFIT_PIN_HASH is read (project already depends on bcryptjs).
 * - The unlock token is a short-lived JWT scoped ONLY to profit (scope claim,
 *   no user id/role), signed with the existing JWT_SECRET; it cannot act as a
 *   general auth token. In-memory jti revocation supports manual re-lock.
 * - Brute-force protection: in-memory per (tenant:manager) attempt tracker.
 * - Crypto libs are lazy-imported so the pure helpers stay unit-testable without deps.
 */

export const PROFIT_UNLOCK_TTL_SECONDS = 900;          // 15 minutes
export const PROFIT_MAX_FAILED_ATTEMPTS = 5;
export const PROFIT_ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // rolling window
export const PROFIT_BLOCK_DURATION_MS = 15 * 60 * 1000; // lockout after too many failures
export const PROFIT_TOKEN_SCOPE = "manager_profit";

// ---- Pure helpers (no external deps; fully unit-testable) -------------------

export const lockedProfitPayload = () => ({
  profit_locked: true,
  profit: null,
  profit_margin: null,
  profit_change_percent: null,
});

export const computeProfitMargin = (profit, sales) => {
  const p = Number(profit);
  const s = Number(sales);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return 0;
  const margin = (p / s) * 100;
  if (!Number.isFinite(margin)) return 0;
  return Math.round(margin * 10) / 10; // 1 decimal, never NaN/Infinity
};

export const isProfitPinConfigured = () =>
  typeof process.env.MANAGER_PROFIT_PIN_HASH === "string" &&
  process.env.MANAGER_PROFIT_PIN_HASH.trim().length > 0;

/**
 * Remove every profit-derived value from a dashboardAnalytics `overview` object.
 * Closes the existing leak where overview.today.todayProfit.{value,growth} kept
 * profit even when overview.today.profit was nulled.
 */
export const nullProfitFieldsInOverview = (overview) => {
  if (!overview || typeof overview !== "object" || !overview.today) return overview;
  const t = overview.today;
  t.profit = null;
  if (t.todayProfit && typeof t.todayProfit === "object") {
    t.todayProfit = { ...t.todayProfit, value: null, growth: null };
  }
  return overview;
};

/** Strip profit/cost from a mapped invoice object when not authorized. */
export const stripInvoiceProfit = (invoice) => {
  if (!invoice || typeof invoice !== "object") return invoice;
  const next = { ...invoice, profit: null, cost: null };
  if (next.permissions && typeof next.permissions === "object") {
    next.permissions = { ...next.permissions, can_view_profit: false };
  }
  return next;
};

const PROFIT_TERMS = /(profit|margin|cogs|\bcost\b|ربح|هامش|تكلفة)/i;
/** Drop AI-insight items that expose profit/cost/margin while profit is locked. */
export const stripProfitFromInsights = (insights) =>
  Array.isArray(insights)
    ? insights.filter((it) => !PROFIT_TERMS.test(
        [it?.type, it?.title, it?.body, it?.text, it?.message, it?.label].filter(Boolean).join(" ")
      ))
    : insights;

/** Build the sales-page daily-profit block (locked or unlocked). */
export const buildDailyProfitBlock = ({ authorized, profit, sales, changePercent = null } = {}) => {
  if (!authorized) return lockedProfitPayload();
  const value = Number(profit);
  return {
    profit_locked: false,
    profit: Number.isFinite(value) ? value : 0,
    profit_margin: computeProfitMargin(value, sales),
    profit_change_percent:
      changePercent === null || changePercent === undefined || !Number.isFinite(Number(changePercent))
        ? null
        : Math.round(Number(changePercent) * 10) / 10,
  };
};

// ---- Brute-force attempt tracker (in-memory; per tenant:manager) ------------

const attempts = new Map(); // key -> { count, firstAt, blockedUntil }

export const attemptKey = (tenantId, managerId) => `${tenantId ?? "0"}:${managerId ?? "0"}`;

export const isRateLimited = (key, now = Date.now()) => {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (rec.blockedUntil && now < rec.blockedUntil) return true;
  return false;
};

export const registerFailedAttempt = (key, now = Date.now()) => {
  const rec = attempts.get(key) || { count: 0, firstAt: now, blockedUntil: 0 };
  if (now - rec.firstAt > PROFIT_ATTEMPT_WINDOW_MS) {
    rec.count = 0;
    rec.firstAt = now;
    rec.blockedUntil = 0;
  }
  rec.count += 1;
  if (rec.count >= PROFIT_MAX_FAILED_ATTEMPTS) {
    rec.blockedUntil = now + PROFIT_BLOCK_DURATION_MS;
  }
  attempts.set(key, rec);
  return { blocked: Boolean(rec.blockedUntil && now < rec.blockedUntil), remaining: Math.max(0, PROFIT_MAX_FAILED_ATTEMPTS - rec.count) };
};

export const registerSuccess = (key) => { attempts.delete(key); };

// ---- Token issue / verify / revoke (lazy crypto; runs with project deps) ----

const revoked = new Map(); // jti -> expiryMs (for manual re-lock)
const secret = () => { const value = String(process.env.JWT_SECRET || "").trim(); if (!value) throw new Error("JWT_SECRET is required for Manager Profit Lock"); return value; };
const newJti = async () => {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(16).toString("hex");
};

export const verifyProfitPin = async (pin) => {
  const hash = isProfitPinConfigured() ? process.env.MANAGER_PROFIT_PIN_HASH.trim() : "";
  const candidate = String(pin ?? "");
  if (!hash || !candidate) return false;
  const bcrypt = (await import("bcryptjs")).default;
  try {
    return await bcrypt.compare(candidate, hash);
  } catch {
    return false;
  }
};

export const issueProfitToken = async ({ managerId, tenantId } = {}) => {
  const jwt = (await import("jsonwebtoken")).default;
  const jti = await newJti();
  const token = jwt.sign(
    { scope: PROFIT_TOKEN_SCOPE, mid: String(managerId ?? ""), tid: String(tenantId ?? ""), jti },
    secret(),
    { expiresIn: PROFIT_UNLOCK_TTL_SECONDS },
  );
  return { token, jti, expiresIn: PROFIT_UNLOCK_TTL_SECONDS };
};

export const verifyProfitToken = async (token, { managerId, tenantId } = {}) => {
  if (!token) return { valid: false };
  const jwt = (await import("jsonwebtoken")).default;
  try {
    const decoded = jwt.verify(String(token), secret());
    if (!decoded || decoded.scope !== PROFIT_TOKEN_SCOPE) return { valid: false };
    if (String(decoded.mid) !== String(managerId ?? "")) return { valid: false };
    if (String(decoded.tid) !== String(tenantId ?? "")) return { valid: false };
    const rev = revoked.get(decoded.jti);
    if (rev && Date.now() < rev) return { valid: false };
    return { valid: true, jti: decoded.jti, expSeconds: Math.max(0, (decoded.exp || 0) - Math.floor(Date.now() / 1000)) };
  } catch {
    return { valid: false };
  }
};

export const revokeProfitToken = async (token) => {
  if (!token) return false;
  const jwt = (await import("jsonwebtoken")).default;
  try {
    const decoded = jwt.decode(String(token));
    if (decoded && decoded.jti && decoded.exp) {
      revoked.set(decoded.jti, decoded.exp * 1000);
      // opportunistic cleanup
      const now = Date.now();
      for (const [k, v] of revoked) if (v < now) revoked.delete(k);
      return true;
    }
  } catch { /* ignore */ }
  return false;
};

export default {
  PROFIT_UNLOCK_TTL_SECONDS,
  lockedProfitPayload,
  computeProfitMargin,
  buildDailyProfitBlock,
  nullProfitFieldsInOverview,
  stripInvoiceProfit,
  stripProfitFromInsights,
  isProfitPinConfigured,
  attemptKey,
  isRateLimited,
  registerFailedAttempt,
  registerSuccess,
  verifyProfitPin,
  issueProfitToken,
  verifyProfitToken,
  revokeProfitToken,
};
