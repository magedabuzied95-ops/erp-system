const parseUser = (value) => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const TOKEN_KEYS = [
  "token",
  "authToken",
  "accessToken",
  "erp_token",
  "erp.saas.token",
];

const normalizePermissionKey = (permission) => {
  const value = String(permission || "").trim().toLowerCase().replace(/:/g, ".");
  if (value === "marketing.approve") return "marketing.publish";
  if (value === "marketing.edit") return "marketing.update";
  return value;
};

export const getToken = () => {
  for (const key of TOKEN_KEYS) {
    const value = localStorage.getItem(key);
    if (value) return value;
  }
  return null;
};

export const getCurrentUser = () =>
  parseUser(localStorage.getItem("user"));

const CURRENT_TENANT_KEY = "erp.saas.currentTenant";

export const getUserRole = (user = getCurrentUser()) =>
  String(user?.role || user?.role_name || "admin").toLowerCase();

export const getUserPermissions = (user = getCurrentUser()) => {
  const permissions = user?.permissions || user?.permission || [];
  if (Array.isArray(permissions)) return permissions.map(normalizePermissionKey);
  if (typeof permissions === "string") return [normalizePermissionKey(permissions)];
  return [];
};

export const isAdminUser = (user = getCurrentUser()) =>
  ["admin", "super admin", "superadmin", "super_admin"].includes(getUserRole(user)) ||
  getUserPermissions(user).includes("*");

const permissionAliases = (permission) => {
  const value = normalizePermissionKey(permission);
  if (!value) return [];
  const aliases = new Set([value, value.replace(":", "."), value.replace(".", ":")]);
  if (value === "marketing.publish") {
    aliases.add("marketing.approve");
    aliases.add("marketing:approve");
  }
  if (value === "marketing.update") {
    aliases.add("marketing.edit");
    aliases.add("marketing:edit");
  }
  return Array.from(aliases);
};

export const hasPermission = (permission, user = getCurrentUser()) => {
  if (!permission) return true;
  if (isAdminUser(user)) return true;
  const effective = new Set(getUserPermissions(user).flatMap(permissionAliases));
  return permissionAliases(permission).some((alias) => effective.has(alias));
};

export const hasAnyPermission = (permissions = [], user = getCurrentUser()) => {
  if (!permissions.length) return true;
  if (isAdminUser(user)) return true;
  return permissions.some((permission) => hasPermission(permission, user));
};

export const setAuth = ({ token, user }) => {
  if (token) {
    localStorage.setItem("token", token);
  } else {
    TOKEN_KEYS.forEach((key) => {
      localStorage.removeItem(key);
    });
  }

  if (user) {
    const currentTenant = parseUser(localStorage.getItem(CURRENT_TENANT_KEY));
    const userTenant = user.tenant && typeof user.tenant === "object" ? user.tenant : {};
    const userCurrentTenant = user.currentTenant && typeof user.currentTenant === "object" ? user.currentTenant : {};
    const resolvedTenantId =
      user.tenant_id ||
      user.tenantId ||
      userTenant.id ||
      userTenant.tenant_id ||
      userCurrentTenant.id ||
      userCurrentTenant.tenant_id ||
      currentTenant?.id ||
      currentTenant?.tenant_id ||
      user.company_id ||
      "";
    const normalizedUser = {
      ...user,
      tenant_id: resolvedTenantId,
      tenantId: user.tenantId || resolvedTenantId,
      tenant_name: user.tenant_name || userTenant.name || currentTenant?.name || user.company_name || "",
      tenant_slug: user.tenant_slug || userTenant.slug || currentTenant?.slug || "",
      company_name: user.company_name || userTenant.companyName || userTenant.name || currentTenant?.companyName || currentTenant?.name || "",
      company_logo_url: user.company_logo_url || userTenant.companyLogoUrl || userTenant.company_logo_url || currentTenant?.companyLogoUrl || currentTenant?.company_logo_url || "",
      favicon_url: user.favicon_url || userTenant.faviconUrl || userTenant.favicon_url || currentTenant?.faviconUrl || currentTenant?.favicon_url || "",
      permissions: Array.isArray(user.permissions)
        ? user.permissions.map(normalizePermissionKey)
        : user.permissions
          ? [user.permissions].flat().map(normalizePermissionKey)
          : [],
    };
    localStorage.setItem(
      "user",
      JSON.stringify(normalizedUser)
    );
  } else {
    localStorage.removeItem("user");
  }
};

export const clearAuth = () => {
  TOKEN_KEYS.forEach((key) => {
    localStorage.removeItem(key);
  });
  localStorage.removeItem("user");
};

export const getCurrentTenant = () =>
  parseUser(localStorage.getItem(CURRENT_TENANT_KEY));

export const setCurrentTenant = (tenant) => {
  if (tenant) {
    const normalized = {
      ...tenant,
      id: String(tenant.id || tenant.slug || tenant.name),
      slug: String(tenant.slug || tenant.name || tenant.id || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
      name: tenant.name || tenant.companyName || "Company",
      companyName: tenant.companyName || tenant.company_name || tenant.name || "Company",
      company_logo_url: tenant.company_logo_url || tenant.companyLogoUrl || tenant.logoUrl || "",
      companyLogoUrl: tenant.companyLogoUrl || tenant.company_logo_url || tenant.logoUrl || "",
      favicon_url: tenant.favicon_url || tenant.faviconUrl || "",
      faviconUrl: tenant.faviconUrl || tenant.favicon_url || "",
    };
    localStorage.setItem(CURRENT_TENANT_KEY, JSON.stringify(normalized));
    return normalized;
  }

  localStorage.removeItem(CURRENT_TENANT_KEY);
  return null;
};

export const getWorkspaceHistory = () => {
  try {
    return JSON.parse(localStorage.getItem("erp.saas.workspaces") || "[]");
  } catch {
    return [];
  }
};

export const setWorkspaceHistory = (items) => {
  localStorage.setItem("erp.saas.workspaces", JSON.stringify(items));
};

export const getAuthToken = getToken;
export const getUser = getCurrentUser;
