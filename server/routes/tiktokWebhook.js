// TikTok webhook receiver.
//
// Contract with TikTok: verify -> persist -> 200 immediately -> process async.
// TikTok retries for 72 hours with exponential backoff, so returning a 5xx on a
// processing bug is fine (it will come back), but returning 200 on an
// unverifiable request is not — TikTok gives us a signature, so an invalid one
// is rejected rather than silently accepted.

import express from "express";

import { redactTikTokError } from "../services/tiktokApiClient.js";
import { tiktokClientSecret, tiktokWebhookEnabled } from "../services/tiktokConfigService.js";
import {
  persistTikTokWebhookEvent,
  verifyTikTokWebhookSignature,
  wakeTikTokWebhookWorker,
} from "../services/tiktokWebhookService.js";

const router = express.Router();
const MAX_EVENT_BYTES = 512 * 1024;

export const receiveTikTokWebhook = async (req, res) => {
  if (!tiktokWebhookEnabled()) {
    return res.status(503).json({ success: false, message: "TikTok webhooks are disabled" });
  }
  if (!tiktokClientSecret()) {
    return res.status(503).json({ success: false, message: "TikTok webhook is not configured" });
  }

  // The signature is computed over the bytes as delivered. server.js already
  // captures them for every request via the express.json `verify` hook
  // (req.rawBody), so no TikTok-specific carve-out is needed — re-serialising
  // req.body here would change key order/whitespace and break every check.
  // req.tiktokRawBody is an explicit override used by tests.
  const source = req.tiktokRawBody ?? req.rawBody;
  const rawBody = typeof source === "string"
    ? source
    : Buffer.isBuffer(source)
      ? source.toString("utf8")
      : "";

  if (!rawBody) {
    return res.status(400).json({ success: false, message: "Missing TikTok webhook body" });
  }
  if (Buffer.byteLength(rawBody) > MAX_EVENT_BYTES) {
    return res.status(413).json({ success: false, message: "TikTok event is too large" });
  }

  const verification = verifyTikTokWebhookSignature({
    header: req.get("TikTok-Signature") || req.get("Tiktok-Signature") || "",
    rawBody,
  });
  if (!verification.valid) {
    console.warn("[tiktok-webhook] rejected", { reason: verification.reason });
    return res.status(401).json({ success: false, message: "Invalid TikTok signature" });
  }

  let event = null;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ success: false, message: "Malformed TikTok event" });
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return res.status(400).json({ success: false, message: "Malformed TikTok event" });
  }

  try {
    const result = await persistTikTokWebhookEvent({ event });
    // Ack before processing: TikTok requires an immediate 200 and will retry a
    // slow endpoint, producing duplicate work for an event we already hold.
    res.status(200).json({ success: true, accepted: true, duplicate: result.duplicate });
    if (!result.duplicate) wakeTikTokWebhookWorker();
    return undefined;
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error("[tiktok-webhook] persist failed", { message: redactTikTokError(error) });
    return res.status(status).json({
      success: false,
      message: status >= 500 ? "TikTok event could not be queued" : "Malformed TikTok event",
    });
  }
};

router.post("/", receiveTikTokWebhook);

export default router;
