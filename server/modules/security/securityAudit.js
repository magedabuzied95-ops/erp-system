import db from "../../database/db.js";
import { resolveTrustedClientIp } from "../../utils/trustedClientIp.js";

// Append-only security events (logins, MFA, password and privilege changes, Amazon access).
// Never pass passwords, tokens, TOTP codes, secrets or recovery codes in `details`.

const FORBIDDEN_DETAIL_KEYS = /pass|secret|token|code|otp|key|authorization|cookie/i;

const scrubDetails = (details) => {
  if (!details || typeof details !== "object") return null;
  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (FORBIDDEN_DETAIL_KEYS.test(key) && key !== "reason_code") continue;
    if (value === undefined) continue;
    safe[key] = typeof value === "string" ? value.slice(0, 300) : value;
  }
  return safe;
};

// For forensics only - never used for an access decision. Behind Cloudflare -> nginx the socket
// address is a proxy hop, so the edge-reported client address is recorded alongside.
const requestClientAddress = (req = {}) => {
  const reported = String(req.headers?.["cf-connecting-ip"] || req.headers?.["x-real-ip"] || "").trim();
  const socket = resolveTrustedClientIp(req);
  return (reported && reported !== socket ? `${reported} (via ${socket || "?"})` : socket || reported || "").slice(0, 120);
};

export const recordSecurityEvent = async ({
  req = null,
  eventType,
  outcome = "success",
  userId = null,
  tenantId = null,
  actorUserId = null,
  details = null,
} = {}) => {
  const entry = {
    event_type: eventType,
    outcome,
    user_id: userId ?? null,
    tenant_id: tenantId ?? null,
    actor_user_id: actorUserId ?? req?.user?.id ?? null,
    ip_address: req ? requestClientAddress(req) : null,
    user_agent: req ? String(req.headers?.["user-agent"] || "").slice(0, 300) : null,
    details: scrubDetails(details),
  };
  // Structured line for docker logs / journald as well as the table.
  console.log("[security-audit]", JSON.stringify({ ...entry, at: new Date().toISOString() }));
  try {
    await db.query(
      `
      INSERT INTO security_audit_events
        (tenant_id, user_id, actor_user_id, event_type, outcome, ip_address, user_agent, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        entry.tenant_id,
        entry.user_id,
        entry.actor_user_id,
        entry.event_type,
        entry.outcome,
        entry.ip_address,
        entry.user_agent,
        entry.details ? JSON.stringify(entry.details) : null,
      ]
    );
  } catch (error) {
    console.error("[security-audit] write failed", { event_type: eventType, message: error?.message || String(error) });
  }
};

export const listSecurityEvents = async ({ tenantId = null, allTenants = false, limit = 200, eventType = "", userId = null } = {}) => {
  const params = [];
  const where = [];
  if (!allTenants) {
    params.push(tenantId);
    where.push(`(tenant_id = $${params.length} OR tenant_id IS NULL)`);
  }
  if (eventType) {
    params.push(eventType);
    where.push(`event_type = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    where.push(`user_id = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  const result = await db.query(
    `
    SELECT id, tenant_id, user_id, actor_user_id, event_type, outcome, ip_address, user_agent, details, created_at
    FROM security_audit_events
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows;
};
