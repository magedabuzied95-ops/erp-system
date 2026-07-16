import {
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Building2,
  Globe,
  LineChart,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  Settings2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  UsersRound,
  Warehouse,
  Wallet,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  CircleDollarSign,
  Megaphone,
  Share2,
  TicketPercent,
} from "lucide-react";

import { getCurrentUser, getUserPermissions, isAdminUser } from "../../../shared/auth/authStorage.js";
import { publicStorefrontUrl } from "../../../shared/lib/publicStorefront.js";

const safeWindow = () => (typeof window !== "undefined" ? window : null);
const SHOW_DEV_TOOLS = String(import.meta.env?.VITE_SHOW_DEV_TOOLS || "").toLowerCase() === "true";

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
  { key: "pos.expenses", label: "POS Expenses" },
  { key: "orders", label: "Orders" },
  { key: "purchases", label: "Purchases" },
  { key: "suppliers", label: "Suppliers" },
  { key: "customers", label: "Customers" },
  { key: "inventory", label: "Inventory" },
  { key: "warehouses", label: "Warehouses" },
  { key: "branches", label: "Branches" },
  { key: "accounting", label: "Accounting" },
  { key: "money_accounts", label: "Money Accounts" },
  { key: "money_transactions", label: "Money Transactions" },
  { key: "money_transfers", label: "Money Transfers" },
  { key: "treasury.dashboard", label: "Treasury Dashboard" },
  { key: "expenses", label: "Expenses" },
  { key: "expenses.advances", label: "Employee Advances" },
  { key: "loyalty", label: "Loyalty" },
  { key: "attendance", label: "Attendance" },
  { key: "marketing", label: "Marketing" },
  { key: "notifications", label: "Notifications" },
  { key: "staff_tasks", label: "Staff Tasks" },
  { key: "website", label: "Website" },
  { key: "employees", label: "Employees" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles" },
];

export const MODULE_ACTIONS = Object.freeze({
  dashboard: ["view"],
  products: ["view", "create", "edit", "delete", "view_cost", "barcode_shop"],
  pos: ["view", "create", "sell", "edit", "edit_old", "override_seller", "scan_product_qr"],
  "pos.expenses": ["create", "view_shift_total"],
  orders: ["view", "create", "edit", "delete", "approve", "print"],
  purchases: ["view", "create", "edit", "delete"],
  suppliers: ["view", "create", "edit", "delete"],
  customers: ["view", "create", "edit", "delete"],
  inventory: ["view", "create", "edit", "movements:view", "movements:undo", "alerts:view"],
  warehouses: ["view", "create", "update", "delete", "transfer"],
  branches: ["view", "create", "update", "delete"],
  accounting: ["view", "create", "edit"],
  money_accounts: ["view", "manage"],
  money_transactions: ["view", "adjust"],
  money_transfers: ["create"],
  "treasury.dashboard": ["view"],
  expenses: ["view", "create", "edit", "delete", "approve", "pay", "reports"],
  "expenses.advances": ["view", "create", "deduct"],
  loyalty: ["view", "edit", "redeem"],
  attendance: ["view", "create", "edit", "delete", "export"],
  marketing: ["view", "create", "update", "delete", "publish", "settings"],
  notifications: ["view", "manage"],
  staff_tasks: ["view", "create", "update", "manage"],
  website: ["view", "orders", "settings"],
  employees: ["view", "edit", "delete", "export", "print"],
  reports: ["view", "export", "print"],
  settings: ["view", "edit", "approve"],
  users: ["view", "create", "edit", "delete"],
  roles: ["view", "create", "edit", "delete", "export"],
});

export const ACTIONS = [...new Set(Object.values(MODULE_ACTIONS).flat())];
export const getModuleActions = (moduleKey) => MODULE_ACTIONS[moduleKey] || ["view"];

export const ALL_PERMISSIONS = MODULES.flatMap((module) =>
  getModuleActions(module.key).map((action) => `${module.key}.${action}`)
);

const STORAGE_KEYS = {
  roles: "erp.permissions.roles",
};

const normalizePermissionKey = (permission) => {
  const raw = String(permission || "").trim().toLowerCase();
  const value = raw.includes(".") ? raw : raw.replace(":", ".");
  if (value === "marketing.approve") return "marketing.publish";
  if (value === "marketing.edit") return "marketing.update";
  if (value === "customers.update") return "customers.edit";
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
const staffTaskPermissions = ["staff_tasks.view", "staff_tasks.create", "staff_tasks.update", "staff_tasks.manage"];
const expensesPermissions = [
  "expenses.view",
  "expenses.create",
  "expenses.edit",
  "expenses.delete",
  "expenses.approve",
  "expenses.pay",
  "expenses.reports",
  "expenses.advances.view",
  "expenses.advances.create",
  "expenses.advances.deduct",
];
const posExpensePermissions = ["pos.expenses.create", "pos.expenses.view_shift_total"];
const treasuryPermissions = [
  "money_accounts.view",
  "money_accounts.manage",
  "money_transactions.view",
  "money_transactions.adjust",
  "money_transfers.create",
  "treasury.dashboard.view",
];

const MODULE_SEARCH_METADATA = {
  Dashboard: { arabicTitle: "لوحة التحكم", aliases: ["Home", "Overview", "داشبورد", "الرئيسية"], keywords: ["kpi", "summary", "analytics"] },
  Employees: { arabicTitle: "الموظفون", aliases: ["Employee", "HR", "Staff", "موظف", "الموظفين"], keywords: ["payroll", "attendance", "commissions", "مرتبات", "حضور", "عمولات"] },
  Notifications: { arabicTitle: "الإشعارات", aliases: ["Alerts", "تنبيهات"], keywords: ["messages", "system alerts"] },
  Workspace: { arabicTitle: "مساحة العمل", aliases: ["Company workspace", "مساحة"], keywords: ["company", "tenant", "organization"] },
  Products: { arabicTitle: "المنتجات", aliases: ["Product", "Catalog", "Items", "منتج", "أصناف"], keywords: ["sku", "stock", "variants", "barcode", "مخزون"] },
  "Add Product": { arabicTitle: "إضافة منتج", aliases: ["Create product", "New product", "منتج جديد"], keywords: ["catalog", "sku", "create"] },
  Orders: { arabicTitle: "الطلبات", aliases: ["Order", "Invoices", "Sales orders", "طلب", "فاتورة"], keywords: ["sales", "receipts", "checkout", "مبيعات"] },
  "POS PRO": { arabicTitle: "نقطة البيع", aliases: ["POS", "Point of sale", "Cashier", "Terminal", "كاشير"], keywords: ["checkout", "receipt", "بيع"] },
  Customers: { arabicTitle: "العملاء", aliases: ["Customer", "CRM", "Clients", "عميل"], keywords: ["loyalty", "wallet", "contacts"] },
  Purchases: { arabicTitle: "المشتريات", aliases: ["Purchase", "Procurement", "شراء"], keywords: ["suppliers", "stock in", "reorder"] },
  Suppliers: { arabicTitle: "الموردون", aliases: ["Supplier", "Vendors", "مورد"], keywords: ["purchases", "procurement"] },
  Inventory: { arabicTitle: "المخزون", aliases: ["Stock", "Inventory control", "مخزن"], keywords: ["products", "warehouses", "transfers"] },
  Warehouses: { arabicTitle: "المخازن", aliases: ["Warehouse", "Stores", "Storage", "مخزن"], keywords: ["inventory", "stock", "branches"] },
  Branches: { arabicTitle: "الفروع", aliases: ["Branch", "Branches", "Store branches", "Branch network", "فرع", "الفروع", "الشبكة", "الفروع الرئيسية"], keywords: ["stores", "locations", "branch network", "bra", "شبكة الفروع", "مواقع"] },
  "Stock Transfers": { arabicTitle: "نقل المخزون", aliases: ["Transfers", "Inventory transfers", "تحويل مخزون"], keywords: ["warehouse", "branch", "stock movement"] },
  Accounting: { arabicTitle: "المحاسبة", aliases: ["Accounts", "Finance ledger", "محاسبة"], keywords: ["journal", "treasury", "cash"] },
  Expenses: { arabicTitle: "المصاريف", aliases: ["Expense", "Costs", "Spending", "مصروف", "نفقات"], keywords: ["advances", "finance", "payments", "سلف"] },
  Payroll: { arabicTitle: "المرتبات", aliases: ["Salaries", "Salary", "Payroll calculator", "مرتبات", "رواتب", "مرتب", "راتب"], keywords: ["employees", "attendance deductions", "penalties", "خصومات", "جزاءات"] },
  "Attendance Center": { arabicTitle: "مركز الحضور", aliases: ["Attendance", "Time attendance", "QR attendance", "حضور", "انصراف"], keywords: ["qr", "late", "absence", "missing hours", "غياب", "تأخير"] },
  Reports: { arabicTitle: "التقارير", aliases: ["Report", "ERP reports", "تقارير"], keywords: ["analytics", "export", "pdf", "excel"] },
  Marketing: { arabicTitle: "التسويق", aliases: ["Marketing dashboard", "Campaign marketing", "تسويق"], keywords: ["posts", "campaigns", "social"] },
  "AI Marketing Center": { arabicTitle: "مركز التسويق بالذكاء الاصطناعي", aliases: ["AI marketing", "Marketing AI", "ذكاء تسويقي"], keywords: ["campaigns", "automation", "content"] },
  "Social Posts": { arabicTitle: "منشورات التواصل", aliases: ["Posts", "Social media", "منشورات"], keywords: ["facebook", "instagram", "content"] },
  Storefront: { arabicTitle: "المتجر", aliases: ["Website", "Shop", "Online store", "متجر"], keywords: ["ecommerce", "storefront"] },
  "Website Orders": { arabicTitle: "طلبات الموقع", aliases: ["Online orders", "Website sales", "طلبات المتجر"], keywords: ["storefront", "ecommerce"] },
  "Website Settings": { arabicTitle: "إعدادات الموقع", aliases: ["Store settings", "Shop settings", "اعدادات المتجر"], keywords: ["website", "storefront"] },
  Company: { arabicTitle: "الشركة", aliases: ["Company settings", "Preferences", "شركة"], keywords: ["settings", "tenant", "profile"] },
  Permissions: { arabicTitle: "الصلاحيات", aliases: ["Roles permissions", "Access control", "صلاحيات"], keywords: ["rbac", "roles", "users", "security"] },
  Users: { arabicTitle: "المستخدمون", aliases: ["User", "System users", "مستخدم"], keywords: ["roles", "permissions", "login"] },
  Tenants: { arabicTitle: "المستأجرون", aliases: ["Tenant", "Companies", "SaaS tenants", "مستأجر"], keywords: ["admin", "billing", "subscriptions"] },
};

const withSearchMetadata = (item, category) => {
  const metadata = MODULE_SEARCH_METADATA[item.label] || {};
  return {
    ...item,
    title: metadata.title || item.label,
    arabicTitle: metadata.arabicTitle || "",
    keywords: Array.isArray(metadata.keywords) ? metadata.keywords : [],
    aliases: Array.isArray(metadata.aliases) ? metadata.aliases : [],
    route: item.to,
    category: metadata.category || category,
  };
};

export const DEFAULT_ROLES = [
  {
    id: "admin",
    name: "Admin",
    slug: "admin",
    description: "Full access to every module and action.",
    builtIn: true,
    permissions: ["*", "products.view_cost", ...attendancePermissions, ...marketingPermissions, ...websitePermissions, ...notificationsPermissions, ...staffTaskPermissions, ...expensesPermissions, ...posExpensePermissions, ...treasuryPermissions],
  },
  {
    id: "super_admin",
    name: "Super Admin",
    slug: "super_admin",
    description: "System-wide access across every module and action.",
    builtIn: true,
    permissions: ["*", "products.view_cost", ...attendancePermissions, ...marketingPermissions, ...websitePermissions, ...notificationsPermissions, ...staffTaskPermissions, ...expensesPermissions, ...posExpensePermissions, ...treasuryPermissions],
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
      ...staffTaskPermissions,
      ...expensesPermissions,
      ...posExpensePermissions,
      ...treasuryPermissions,
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
      ...expensesPermissions,
      ...treasuryPermissions,
      "products.view_cost",
      "purchases.view",
      "orders.view",
      "loyalty.view",
      "attendance.view",
      "employees.view",
      "users.view",
      "marketing.view",
      "website.orders",
      "notifications.view",
      "staff_tasks.view",
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
      "orders.edit",
      "orders.delete",
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
      "staff_tasks.view",
      "staff_tasks.update",
      ...posExpensePermissions,
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
      "staff_tasks.view",
      "staff_tasks.update",
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
      "staff_tasks.view",
      "staff_tasks.update",
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

const RAW_SIDEBAR_SECTIONS = [
  {
    title: "Main",
    items: [
      { label: "Dashboard", to: "/dashboard", permission: "dashboard.view", icon: LayoutDashboard },
      { label: "Workspace", to: "/workspace", permission: "settings.view", icon: Building2 },
      { label: "Notifications", to: "/notifications", permission: "notifications.view", icon: Bell },
    ],
  },
  {
    title: "Products",
    items: [
      { label: "Products", to: "/products", permission: "products.view", icon: Package },
      { label: "Add Product", to: "/products/add", permission: "products.create", icon: Package },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "POS PRO", to: "/pos", permission: "pos.view", icon: Store },
      { label: "Orders", to: "/orders", permission: "orders.view", icon: ShoppingCart },
      { label: "Website Orders", to: "/orders?channel=website", permission: "website.orders", icon: ShoppingBag },
      { label: "Returns", to: "/orders/returns", permission: "orders.view", icon: ReceiptText },
      { label: "Customers", to: "/customers", permission: "orders.view", icon: UsersRound },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Shipping Center", to: "/operations/shipping", permission: "orders.view", icon: Truck, aliases: ["Logistics", "Shipments", "Bosta", "Shipping operations"], keywords: "shipping logistics bosta shipments delivery tracking operations" },
    ],
  },
  {
    title: "Purchasing",
    items: [
      { label: "Purchases", to: "/purchases", permission: "purchases.view", icon: ReceiptText },
      { label: "Suppliers", to: "/suppliers", permission: "suppliers.view", icon: Building2 },
    ],
  },
  {
    title: "Inventory",
    items: [
      { label: "Inventory", to: "/inventory", permission: "inventory.view", icon: Boxes },
      { label: "Inventory Count", to: "/inventory/count", permission: "inventory.view", icon: ClipboardList },
      { label: "Warehouses", to: "/warehouses", permission: "warehouses.view", icon: Warehouse },
      { label: "Stock Transfers", to: "/stock-transfers", permission: "warehouses.view", icon: Warehouse },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Accounting", to: "/accounting", permission: "accounting.view", icon: Wallet },
      { label: "Expenses", to: "/expenses", permission: "expenses.view", icon: ReceiptText, keywords: "Expenses expense costs spending المصاريف مصاريف النفقات" },
    ],
  },
  {
    title: "Employees",
    items: [
      { label: "Employees", to: "/employees", permission: "employees.view", icon: UsersRound },
      { label: "Attendance Center", to: "/employees/attendance", permission: "attendance.view", icon: CalendarClock },
      { label: "Reports", to: "/reports", permission: "reports.view", icon: BarChart3 },
    ],
  },
  {
    title: "Marketing",
    items: [
      { label: "Marketing", to: "/marketing", permission: "marketing.view", icon: Megaphone, devOnly: true },
      { label: "Coupons", to: "/marketing/coupons", permission: "marketing.view", icon: TicketPercent },
      { label: "AI Marketing Center", to: "/marketing/ai-center", permission: "marketing.view", icon: Sparkles },
      { label: "Social Calendar", to: "/marketing/social-calendar", permission: "marketing.view", icon: CalendarDays },
      { label: "Social Posts", to: "/marketing/posts", permission: "marketing.view", icon: Share2, devOnly: true },
      { label: "Social Media Publisher", to: "/marketing/social-media-publisher", permission: "marketing.view", icon: Megaphone },
    ],
  },
  {
    title: "WEBSITE",
    items: [
      { label: "Storefront", to: publicStorefrontUrl("/"), permission: "website.view", icon: Globe, devOnly: true, external: true },
      { label: "Storefront Settings", to: "/settings/storefront", permission: "settings.view", icon: Settings },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Branches", to: "/branches", permission: "branches.view", icon: Building2 },
      { label: "Users", to: "/settings/users", permission: "users.view", icon: UsersRound },
      { label: "Tenants", to: "/admin/tenants", permission: "settings.view", icon: Building2, adminOnly: true },
      { label: "Permissions", to: "/settings/permissions", permission: "roles.view", icon: Settings2 },
      { label: "Settings Center", to: "/settings", permission: "settings.view", icon: Settings2 },
      { label: "General", to: "/settings/company", permission: "settings.view", icon: Settings2 },
      { label: "Shipping", to: "/settings/shipping", permission: "settings.view", icon: Settings2 },
      { label: "Payments", to: "/settings/payments", permission: "settings.view", icon: CircleDollarSign },
      { label: "AI Inbox", to: "/admin/ai-inbox", permission: "settings.view", icon: Bot, adminOnly: true },
      { label: "AI Follow Ups", to: "/admin/ai-followups", permission: "settings.view", icon: CalendarClock, adminOnly: true },
      { label: "AI Channels", to: "/admin/ai-channels", permission: "settings.view", icon: Share2, adminOnly: true },
      { label: "AI Agent Analytics", to: "/admin/ai-agent-analytics", permission: "settings.view", icon: LineChart, adminOnly: true },
      { label: "AI Agent Settings", to: "/admin/ai-agent-settings", permission: "settings.view", icon: Settings2, adminOnly: true },
      { label: "AI Support Console", to: "/admin/ai-support-console", permission: "settings.view", icon: Bot, adminOnly: true, devOnly: true },
      { label: "AI Knowledge Base", to: "/admin/ai-support-knowledge-base", permission: "settings.view", icon: Bot, adminOnly: true },
    ],
  },
];

export const SIDEBAR_SECTIONS = RAW_SIDEBAR_SECTIONS.map((section) => ({
  ...section,
  items: section.items.map((item) => withSearchMetadata(item, section.title)),
}));

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

export const normalizeRole = (role) => ({
  ...role,
  id: String(role.id || role.slug || role.name),
  name: role.name || role.role_name || "Role",
  slug: role.slug || String(role.name || role.id || "").toLowerCase().replace(/\s+/g, "-"),
  description: role.description || "",
  permissions: Array.isArray(role.permissions) ? role.permissions.map(normalizePermissionKey) : [],
  builtIn: Boolean(role.builtIn || role.is_system || role.isSystem),
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
  if (value === "customers.edit") {
    aliases.add("customers.update");
    aliases.add("customers:update");
  }
  return Array.from(aliases);
};

export const hasPermission = (permission, user = getCurrentUser()) => {
  if (!permission) return true;
  if (isAdminUser(user)) return true;
  const effective = new Set(getEffectivePermissions(user).flatMap(permissionAliases));
  return permissionAliases(permission).some((alias) => effective.has(alias));
};

export const canViewCostPrices = (user = getCurrentUser()) => hasPermission("products.view_cost", user);

export const hasAnyPermission = (permissions = [], user = getCurrentUser()) => {
  if (!permissions.length) return true;
  if (isAdminUser(user)) return true;
  const effective = new Set(getEffectivePermissions(user).flatMap(permissionAliases));
  return permissions.some((permission) => permissionAliases(permission).some((alias) => effective.has(alias)));
};

export const getVisibleSidebarSections = (user = getCurrentUser()) => {
  const effective = new Set(getEffectivePermissions(user).flatMap(permissionAliases));
  const visibleForEnvironment = (item) => SHOW_DEV_TOOLS || !item.devOnly;
  if (isAdminUser(user)) {
    return SIDEBAR_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(visibleForEnvironment),
    })).filter((section) => section.items.length > 0);
  }
  return SIDEBAR_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => effective.has(item.permission) && !item.adminOnly && visibleForEnvironment(item)),
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
