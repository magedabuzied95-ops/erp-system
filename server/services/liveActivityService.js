import db from "../database/db.js";
import { SALE_MODE_DEFAULTS } from "./saleModeService.js";
import { buildCacheKey, invalidateCachePattern } from "./cacheService.js";
import { getSetting, setSetting } from "./settingsService.js";

const DEFAULT_SETTINGS = {
  enable_fake_compare_price: true,
  fake_compare_percent: 20,
  fake_compare_rounding_mode: "none",
  ...SALE_MODE_DEFAULTS,
};
let websiteSettingsSchemaPromise = null;
let websiteSettingsSchemaEnsured = false;

export const ensureWebsiteSettingsSchema = async (clientOrPool = db) => {
  if (websiteSettingsSchemaEnsured) return;
  if (clientOrPool === db && websiteSettingsSchemaPromise) return websiteSettingsSchemaPromise;
  const runEnsure = async () => {
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
  if (clientOrPool !== db) return runEnsure();
  websiteSettingsSchemaPromise = runEnsure()
    .then(() => {
      websiteSettingsSchemaEnsured = true;
    })
    .catch((error) => {
      websiteSettingsSchemaPromise = null;
      throw error;
    });
  return websiteSettingsSchemaPromise;
};

export const getWebsiteSettings = async ({ tenantId = null } = {}) => {
  await ensureWebsiteSettingsSchema();
  const [defaultShippingPrice, shippingZones, result] = await Promise.all([
    getSetting("storefront.default_shipping_price", 60),
    getSetting("storefront.shipping_zones", []),
    db.query(
    `
    SELECT settings
    FROM website_settings
    WHERE ($1::bigint IS NULL AND tenant_id IS NULL)
       OR tenant_id = $1::bigint
    ORDER BY tenant_id NULLS LAST
    LIMIT 1
    `,
    [tenantId]
    ),
  ]);
  return {
    ...DEFAULT_SETTINGS,
    default_shipping_price: defaultShippingPrice,
    shipping_zones: Array.isArray(shippingZones) ? shippingZones : [],
    ...(result.rows[0]?.settings || {}),
  };
};

export const updateWebsiteSettings = async ({ tenantId = null, settings = {} } = {}) => {
  await ensureWebsiteSettingsSchema();
  if (Object.prototype.hasOwnProperty.call(settings, "default_shipping_price")) {
    await setSetting("storefront.default_shipping_price", settings.default_shipping_price, "shipping");
  }
  if (Object.prototype.hasOwnProperty.call(settings, "shipping_zones")) {
    await setSetting("storefront.shipping_zones", Array.isArray(settings.shipping_zones) ? settings.shipping_zones : [], "shipping");
  }
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
      invalidateCachePattern(buildCacheKey("storefront", `tenant:public`, "*")).catch(() => {});
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
  invalidateCachePattern(buildCacheKey("storefront", `tenant:${tenantId || "public"}`, "*")).catch(() => {});
  if (tenantId !== null && tenantId !== undefined) {
    invalidateCachePattern(buildCacheKey("storefront", `tenant:public`, "*")).catch(() => {});
  }
  return { ...DEFAULT_SETTINGS, ...(result.rows[0]?.settings || next) };
};

export { DEFAULT_SETTINGS as DEFAULT_WEBSITE_SETTINGS };
