import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ======================================================
   ONE WRITER PER WHATSAPP NUMBER
   ------------------------------------------------------
   Every WhatsApp conversation was arriving doubled. The number runs WhatsApp **Coexistence** —
   the same line on the Business App and on Cloud API at once — so each inbound message reached us
   twice: once through the Cloud webhook as a `wamid.…`, once through Evolution as the bare
   provider id. Those are the same message (the bare id is literally inside the base64 of the
   wamid) but they produce different dedupe keys, so neither copy could recognise the other.

   The Cloud integration row already said status='disconnected' and webhook_subscribed=false. The
   inbound path simply never read it — Meta keeps delivering to the app-level webhook regardless.

   What this pins down:
     1. Inbound Cloud messages are gated on the integration being CONNECTED.
     2. Delivery STATUS events are never gated — a receipt for a message we did send must land.
     3. A failed gate read lets the message through: losing messages beats duplicating them.
====================================================== */

const routeSource = readFileSync(
  fileURLToPath(new URL("../routes/aiAgentOrders.js", import.meta.url)),
  "utf8"
);

const gateStart = routeSource.indexOf("const isWhatsappCloudIngestionAllowed = async");
assert.ok(gateStart > 0, "the Cloud ingestion gate is gone");
const gateBody = routeSource.slice(gateStart, routeSource.indexOf("const resolveWhatsappTenantId = async", gateStart));

// ── 1. Only a connected integration may write ─────────────────────────────────────────────────
assert.match(
  gateBody,
  /FROM whatsapp_cloud_integrations/,
  "the gate must read the integration row, not a flag or an env var"
);
assert.match(
  gateBody,
  /if \(status !== "connected"\) return \{ allowed: false/,
  "anything other than connected must be refused — disconnected is what was ingesting"
);
assert.match(
  gateBody,
  /if \(!row\) return \{ allowed: false, reason: "cloud_integration_not_configured" \}/,
  "no integration row means no Cloud inbound"
);

// ── 2. Status events must still land ──────────────────────────────────────────────────────────
assert.match(
  routeSource,
  /if \(!cloudIngestAllowed\.allowed && !hasStatuses\)/,
  "delivery receipts must not be dropped by the inbound gate"
);

// ── 3. A broken gate must not silence the channel ─────────────────────────────────────────────
assert.match(
  gateBody,
  /catch \(error\)[\s\S]{0,220}return \{ allowed: true, reason: "gate_unavailable" \}/,
  "a failed gate read must let messages through — a lost message is worse than a duplicate"
);

// The gate has to run BEFORE the messages are extracted and written.
const gateCallIndex = routeSource.indexOf("const cloudIngestAllowed = await isWhatsappCloudIngestionAllowed");
const extractIndex = routeSource.indexOf("const messages = extractWhatsAppWebhookMessages({ body: req.body, tenantId })");
assert.ok(gateCallIndex > 0 && extractIndex > 0, "the gate call or the extraction is gone");
assert.ok(gateCallIndex < extractIndex, "the gate must run before any message is extracted");

console.log("whatsapp cloud ingest gate OK");
