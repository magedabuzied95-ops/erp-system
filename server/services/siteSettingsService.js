import db from "../database/db.js";
import { setSetting } from "./settingsService.js";

const cleanText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

let schemaEnsured = false;
let schemaEnsurePromise = null;

export const ensureSiteSettingsSchema = async (client = db) => {
  if (schemaEnsured) return;
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = (async () => {
      await client.query(`ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS company_name TEXT`);
      await client.query(`ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS company_logo_url TEXT`);
      await client.query(`ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT`);
      await client.query(`ALTER TABLE IF EXISTS company_profiles ADD COLUMN IF NOT EXISTS favicon_url TEXT`);
      schemaEnsured = true;
    })().catch((error) => {
      schemaEnsurePromise = null;
      throw error;
    });
  }
  await schemaEnsurePromise;
};

export const getSiteSettings = async ({ tenantId } = {}) => {
  const safeTenantId = Number.isFinite(Number(tenantId)) && Number(tenantId) > 0 ? Number(tenantId) : null;
  await ensureSiteSettingsSchema();

  if (!safeTenantId) {
    return {
      tenant_id: null,
      company_name: "MONE",
      company_logo_url: "",
      favicon_url: "",
      source: "fallback",
    };
  }

  const result = await db.query(
    `
    SELECT
      t.id AS tenant_id,
      COALESCE(NULLIF(TRIM(t.company_name), ''), NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(t.name), ''), 'MONE') AS company_name,
      COALESCE(NULLIF(TRIM(t.company_logo_url), ''), NULLIF(TRIM(c.logo_url), ''), '') AS company_logo_url,
      COALESCE(NULLIF(TRIM(t.favicon_url), ''), NULLIF(TRIM(c.favicon_url), ''), '') AS favicon_url,
      t.updated_at AS tenant_updated_at,
      c.updated_at AS company_updated_at
    FROM tenants t
    LEFT JOIN company_profiles c ON c.tenant_id = t.id
    WHERE t.id = $1
    LIMIT 1
    `,
    [safeTenantId]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      tenant_id: safeTenantId,
      company_name: "MONE",
      company_logo_url: "",
      favicon_url: "",
      source: "fallback",
    };
  }

  return {
    tenant_id: Number(row.tenant_id) || safeTenantId,
    company_name: cleanText(row.company_name, "MONE"),
    company_logo_url: cleanText(row.company_logo_url, ""),
    favicon_url: cleanText(row.favicon_url, ""),
    source: "tenant",
    updated_at: row.tenant_updated_at || row.company_updated_at || null,
  };
};

export const updateSiteSettings = async ({ tenantId, companyName, companyLogoUrl, faviconUrl, updatedBy = null } = {}) => {
  const safeTenantId = Number.isFinite(Number(tenantId)) && Number(tenantId) > 0 ? Number(tenantId) : null;
  if (!safeTenantId) throw new Error("tenant_id is required");

  const nextCompanyName = cleanText(companyName, "MONE");
  const nextCompanyLogoUrl = cleanText(companyLogoUrl, "");
  const nextFaviconUrl = cleanText(faviconUrl, "");

  await ensureSiteSettingsSchema();

  await db.query(
    `
    INSERT INTO tenants (id, company_name, company_logo_url, favicon_url)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      company_logo_url = EXCLUDED.company_logo_url,
      favicon_url = EXCLUDED.favicon_url,
      updated_at = NOW()
    `,
    [safeTenantId, nextCompanyName, nextCompanyLogoUrl, nextFaviconUrl]
  );

  await db.query(
    `
    INSERT INTO company_profiles (
      tenant_id,
      company_name,
      logo_url,
      favicon_url
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (tenant_id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      logo_url = EXCLUDED.logo_url,
      favicon_url = EXCLUDED.favicon_url,
      updated_at = NOW()
    `,
    [safeTenantId, nextCompanyName, nextCompanyLogoUrl, nextFaviconUrl]
  );

  await Promise.all([
    setSetting("general.company_name", nextCompanyName, "general", updatedBy).catch(() => null),
    setSetting("general.company_logo_url", nextCompanyLogoUrl, "general", updatedBy).catch(() => null),
    setSetting("general.favicon_url", nextFaviconUrl, "general", updatedBy).catch(() => null),
  ]);

  return getSiteSettings({ tenantId: safeTenantId });
};
