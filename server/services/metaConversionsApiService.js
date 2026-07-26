import crypto from "node:crypto";
import db from "../database/db.js";

const GRAPH_API_VERSION = "v25.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const DEFAULT_META_DATASET_ID = "2459469681170451";

const text = (value = "") => String(value ?? "").trim();
const normalizeNumericText = (value = "") =>
  text(value)
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[,\u066C\s]/g, "")
    .replace(/\u066B/g, ".")
    .replace(/[^\d.-]/g, "");
const numberValue = (value = 0) => {
  const parsed = Number(typeof value === "number" ? value : normalizeNumericText(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const sha256 = async (value = "") => {
  const normalized = text(value).toLowerCase();
  if (!normalized || !globalThis.crypto?.subtle) return "";
  const data = new TextEncoder().encode(normalized);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const configuredAccessToken = () => text(process.env.M1_META_CAPI_ACCESS_TOKEN || process.env.META_CAPI_ACCESS_TOKEN);
const datasetId = () => text(process.env.M1_META_DATASET_ID || process.env.META_DATASET_ID || process.env.M1_META_PIXEL_ID || process.env.META_PIXEL_ID || DEFAULT_META_DATASET_ID);
const secretKey = () =>
  crypto.createHash("sha256").update(text(process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || "SECRET_KEY")).digest();
const decryptStoredToken = (value = "") => {
  const raw = text(value);
  if (!raw || !raw.startsWith("enc:v1:")) return raw;
  const [, , ivRaw, tagRaw, encryptedRaw] = raw.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
};
const storedMetaAccessToken = async (tenantId = 1) => {
  try {
    const result = await db.query(
      `
      SELECT token
      FROM (
        SELECT COALESCE(page_access_token, access_token_encrypted, '') AS token, updated_at
        FROM marketing_settings
        WHERE tenant_id = $1::integer
        UNION ALL
        SELECT COALESCE(page_access_token_encrypted, '') AS token, updated_at
        FROM meta_integration_configs
        WHERE tenant_id = $1::integer
      ) candidates
      WHERE COALESCE(token, '') <> ''
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
      `,
      [Number(tenantId) || 1]
    );
    return decryptStoredToken(result.rows?.[0]?.token || "");
  } catch {
    return "";
  }
};
const cookieValue = (req, name) => {
  const direct = req?.cookies?.[name];
  if (direct) return direct;
  const raw = text(req?.headers?.cookie);
  return raw
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
};

export const sendStorefrontMetaEvent = async ({ req, event = {}, tenantId = 1 } = {}) => {
  const token = configuredAccessToken() || await storedMetaAccessToken(tenantId);
  const pixelOrDatasetId = datasetId();
  const eventName = text(event.event_name);
  const contentIds = Array.isArray(event.content_ids) ? event.content_ids.map(text).filter(Boolean) : [];
  const eventValue = numberValue(event.value);
  if (!token || !pixelOrDatasetId || !eventName || !contentIds.length) {
    return { sent: false, reason: "missing_config_or_content_ids" };
  }
  if (eventName === "Purchase" && eventValue <= 0) {
    return { sent: false, reason: "invalid_purchase_value" };
  }

  const userData = {
    client_ip_address: req?.headers?.["x-forwarded-for"]?.split(",")?.[0]?.trim() || req?.socket?.remoteAddress || "",
    client_user_agent: req?.headers?.["user-agent"] || "",
    fbp: text(event.fbp) || cookieValue(req, "_fbp"),
    fbc: text(event.fbc) || cookieValue(req, "_fbc"),
  };
  const emailHash = await sha256(event.email);
  const phoneHash = await sha256(event.phone);
  const firstNameHash = await sha256(event.first_name);
  const lastNameHash = await sha256(event.last_name);
  const externalIdHash = await sha256(event.external_id);
  if (emailHash) userData.em = [emailHash];
  if (phoneHash) userData.ph = [phoneHash];
  if (firstNameHash) userData.fn = [firstNameHash];
  if (lastNameHash) userData.ln = [lastNameHash];
  if (externalIdHash) userData.external_id = [externalIdHash];

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: text(event.event_id),
        action_source: "website",
        event_source_url: text(event.event_source_url) || text(req?.headers?.referer),
        user_data: userData,
        custom_data: {
          content_type: "product",
          content_ids: contentIds,
          ...(text(event.content_name) ? { content_name: text(event.content_name) } : {}),
          ...(Array.isArray(event.contents) && event.contents.length ? { contents: event.contents } : {}),
          ...(numberValue(event.num_items) ? { num_items: Math.floor(numberValue(event.num_items)) } : {}),
          currency: text(event.currency) || "EGP",
          value: eventValue,
        },
      },
    ],
  };
  if (event.test_event_code) payload.test_event_code = text(event.test_event_code);

  const response = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(pixelOrDatasetId)}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || "Meta Conversions API request failed");
    error.status = response.status;
    error.metaResponse = body;
    throw error;
  }
  return { sent: true, payload, response: body };
};
