// Edge Agent identity: enrolment, signing, revocation, liveness.
//
// WHY THE AGENT DIALS US
// ----------------------
// Every shop this will run in is behind NAT, and most Egyptian consumer and
// SME connections are behind CARRIER-GRADE NAT — there is no public address to
// forward a port to, and no port-forward to configure even if the owner wanted
// one. Any design where the cloud connects TO the shop is dead on arrival.
//
// So the agent makes ONE outbound connection and holds it open. Outbound 443 is
// the one thing that works everywhere, needs no router change, no static IP, no
// WireGuard, and no VPN licence. It is also the safer direction: the shop's
// firewall keeps doing its job, and nothing about the shop becomes reachable
// from the internet.
//
// WHAT AN AGENT'S CREDENTIAL IS, AND WHAT IT IS NOT
// -------------------------------------------------
// Enrolment issues a KEY PAIR-shaped secret: the agent keeps a secret it never
// transmits, and we keep a verifier. Commands are signed with an HMAC derived
// from that secret, so a stolen database of agent records does not let anyone
// impersonate an agent to a shop, and a stolen agent secret is scoped to one
// shop and revocable in one row.
//
// REVOCATION HAS TO BE INSTANT AND HAS TO SURVIVE A RESTART
// ---------------------------------------------------------
// The scenario that matters: a laptop running the agent is stolen. Revocation
// is a database fact checked on every command and every reconnect, not a
// message pushed to the agent — a stolen agent will not honour a message asking
// it to stop.

import crypto from "node:crypto";

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";
import { canonicalise } from "./edgeCommandProtocol.js";

const AGENT_LABEL = "srv:edge:v1";

/**
 * Per-agent signing key, derived from the platform secret and the agent's own
 * enrolment secret.
 *
 * Derived rather than stored so that the database never holds anything that can
 * sign on its own: an attacker with a full database dump still cannot mint a
 * command without SURVEILLANCE_ENCRYPTION_KEY, which lives in the environment.
 */
const agentKey = (enrolmentSecret) => {
  const material = String(process.env.SURVEILLANCE_ENCRYPTION_KEY || "").trim();
  if (!material) {
    throw new SurveillanceError("SURVEILLANCE_ENCRYPTION_KEY must be set before an agent can be enrolled", {
      code: SURVEILLANCE_ERROR_CODES.ENCRYPTION_KEY_MISSING,
      status: 500,
    });
  }
  return crypto.createHmac("sha256", `${AGENT_LABEL}:${material}`).update(String(enrolmentSecret)).digest();
};

/**
 * Mint an enrolment.
 *
 * The secret is returned ONCE, to be shown to the installer and typed into the
 * agent. What is stored is a verifier — a hash — so the database cannot
 * reproduce the secret. This mirrors how a password is stored, for the same
 * reason: the store is the thing most likely to leak.
 */
export const createEnrolment = ({ tenantId, branchId, label }) => {
  if (!Number.isInteger(Number(tenantId)) || Number(tenantId) <= 0) {
    throw new SurveillanceError("an agent must be enrolled to a tenant", {
      code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
      status: 400,
    });
  }

  const agentId = `ea_${crypto.randomBytes(9).toString("base64url")}`;
  const secret = crypto.randomBytes(32).toString("base64url");

  return {
    agentId,
    // Shown once. Never stored, never logged, never returned again.
    enrolmentSecret: secret,
    record: {
      agent_id: agentId,
      tenant_id: Number(tenantId),
      // null = every branch in the tenant. A branch-bound agent cannot be used
      // to reach another branch's recorders even by a tenant admin.
      branch_id: branchId === null || branchId === undefined ? null : Number(branchId),
      label: String(label || "").slice(0, 80),
      secret_verifier: crypto.createHash("sha256").update(secret).digest("hex"),
      status: "active",
      created_at: new Date().toISOString(),
      last_seen_at: null,
      revoked_at: null,
      revoked_reason: "",
    },
  };
};

/** Does a presented secret match the stored verifier? Constant time. */
export const verifyEnrolmentSecret = (record, presentedSecret) => {
  const expected = Buffer.from(String(record?.secret_verifier || ""), "utf8");
  const actual = Buffer.from(
    crypto.createHash("sha256").update(String(presentedSecret ?? "")).digest("hex"),
    "utf8",
  );
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
};

/**
 * Is this agent allowed to act right now?
 *
 * Checked on every command and every reconnect. Revocation that is only checked
 * at connect time leaves a stolen agent working until its socket drops.
 */
export const assertAgentUsable = (record, { tenantId, branchId } = {}) => {
  if (!record || record.status !== "active" || record.revoked_at) {
    throw new SurveillanceError("this edge agent is not active", {
      code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
      details: { reason: record?.revoked_at ? "revoked" : "inactive" },
    });
  }
  if (tenantId !== undefined && Number(record.tenant_id) !== Number(tenantId)) {
    throw new SurveillanceError("this edge agent belongs to another tenant", {
      code: SURVEILLANCE_ERROR_CODES.TENANT_MISMATCH,
      status: 403,
    });
  }
  // A tenant-wide agent (branch_id null) may serve any branch. A branch-bound
  // agent may serve only its own — including against a tenant admin who can
  // see every branch in the ERP.
  if (
    record.branch_id !== null &&
    branchId !== undefined &&
    branchId !== null &&
    Number(record.branch_id) !== Number(branchId)
  ) {
    throw new SurveillanceError("this edge agent is bound to another branch", {
      code: SURVEILLANCE_ERROR_CODES.BRANCH_FORBIDDEN,
      status: 403,
    });
  }
  return true;
};

/** Sign a command envelope for one agent. */
export const signEnvelope = (envelope, enrolmentSecret) =>
  crypto.createHmac("sha256", agentKey(enrolmentSecret)).update(canonicalise(envelope)).digest("base64url");

/**
 * Verify a signed envelope, as the AGENT does.
 *
 * Order matters: signature first, then expiry, then bindings. Checking the
 * bindings on an unverified envelope would let an attacker learn which tenant
 * and branch an agent belongs to by watching which rejections come back
 * differently.
 */
export const verifyEnvelope = (envelope, signature, enrolmentSecret, { agentId, tenantId, branchId } = {}) => {
  const expected = signEnvelope(envelope, enrolmentSecret);
  const provided = Buffer.from(String(signature || ""), "utf8");
  const computed = Buffer.from(expected, "utf8");
  if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
    throw new SurveillanceError("edge command signature is invalid", {
      code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
    });
  }

  if (Math.floor(Date.now() / 1000) >= Number(envelope.exp)) {
    throw new SurveillanceError("edge command expired", {
      code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
    });
  }

  const mismatches = [
    agentId !== undefined && String(envelope.agent) !== String(agentId),
    tenantId !== undefined && Number(envelope.tenant) !== Number(tenantId),
    branchId !== undefined && branchId !== null && envelope.branch !== null &&
      Number(envelope.branch) !== Number(branchId),
  ];
  if (mismatches.some(Boolean)) {
    throw new SurveillanceError("edge command was not minted for this agent", {
      code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
    });
  }

  return envelope;
};

/**
 * Liveness.
 *
 * An agent that has not been heard from is NOT assumed dead — a shop's internet
 * dropping for five minutes must not deregister it — but it is reported as
 * stale so the dashboard can say so instead of showing a green dot for a
 * laptop that has been switched off since Tuesday.
 */
export const HEARTBEAT_INTERVAL_SECONDS = 30;
export const STALE_AFTER_SECONDS = 120;

export const agentLiveness = (record, now = Date.now()) => {
  if (!record?.last_seen_at) return { state: "never-connected", seconds_since: null };
  const seconds = Math.round((now - new Date(record.last_seen_at).getTime()) / 1000);
  if (seconds <= STALE_AFTER_SECONDS) return { state: "online", seconds_since: seconds };
  return { state: "stale", seconds_since: seconds };
};

/**
 * Reconnect backoff, with jitter.
 *
 * Without jitter every agent in the estate reconnects on the same schedule
 * after a cloud restart, and the reconnect storm is what keeps the cloud down.
 */
export const reconnectDelayMs = (attempt, random = Math.random) => {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(10, attempt)));
  return Math.round(base / 2 + random() * (base / 2));
};
