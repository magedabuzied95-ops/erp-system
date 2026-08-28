// TikTok API for Business webhook — comment.update intake.
//
// CONTRACT PROVENANCE (2026-08-28)
// --------------------------------
// The Business webhook signature contract was read from TikTok's own
// documentation (Accounts API > Guides > Webhooks > Webhook verification):
//
//   header     Tiktok-Signature: t=<unix seconds>,s=<hex>
//   signature  s = HMAC-SHA256(app_secret, "<t>." + <raw request body>)
//
// The ALGORITHM is the same one the Content Posting webhook uses, but the KEY is
// this app's own secret (TIKTOK_BUSINESS_APP_SECRET) — never the Content Posting
// client_secret. TikTok's sample implementation signs `t + "." + JSON.stringify(body)`;
// we sign the raw bytes, which is what JSON.stringify reproduces only if the
// body was never re-parsed — hence the express.raw() mount and the server.js
// raw-body carve-out.
//
// INTAKE MODEL
// ------------
// Verify -> dedupe -> persist -> 200, nothing else. Rows land in
// tiktok_business_webhook_events and are processed by the comments worker
// (tiktokBusinessCommentsSyncService.processTikTokBusinessWebhookEvent), so a
// slow downstream can never make us miss TikTok's response deadline, and
// at-least-once delivery is absorbed by the event_key unique constraint.
//
// MOUNTED in server.js at /api/webhooks/tiktok-business, gated on
// TIKTOK_BUSINESS_ENABLED + TIKTOK_BUSINESS_WEBHOOK_ENABLED. While either flag
// is off the handler answers 503 (NOT 200 — a 200 would tell TikTok the event
// was accepted and stop its retries, silently discarding real events).

import crypto from "node:crypto";
import express from "express";

import db from "../database/db.js";
import { parseTikTokBusinessWebhookContent } from "../services/tiktokBusinessApiClient.js";
import {
  tiktokBusinessAppSecret,
  tiktokBusinessEnabled,
  tiktokBusinessWebhookEnabled,
} from "../services/tiktokBusinessConfigService.js";

const router = express.Router();
const text = (value = "") => String(value ?? "").trim();

export const TIKTOK_BUSINESS_WEBHOOK_CONTRACT = Object.freeze({
  verified: true,
  path: "/api/webhooks/tiktok-business",
  requires_raw_body: true,
  signature_header: "tiktok-signature",
  signature_algorithm: "HMAC-SHA256(app_secret, `${t}.${rawBody}`)",
  signing_secret_source: "TIKTOK_BUSINESS_APP_SECRET",
  delivery_semantics: "at_least_once",
  replay_window_seconds: Math.max(60, Number(process.env.TIKTOK_BUSINESS_WEBHOOK_TOLERANCE_SECONDS || 300)),
});

export class TikTokBusinessWebhookError extends Error {
  constructor(message, code = "TIKTOK_BUSINESS_WEBHOOK_REJECTED", status = 401) {
    super(message);
    this.name = "TikTokBusinessWebhookError";
    this.code = code;
    this.status = status;
  }
}

// Parses "t=1633174587,s=<hex>" into its parts. Tolerates reordered elements;
// rejects anything missing either key.
export const parseTikTokSignatureHeader = (header = "") => {
  const parts = new Map();
  for (const element of text(header).split(",")) {
    const eq = element.indexOf("=");
    if (eq <= 0) continue;
    parts.set(element.slice(0, eq).trim(), element.slice(eq + 1).trim());
  }
  const timestamp = Number(parts.get("t"));
  const signature = text(parts.get("s")).toLowerCase();
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !signature) return null;
  return { timestamp, signature };
};

// Verifies a raw webhook body against the documented contract. Throws typed
// errors; never returns a boolean that could be ignored.
export const verifyBusinessWebhookSignature = ({ header = "", rawBody = "", secret = "", now = Date.now(), toleranceSeconds = TIKTOK_BUSINESS_WEBHOOK_CONTRACT.replay_window_seconds } = {}) => {
  const signingSecret = text(secret);
  if (!signingSecret) {
    throw new TikTokBusinessWebhookError("Webhook signing secret is not configured", "TIKTOK_BUSINESS_WEBHOOK_SECRET_MISSING", 503);
  }
  const parsed = parseTikTokSignatureHeader(header);
  if (!parsed) {
    throw new TikTokBusinessWebhookError("Missing or malformed Tiktok-Signature header", "TIKTOK_BUSINESS_WEBHOOK_SIGNATURE_MALFORMED", 401);
  }

  const body = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "";
  const expected = crypto.createHmac("sha256", signingSecret).update(`${parsed.timestamp}.${body}`, "utf8").digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(parsed.signature, "utf8");
  const match = expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  if (!match) {
    throw new TikTokBusinessWebhookError("Webhook signature mismatch", "TIKTOK_BUSINESS_WEBHOOK_SIGNATURE_INVALID", 401);
  }

  // The timestamp is inside the signed payload, so an attacker cannot move it
  // without invalidating the signature — making this a real replay bound.
  const ageSeconds = Math.abs(now / 1000 - parsed.timestamp);
  if (ageSeconds > toleranceSeconds) {
    throw new TikTokBusinessWebhookError("Webhook timestamp outside the replay window", "TIKTOK_BUSINESS_WEBHOOK_REPLAY", 401);
  }
  return { timestamp: parsed.timestamp };
};

// Dedupe key for at-least-once delivery, built from the documented envelope
// (client_key/event/create_time/user_openid + the content's comment identity).
export const webhookEventKey = (payload = {}) => {
  // Digit-safe: TikTok's ids arrive as unquoted numbers past 2^53 and must
  // never round-trip through Number.
  const content = parseTikTokBusinessWebhookContent(payload?.content);
  const parts = [
    text(payload?.event ?? payload?.event_type),
    text(payload?.user_openid ?? payload?.business_id),
    text(payload?.create_time),
    text(content?.comment_id),
    text(content?.comment_action),
  ].filter(Boolean);
  // No identifying field at all means we cannot dedupe it, and a random key
  // would defeat the unique constraint it is meant to feed.
  return parts.length ? `tiktok_business:${parts.join(":")}` : "";
};

router.post("/", express.raw({ type: "*/*" }), async (req, res) => {
  if (!tiktokBusinessEnabled() || !tiktokBusinessWebhookEnabled()) {
    return res.status(503).json({
      success: false,
      code: "TIKTOK_BUSINESS_WEBHOOK_DISABLED",
      message: "TikTok Business webhook is not enabled",
    });
  }

  // In server.js the global express.json() has already consumed the stream and
  // preserved the original bytes on req.rawBody (its `verify` hook) — the same
  // source the Content Posting webhook verifies against. The express.raw()
  // above only matters when this router is mounted standalone (tests): json has
  // not run there, so the buffer arrives as req.body. Re-serialising a parsed
  // object is NOT acceptable — key order and whitespace differences break HMAC.
  const source = req.rawBody ?? req.body;
  const rawBody = Buffer.isBuffer(source) ? source : Buffer.from(typeof source === "string" ? source : "");

  try {
    verifyBusinessWebhookSignature({
      header: req.headers["tiktok-signature"] || "",
      rawBody,
      secret: tiktokBusinessAppSecret(),
    });
  } catch (error) {
    // Log the code only. Never the body (customer content), never the header
    // (attacker-controlled), never anything derived from the secret.
    console.warn("[tiktok-business-webhook] rejected", { code: text(error?.code) });
    return res.status(Number(error?.status) || 401).json({ success: false, code: text(error?.code) });
  }

  let payload = {};
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ success: false, code: "TIKTOK_BUSINESS_WEBHOOK_BODY_INVALID" });
  }

  const eventKey = webhookEventKey(payload);
  if (!eventKey) {
    // Verified as genuinely from TikTok but carrying no identity; acknowledge so
    // TikTok stops retrying something we can never dedupe.
    return res.status(200).json({ success: true, stored: false });
  }

  try {
    const inserted = await db.query(
      `INSERT INTO tiktok_business_webhook_events (event_key, business_id, event_type, payload, signature_verified, status)
       VALUES ($1::text, $2::text, $3::text, $4::jsonb, TRUE, 'pending')
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [eventKey, text(payload?.user_openid), text(payload?.event), JSON.stringify(payload)]
    );
    return res.status(200).json({ success: true, stored: Boolean(inserted.rowCount), duplicate: !inserted.rowCount });
  } catch (error) {
    // Storage failed — tell TikTok to retry rather than dropping the event.
    console.error("[tiktok-business-webhook] intake failed", { message: text(error?.message).slice(0, 200) });
    return res.status(503).json({ success: false, code: "TIKTOK_BUSINESS_WEBHOOK_STORE_FAILED" });
  }
});

export default router;
