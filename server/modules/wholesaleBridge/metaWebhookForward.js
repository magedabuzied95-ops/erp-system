// One Meta app has ONE webhook callback URL, and it points at this (retail) backend.
// The wholesale copy runs as a second backend with its own database, so the events of
// its Facebook page / Instagram account must reach it, and must NOT be processed here.
//
// META_WEBHOOK_FORWARD_IDS  page ids / Instagram business account ids owned by the other copy
// META_WEBHOOK_FORWARD_URL  that copy's webhook, e.g. https://api-jomla.m1store-egy.com/api/meta/webhook
//
// The raw body goes out byte-for-byte with Meta's signature header, so the receiver
// verifies it with the same app secret exactly as if Meta had called it directly.

const FORWARD_TIMEOUT_MS = 8_000;

const text = (value) => String(value ?? "").trim();

export const metaWebhookForwardIds = (env = process.env) =>
  new Set(text(env.META_WEBHOOK_FORWARD_IDS).split(/[\s,]+/).map(text).filter(Boolean));

export const metaWebhookForwardUrl = (env = process.env) => {
  const raw = text(env.META_WEBHOOK_FORWARD_URL);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
};

// entry.id is the page id for object "page" and the Instagram business account id for
// object "instagram" -- the account the event belongs to, never the customer.
export const splitMetaWebhookEntries = (body, forwardIds) => {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const forwarded = [];
  const kept = [];
  for (const entry of entries) {
    (forwardIds.has(text(entry?.id)) ? forwarded : kept).push(entry);
  }
  return { forwarded, kept };
};

const postRawBody = async ({ url, req, fetchImpl }) => {
  const headers = { "Content-Type": req.get?.("content-type") || "application/json" };
  const signature256 = req.headers?.["x-hub-signature-256"];
  const signature = req.headers?.["x-hub-signature"];
  if (signature256) headers["X-Hub-Signature-256"] = signature256;
  if (signature) headers["X-Hub-Signature"] = signature;
  const body = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
  });
  if (!response.ok) throw Object.assign(new Error(`forward answered HTTP ${response.status}`), { status: response.status });
};

/**
 * Forwards the other copy's entries and strips them from req.body, so the local
 * processing only ever sees this copy's own accounts.
 *
 * Returns { forwarded, kept, failed }. When every entry belonged to the other copy and the
 * forward failed, the caller should answer non-2xx so Meta redelivers the event.
 */
export const forwardForeignMetaWebhookEntries = async ({ req, env = process.env, fetchImpl = fetch } = {}) => {
  const url = metaWebhookForwardUrl(env);
  const forwardIds = metaWebhookForwardIds(env);
  if (!url || !forwardIds.size) return { forwarded: 0, kept: null, failed: false };

  const { forwarded, kept } = splitMetaWebhookEntries(req.body, forwardIds);
  if (!forwarded.length) return { forwarded: 0, kept: kept.length, failed: false };

  let failed = false;
  try {
    await postRawBody({ url, req, fetchImpl });
    console.log("[meta-webhook-forward] delivered", { object: text(req.body?.object), forwarded: forwarded.length, kept: kept.length });
  } catch (error) {
    failed = true;
    console.error("[meta-webhook-forward] failed", {
      object: text(req.body?.object),
      forwarded: forwarded.length,
      kept: kept.length,
      message: error?.message || "unknown",
    });
  }

  req.body = { ...req.body, entry: kept };
  return { forwarded: forwarded.length, kept: kept.length, failed };
};
