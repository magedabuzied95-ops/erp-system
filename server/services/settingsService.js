import db from "../database/db.js";
import {
  getSettingDefinition,
  normalizeSettingsCategory,
  settingsByCategory,
  settingsByKey,
  settingsCategories,
  settingsRegistry,
} from "../../shared/settingsRegistry.js";

const SECRET_MASK = "********";
const settingsCache = new Map();
let schemaEnsured = false;
let schemaEnsurePromise = null;

const clientQuery = (client, text, values) => (client || db).query(text, values);

export const ensureSystemSettingsSchema = async (client = db) => {
  if (schemaEnsured) return;
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = (async () => {
      await clientQuery(client, `
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL DEFAULT 'null'::jsonb,
          category TEXT NOT NULL,
          is_secret BOOLEAN NOT NULL DEFAULT FALSE,
          is_public BOOLEAN NOT NULL DEFAULT FALSE,
          updated_by BIGINT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientQuery(client, "CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category)");
      await clientQuery(client, "CREATE INDEX IF NOT EXISTS idx_system_settings_public ON system_settings(is_public)");
      schemaEnsured = true;
    })().catch((error) => {
      schemaEnsurePromise = null;
      throw error;
    });
  }
  await schemaEnsurePromise;
};

const cloneDefault = (value) => {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.parse(JSON.stringify(value));
  return value;
};

const parseDbValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const coerceValue = (definition, value) => {
  if (!definition) return value;
  if (value === undefined) return cloneDefault(definition.defaultValue);
  if (definition.type === "number") {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new Error(`${definition.key} must be a number`);
    const { min, max } = definition.validation || {};
    if (min !== undefined && numberValue < min) throw new Error(`${definition.key} must be at least ${min}`);
    if (max !== undefined && numberValue > max) throw new Error(`${definition.key} must be at most ${max}`);
    return numberValue;
  }
  if (definition.type === "boolean") {
    if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    return Boolean(value);
  }
  if (definition.type === "multiselect") {
    const values = Array.isArray(value)
      ? value
      : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    const allowed = new Set((definition.options || []).map((item) => item.value));
    if (allowed.size && values.some((item) => !allowed.has(item))) throw new Error(`${definition.key} contains an unsupported option`);
    return values;
  }
  if (definition.type === "json") {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        throw new Error(`${definition.key} must be valid JSON`);
      }
    }
    return value;
  }
  if (definition.type === "select") {
    const allowed = new Set((definition.options || []).map((item) => item.value));
    if (allowed.size && !allowed.has(value)) throw new Error(`${definition.key} contains an unsupported option`);
  }
  const stringValue = value === null || value === undefined ? "" : String(value);
  const maxLength = definition.validation?.maxLength;
  if (maxLength && stringValue.length > maxLength) throw new Error(`${definition.key} is too long`);
  return stringValue;
};

const buildSettingRecord = (definition, dbRow) => {
  const value = dbRow ? parseDbValue(dbRow.value) : cloneDefault(definition.defaultValue);
  return {
    ...definition,
    value: definition.isSecret ? undefined : value,
    hasValue: definition.isSecret ? Boolean(value) : undefined,
    maskedValue: definition.isSecret && value ? SECRET_MASK : undefined,
    updatedAt: dbRow?.updated_at || null,
    updatedBy: dbRow?.updated_by || null,
  };
};

const loadRows = async (where = "", values = []) => {
  await ensureSystemSettingsSchema();
  const result = await db.query(
    `
    SELECT key, value, category, is_secret, is_public, updated_by, created_at, updated_at
    FROM system_settings
    ${where}
    `,
    values
  );
  return new Map(result.rows.map((row) => [row.key, row]));
};

export const clearSettingsCache = () => {
  settingsCache.clear();
};

export const getSetting = async (key, defaultValue) => {
  const settingKey = String(key || "").trim();
  const definition = getSettingDefinition(settingKey);
  if (settingsCache.has(settingKey)) return settingsCache.get(settingKey);
  await ensureSystemSettingsSchema();
  const result = await db.query("SELECT value FROM system_settings WHERE key = $1 LIMIT 1", [settingKey]);
  const fallback = defaultValue !== undefined ? defaultValue : cloneDefault(definition?.defaultValue);
  const value = result.rows[0] ? parseDbValue(result.rows[0].value) : fallback;
  settingsCache.set(settingKey, value);
  return value;
};

export const setSetting = async (key, value, category, updatedBy = null) => {
  const settingKey = String(key || "").trim();
  const definition = getSettingDefinition(settingKey);
  if (!definition) throw new Error(`Unknown setting key: ${settingKey}`);
  const settingCategory = normalizeSettingsCategory(category || definition.category);
  if (!settingCategory || settingCategory !== definition.category) throw new Error(`Invalid category for ${settingKey}`);
  if (definition.isSecret && (value === "" || value === SECRET_MASK || value === undefined || value === null)) {
    return getSetting(settingKey, cloneDefault(definition.defaultValue));
  }
  const nextValue = coerceValue(definition, value);
  await ensureSystemSettingsSchema();
  await db.query(
    `
    INSERT INTO system_settings (key, value, category, is_secret, is_public, updated_by, created_at, updated_at)
    VALUES ($1, $2::jsonb, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      category = EXCLUDED.category,
      is_secret = EXCLUDED.is_secret,
      is_public = EXCLUDED.is_public,
      updated_by = EXCLUDED.updated_by,
      updated_at = CURRENT_TIMESTAMP
    `,
    [settingKey, JSON.stringify(nextValue), settingCategory, definition.isSecret, definition.isPublic, updatedBy]
  );
  settingsCache.set(settingKey, nextValue);
  return nextValue;
};

export const getSettingsByCategory = async (category) => {
  const normalizedCategory = normalizeSettingsCategory(category);
  if (!normalizedCategory) throw new Error("Unknown settings category");
  const definitions = settingsByCategory[normalizedCategory] || [];
  const keys = definitions.map((definition) => definition.key);
  const rowsByKey = keys.length
    ? await loadRows("WHERE key = ANY($1::text[]) OR category = $2", [keys, normalizedCategory])
    : await loadRows("WHERE category = $1", [normalizedCategory]);
  return definitions.map((definition) => buildSettingRecord(definition, rowsByKey.get(definition.key)));
};

export const maskSecretSettings = (settings) =>
  settings.map((setting) => {
    if (!setting.isSecret) return setting;
    const { value, ...rest } = setting;
    return {
      ...rest,
      value: undefined,
      maskedValue: setting.hasValue ? SECRET_MASK : "",
    };
  });

export const getPrivateSettings = async () => {
  const rowsByKey = await loadRows();
  const settings = settingsRegistry.map((definition) => buildSettingRecord(definition, rowsByKey.get(definition.key)));
  return {
    categories: settingsCategories,
    settings: maskSecretSettings(settings),
    byCategory: settingsCategories.reduce((acc, category) => {
      acc[category.key] = maskSecretSettings(settings.filter((setting) => setting.category === category.key));
      return acc;
    }, {}),
  };
};

export const getPublicSettings = async () => {
  const rowsByKey = await loadRows("WHERE is_public = TRUE");
  const flat = settingsRegistry
    .filter((definition) => definition.isPublic && !definition.isSecret)
    .map((definition) => buildSettingRecord(definition, rowsByKey.get(definition.key)))
    .reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

  const storefront = Object.entries(flat)
    .filter(([key]) => key.startsWith("storefront."))
    .reduce((acc, [key, value]) => {
      acc[key.slice("storefront.".length)] = value;
      return acc;
    }, {});

  return {
    ...flat,
    storefront,
  };
};

export const getSettingsRegistry = () => ({
  categories: settingsCategories,
  settings: settingsRegistry,
  byKey: settingsByKey,
  byCategory: settingsByCategory,
});
