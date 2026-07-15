import db from "../database/db.js";

export const DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS = [
  "إزيك يا صديقي {{customer_name}} 👋",
  "أهلاً وسهلاً يا {{customer_name}} ❤️",
  "نورتنا يا صديقي {{customer_name}} ✨",
  "منورنا يا {{customer_name}} 🙏",
  "أهلاً بحضرتك يا {{customer_name}} 🌟",
];

export const DEFAULT_SOCIAL_PUBLIC_REPLY_BODY = [
  "تم الرد عليك في الخاص يا صديقي ❤️",
  "وعندنا شحن لكل المحافظات 📦🚚",
  "━━━━━━━━━━━━━━━━━━",
  "❤️ العنوان: دمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب",
].join("\n");

export const DEFAULT_SOCIAL_AUTOMATION_SETTINGS = {
  auto_like_enabled: false,
  auto_public_reply_enabled: false,
  auto_private_message_enabled: false,
  min_confidence: 0.9,
  public_reply_template: DEFAULT_SOCIAL_PUBLIC_REPLY_BODY,
  public_reply_rotation_enabled: true,
  public_reply_openers: DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS,
  private_message_template: null,
};

const LEGACY_PUBLIC_REPLY_TEMPLATES = new Set([
  "تم إرسال التفاصيل في رسالة خاصة",
  "تم إرسال التفاصيل في رسالة خاصة ",
]);

let schemaReadyPromise = null;
let fallbackSettings = { ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS };

const text = (value = "") => String(value ?? "").trim();

const booleanFrom = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const confidenceFrom = (value, fallback = DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
};

const normalizeTemplate = (value, fallback = "", allowNull = false) => {
  if (value === null || value === undefined) return allowNull ? null : fallback;
  const normalized = text(value);
  if (!normalized && allowNull) return null;
  return normalized || fallback;
};

const normalizePublicReplyTemplate = (value, fallback = DEFAULT_SOCIAL_AUTOMATION_SETTINGS.public_reply_template) => {
  const normalized = normalizeTemplate(value, fallback, false);
  return LEGACY_PUBLIC_REPLY_TEMPLATES.has(normalized) ? fallback : normalized;
};

const normalizePublicReplyOpeners = (value, fallback = DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS) => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = parsed.split(/\r?\n/);
    }
  }
  const normalized = (Array.isArray(parsed) ? parsed : [])
    .map((item) => text(item))
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 10);
  return normalized.length ? normalized : [...fallback];
};

const stableRotationIndex = (key = "", length = 0) => {
  if (!length) return -1;
  const source = String(key || "social-comment");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
};

export const selectSocialPublicReplyTemplate = ({
  baseTemplate = "",
  openers = DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS,
  rotationEnabled = true,
  commentId = "",
  postId = "",
} = {}) => {
  const normalizedBase = normalizeTemplate(baseTemplate, DEFAULT_SOCIAL_PUBLIC_REPLY_BODY, false);
  const normalizedOpeners = normalizePublicReplyOpeners(openers);
  if (!booleanFrom(rotationEnabled, true) || !normalizedOpeners.length) return normalizedBase;
  const opener = normalizedOpeners[stableRotationIndex(`${postId}:${commentId}`, normalizedOpeners.length)] || normalizedOpeners[0];
  if (normalizedBase.includes("{{social_reply_opener}}")) {
    return normalizedBase.replaceAll("{{social_reply_opener}}", opener).trim();
  }
  return `${opener}\n${normalizedBase}`.trim();
};

const rowToSettings = (row = {}) => ({
  tenant_id: Number(row.tenant_id || 0) || null,
  auto_like_enabled: booleanFrom(row.auto_like_enabled, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_like_enabled),
  auto_public_reply_enabled: booleanFrom(row.auto_public_reply_enabled, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_public_reply_enabled),
  auto_private_message_enabled: booleanFrom(row.auto_private_message_enabled, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_private_message_enabled),
  min_confidence: confidenceFrom(row.min_confidence, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence),
  public_reply_template: normalizePublicReplyTemplate(
    row.public_reply_template,
    DEFAULT_SOCIAL_AUTOMATION_SETTINGS.public_reply_template,
  ),
  public_reply_rotation_enabled: booleanFrom(row.public_reply_rotation_enabled, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.public_reply_rotation_enabled),
  public_reply_openers: normalizePublicReplyOpeners(row.public_reply_openers, DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS),
  private_message_template: normalizeTemplate(
    row.private_message_template,
    DEFAULT_SOCIAL_AUTOMATION_SETTINGS.private_message_template,
    true
  ),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  persisted: true,
});

const normalizePatch = (patch = {}) => ({
  ...(Object.prototype.hasOwnProperty.call(patch, "auto_like_enabled") ? { auto_like_enabled: booleanFrom(patch.auto_like_enabled, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_like_enabled) } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "auto_public_reply_enabled") ? { auto_public_reply_enabled: booleanFrom(patch.auto_public_reply_enabled, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_public_reply_enabled) } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "auto_private_message_enabled") ? { auto_private_message_enabled: booleanFrom(patch.auto_private_message_enabled, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_private_message_enabled) } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "min_confidence") ? { min_confidence: confidenceFrom(patch.min_confidence, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence) } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "public_reply_template") ? { public_reply_template: normalizePublicReplyTemplate(patch.public_reply_template, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.public_reply_template) } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "public_reply_rotation_enabled") ? { public_reply_rotation_enabled: booleanFrom(patch.public_reply_rotation_enabled, true) } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "public_reply_openers") ? { public_reply_openers: normalizePublicReplyOpeners(patch.public_reply_openers, DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS) } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "private_message_template") ? { private_message_template: normalizeTemplate(patch.private_message_template, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.private_message_template, true) } : {}),
});

const mergeSettings = (current = {}, patch = {}) => rowToSettings({
  ...current,
  ...normalizePatch(patch),
});

export async function ensureSocialAutomationSettingsSchema(client = db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS social_automation_settings (
          tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          auto_like_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          auto_public_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          auto_private_message_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          min_confidence NUMERIC(6,4) NOT NULL DEFAULT 0.9000,
          public_reply_template TEXT NOT NULL DEFAULT 'أهلاً وسهلاً يا {{customer_name}} ❤️
تم الرد في الخاص يا صديقي 
وعندنا شحن لجميع محافظات مصر 
━━━━━━━━━━━━━━━━━━
 العنوان:
دمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️

 اللوكيشن:
https://share.google/1e0cM7JVmxyLTpWVe',
          public_reply_rotation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          public_reply_openers JSONB NOT NULL DEFAULT '[]'::jsonb,
          private_message_template TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        ALTER TABLE IF EXISTS social_automation_settings
          ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
          ADD COLUMN IF NOT EXISTS auto_like_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS auto_public_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS auto_private_message_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS min_confidence NUMERIC(6,4) NOT NULL DEFAULT 0.9000,
          ADD COLUMN IF NOT EXISTS public_reply_template TEXT NOT NULL DEFAULT 'أهلاً وسهلاً يا {{customer_name}} ❤️
تم الرد في الخاص يا صديقي 
وعندنا شحن لجميع محافظات مصر 
━━━━━━━━━━━━━━━━━━
 العنوان:
دمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️

 اللوكيشن:
https://share.google/1e0cM7JVmxyLTpWVe',
          ADD COLUMN IF NOT EXISTS public_reply_rotation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS public_reply_openers JSONB NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS private_message_template TEXT NULL,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

export async function getSocialAutomationSettings(tenantId) {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) {
    return { ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS, tenant_id: null, persisted: false };
  }

  try {
    await ensureSocialAutomationSettingsSchema();
    const result = await db.query(
      `
      SELECT *
      FROM social_automation_settings
      WHERE tenant_id = $1::bigint
      LIMIT 1
      `,
      [Math.trunc(safeTenantId)]
    );

    if (!result.rows.length) {
      const inserted = await db.query(
        `
        INSERT INTO social_automation_settings (
          tenant_id,
          auto_like_enabled,
          auto_public_reply_enabled,
          auto_private_message_enabled,
          min_confidence,
          public_reply_template,
          public_reply_rotation_enabled,
          public_reply_openers,
          private_message_template,
          created_at,
          updated_at
        )
        VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id) DO UPDATE SET
          updated_at = social_automation_settings.updated_at
        RETURNING *
        `,
        [
          Math.trunc(safeTenantId),
          DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_like_enabled,
          DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_public_reply_enabled,
          DEFAULT_SOCIAL_AUTOMATION_SETTINGS.auto_private_message_enabled,
          DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence,
          DEFAULT_SOCIAL_AUTOMATION_SETTINGS.public_reply_template,
          DEFAULT_SOCIAL_AUTOMATION_SETTINGS.public_reply_rotation_enabled,
          JSON.stringify(DEFAULT_SOCIAL_AUTOMATION_SETTINGS.public_reply_openers),
          DEFAULT_SOCIAL_AUTOMATION_SETTINGS.private_message_template,
        ]
      );
      const settings = rowToSettings(inserted.rows[0] || {});
      fallbackSettings = settings;
      return settings;
    }

    const settings = rowToSettings(result.rows[0]);
    fallbackSettings = settings;
    return settings;
  } catch (error) {
    console.warn("[social-automation-settings] read failed; using fallback", {
      tenant_id: safeTenantId,
      message: error?.message || "Unknown error",
      code: error?.code || "",
    });
    return { ...fallbackSettings, tenant_id: Math.trunc(safeTenantId), persisted: false };
  }
}

export async function updateSocialAutomationSettings(tenantId, patch = {}) {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) {
    throw Object.assign(new Error("Invalid tenant"), { status: 400 });
  }

  try {
    await ensureSocialAutomationSettingsSchema();
    const current = await getSocialAutomationSettings(safeTenantId);
    const next = mergeSettings(current, patch);
    const result = await db.query(
      `
      INSERT INTO social_automation_settings (
        tenant_id,
        auto_like_enabled,
        auto_public_reply_enabled,
        auto_private_message_enabled,
        min_confidence,
        public_reply_template,
        public_reply_rotation_enabled,
        public_reply_openers,
        private_message_template,
        created_at,
        updated_at
      )
      VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, COALESCE($10::timestamp, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id) DO UPDATE SET
        auto_like_enabled = EXCLUDED.auto_like_enabled,
        auto_public_reply_enabled = EXCLUDED.auto_public_reply_enabled,
        auto_private_message_enabled = EXCLUDED.auto_private_message_enabled,
        min_confidence = EXCLUDED.min_confidence,
        public_reply_template = EXCLUDED.public_reply_template,
        public_reply_rotation_enabled = EXCLUDED.public_reply_rotation_enabled,
        public_reply_openers = EXCLUDED.public_reply_openers,
        private_message_template = EXCLUDED.private_message_template,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [
        Math.trunc(safeTenantId),
        next.auto_like_enabled,
        next.auto_public_reply_enabled,
        next.auto_private_message_enabled,
        next.min_confidence,
        next.public_reply_template,
        next.public_reply_rotation_enabled,
        JSON.stringify(next.public_reply_openers),
        next.private_message_template,
        current.created_at || null,
      ]
    );
    const settings = rowToSettings(result.rows[0] || next);
    if (Object.prototype.hasOwnProperty.call(patch, "public_reply_template")) {
      await db.query(
        `
        UPDATE social_auto_reply_settings
        SET generic_template = $2::text,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1::bigint
        `,
        [Math.trunc(safeTenantId), settings.public_reply_template]
      ).catch((syncError) => {
        console.warn("[social-automation-settings] global public template sync failed", {
          tenant_id: safeTenantId,
          message: syncError?.message || "Unknown error",
        });
      });
    }
    fallbackSettings = settings;
    return settings;
  } catch (error) {
    console.warn("[social-automation-settings] write failed; using fallback", {
      tenant_id: safeTenantId,
      message: error?.message || "Unknown error",
      code: error?.code || "",
    });
    fallbackSettings = mergeSettings(fallbackSettings, patch);
    return { ...fallbackSettings, tenant_id: Math.trunc(safeTenantId), persisted: false };
  }
}
