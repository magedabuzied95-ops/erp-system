import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  Factory,
  Gift,
  Globe,
  LineChart,
  LayoutDashboard,
  LayoutTemplate,
  Package,
  Palette,
  ReceiptText,
  QrCode,
  Settings,
  Settings2,
  ShoppingBag,
  ShoppingCart,
  Store,
  UsersRound,
  Warehouse,
  Wallet,
  ShieldCheck,
  CalendarClock,
  Megaphone,
  Share2,
  TicketPercent,
} from "lucide-react";

import { getCurrentUser, getUserPermissions, isAdminUser } from "../../../shared/auth/authStorage";

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const readJson = (key, fallback) => {
  const win = safeWindow();
  if (!win) return fallback;
  try {
    const raw = win.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  const win = safeWindow();
  if (!win) return;
  win.localStorage.setItem(key, JSON.stringify(value));
};

export const MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "products", label: "Products" },
  { key: "pos", label: "POS" },
  { key: "orders", label: "Orders" },
  { key: "purchases", label: "Purchases" },
  { key: "suppliers", label: "Suppliers" },
  { key: "inventory", label: "Inventory" },
  { key: "warehouses", label: "Warehouses" },
  { key: "branches", label: "Branches" },
  { key: "accounting", label: "Accounting" },
  { key: "loyalty", label: "Loyalty" },
  { key: "attendance", label: "Attendance" },
  { key: "marketing", label: "Marketing" },
  { key: "notifications", label: "Notifications" },
  { key: "website", label: "Website" },
  { key: "employees", label: "Employees" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles" },
];

export const ACTIONS = ["view", "create", "edit", "update", "delete", "approve", "publish", "settings", "export", "print", "redeem"];

export const MARKETING_ACTIONS = ["view", "create", "update", "delete", "publish", "settings"];
export const WEBSITE_ACTIONS = ["view", "orders", "settings"];
export const NOTIFICATIONS_ACTIONS = ["view", "manage"];

export const getModuleActions = (moduleKey) => {
  if (moduleKey === "marketing") return MARKETING_ACTIONS;
  if (moduleKey === "website") return WEBSITE_ACTIONS;
  if (moduleKey === "notifications") return NOTIFICATIONS_ACTIONS;
  return ACTIONS;
};

export const ALL_PERMISSIONS = MODULES.flatMap((module) =>
  getModuleActions(module.key).map((action) => `${module.key}.${action}`)
);

const STORAGE_KEYS = {
  roles: "erp.permissions.roles",
  users: "erp.permissions.users",
};

const normalizePermissionKey = (permission) => {
  const value = String(permission || "").trim().toLowerCase().replace(/:/g, ".");
  if (value === "marketing.approve") return "marketing.publish";
  if (value === "marketing.edit") return "marketing.update";
  return value;
};

const allow = (modules, actions = ["view"]) =>
  modules.flatMap((module) => actions.map((action) => `${module}.${action}`));

const attendancePermissions = [
  "attendance.view",
  "attendance.create",
  "attendance.edit",
  "attendance.update",
  "attendance.delete",
];
const marketingPermissions = [
  "marketing.view",
  "marketing.create",
  "marketing.update",
  "marketing.delete",
  "marketing.publish",
  "marketing.settings",
];
const websitePermissions = ["website.view", "website.orders", "website.settings"];
const notificationsPermissions = ["notifications.view", "notifications.manage"];

export const DEFAULT_ROLES = [
  {
    id: "admin",
    name: "Admin",
    slug: "admin",
    description: "Full access to every module and action.",
    builtIn: true,
    permissions: ["*", ...attendancePermissions, ...marketingPermissions, ...websitePermissions, ...notificationsPermissions],
  },
  {
    id: "super_admin",
    name: "Super Admin",
    slug: "super_admin",
    description: "System-wide access across every module and action.",
    builtIn: true,
    permissions: ["*", ...attendancePermissions, ...marketingPermissions, ...websitePermissions, ...notificationsPermissions],
  },
  {
    id: "manager",
    name: "Manager",
    slug: "manager",
    description: "Broad operational access with approval and reporting controls.",
    builtIn: true,
    permissions: [
      ...allow(["dashboard", "products", "orders", "purchases", "suppliers", "inventory", "warehouses", "branches", "reports", "settings"], ["view"]),
      ...allow(["products", "orders", "purchases", "suppliers", "inventory", "warehouses", "branches"], ["create", "edit", "export", "print"]),
      ...allow(["orders", "purchases"], ["approve"]),
      ...allow(["loyalty"], ["view", "create", "edit", "export"]),
      ...allow(["attendance"], ["view", "create", "edit", "export", "print"]),
      ...marketingPermissions,
      ...websitePermissions,
      ...notificationsPermissions,
      ...allow(["employees"], ["view", "export", "print"]),
      "settings.view",
      "users.view",
      "roles.view",
    ],
  },
  {
    id: "accountant",
    name: "Accountant",
    slug: "accountant",
    description: "Financial access for ledgers, cashbox, journal entries, and reports.",
    builtIn: true,
    permissions: [
      ...allow(["dashboard", "accounting", "reports", "suppliers"], ["view", "export", "print"]),
      ...allow(["accounting"], ["create", "edit", "approve"]),
      "purchases.view",
      "orders.view",
      "loyalty.view",
      "attendance.view",
      "employees.view",
      "users.view",
      "marketing.view",
      "website.orders",
      "notifications.view",
    ],
  },
  {
    id: "cashier",
    name: "Cashier",
    slug: "cashier",
    description: "POS and order-taking access with print and cashbox actions.",
    builtIn: true,
    permissions: [
      ...allow(["dashboard", "pos", "orders", "reports"], ["view", "create", "print"]),
      "customers.view",
      "customers.create",
      "loyalty.view",
      "loyalty.create",
      "loyalty.redeem",
      "attendance.view",
      "attendance.create",
      "accounting.view",
      "employees.view",
      "settings.view",
      "notifications.view",
    ],
  },
  {
    id: "warehouse-staff",
    name: "Warehouse Staff",
    slug: "warehouse-staff",
    description: "Inventory, warehouse, receiving, and transfer support.",
    builtIn: true,
    permissions: [
      ...allow(["dashboard", "products", "inventory", "warehouses", "branches", "purchases", "suppliers"], ["view", "edit", "approve"]),
      ...allow(["inventory", "warehouses", "branches"], ["create", "export", "print"]),
      "purchases.create",
      "purchases.view",
      "attendance.view",
      "employees.view",
      "notifications.view",
    ],
  },
  {
    id: "sales-agent",
    name: "Sales Agent",
    slug: "sales-agent",
    description: "Sales-facing access for customers, orders, POS, and product lookup.",
    builtIn: true,
    permissions: [
      ...allow(["dashboard", "products", "pos", "orders"], ["view", "create", "edit", "print"]),
      "customers.view",
      "customers.create",
      "loyalty.view",
      "attendance.view",
      "attendance.create",
      "reports.view",
      "employees.view",
      "settings.view",
      "marketing.view",
      "marketing.create",
      "marketing.update",
      "website.view",
      "website.orders",
      "notifications.view",
    ],
  },
  {
    id: "custom",
    name: "Custom Role",
    slug: "custom",
    description: "Start with a blank permission set and assign only what is needed.",
    builtIn: true,
    permissions: [],
  },
];

export const DEFAULT_USERS = [
  {
    id: "usr-1",
    name: "System Admin",
    email: "admin@erp.local",
    role: "Admin",
    status: "Active",
    permissions: ["*"],
  },
  {
    id: "usr-2",
    name: "Finance Lead",
    email: "finance@erp.local",
    role: "Accountant",
    status: "Active",
  },
  {
    id: "usr-3",
    name: "Cash Desk",
    email: "cashier@erp.local",
    role: "Cashier",
    status: "Active",
  },
];

export const SIDEBAR_SECTIONS = [
  {
    title: "Main",
    items: [
      { label: "Dashboard", to: "/dashboard", permission: "dashboard.view", icon: LayoutDashboard },
      { label: "Notifications", to: "/notifications", permission: "notifications.view", icon: Bell },
      { label: "Workspace", to: "/workspace", permission: "settings.view", icon: Building2 },
    ],
  },
  {
    title: "Products",
    items: [
      { label: "All Products", to: "/products", permission: "products.view", icon: Package },
      { label: "Add Product", to: "/products/add", permission: "products.create", icon: Package },
      { label: "Categories", to: "/products/categories", permission: "products.view", icon: Boxes },
      { label: "Product Classifications", to: "/products/classifications", permission: "products.view", icon: Boxes },
      { label: "Brands", to: "/products/brands", permission: "products.view", icon: Boxes },
      { label: "Manufacturers", to: "/products/manufacturers", permission: "products.view", icon: Factory },
      { label: "Units", to: "/products/units", permission: "products.view", icon: Boxes },
      { label: "Variants", to: "/products/variants", permission: "products.view", icon: Boxes },
      { label: "Barcode Labels", to: "/products/barcode-labels", permission: "products.print", icon: Boxes },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Orders", to: "/orders", permission: "orders.view", icon: ShoppingCart },
      { label: "POS PRO", to: "/pos", permission: "pos.view", icon: Store },
      { label: "Sales Staff", to: "/sales-employees", permission: "employees.view", icon: UsersRound },
      { label: "Customers", to: "/customers", permission: "orders.view", icon: UsersRound },
    ],
  },
  {
    title: "Purchasing",
    items: [
      { label: "Purchases", to: "/purchases", permission: "purchases.view", icon: ReceiptText },
      { label: "Smart Reorder", to: "/purchases/reorder-suggestions", permission: "purchases.view", icon: LineChart },
      { label: "Suppliers", to: "/suppliers", permission: "suppliers.view", icon: Building2 },
    ],
  },
  {
    title: "Inventory",
    items: [
      { label: "Inventory", to: "/inventory", permission: "inventory.view", icon: Boxes },
      { label: "Smart Warehouse", to: "/smart-warehouse", permission: "inventory.view", icon: QrCode },
      { label: "Warehouses", to: "/warehouses", permission: "warehouses.view", icon: Warehouse },
      { label: "Branches", to: "/branches", permission: "branches.view", icon: Building2 },
      { label: "Stock Transfers", to: "/stock-transfers", permission: "warehouses.view", icon: Warehouse },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Accounting", to: "/accounting", permission: "accounting.view", icon: Wallet },
      { label: "Journal Entries", to: "/accounting/journal-entries", permission: "accounting.view", icon: ReceiptText },
      { label: "Loyalty", to: "/loyalty", permission: "loyalty.view", icon: Gift },
      { label: "Employee Analytics", to: "/employees", permission: "employees.view", icon: BarChart3 },
      { label: "Analytics & Reports", to: "/reports", permission: "reports.view", icon: BarChart3 },
      { label: "Analytics", to: "/analytics", permission: "reports.view", icon: LineChart },
      { label: "Billing", to: "/billing", permission: "settings.view", icon: Wallet },
    ],
  },
  {
    title: "HR / Attendance",
    items: [
      { label: "Dashboard", to: "/attendance", permission: "attendance.view", icon: LayoutDashboard },
      { label: "Employees", to: "/attendance/employees", permission: "attendance.view", icon: UsersRound },
      { label: "Reports", to: "/attendance/reports", permission: "attendance.view", icon: BarChart3 },
      { label: "Kiosk", to: "/attendance/kiosk", permission: "attendance.create", icon: Store },
      { label: "QR Attendance", to: "/staff/qr-attendance", permission: "attendance.create", icon: QrCode },
    ],
  },
  {
    title: "Marketing",
    items: [
      { label: "Marketing Dashboard", to: "/marketing", permission: "marketing.view", icon: Megaphone },
      { label: "Social Posts", to: "/marketing/posts", permission: "marketing.view", icon: Share2 },
      { label: "Campaigns", to: "/marketing/campaigns", permission: "marketing.view", icon: CalendarClock },
      { label: "Coupons", to: "/marketing/coupons", permission: "marketing.view", icon: TicketPercent },
      { label: "Templates", to: "/marketing/templates", permission: "marketing.view", icon: LayoutTemplate },
      { label: "Settings", to: "/marketing/settings", permission: "marketing.settings", icon: Settings2 },
    ],
  },
  {
    title: "WEBSITE",
    items: [
      { label: "Storefront", to: "/shop", permission: "website.view", icon: Globe },
      { label: "Website Orders", to: "/orders?channel=website", permission: "website.orders", icon: ShoppingBag },
      { label: "Website Settings", to: "/website/settings", permission: "website.settings", icon: Settings },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Appearance", to: "/settings/appearance", permission: "settings.view", icon: Palette },
      { label: "Company", to: "/settings/company", permission: "settings.view", icon: Settings2 },
      { label: "Roles", to: "/settings/roles", permission: "roles.view", icon: ShieldCheck },
      { label: "Permissions", to: "/settings/permissions", permission: "roles.view", icon: Settings2 },
      { label: "Users", to: "/settings/users", permission: "users.view", icon: UsersRound },
      { label: "Tenants", to: "/admin/tenants", permission: "settings.view", icon: Building2, adminOnly: true },
    ],
  },
];

export const getRoleCatalog = () => {
  const localRoles = readJson(STORAGE_KEYS.roles, []);
  const map = new Map();
  [...DEFAULT_ROLES, ...localRoles].forEach((role) => {
    if (!role) return;
    map.set(String(role.id || role.slug || role.name), {
      ...role,
      id: String(role.id || role.slug || role.name),
      name: role.name || role.role_name || "Role",
      slug: role.slug || String(role.name || role.id || "").toLowerCase().replace(/\s+/g, "-"),
      permissions: Array.isArray(role.permissions) ? role.permissions.map(normalizePermissionKey) : [],
      builtIn: Boolean(role.builtIn),
      updatedAt: role.updatedAt || role.updated_at || null,
    });
  });
  return Array.from(map.values());
};

export const saveRoleCatalog = (roles) => {
  const normalized = roles.map((role) => ({
    ...role,
    id: String(role.id || role.slug || role.name),
    name: role.name || "Role",
    slug: role.slug || String(role.name || role.id || "").toLowerCase().replace(/\s+/g, "-"),
    permissions: Array.isArray(role.permissions) ? role.permissions.map(normalizePermissionKey) : [],
  }));
  writeJson(STORAGE_KEYS.roles, normalized);
  return normalized;
};

export const getUserCatalog = () => {
  const localUsers = readJson(STORAGE_KEYS.users, []);
  const map = new Map();
  [...DEFAULT_USERS, ...localUsers].forEach((user) => {
    if (!user) return;
    const id = String(user.id || user.email || user.name);
    map.set(id, normalizeUser(user));
  });
  return Array.from(map.values());
};

export const saveUserCatalog = (users) => {
  const normalized = users.map(normalizeUser);
  writeJson(STORAGE_KEYS.users, normalized);
  return normalized;
};

export const normalizeRole = (role) => ({
  ...role,
  id: String(role.id || role.slug || role.name),
  name: role.name || role.role_name || "Role",
  slug: role.slug || String(role.name || role.id || "").toLowerCase().replace(/\s+/g, "-"),
  description: role.description || "",
  permissions: Array.isArray(role.permissions) ? role.permissions.map(String) : [],
  builtIn: Boolean(role.builtIn),
});

export const normalizeUser = (user) => {
  const roleName = user.role || user.role_name || "Custom Role";
  const roleId = user.role_id ? String(user.role_id) : null;
  const rolePermissions = getRoleCatalog().find(
    (role) =>
      String(role.id).toLowerCase() === String(roleId || roleName).toLowerCase() ||
      String(role.name).toLowerCase() === String(roleName).toLowerCase() ||
      String(role.slug).toLowerCase() === String(roleName).toLowerCase().replace(/\s+/g, "-")
  )?.permissions || [];

  return {
    ...user,
    id: String(user.id || user.email || user.name),
    name: user.name || "User",
    email: user.email || "",
    role: roleName,
    role_id: roleId || user.role_id || "",
    status: user.status || (user.is_active === false ? "Disabled" : "Active"),
    permissions: Array.isArray(user.permissions) && user.permissions.length
      ? user.permissions.map(normalizePermissionKey)
      : rolePermissions.map(normalizePermissionKey),
  };
};

export const getPermissionMatrix = () =>
  MODULES.map((module) => {
    const actions = getModuleActions(module.key);
    return {
      module: module.key,
      label: module.label,
      actions,
      permissions: actions.map((action) => `${module.key}.${action}`),
    };
  });

export const getEffectivePermissions = (user = getCurrentUser(), roleCatalog = getRoleCatalog()) => {
  if (!user) return [];
  if (isAdminUser(user)) return ALL_PERMISSIONS;

  const direct = getUserPermissions(user);
  if (direct.length) return direct;

  const roleValue = String(user.role || user.role_name || user.role_id || "").toLowerCase();
  const role = roleCatalog.find(
    (item) =>
      String(item.id).toLowerCase() === roleValue ||
      String(item.slug).toLowerCase() === roleValue ||
      String(item.name).toLowerCase() === roleValue
  );
  return role?.permissions?.length ? role.permissions : [];
};

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
  const effective = new Set(getEffectivePermissions(user).flatMap(permissionAliases));
  return permissionAliases(permission).some((alias) => effective.has(alias));
};

export const hasAnyPermission = (permissions = [], user = getCurrentUser()) => {
  if (!permissions.length) return true;
  if (isAdminUser(user)) return true;
  const effective = new Set(getEffectivePermissions(user).flatMap(permissionAliases));
  return permissions.some((permission) => permissionAliases(permission).some((alias) => effective.has(alias)));
};

export const getVisibleSidebarSections = (user = getCurrentUser()) => {
  const effective = new Set(getEffectivePermissions(user).flatMap(permissionAliases));
  if (isAdminUser(user)) return SIDEBAR_SECTIONS;
  return SIDEBAR_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => effective.has(item.permission) && !item.adminOnly),
  })).filter((section) => section.items.length > 0);
};

export const getRoleSummary = (role) => {
  const permissions = Array.isArray(role.permissions) ? role.permissions : [];
  const modules = new Set(permissions.map((permission) => String(permission).split(".")[0]));
  return {
    permissionCount: permissions.includes("*") ? ALL_PERMISSIONS.length : permissions.length,
    moduleCount: permissions.includes("*") ? MODULES.length : modules.size,
  };
};

export const generateRoleTemplate = (name) => {
  const slug = String(name || "custom-role").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: slug || `role-${Date.now()}`,
    name: name || "Custom Role",
    slug: slug || `role-${Date.now()}`,
    description: "",
    builtIn: false,
    permissions: [],
  };
};
