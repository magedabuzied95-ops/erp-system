import jwt from "jsonwebtoken";

const cleanBaseUrl = (value = "") => String(value || "").trim().replace(/\/+$/, "");
const truthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

export const getAccountingAnalyticsEmbed = ({ tenantId, user = {} } = {}) => {
  const siteUrl = cleanBaseUrl(process.env.METABASE_SITE_URL);
  const dashboardId = String(process.env.METABASE_ACCOUNTING_DASHBOARD_ID || "").trim();
  const embeddingSecret = String(process.env.METABASE_EMBEDDING_SECRET || "").trim();

  if (!siteUrl || !dashboardId || !embeddingSecret) {
    return {
      enabled: false,
      reason: "not_configured",
    };
  }

  const numericTenantId = Number(tenantId);
  if (!Number.isInteger(numericTenantId) || numericTenantId <= 0) {
    return {
      enabled: false,
      reason: "tenant_required",
    };
  }

  const expiresInSeconds = Math.min(
    60 * 60,
    Math.max(60, Number(process.env.METABASE_EMBED_TOKEN_TTL_SECONDS || 600) || 600)
  );
  const payload = {
    resource: { dashboard: Number.isFinite(Number(dashboardId)) ? Number(dashboardId) : dashboardId },
    params: { tenant_id: numericTenantId },
    exp: Math.round(Date.now() / 1000) + expiresInSeconds,
  };
  const token = jwt.sign(payload, embeddingSecret);
  const theme = truthy(process.env.METABASE_FORCE_DARK_THEME) ? "night" : "transparent";
  const query = new URLSearchParams({
    bordered: "false",
    titled: "false",
    theme,
  });

  return {
    enabled: true,
    embed_url: `${siteUrl}/embed/dashboard/${token}#${query.toString()}`,
    expires_in: expiresInSeconds,
    tenant_id: numericTenantId,
    viewer: {
      id: user?.id ?? null,
      name: user?.name || user?.username || null,
    },
  };
};
