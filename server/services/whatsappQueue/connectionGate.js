import db from "../../database/db.js";
import { ensureWhatsappQueueSchema } from "./schema.js";

/*
 * A door for the sends that cannot go through the queue.
 *
 * Most automations are fire-and-forget and belong in the outbound queue. A few are not: a coupon
 * hand-off and an approved restock notification are synchronous, and their caller acts on the
 * result — it records the message only once the provider confirms, and reports a failure to the
 * person who pressed the button. Queueing those would replace a real answer with "we will try
 * later", which is worse than what they do today.
 *
 * What they should not do is POST into a socket that has been dead for three days. That is how a
 * message ends up buffered inside Evolution where nothing in the ERP can see, pace or cancel it —
 * the exact shape of the incident this queue was built for.
 *
 * So they ask here first. The answer is free: the queue worker already polls the gateway every
 * fifteen seconds and records what it found, so this is a single indexed row read rather than
 * another round trip to Evolution.
 */

/*
 * How stale the worker's last observation may be before it stops counting as evidence. Three
 * worker ticks: long enough to ride out one slow poll, short enough that a stopped worker does not
 * silently authorise sends for hours on the strength of an old reading.
 */
const OBSERVATION_MAX_AGE_MS = 45_000;

export const whatsappGatewayState = async (tenantId = 0) => {
  try {
    await ensureWhatsappQueueSchema();
    const result = await db.query(
      `SELECT state, connection_state, updated_at, last_disconnected_at, last_connected_at
       FROM whatsapp_queue_runtime WHERE tenant_id = $1 LIMIT 1`,
      [Number(tenantId) || 0]
    );
    const row = result.rows[0];
    if (!row) return { known: false, connected: null, reason: "no_observation" };

    const observedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    if (!observedAt || Date.now() - observedAt > OBSERVATION_MAX_AGE_MS) {
      // The worker is not running, or has not polled recently. An old reading is not evidence.
      return { known: false, connected: null, reason: "observation_stale", observedAt: row.updated_at || null };
    }
    return {
      known: true,
      connected: String(row.connection_state || "").toLowerCase() === "connected",
      connectionState: row.connection_state || "unknown",
      queueState: row.state || "running",
      lastDisconnectedAt: row.last_disconnected_at || null,
      lastConnectedAt: row.last_connected_at || null,
    };
  } catch (error) {
    // A gate that fails closed would block every coupon on a database hiccup. Unknown means
    // "carry on as before" — this is a guard, not an authority.
    return { known: false, connected: null, reason: "lookup_failed", error: error?.message || String(error) };
  }
};

/*
 * Throws when the gateway is known to be down. Silent when it is up, and silent when we do not
 * know — an absent observation must never become a reason to stop sending.
 */
export const assertWhatsappReachable = async ({ tenantId = 0, purpose = "message" } = {}) => {
  const state = await whatsappGatewayState(tenantId);
  if (!state.known || state.connected !== false) return state;

  const downSince = state.lastDisconnectedAt ? new Date(state.lastDisconnectedAt).toISOString() : "unknown";
  const error = new Error(
    `WhatsApp is disconnected (since ${downSince}); refusing to hand ${purpose} to the gateway where it cannot be seen or cancelled.`
  );
  error.code = "WHATSAPP_GATEWAY_OFFLINE";
  error.status = 503;
  error.gatewayState = state.connectionState;
  console.warn("[wa-gate] refused a direct send while the gateway is down", {
    purpose,
    connection_state: state.connectionState,
    last_disconnected_at: state.lastDisconnectedAt,
  });
  throw error;
};
