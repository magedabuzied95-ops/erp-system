import db from "../database/db.js";

const SETTINGS_KEY = "global";

const defaultSettings = {
  autoReplyMode: "suggest_only",
  tone: "casual",
  ai_shoe_cover_enabled: true,
  safety: {
    no_fake_stock: true,
    no_fake_price: true,
    escalate_angry_customers: true,
  },
  debug: {
    show_live_logs: true,
    show_memory_debug: true,
  },
};

let fallbackSettings = { ...defaultSettings };
let lastPersisted = false;
let tableReadyPromise = null;

const normalizeValue = (value = {}) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
};

const mergeSettings = (current = {}, patch = {}) => ({
  ...current,
  ...patch,
  safety: {
    ...(current.safety || {}),
    ...(patch.safety || {}),
  },
  debug: {
    ...(current.debug || {}),
    ...(patch.debug || {}),
  },
});

const withDefaults = (value = {}) => mergeSettings(defaultSettings, normalizeValue(value));

export async function ensureAISettingsTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = db.query(`
      CREATE TABLE IF NOT EXISTS ai_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }
  return tableReadyPromise;
}

export async function getAISettings() {
  try {
    await ensureAISettingsTable();
    const result = await db.query(`SELECT value FROM ai_settings WHERE key = $1 LIMIT 1`, [SETTINGS_KEY]);
    if (!result.rows.length) {
      const inserted = await db.query(
        `
        INSERT INTO ai_settings (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = ai_settings.value, updated_at = ai_settings.updated_at
        RETURNING value
        `,
        [SETTINGS_KEY, JSON.stringify(defaultSettings)]
      );
      fallbackSettings = withDefaults(inserted.rows[0]?.value || defaultSettings);
      lastPersisted = true;
      return fallbackSettings;
    }
    fallbackSettings = withDefaults(result.rows[0]?.value);
    lastPersisted = true;
    return fallbackSettings;
  } catch (error) {
    lastPersisted = false;
    console.warn("[ai-settings] persistence read failed; using fallback defaults", {
      message: error?.message || "Unknown error",
      code: error?.code || "",
    });
    return withDefaults(fallbackSettings);
  }
}

export async function updateAISettings(patch = {}) {
  try {
    await ensureAISettingsTable();
    const current = await getAISettings();
    const next = mergeSettings(current, normalizeValue(patch));
    const result = await db.query(
      `
      INSERT INTO ai_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      RETURNING value
      `,
      [SETTINGS_KEY, JSON.stringify(next)]
    );
    fallbackSettings = withDefaults(result.rows[0]?.value || next);
    lastPersisted = true;
    return fallbackSettings;
  } catch (error) {
    lastPersisted = false;
    fallbackSettings = mergeSettings(withDefaults(fallbackSettings), normalizeValue(patch));
    console.warn("[ai-settings] persistence write failed; using in-memory fallback", {
      message: error?.message || "Unknown error",
      code: error?.code || "",
    });
    return fallbackSettings;
  }
}

export function wasAISettingsPersisted() {
  return lastPersisted;
}

export function getAIToneInstruction(tone = fallbackSettings.tone) {
  if (tone === "professional") return "Use professional Arabic, clear and respectful.";
  if (tone === "luxury") return "Use premium luxury seller tone, confident and polished.";
  return "Use friendly Egyptian Arabic, short and helpful.";
}
