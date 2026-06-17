import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { getSiteSettings, updateSiteSettings } from "../services/siteSettingsService.js";

export const getTenants = async (req, res) => {
  try {
    if (!isSuperAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const tenants = await db.query(
      `
      SELECT
        t.*,
        c.company_name,
        c.currency,
        c.language,
        s.plan AS subscription_plan,
        s.status AS subscription_status,
        s.trial_ends_at,
        s.end_date
      FROM tenants t
      LEFT JOIN company_profiles c ON c.tenant_id = t.id
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      ORDER BY t.id DESC
      `
    );

    return res.json({
      success: true,
      tenants: tenants.rows,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Tenants",
      error: error.message,
    });
  }
};

export const updateTenantStatus = async (req, res) => {
  try {
    if (!isSuperAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    const updated = await db.query(
      `
      UPDATE tenants
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [status || "active", id]
    );

    return res.json({
      success: true,
      tenant: updated.rows[0],
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Update Tenant",
      error: error.message,
    });
  }
};

export const getCurrentTenant = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant Context Missing",
      });
    }

    const tenant = await db.query(
      `
      SELECT
        t.*,
        c.*,
        s.plan AS subscription_plan,
        s.status AS subscription_status,
        s.end_date,
        s.trial_ends_at
      FROM tenants t
      LEFT JOIN company_profiles c ON c.tenant_id = t.id
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      WHERE t.id = $1
      LIMIT 1
      `,
      [tenantId]
    );

    return res.json({
      success: true,
      tenant: tenant.rows[0] || null,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Tenant",
      error: error.message,
    });
  }
};

export const upsertCompanySettings = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant Context Missing",
      });
    }

    const {
      company_name,
      company_logo_url,
      legal_name,
      logo_url,
      favicon_url,
      address,
      phone,
      email,
      tax_number,
      currency,
      language,
      invoice_prefix,
      invoice_footer,
      branch_mode,
      pos_mode,
    } = req.body;

    const branding = await updateSiteSettings({
      tenantId,
      companyName: company_name,
      companyLogoUrl: company_logo_url || logo_url,
      faviconUrl: favicon_url,
      updatedBy: req.user?.id || null,
    }).catch(() => null);

    const result = await db.query(
      `
      INSERT INTO company_profiles (
        tenant_id,
        company_name,
        legal_name,
        logo_url,
        favicon_url,
        address,
        phone,
        email,
        tax_number,
        currency,
        language,
        invoice_prefix,
        invoice_footer,
        branch_mode,
        pos_mode
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        company_name = EXCLUDED.company_name,
        legal_name = EXCLUDED.legal_name,
        logo_url = EXCLUDED.logo_url,
        favicon_url = EXCLUDED.favicon_url,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        tax_number = EXCLUDED.tax_number,
        currency = EXCLUDED.currency,
        language = EXCLUDED.language,
        invoice_prefix = EXCLUDED.invoice_prefix,
        invoice_footer = EXCLUDED.invoice_footer,
        branch_mode = EXCLUDED.branch_mode,
        pos_mode = EXCLUDED.pos_mode,
        updated_at = NOW()
      RETURNING *
      `,
      [
        tenantId,
        company_name || "ERP Company",
        legal_name || "",
        company_logo_url || logo_url || "",
        favicon_url || "",
        address || "",
        phone || "",
        email || "",
        tax_number || "",
        currency || "USD",
        language || "en",
        invoice_prefix || "INV",
        invoice_footer || "",
        Boolean(branch_mode),
        Boolean(pos_mode),
      ]
    );

    return res.json({
      success: true,
      company: {
        ...result.rows[0],
        company_name: branding?.company_name || result.rows[0]?.company_name || "ERP Company",
        company_logo_url: branding?.company_logo_url || result.rows[0]?.logo_url || "",
        favicon_url: branding?.favicon_url || result.rows[0]?.favicon_url || "",
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Save Company Settings",
      error: error.message,
    });
  }
};

export const getCompanySettings = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const result = await db.query(
      `
      SELECT
        c.*,
        t.company_name AS tenant_company_name,
        t.company_logo_url AS tenant_company_logo_url,
        t.favicon_url AS tenant_favicon_url
      FROM company_profiles c
      LEFT JOIN tenants t ON t.id = c.tenant_id
      WHERE c.tenant_id = $1
      LIMIT 1
      `,
      [tenantId]
    );

    return res.json({
      success: true,
      company: result.rows[0]
        ? {
            ...result.rows[0],
            company_name: result.rows[0].tenant_company_name || result.rows[0].company_name || "ERP Company",
            company_logo_url: result.rows[0].tenant_company_logo_url || result.rows[0].logo_url || "",
            favicon_url: result.rows[0].tenant_favicon_url || result.rows[0].favicon_url || "",
          }
        : null,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Company Settings",
      error: error.message,
    });
  }
};

export const getSubscription = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const result = await db.query(
      `
      SELECT *
      FROM subscriptions
      WHERE tenant_id = $1
      LIMIT 1
      `,
      [tenantId]
    );

    return res.json({
      success: true,
      subscription: result.rows[0] || null,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Subscription",
      error: error.message,
    });
  }
};

export const updateSubscription = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const { plan, status, end_date, trial_ends_at, billing_provider, billing_email } = req.body;

    const result = await db.query(
      `
      INSERT INTO subscriptions (
        tenant_id,
        plan,
        status,
        end_date,
        trial_ends_at,
        billing_provider,
        billing_email
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        plan = EXCLUDED.plan,
        status = EXCLUDED.status,
        end_date = EXCLUDED.end_date,
        trial_ends_at = EXCLUDED.trial_ends_at,
        billing_provider = EXCLUDED.billing_provider,
        billing_email = EXCLUDED.billing_email,
        updated_at = NOW()
      RETURNING *
      `,
      [
        tenantId,
        plan || "trial",
        status || "active",
        end_date || null,
        trial_ends_at || null,
        billing_provider || "manual",
        billing_email || "",
      ]
    );

    return res.json({
      success: true,
      subscription: result.rows[0],
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Update Subscription",
      error: error.message,
    });
  }
};
