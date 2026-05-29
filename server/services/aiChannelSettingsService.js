import db from "../database/db.js";

const defaultChannelSettings = {
  aiMode: "suggest_only",
  tone: null,
  safety: {},
  debug: {},
};

let schemaReadyPromise = null;
const fallbackByChannel = new Map();

const text = (value = "") => String(value ?? "").trim();
const json = (value) => JSON.stringify(value === undefined ? null : value);

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

const normalizeMode = (value = "") =>
  ["off", "suggest_only", "fully_automatic"].includes(text(value).toLowerCase())
    ? text(value).toLowerCase()
    : defaultChannelSettings.aiMode;

const mergeSettings = (current = {}, patch = {}) => ({
  ...current,
  ...patch,
  aiMode: normalizeMode(patch.aiMode || patch.ai_mode || current.aiMode),
  tone: patch.tone === "" ? null : patch.tone ?? current.tone ?? null,
  safety: {
    ...(current.safety || {}),
    ...(patch.safety || {}),
  },
  debug: {
    ...(current.debug || {}),
    ...(patch.debug || {}),
  },
});

const withDefaults = (value = {}) => mergeSettings(defaultChannelSettings, normalizeValue(value));

const rowToSettings = (row = {}) => withDefaults({
  aiMode: row.ai_mode || row.settings?.aiMode || row.settings?.auto_reply_mode,
  tone: row.tone || row.settings?.tone || null,
  safety: row.safety || row.settings?.safety || {},
  debug: row.debug || row.settings?.debug || {},
});

export async function ensureAIChannelSettingsTable() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_channel_settings (
          tenant_id BIGINT NOT NULL DEFAULT 0,
          channel TEXT NOT NULL DEFAULT '',
          settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, channel)
        )
      `);
      await db.query(`ALTER TABLE ai_channel_settings ADD COLUMN IF NOT EXISTS channel_id TEXT`);
      await db.query(`ALTER TABLE ai_channel_settings ADD COLUMN IF NOT EXISTS platform TEXT`);
      await db.query(`ALTER TABLE ai_channel_settings ADD COLUMN IF NOT EXISTS ai_mode TEXT NOT NULL DEFAULT 'suggest_only'`);
      await db.query(`ALTER TABLE ai_channel_settings ADD COLUMN IF NOT EXISTS tone TEXT`);
      await db.query(`ALTER TABLE ai_channel_settings ADD COLUMN IF NOT EXISTS debug JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await db.query(`ALTER TABLE ai_channel_settings ADD COLUMN IF NOT EXISTS safety JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_channel_settings_channel_id ON ai_channel_settings (channel_id) WHERE channel_id IS NOT NULL AND channel_id <> ''`);
    })();
  }
  return schemaReadyPromise;
}

export async function getAIChannelSettings(channelId, platform = "") {
  const safeChannelId = text(channelId || platform || "default").toLowerCase();
  const safePlatform = text(platform || safeChannelId).toLowerCase();
  try {
    await ensureAIChannelSettingsTable();
    const result = await db.query(
      `SELECT * FROM ai_channel_settings WHERE channel_id = $1 OR channel = $1 ORDER BY updated_at DESC LIMIT 1`,
      [safeChannelId]
    );
    if (!result.rows.length) {
      const inserted = await db.query(
        `
        INSERT INTO ai_channel_settings (tenant_id, channel, channel_id, platform, settings, ai_mode, tone, safety, debug, updated_at)
        VALUES (0, $1, $1, $2, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb, NOW())
        ON CONFLICT (channel_id) WHERE channel_id IS NOT NULL AND channel_id <> ''
        DO UPDATE SET updated_at = ai_channel_settings.updated_at
        RETURNING *
        `,
        [
          safeChannelId,
          safePlatform,
          json(defaultChannelSettings),
          defaultChannelSettings.aiMode,
          defaultChannelSettings.tone,
          json(defaultChannelSettings.safety),
          json(defaultChannelSettings.debug),
        ]
      );
      const settings = rowToSettings(inserted.rows[0]);
      fallbackByChannel.set(safeChannelId, settings);
      return { ...settings, channelId: safeChannelId, platform: safePlatform, persisted: true };
    }
    const settings = rowToSettings(result.rows[0]);
    fallbackByChannel.set(safeChannelId, settings);
    return { ...settings, channelId: safeChannelId, platform: result.rows[0].platform || safePlatform, persisted: true };
  } catch (error) {
    console.warn("[ai-channel-settings] persistence read failed; using fallback", {
      channel_id: safeChannelId,
      message: error?.message || "Unknown error",
      code: error?.code || "",
    });
    return { ...withDefaults(fallbackByChannel.get(safeChannelId) || {}), channelId: safeChannelId, platform: safePlatform, persisted: false };
  }
}

export async function updateAIChannelSettings(channelId, patch = {}) {
  const safeChannelId = text(channelId || patch.channelId || patch.platform || "default").toLowerCase();
  const safePlatform = text(patch.platform || safeChannelId).toLowerCase();
  try {
    await ensureAIChannelSettingsTable();
    const current = await getAIChannelSettings(safeChannelId, safePlatform);
    const next = mergeSettings(current, normalizeValue(patch));
    const existing = await db.query(
      `
      UPDATE ai_channel_settings
      SET
        channel_id = $1,
        platform = $2,
        settings = $3::jsonb,
        ai_mode = $4,
        tone = $5,
        safety = $6::jsonb,
        debug = $7::jsonb,
        updated_at = NOW()
      WHERE channel_id = $1 OR channel = $1
      RETURNING *
      `,
      [safeChannelId, safePlatform, json(next), next.aiMode, next.tone || null, json(next.safety || {}), json(next.debug || {})]
    );
    const result = existing.rows.length ? existing : await db.query(
      `
      INSERT INTO ai_channel_settings (tenant_id, channel, channel_id, platform, settings, ai_mode, tone, safety, debug, updated_at)
      VALUES (0, $1, $1, $2, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb, NOW())
      ON CONFLICT (channel_id) WHERE channel_id IS NOT NULL AND channel_id <> ''
      DO UPDATE SET
        platform = EXCLUDED.platform,
        settings = EXCLUDED.settings,
        ai_mode = EXCLUDED.ai_mode,
        tone = EXCLUDED.tone,
        safety = EXCLUDED.safety,
        debug = EXCLUDED.debug,
        updated_at = NOW()
      RETURNING *
      `,
      [safeChannelId, safePlatform, json(next), next.aiMode, next.tone || null, json(next.safety || {}), json(next.debug || {})]
    );
    const settings = rowToSettings(result.rows[0]);
    fallbackByChannel.set(safeChannelId, settings);
    return { ...settings, channelId: safeChannelId, platform: safePlatform, persisted: true };
  } catch (error) {
    const next = mergeSettings(withDefaults(fallbackByChannel.get(safeChannelId) || {}), normalizeValue(patch));
    fallbackByChannel.set(safeChannelId, next);
    console.warn("[ai-channel-settings] persistence write failed; using fallback", {
      channel_id: safeChannelId,
      message: error?.message || "Unknown error",
      code: error?.code || "",
    });
    return { ...next, channelId: safeChannelId, platform: safePlatform, persisted: false };
  }
}
