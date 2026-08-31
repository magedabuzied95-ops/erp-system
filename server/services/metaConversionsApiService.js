import crypto from "node:crypto";
import db from "../database/db.js";
import {
  normalizeMetaCustomer,
  normalizeMetaEmail,
  normalizeMetaEgyptPhone,
  normalizeMetaText,
} from "../../shared/metaEventMatching.js";
import { metaEventContents, metaMoneyValue, metaValueFields } from "../../shared/metaEventValue.js";
import { resolveTrustedClientIp } from "../utils/trustedClientIp.js";

const GRAPH_API_VERSION = "v25.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const DEFAULT_META_DATASET_ID = "2459469681170451";

const text = (value = "") => String(value ?? "").trim();
const numberValue = metaMoneyValue;

export const sha256MetaValue = (value = "") => {
  const normalized = text(value);
  return normalized ? crypto.createHash("sha256").update(normalized, "utf8").digest("hex") : "";
};

const validMetaCookie = (value = "", prefix = "") => {
  const normalized = text(value);
  return normalized && (!prefix || normalized.startsWith(prefix)) ? normalized : "";
};

const configuredTestEventCode = () => {
  const isProduction = text(process.env.NODE_ENV).toLowerCase() === "production";
  if (isProduction) return "";
  return text(process.env.M1_META_TEST_EVENT_CODE || process.env.META_TEST_EVENT_CODE);
};

export const buildHashedMetaUserData = ({ req, event = {} } = {}) => {
  const normalized = normalizeMetaCustomer({
    email: normalizeMetaEmail(event.email),
    phone: normalizeMetaEgyptPhone(event.phone),
    first_name: normalizeMetaText(event.first_name),
    last_name: normalizeMetaText(event.last_name),
    city: normalizeMetaText(event.city),
    state: normalizeMetaText(event.state),
    country: normalizeMetaText(event.country),
    external_id: text(event.external_id),
  });
  const userData = {
    client_ip_address: resolveTrustedClientIp(req),
    client_user_agent: text(req?.headers?.["user-agent"]),
    fbp: validMetaCookie(event.fbp, "fb.") || validMetaCookie(cookieValue(req, "_fbp"), "fb."),
    fbc: validMetaCookie(event.fbc, "fb.") || validMetaCookie(cookieValue(req, "_fbc"), "fb."),
  };
  if (normalized.email) userData.em = [sha256MetaValue(normalized.email)];
  if (normalized.phone) userData.ph = [sha256MetaValue(normalized.phone)];
  if (normalized.firstName) userData.fn = [sha256MetaValue(normalized.firstName)];
  if (normalized.lastName) userData.ln = [sha256MetaValue(normalized.lastName)];
  if (normalized.city) userData.ct = [sha256MetaValue(normalized.city)];
  if (normalized.state) userData.st = [sha256MetaValue(normalized.state)];
  if (normalized.country) userData.country = [sha256MetaValue(normalized.country)];
  if (normalized.externalId) userData.external_id = [sha256MetaValue(normalized.externalId)];
  return Object.fromEntries(Object.entries(userData).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value)));
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
export const uniqueMetaAccessTokens = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => {
    try {
      return decryptStoredToken(value);
    } catch {
      return "";
    }
  }).map(text).filter(Boolean))];

const storedMetaAccessTokens = async (tenantId = 1) => {
  try {
    const result = await db.query(
      `
      SELECT token, priority, updated_at
      FROM (
        SELECT long_lived_user_token AS token, 1 AS priority, updated_at
        FROM marketing_settings
        WHERE tenant_id = $1::integer
        UNION ALL
        SELECT access_token_encrypted AS token, 2 AS priority, updated_at
        FROM marketing_settings
        WHERE tenant_id = $1::integer
        UNION ALL
        SELECT page_access_token AS token, 3 AS priority, updated_at
        FROM marketing_settings
        WHERE tenant_id = $1::integer
        UNION ALL
        SELECT page_access_token_encrypted AS token, 4 AS priority, updated_at
        FROM meta_integration_configs
        WHERE tenant_id = $1::integer
      ) candidates
      WHERE COALESCE(token, '') <> ''
      ORDER BY priority ASC, updated_at DESC NULLS LAST
      `,
      [Number(tenantId) || 1]
    );
    return uniqueMetaAccessTokens((result.rows || []).map((row) => row.token));
  } catch {
    return [];
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
  const tokens = uniqueMetaAccessTokens([
    configuredAccessToken(),
    ...await storedMetaAccessTokens(tenantId),
  ]);
  const pixelOrDatasetId = datasetId();
  const eventName = text(event.event_name);
  const metaEventId = text(event.event_id);
  const contentIds = Array.isArray(event.content_ids) ? event.content_ids.map(text).filter(Boolean) : [];
  const eventValue = numberValue(event.value);
  const eventContents = metaEventContents(event.contents);
  if (!tokens.length || !pixelOrDatasetId || !eventName || !metaEventId || !contentIds.length) {
    return { sent: false, reason: "missing_config_or_content_ids" };
  }
  if (eventName === "Purchase" && eventValue <= 0) {
    return { sent: false, reason: "invalid_purchase_value" };
  }

  const userData = buildHashedMetaUserData({ req, event });

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: metaEventId,
        action_source: "website",
        event_source_url: text(event.event_source_url) || text(req?.headers?.referer),
        user_data: userData,
        custom_data: {
          content_type: "product",
          content_ids: contentIds,
          ...(text(event.content_name) ? { content_name: text(event.content_name) } : {}),
          ...(eventContents.length ? { contents: eventContents } : {}),
          ...(numberValue(event.num_items) ? { num_items: Math.floor(numberValue(event.num_items)) } : {}),
          ...metaValueFields({ value: eventValue, currency: event.currency }),
        },
      },
    ],
  };
  const testEventCode = configuredTestEventCode();
  if (testEventCode) payload.test_event_code = testEventCode;

  let lastError = null;
  for (const token of tokens) {
    const response = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(pixelOrDatasetId)}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      return { sent: true, payload, response: body };
    }
    const error = new Error(body?.error?.message || "Meta Conversions API request failed");
    error.status = response.status;
    error.metaResponse = body;
    lastError = error;
  }
  throw lastError || new Error("Meta Conversions API request failed");
};
