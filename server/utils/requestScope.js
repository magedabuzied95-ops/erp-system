export const getTenantId = (req, fallback = null) => {
  const rawTenant =
    req?.user?.tenant_id ??
    req?.user?.tenantId ??
    req?.headers?.["x-tenant-id"] ??
    req?.query?.tenant_id ??
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
