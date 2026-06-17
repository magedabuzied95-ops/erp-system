import db from "../database/db.js";
import { setSetting } from "./settingsService.js";

const cleanText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const nullableText = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const slugifyTenantName = (value, fallback = "mone") => {
  const raw = String(value ?? "").trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
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
      slug: "mone",
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
      t.slug AS tenant_slug,
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
      slug: "mone",
      company_name: "MONE",
      company_logo_url: "",
      favicon_url: "",
      source: "fallback",
    };
  }

  return {
    tenant_id: Number(row.tenant_id) || safeTenantId,
    slug: cleanText(row.tenant_slug, "mone").toLowerCase().replace(/\s+/g, "-"),
    company_name: cleanText(row.company_name, "MONE"),
    company_logo_url: cleanText(row.company_logo_url, ""),
    favicon_url: cleanText(row.favicon_url, ""),
    source: "tenant",
    updated_at: row.tenant_updated_at || row.company_updated_at || null,
  };
};

export const updateSiteSettings = async ({ tenantId, name, slug, companyName, companyLogoUrl, faviconUrl, updatedBy = null } = {}) => {
  const safeTenantId = Number.isFinite(Number(tenantId)) && Number(tenantId) > 0 ? Number(tenantId) : null;
  if (!safeTenantId) throw new Error("tenant_id is required");

  await ensureSiteSettingsSchema();

  const currentTenantResult = await db.query(
    `
    SELECT
      t.id,
      t.name,
      t.slug,
      t.company_name,
      t.company_logo_url,
      t.favicon_url
    FROM tenants t
    WHERE t.id = $1
    LIMIT 1
    `,
    [safeTenantId]
  );
  const currentTenant = currentTenantResult.rows[0] || null;
  const payload = {
    tenantId: safeTenantId,
    name: nullableText(name),
    slug: nullableText(slug),
    company_name: nullableText(companyName),
    company_logo_url: nullableText(companyLogoUrl),
    favicon_url: nullableText(faviconUrl),
  };
  console.log({
    tenantId: safeTenantId,
    payload,
    currentTenant,
  });

  const nextTenantName = cleanText(
    payload.name || payload.company_name || currentTenant?.name || currentTenant?.company_name,
    "MONE"
  );
  const nextTenantSlug = cleanText(
    payload.slug || currentTenant?.slug || slugifyTenantName(nextTenantName || payload.company_name || currentTenant?.company_name || currentTenant?.name),
    "mone"
  ).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const nextCompanyName = cleanText(payload.company_name || payload.name || currentTenant?.company_name || currentTenant?.name, nextTenantName);
  const nextCompanyLogoUrl = payload.company_logo_url;
  const nextFaviconUrl = payload.favicon_url;

  await db.query(
    `
    INSERT INTO tenants (
      id,
      name,
      slug,
      company_name,
      company_logo_url,
      favicon_url
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name, ''), tenants.name, COALESCE(NULLIF(EXCLUDED.company_name, ''), tenants.company_name, 'MONE')),
      slug = COALESCE(NULLIF(EXCLUDED.slug, ''), tenants.slug, 'mone'),
      company_name = COALESCE(NULLIF(EXCLUDED.company_name, ''), tenants.company_name, tenants.name, 'MONE'),
      company_logo_url = COALESCE(NULLIF(EXCLUDED.company_logo_url, ''), tenants.company_logo_url, ''),
      favicon_url = COALESCE(NULLIF(EXCLUDED.favicon_url, ''), tenants.favicon_url, ''),
      updated_at = NOW()
    `,
    [safeTenantId, nextTenantName, nextTenantSlug, nextCompanyName, nextCompanyLogoUrl, nextFaviconUrl]
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
      company_name = COALESCE(NULLIF(EXCLUDED.company_name, ''), company_profiles.company_name, ''),
      logo_url = COALESCE(NULLIF(EXCLUDED.logo_url, ''), company_profiles.logo_url, ''),
      favicon_url = COALESCE(NULLIF(EXCLUDED.favicon_url, ''), company_profiles.favicon_url, ''),
      updated_at = NOW()
    `,
    [safeTenantId, nextCompanyName, nextCompanyLogoUrl, nextFaviconUrl]
  );

  await Promise.all([
    nextCompanyName !== null ? setSetting("general.company_name", nextCompanyName, "general", updatedBy).catch(() => null) : Promise.resolve(),
    nextCompanyLogoUrl !== null ? setSetting("general.company_logo_url", nextCompanyLogoUrl, "general", updatedBy).catch(() => null) : Promise.resolve(),
    nextFaviconUrl !== null ? setSetting("general.favicon_url", nextFaviconUrl, "general", updatedBy).catch(() => null) : Promise.resolve(),
  ]);

  return getSiteSettings({ tenantId: safeTenantId });
};
