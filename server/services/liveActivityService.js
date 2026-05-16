import db from "../database/db.js";

const DEFAULT_SETTINGS = {};

export const ensureWebsiteSettingsSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS website_settings (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL UNIQUE,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_website_settings_tenant ON website_settings (tenant_id)`);
};

export const getWebsiteSettings = async ({ tenantId = null } = {}) => {
  await ensureWebsiteSettingsSchema();
  const result = await db.query(
    `
    SELECT settings
    FROM website_settings
    WHERE ($1::bigint IS NULL AND tenant_id IS NULL)
       OR tenant_id = $1::bigint
    ORDER BY tenant_id NULLS LAST
    LIMIT 1
    `,
    [tenantId]
  );
  return { ...DEFAULT_SETTINGS, ...(result.rows[0]?.settings || {}) };
};

export const updateWebsiteSettings = async ({ tenantId = null, settings = {} } = {}) => {
  await ensureWebsiteSettingsSchema();
  const current = await getWebsiteSettings({ tenantId });
  const next = { ...current, ...(settings || {}) };
  if (tenantId === null || tenantId === undefined) {
    const existing = await db.query(`SELECT id FROM website_settings WHERE tenant_id IS NULL ORDER BY id ASC LIMIT 1`);
    if (existing.rows[0]) {
      const updated = await db.query(
        `
        UPDATE website_settings
        SET settings = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING settings
        `,
        [existing.rows[0].id, JSON.stringify(next)]
      );
      return { ...DEFAULT_SETTINGS, ...(updated.rows[0]?.settings || next) };
    }
  }
  const result = await db.query(
    `
    INSERT INTO website_settings (tenant_id, settings)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (tenant_id) DO UPDATE SET
      settings = EXCLUDED.settings,
      updated_at = CURRENT_TIMESTAMP
    RETURNING settings
    `,
    [tenantId, JSON.stringify(next)]
  );
  return { ...DEFAULT_SETTINGS, ...(result.rows[0]?.settings || next) };
};

export { DEFAULT_SETTINGS as DEFAULT_WEBSITE_SETTINGS };
