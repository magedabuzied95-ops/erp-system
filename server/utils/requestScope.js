export const getTenantId = (req, fallback = null) => {
  const rawTenant =
    req?.tenantId ??
    req?.tenant?.id ??
    req?.user?.tenant_id ??
    req?.user?.tenantId ??
    req?.headers?.["x-tenant-id"] ??
    req?.query?.tenant_id ??
    req?.query?.tenantId ??
    req?.body?.tenant_id ??
    req?.body?.tenantId ??
    fallback;

  if (rawTenant === null || rawTenant === undefined || rawTenant === "") {
    return null;
  }

  const tenantId = Number(rawTenant);

  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

export const isSuperAdminUser = (user = {}) =>
  user?.role === "super_admin" ||
  user?.is_super_admin === true ||
  user?.role === "platform_admin";

export const tenantWhereClause = (column = "tenant_id") =>
  `${column} = $1`;

export const tenantContextMissingResponse = (res) =>
  res.status(400).json({
    success: false,
    message: "Tenant context missing",
  });
