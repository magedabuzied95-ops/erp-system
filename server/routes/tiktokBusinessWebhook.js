// TikTok API for Business webhook — architecture only. NOT MOUNTED.
//
// THIS ROUTER IS NOT REGISTERED IN server.js, ON PURPOSE
// -----------------------------------------------------
// Mounting it would expose a new unauthenticated public endpoint. TikTok has not
// been given this URL, no webhook is registered, and no event can legitimately
// arrive — so the only traffic it could receive today is unsolicited. The
// endpoint therefore stays off until the Business app is approved and a webhook
// is actually registered.
//
// To activate later (two edits, both additive):
//   1. server.js — retain the raw body for this path, alongside the existing
//      /api/meta/webhook and /api/webhooks/tiktok carve-outs. Signature
//      verification is computed over raw bytes; express.json() destroys them,
//      and re-serialising the parsed object does NOT reproduce the original.
//   2. server.js — app.use("/api/webhooks/tiktok-business", tiktokBusinessWebhookRoutes)
//
// WHY THE SIGNATURE IS NOT IMPLEMENTED
// ------------------------------------
// The TikTok *for Developers* webhook contract is known and already implemented
// in tiktokWebhookService.js: header `TikTok-Signature: t=<unix>,s=<hex>`, and
// HMAC-SHA256(client_secret, "<t>.<raw body>").
//
// That contract MUST NOT be copied here. It belongs to a different app on a
// different host with a different credential (client_secret vs Business app
// secret), and business-api.tiktok.com publishes its own webhook documentation
// which could not be read programmatically — the portal renders client-side.
// Assuming the two are identical is exactly the kind of guess that produces code
// which looks verified and is not. Until the Business webhook docs are read,
// verifyBusinessWebhookSignature() refuses rather than guesses.
//
// A webhook whose signature check is a guess is worse than no webhook: it either
// rejects genuine events, or accepts forged ones.

import express from "express";

import {
  tiktokBusinessWebhookEnabled,
  tiktokBusinessEnabled,
} from "../services/tiktokBusinessConfigService.js";

const router = express.Router();

export const TIKTOK_BUSINESS_WEBHOOK_STATUS = "WAITING_FOR_TIKTOK_BUSINESS_APP_APPROVAL";

// The unverified half of the contract, quarantined like every other guess in
// this integration. `verified: false` is what keeps the handler closed.
export const TIKTOK_BUSINESS_WEBHOOK_CONTRACT = Object.freeze({
  verified: false,
  path: "/api/webhooks/tiktok-business",
  requires_raw_body: true,
  // Deliberately null, not a copied value. See the header comment.
  signature_header: null,
  signature_algorithm: null,
  signing_secret_source: null,
  // Assumed, because every comparable TikTok surface behaves this way and the
  // cost of being wrong is only redundant work, not incorrect data.
  delivery_semantics: "assume_at_least_once",
  replay_window_seconds: 300,
});

export class TikTokBusinessWebhookDisabledError extends Error {
  constructor(detail = "") {
    super(`TikTok Business webhook is disabled: ${detail}`);
    this.name = "TikTokBusinessWebhookDisabledError";
    this.code = TIKTOK_BUSINESS_WEBHOOK_STATUS;
    this.status = 503;
  }
}

// Refuses unconditionally today. Written as a real function rather than a TODO
// so the call site exists and cannot be forgotten when the contract is filled in.
export const verifyBusinessWebhookSignature = () => {
  if (!TIKTOK_BUSINESS_WEBHOOK_CONTRACT.verified) {
    throw new TikTokBusinessWebhookDisabledError(
      "the TikTok API for Business webhook signature contract has not been confirmed against the official documentation"
    );
  }
  throw new TikTokBusinessWebhookDisabledError("signature verification is not implemented");
};

// Dedupe key for at-least-once delivery. Pure and testable now; the field names
// it reads are best-effort and will be corrected with the rest of the contract.
export const webhookEventKey = (payload = {}) => {
  const parts = [
    String(payload?.event_id ?? "").trim(),
    String(payload?.event ?? payload?.event_type ?? "").trim(),
    String(payload?.business_id ?? "").trim(),
    String(payload?.create_time ?? "").trim(),
  ].filter(Boolean);
  // No identifying field at all means we cannot dedupe it, and a random key
  // would defeat the unique constraint it is meant to feed.
  return parts.length ? `tiktok_business:${parts.join(":")}` : "";
};

// Three independent gates. All three are closed; any one of them is enough.
router.post("/", express.raw({ type: "*/*" }), (req, res) => {
  if (!tiktokBusinessEnabled() || !tiktokBusinessWebhookEnabled() || !TIKTOK_BUSINESS_WEBHOOK_CONTRACT.verified) {
    // 503, not 200. Returning 200 would tell TikTok the event was accepted and
    // stop its retries — silently discarding real events once registration
    // happens. 503 keeps them in TikTok's retry queue.
    return res.status(503).json({
      success: false,
      code: TIKTOK_BUSINESS_WEBHOOK_STATUS,
      message: "TikTok Business webhook is not enabled",
    });
  }
  return res.status(503).json({
    success: false,
    code: TIKTOK_BUSINESS_WEBHOOK_STATUS,
    message: "TikTok Business webhook handler is not implemented",
  });
});

export default router;
