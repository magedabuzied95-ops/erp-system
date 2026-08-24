const EXACT_ROUTE_TITLES = Object.freeze({
  "/": "Dashboard",
  "/dashboard": "Dashboard",
  "/notifications": "Notifications",
  "/workspace": "Workspace",
  "/billing": "Billing",
  "/admin/tenants": "Tenant Management",

  "/ai-studio": "AI Studio",
  "/ai-studio/workflows": "AI Workflows",
  "/ai-studio/executions": "AI Executions",
  "/ai-studio/approvals": "AI Approvals",
  "/ai-studio/tools": "AI Tools",
  "/ai-studio/restock-recovery": "AI Restock Recovery",
  "/admin/ai-inbox": "AI Inbox",
  "/admin/ai-followups": "AI Follow-ups",
  "/admin/ai-agent-settings": "AI Agent Settings",
  "/admin/ai-agent-analytics": "AI Agent Analytics",
  "/admin/ai-support-console": "AI Support Console",
  "/admin/ai-support-knowledge-base": "AI Knowledge Base",
  "/ai/settings": "AI Settings",

  "/settings": "Settings Center",
  "/settings/company": "Company Settings",
  "/settings/appearance": "Appearance Settings",
  "/settings/currencies": "Currency Settings",
  "/settings/storefront": "Storefront Settings",
  "/settings/shipping": "Shipping Settings",
  "/settings/payments": "Payment Settings",
  "/settings/debug": "System Diagnostics",
  "/website/settings": "Website Settings",
  "/settings/permissions": "Permissions",
  "/settings/roles": "Roles",
  "/settings/users": "Users",
  "/users": "Users",
  "/roles": "Roles",

  "/products": "Products",
  "/products/add": "Add Product",
  "/products/create": "Add Product",
  "/products/categories": "Product Categories",
  "/products/classifications": "Product Classifications",
  "/products/brands": "Brands",
  "/products/manufacturers": "Manufacturers",
  "/products/units": "Product Units",
  "/products/variants": "Product Variants",
  "/products/barcodes": "Barcode Labels",
  "/products/barcode-labels": "Barcode Labels",
  "/products/barcode-print-queue": "Barcode Print Queue",
  "/products/labels": "Barcode Labels",
  "/products/print-list": "Product Print List",

  "/inventory": "Inventory",
  "/inventory/history": "Inventory History",
  "/inventory/movements": "Inventory Movements",
  "/inventory/adjustments": "Inventory Adjustments",
  "/inventory/count": "Inventory Counts",
  "/smart-warehouse": "Smart Warehouse",
  "/warehouses": "Warehouses",
  "/stock-transfers": "Stock Transfers",
  "/branches": "Branches",

  "/customers": "Customers",
  "/sales-employees": "Sales Employees",
  "/loyalty": "Loyalty Dashboard",
  "/loyalty/rules": "Loyalty Rules",
  "/suppliers": "Suppliers",
  "/purchases": "Purchases",
  "/purchases/create": "Create Purchase",
  "/purchases/reorder-suggestions": "Reorder Suggestions",

  "/accounting": "Accounting Dashboard",
  "/accounting/dashboard": "Accounting Dashboard",
  "/accounting/treasury": "Treasury",
  "/accounting/cashbox": "Cashbox",
  "/accounting/cash-registers": "Cashbox",
  "/accounting/financial-accounts": "Financial Accounts",
  "/accounting/payment-method-mappings": "Payment Method Mappings",
  "/accounting/expenses": "Expenses",
  "/expenses": "Expenses",
  "/accounting/income": "Income",
  "/accounting/journal-entries": "Journal Entries",
  "/accounting/ledgers": "Accounts",
  "/accounting/accounts": "Accounts",
  "/accounting/general-ledger": "General Ledger",
  "/accounting/trial-balance": "Trial Balance",
  "/accounting/reports": "Financial Reports",
  "/accounting/analytics": "Financial Reports",
  "/accounting/profit-loss": "Profit and Loss",
  "/accounting/taxes": "Financial Reports",
  "/accounting/cost-fix": "Cost Fix Center",
  "/accounting/audit-trail": "Accounting Audit Trail",

  "/orders": "Orders",
  "/orders/returns": "Returns",
  "/operations/shipping": "Shipping Center",
  "/create-order": "Create Order",
  "/pos": "Point of Sale",

  "/reports": "Reports",
  "/reports/overview": "Executive Overview",
  "/reports/sales": "Sales Intelligence",
  "/reports/inventory": "Inventory Intelligence",
  "/reports/purchasing": "Purchasing Intelligence",
  "/reports/customers": "Customer Intelligence",
  "/reports/employees": "Employee & Channel Intelligence",
  "/reports/reconciliation": "Reconciliation",
  "/reports/coupons": "Coupon Performance",
  "/analytics": "Analytics Dashboard",

  "/marketing": "Marketing Dashboard",
  "/marketing/ai-center": "AI Marketing Center",
  "/marketing/ai-center/leads": "AI Lead Center",
  "/marketing/ai-center/videos": "AI Marketing Videos",
  "/marketing/analytics": "Marketing Analytics",
  "/marketing/attribution": "Marketing Attribution",
  "/marketing/automation": "Marketing Automation",
  "/marketing/posts": "Social Posts",
  "/marketing/social-calendar": "Social Calendar",
  "/marketing/social-comments": "Social Comments",
  "/marketing/social-media-publisher": "Social Media Publisher",
  "/marketing/campaigns": "Campaigns",
  "/marketing/coupons": "Coupons",
  "/marketing/templates": "Post Templates",
  "/marketing/settings": "Marketing Settings",

  "/employees": "HR Center",
  "/employees/commissions": "Sales Performance",
  "/employees/top-performers": "Sales Performance",
  "/employees/shifts": "Attendance",
  "/staff/tasks": "Employee Tasks",
  "/attendance": "Attendance",
  "/attendance/employees": "Employees",
  "/attendance/reports": "Employee Reports",
  "/attendance/kiosk": "Attendance Kiosk",
  "/staff/qr-attendance": "QR Attendance",
});

const EMPLOYEE_TAB_TITLES = Object.freeze({
  employees: "Employees",
  attendance: "Attendance",
  analytics: "Employee Analytics",
  reports: "Employee Reports",
  payroll: "Payroll",
  advances: "Salary Advances",
  "sales-performance": "Sales Performance",
});

const normalizePathname = (pathname = "") => {
  const value = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  if (value === "/") return value;
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
};

const humanizeSegment = (segment = "") => String(segment || "")
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (character) => character.toUpperCase())
  .trim();

export const resolveErpRoutePageTitle = (pathname = "") => {
  const path = normalizePathname(pathname);
  if (EXACT_ROUTE_TITLES[path]) return EXACT_ROUTE_TITLES[path];

  if (/^\/ai-studio\/workflows\/[^/]+\/edit$/.test(path)) return "Edit AI Workflow";
  if (/^\/products\/[^/]+\/edit$/.test(path)) return "Edit Product";
  if (/^\/products\/[^/]+$/.test(path)) return "Product Details";
  if (/^\/inventory\/variant\/[^/]+\/history$/.test(path)) return "Variant Stock History";
  if (/^\/inventory\/count\/[^/]+$/.test(path)) return "Inventory Count Session";
  if (/^\/customers\/[^/]+\/statement$/.test(path)) return "Customer Statement";
  if (/^\/loyalty\/customers\/[^/]+$/.test(path)) return "Customer Loyalty Profile";
  if (/^\/suppliers\/[^/]+\/statement$/.test(path)) return "Supplier Statement";
  if (/^\/suppliers\/[^/]+$/.test(path)) return "Supplier Details";
  if (/^\/purchases\/[^/]+\/edit$/.test(path)) return "Edit Purchase";
  if (/^\/purchases\/[^/]+$/.test(path)) return "Purchase Details";
  if (/^\/orders\/[^/]+$/.test(path)) return "Order Details";

  const employeeTab = path.match(/^\/employees\/([^/]+)$/)?.[1];
  if (employeeTab) return EMPLOYEE_TAB_TITLES[employeeTab] || `Employees - ${humanizeSegment(employeeTab)}`;

  const lastReadableSegment = path.split("/").filter(Boolean).reverse().find((segment) => !/^\d+$/.test(segment));
  return humanizeSegment(lastReadableSegment) || "System";
};

export { EXACT_ROUTE_TITLES };
