import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const text = (value = "") => String(value ?? "").trim();
const digestBody = (body = "") => createHash("sha256").update(Buffer.isBuffer(body) ? body : Buffer.from(String(body))).digest("hex");

export const signaturePayload = ({ timestamp, nonce, method, path, rawBody = "" } = {}) =>
  [text(timestamp), text(nonce), text(method).toUpperCase(), text(path), digestBody(rawBody)].join(".");

export const signGatewayRequest = ({ secret, ...input } = {}) =>
  createHmac("sha256", text(secret)).update(signaturePayload(input)).digest("hex");

export const verifyGatewayRequest = ({ secret, signature, now = Date.now(), maxSkewMs = 300_000, ...input } = {}) => {
  if (!text(secret)) return { ok: false, reason: "secret_missing" };
  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > maxSkewMs) return { ok: false, reason: "timestamp_expired" };
  if (!text(input.nonce)) return { ok: false, reason: "nonce_missing" };
  const expected = signGatewayRequest({ secret, ...input });
  const actualBuffer = Buffer.from(text(signature), "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) return { ok: false, reason: "signature_invalid" };
  return timingSafeEqual(actualBuffer, expectedBuffer)
    ? { ok: true, reason: "verified" }
    : { ok: false, reason: "signature_invalid" };
};

export const rawJsonSaver = (req, _res, buffer) => {
  req.rawBody = Buffer.from(buffer || "");
};
