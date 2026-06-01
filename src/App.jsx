import {
  lazy,
  Suspense,
  useEffect,
} from "react";

import {
  Routes,
  Route,
  Navigate
} from "react-router-dom";
import { useTranslation } from "react-i18next";

/* ======================================================
   LAYOUT
====================================================== */

import MainLayout from "./shared/layouts/MainLayout";
import { api } from "./shared/api/api";
import { setCurrency } from "./shared/lib/currency";

/* ======================================================
   AUTH
====================================================== */

import Login from "./pages/Login";

/* ======================================================
   DASHBOARD
====================================================== */

const Dashboard = lazy(() => import("./pages/Dashboard"));

/* ======================================================
   PRODUCTS
====================================================== */

const Products = lazy(() => import("./modules/products/pages/Products"));
const AddProduct = lazy(() => import("./modules/products/pages/AddProduct"));
const ProductDetails = lazy(() => import("./modules/products/pages/ProductDetails"));
const ProductEdit = lazy(() => import("./modules/products/pages/ProductEdit"));
const Categories = lazy(() => import("./modules/products/pages/Categories"));
const ProductClassifications = lazy(() => import("./modules/products/pages/ProductClassifications"));
const Brands = lazy(() => import("./modules/products/pages/Brands"));
const Manufacturers = lazy(() => import("./modules/products/pages/Manufacturers"));
const Units = lazy(() => import("./modules/products/pages/Units"));
const Variants = lazy(() => import("./modules/products/pages/Variants"));
const BarcodeLabels = lazy(() => import("./modules/products/pages/BarcodeLabels"));

/* ======================================================
   INVENTORY
====================================================== */

const Inventory = lazy(() => import("./modules/inventory/pages/InventoryDashboard"));
const InventoryMovements = lazy(() => import("./modules/inventory/pages/StockMovements"));
const InventoryAdjustments = lazy(() => import("./modules/inventory/pages/StockAdjustments"));
const InventoryHistory = lazy(() => import("./modules/inventory/pages/InventoryHistory"));

const SmartWarehouse = lazy(() => import("./modules/smartWarehouse/pages/SmartWarehouse"));

/* ======================================================
   WAREHOUSES
====================================================== */

const Warehouses = lazy(() => import("./modules/inventory/pages/WarehousesDashboard"));
const StockTransfers = lazy(() => import("./modules/inventory/pages/StockTransfers"));
const Branches = lazy(() => import("./pages/Branches"));

/* ======================================================
   CUSTOMERS
====================================================== */

const Customers = lazy(() => import("./modules/sales/pages/Customers"));
const SalesEmployees = lazy(() => import("./modules/sales/pages/SalesEmployees"));

/* ======================================================
   SUPPLIERS
====================================================== */

const Suppliers = lazy(() => import("./modules/purchases/pages/SuppliersDashboard"));
const SupplierDetails = lazy(() => import("./modules/purchases/pages/SupplierDetails"));

/* ======================================================
   PURCHASES
====================================================== */

const Purchases = lazy(() => import("./modules/purchases/pages/PurchasesDashboard"));
const CreatePurchase = lazy(() => import("./modules/purchases/pages/CreatePurchase"));
const PurchaseDetails = lazy(() => import("./modules/purchases/pages/PurchaseDetails"));
const ReorderSuggestions = lazy(() => import("./modules/purchases/pages/ReorderSuggestions"));

/* ======================================================
   ACCOUNTING
====================================================== */

const Accounting = lazy(() => import("./modules/accounting/pages/Accounting"));
const Treasury = lazy(() => import("./modules/accounting/pages/Treasury"));
const CashRegisters = lazy(() => import("./modules/accounting/pages/CashRegisters"));
const FinancialAccounts = lazy(() => import("./modules/accounting/pages/FinancialAccounts"));
const PaymentMethodMappings = lazy(() => import("./modules/accounting/pages/PaymentMethodMappings"));
const Expenses = lazy(() => import("./modules/accounting/pages/Expenses"));
const Revenues = lazy(() => import("./modules/accounting/pages/Revenues"));
const JournalEntries = lazy(() => import("./modules/accounting/pages/JournalEntries"));
const Accounts = lazy(() => import("./modules/accounting/pages/Accounts"));
const FinancialReports = lazy(() => import("./modules/accounting/pages/FinancialReports"));
const ProfitAndLoss = lazy(() => import("./modules/accounting/pages/ProfitAndLoss"));
const Taxes = lazy(() => import("./modules/accounting/pages/Taxes"));
const CostFixCenter = lazy(() => import("./modules/accounting/pages/CostFixCenter"));
const AuditTrail = lazy(() => import("./modules/accounting/pages/AuditTrail"));

/* ======================================================
   LOYALTY
====================================================== */

const LoyaltyDashboard = lazy(() => import("./modules/loyalty/pages/LoyaltyDashboard"));
const LoyaltyRules = lazy(() => import("./modules/loyalty/pages/LoyaltyRules"));
const CustomerLoyaltyProfile = lazy(() => import("./modules/loyalty/pages/CustomerLoyaltyProfile"));

/* ======================================================
   ORDERS
====================================================== */

const Orders = lazy(() => import("./modules/orders/pages/OrdersDashboard"));
const CreateOrder = lazy(() => import("./modules/sales/pages/CreateOrder"));
const ShippingCenter = lazy(() => import("./modules/shipping/pages/ShippingCenter"));

/* ======================================================
   POS
====================================================== */

const POS = lazy(() => import("./modules/pos/pages/POSPro"));

const OrderDetails = lazy(() => import("./modules/orders/pages/OrderDetails"));
const OrderReturns = lazy(() => import("./modules/orders/pages/Returns"));

/* ======================================================
   REPORTS
====================================================== */

const Reports = lazy(() => import("./modules/reports/pages/Reports"));
const AnalyticsDashboard = lazy(() => import("./modules/analytics/pages/AnalyticsDashboard"));
const EmployeeHub = lazy(() => import("./modules/employees/pages/EmployeeHub"));
const EmployeeSalesPerformance = lazy(() => import("./modules/employees/pages/SalesPerformance"));
const EmployeeCommissions = lazy(() => import("./modules/employees/pages/Commissions"));
const EmployeeTopPerformers = lazy(() => import("./modules/employees/pages/TopPerformers"));
const EmployeeShiftAnalytics = lazy(() => import("./modules/employees/pages/ShiftAnalytics"));
const StaffTasks = lazy(() => import("./modules/employees/pages/StaffTasks"));
const EmployeePortal = lazy(() => import("./modules/employees/pages/EmployeePortal"));
const EmployeeAppShell = lazy(() => import("./modules/employees/pages/EmployeeAppShell"));
const EmployeePayrollPortal = lazy(() => import("./modules/employees/pages/EmployeePayrollPortal"));
const AttendanceDashboard = lazy(() => import("./modules/attendance/pages/AttendanceDashboard"));
const AttendanceEmployees = lazy(() => import("./modules/attendance/pages/EmployeesAttendance"));
const AttendanceReports = lazy(() => import("./modules/attendance/pages/AttendanceReports"));
const AttendanceKiosk = lazy(() => import("./modules/attendance/pages/AttendanceKiosk"));
const StaffQrAttendance = lazy(() => import("./modules/attendance/pages/StaffQrAttendance"));
const PublicBranchAttendance = lazy(() => import("./modules/attendance/pages/PublicBranchAttendance"));
const MarketingDashboard = lazy(() => import("./modules/marketing/pages/MarketingDashboard"));
const AiMarketingCenter = lazy(() => import("./modules/marketing/pages/AiMarketingCenter"));
const AiMarketingVideos = lazy(() => import("./modules/marketing/pages/AiMarketingVideos"));
const MarketingAnalytics = lazy(() => import("./modules/marketing/pages/MarketingAnalytics"));
const MarketingAttribution = lazy(() => import("./modules/marketing/pages/MarketingAttribution"));
const MarketingAutomation = lazy(() => import("./modules/marketing/pages/MarketingAutomation"));
const SocialPosts = lazy(() => import("./modules/marketing/pages/SocialPosts"));
const Campaigns = lazy(() => import("./modules/marketing/pages/Campaigns"));
const PostTemplates = lazy(() => import("./modules/marketing/pages/PostTemplates"));
const MarketingSettings = lazy(() => import("./modules/marketing/pages/MarketingSettings"));
const CouponsManager = lazy(() => import("./modules/coupons/pages/CouponsManager"));

/* ======================================================
   USERS & ROLES
====================================================== */

const Users = lazy(() => import("./modules/permissions/pages/Users"));
const Roles = lazy(() => import("./modules/permissions/pages/Roles"));
const Permissions = lazy(() => import("./modules/permissions/pages/Permissions"));

import ProtectedRoute from "./shared/auth/ProtectedRoute";
import DebugErrorBoundary from "./shared/components/DebugErrorBoundary";

/* ======================================================
   FORBIDDEN
====================================================== */

import Forbidden from "./pages/Forbidden";

import { TenantProvider } from "./modules/saas/context/TenantContext";

const RegisterCompany = lazy(() => import("./modules/saas/pages/RegisterCompany"));
const PublicInvoice = lazy(() => import("./pages/PublicInvoice"));
const PublicProduct = lazy(() => import("./pages/PublicProduct"));
const Storefront = lazy(() => import("./storefront/Storefront"));

const Workspace = lazy(() => import("./modules/saas/pages/Workspace"));

const Billing = lazy(() => import("./modules/saas/pages/Billing"));

const AdminTenants = lazy(() => import("./modules/saas/pages/AdminTenants"));

const SettingsCenter = lazy(() => import("./modules/settings/pages/SettingsCenter"));
const NotificationsCenter = lazy(() => import("./modules/notifications/pages/NotificationsCenter"));
const AiSupportConsole = lazy(() => import("./modules/aiSupport/pages/AiSupportConsole"));
const AiSupportKnowledgeBase = lazy(() => import("./modules/aiSupport/pages/AiSupportKnowledgeBase"));
const AiInbox = lazy(() => import("./modules/aiSupport/pages/AiInbox"));
const AiFollowups = lazy(() => import("./modules/aiSupport/pages/AiFollowups"));
const AiChannels = lazy(() => import("./modules/aiSupport/pages/AiChannels"));
const AiAgentSettings = lazy(() => import("./modules/aiSupport/pages/AiAgentSettings"));
const AiSettings = lazy(() => import("./modules/aiSupport/pages/AiSettings"));
const AiAgentAnalytics = lazy(() => import("./modules/aiSupport/pages/AiAgentAnalytics"));

function RouteSkeleton() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[var(--bg)] p-4 text-[var(--text)] dark:bg-[#050816] dark:text-white md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-[var(--surface-muted,#e5e7eb)] dark:bg-white/[0.06]" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-[var(--surface-muted,#e5e7eb)] dark:bg-white/[0.06]" />
          ))}
        </div>
        <div className="h-[28rem] animate-pulse rounded-2xl bg-[var(--surface-muted,#e5e7eb)] dark:bg-white/[0.06]" />
      </div>
    </div>
  );
}

function App() {
  useTranslation();
  const isEmployeeAppRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/employee-app/");
  const employeeAppToken = isEmployeeAppRoute ? window.location.pathname.split("/")[2] || "" : "";

  useEffect(() => {
    if (isEmployeeAppRoute) return undefined;
    let cancelled = false;
    api.get("/settings/public", { suppressErrorStatuses: [401, 403, 404, 500] })
      .then((response) => {
        if (cancelled) return;
        const settings = response?.settings || {};
        const code = settings["general.default_currency"];
        const symbol = settings["general.currency_symbol"];
        if (code || symbol) setCurrency({ code, symbol });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isEmployeeAppRoute]);

  if (isEmployeeAppRoute) {
    console.debug("[employee-app-route-hit]", employeeAppToken);
    return (
      <DebugErrorBoundary title="Employee app screen crashed">
        <Suspense fallback={<RouteSkeleton />}>
          <Routes>
            <Route path="/employee-app/:token" element={<EmployeeAppShell />} />
            <Route path="/employee-app/*" element={<EmployeeAppShell />} />
          </Routes>
        </Suspense>
      </DebugErrorBoundary>
    );
  }

  return (
    <TenantProvider>
    <DebugErrorBoundary title="Application screen crashed">
    <Suspense fallback={<RouteSkeleton />}>
    <Routes>

      <Route
        path="/register-company"
        element={<RegisterCompany />}
      />

      {/* LOGIN */}

      <Route
        path="/login"
        element={<Login />}
      />

      {/* FORBIDDEN */}

      <Route
        path="/403"
        element={<Forbidden />}
      />

      <Route
        path="/invoice/:token"
        element={<PublicInvoice />}
      />

      <Route
        path="/i/:token"
        element={<PublicInvoice />}
      />

      <Route
        path="/share/invoice/:token"
        element={<PublicInvoice />}
      />

      <Route
        path="/p/:productId"
        element={<PublicProduct />}
      />

      <Route
        path="/attendance/branch/:token"
        element={<PublicBranchAttendance />}
      />

      <Route
        path="/a/:branchKey"
        element={<PublicBranchAttendance />}
      />

      <Route
        path="/att/:branchKey"
        element={<PublicBranchAttendance />}
      />

      <Route
        path="/employee/portal/:token"
        element={<EmployeePortal />}
      />

      <Route
        path="/employee-portal/:token"
        element={<EmployeePayrollPortal />}
      />

      <Route
        path="/employee-app/:token"
        element={<EmployeeAppShell />}
      />

      <Route
        path="/shop/*"
        element={
          <Suspense fallback={<RouteSkeleton />}>
            <Storefront />
          </Suspense>
        }
      />

      {/* MAIN APP */}

      <Route
        path="/*"
        element={<MainLayout />}
      >

        {/* DEFAULT */}

        <Route
          index
          element={
            <Navigate
              to="/dashboard"
              replace
            />
          }
        />

        {/* DASHBOARD */}

        <Route
          path="dashboard"
          element={<Dashboard />}
        />

        <Route
          path="notifications"
          element={
            <ProtectedRoute requiredPermissions={["notifications.view"]}>
              <NotificationsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="workspace"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <Workspace />
            </ProtectedRoute>
          }
        />

        <Route
          path="billing"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <Billing />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin/tenants"
          element={
            <ProtectedRoute adminOnly>
              <AdminTenants />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin/ai-inbox"
          element={
            <ProtectedRoute adminOnly>
              <AiInbox />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin/ai-followups"
          element={
            <ProtectedRoute adminOnly>
              <AiFollowups />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin/ai-channels"
          element={
            <ProtectedRoute adminOnly>
              <AiChannels />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin/ai-agent-settings"
          element={
            <ProtectedRoute adminOnly>
              <AiAgentSettings />
            </ProtectedRoute>
          }
        />

        <Route
          path="ai/settings"
          element={
            <ProtectedRoute requiredPermissions={["settings.edit"]}>
              <AiSettings />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin/ai-agent-analytics"
          element={
            <ProtectedRoute adminOnly>
              <AiAgentAnalytics />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin/ai-support-console"
          element={
            <ProtectedRoute adminOnly>
              <AiSupportConsole />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin/ai-support-knowledge-base"
          element={
            <ProtectedRoute adminOnly>
              <AiSupportKnowledgeBase />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/company"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/appearance"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/currencies"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/storefront"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/shipping"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/payments"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/debug"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter debugMode />
            </ProtectedRoute>
          }
        />

        {/* PRODUCTS */}

        <Route
          path="products"
          element={<Products />}
        />

        <Route
          path="products/add"
          element={<AddProduct />}
        />

        <Route
          path="products/:id/edit"
          element={<ProductEdit />}
        />

        <Route
          path="products/:id"
          element={<ProductDetails />}
        />

        <Route
          path="products/create"
          element={<AddProduct />}
        />

        <Route
          path="products/categories"
          element={<Categories />}
        />

        <Route
          path="products/classifications"
          element={<ProductClassifications />}
        />

        <Route
          path="products/brands"
          element={<Brands />}
        />

        <Route
          path="products/manufacturers"
          element={<Manufacturers />}
        />

        <Route
          path="products/units"
          element={<Units />}
        />

        <Route
          path="products/variants"
          element={<Variants />}
        />

        <Route
          path="products/barcodes"
          element={
            <DebugErrorBoundary>
              <BarcodeLabels />
            </DebugErrorBoundary>
          }
        />

        <Route
          path="products/barcode-labels"
          element={
            <DebugErrorBoundary>
              <BarcodeLabels />
            </DebugErrorBoundary>
          }
        />

        <Route
          path="products/labels"
          element={
            <DebugErrorBoundary>
              <BarcodeLabels />
            </DebugErrorBoundary>
          }
        />

        {/* INVENTORY */}

        <Route
          path="inventory"
          element={<Inventory />}
        />

        <Route
          path="inventory/history"
          element={<InventoryHistory />}
        />

        <Route
          path="inventory/variant/:id/history"
          element={<InventoryHistory />}
        />

        <Route
          path="inventory/movements"
          element={<InventoryMovements />}
        />

        <Route
          path="inventory/adjustments"
          element={<InventoryAdjustments />}
        />

        <Route
          path="smart-warehouse"
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <SmartWarehouse />
            </Suspense>
          }
        />

        {/* WAREHOUSES */}

        <Route
          path="warehouses"
          element={<Warehouses />}
        />

        <Route
          path="branches"
          element={<Branches />}
        />

        {/* STOCK TRANSFERS */}

        <Route
          path="stock-transfers"
          element={<StockTransfers />}
        />

        {/* CUSTOMERS */}

        <Route
          path="customers"
          element={<Customers />}
        />

        <Route
          path="sales-employees"
          element={
            <Navigate to="/employees/employees" replace />
          }
        />

        {/* LOYALTY */}

        <Route
          path="loyalty"
          element={
            <ProtectedRoute requiredPermissions={["loyalty.view"]}>
              <LoyaltyDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="loyalty/rules"
          element={
            <ProtectedRoute requiredPermissions={["loyalty.edit"]}>
              <LoyaltyRules />
            </ProtectedRoute>
          }
        />

        <Route
          path="loyalty/customers/:customerId"
          element={
            <ProtectedRoute requiredPermissions={["loyalty.view"]}>
              <CustomerLoyaltyProfile />
            </ProtectedRoute>
          }
        />

        {/* SUPPLIERS */}

        <Route
          path="suppliers"
          element={<Suppliers />}
        />

        <Route
          path="suppliers/:id"
          element={<SupplierDetails />}
        />

        {/* PURCHASES */}

        <Route
          path="purchases"
          element={<Purchases />}
        />

        <Route
          path="purchases/create"
          element={<CreatePurchase />}
        />

        <Route
          path="purchases/reorder-suggestions"
          element={<ReorderSuggestions />}
        />

        <Route
          path="purchases/:id/edit"
          element={<CreatePurchase />}
        />

        <Route
          path="purchases/:id"
          element={<PurchaseDetails />}
        />

        {/* ACCOUNTING */}

        <Route
          path="accounting"
          element={<Accounting />}
        />

        <Route
          path="accounting/dashboard"
          element={<Accounting />}
        />

        <Route
          path="accounting/treasury"
          element={<Treasury />}
        />
        <Route
          path="accounting/cashbox"
          element={<CashRegisters />}
        />

        <Route
          path="accounting/financial-accounts"
          element={<FinancialAccounts />}
        />

        <Route
          path="accounting/payment-method-mappings"
          element={<PaymentMethodMappings />}
        />

        <Route
          path="accounting/cash-registers"
          element={<CashRegisters />}
        />

        <Route
          path="accounting/expenses"
          element={<Expenses />}
        />

        <Route
          path="expenses"
          element={<Expenses />}
        />

        <Route
          path="accounting/income"
          element={<Revenues />}
        />

        <Route
          path="accounting/journal-entries"
          element={<JournalEntries />}
        />

        <Route
          path="accounting/ledgers"
          element={<Accounts />}
        />

        <Route
          path="accounting/accounts"
          element={<Accounts />}
        />

        <Route
          path="accounting/reports"
          element={<FinancialReports />}
        />

        <Route
          path="accounting/profit-loss"
          element={<ProfitAndLoss />}
        />

        <Route
          path="accounting/taxes"
          element={<Taxes />}
        />

        <Route
          path="accounting/cost-fix"
          element={<CostFixCenter />}
        />

        <Route
          path="accounting/audit-trail"
          element={<AuditTrail />}
        />

        {/* ORDERS */}

        <Route
          path="orders"
          element={<Orders />}
        />

        <Route
          path="orders/:id"
          element={<OrderDetails />}
        />

        <Route
          path="orders/returns"
          element={<OrderReturns />}
        />

        <Route
          path="operations/shipping"
          element={
            <ProtectedRoute requiredPermissions={["orders.view"]}>
              <ShippingCenter />
            </ProtectedRoute>
          }
        />

        {/* CREATE ORDER */}

        <Route
          path="create-order"
          element={<CreateOrder />}
        />

        {/* POS */}

        <Route
          path="pos"
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <POS />
            </Suspense>
          }
        />

        {/* REPORTS */}

        <Route
          path="reports"
          element={<Reports />}
        />

        <Route
          path="marketing"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <MarketingDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/ai-center"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <AiMarketingCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/ai-center/videos"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <AiMarketingVideos />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/analytics"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <MarketingAnalytics />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/attribution"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <MarketingAttribution />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/automation"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <MarketingAutomation />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/posts"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <SocialPosts />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/campaigns"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <Campaigns />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/coupons"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <CouponsManager />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/templates"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <PostTemplates />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/settings"
          element={
            <ProtectedRoute requiredPermissions={["marketing.settings"]}>
              <MarketingSettings />
            </ProtectedRoute>
          }
        />

        <Route
          path="website/settings"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <SettingsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="analytics"
          element={<AnalyticsDashboard />}
        />

        {/* EMPLOYEES */}

        <Route
          path="employees"
          element={
            <ProtectedRoute requiredPermissions={["employees.view"]}>
              <EmployeeHub />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/:tab"
          element={
            <ProtectedRoute requiredPermissions={["employees.view"]}>
              <EmployeeHub />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/commissions"
          element={
            <Navigate to="/employees/sales-performance" replace />
          }
        />

        <Route
          path="employees/top-performers"
          element={
            <Navigate to="/employees/sales-performance" replace />
          }
        />

        <Route
          path="employees/shifts"
          element={
            <Navigate to="/employees/attendance" replace />
          }
        />

        <Route
          path="staff/tasks"
          element={
            <ProtectedRoute requiredPermissions={["staff_tasks.view"]}>
              <StaffTasks />
            </ProtectedRoute>
          }
        />

        {/* HR / ATTENDANCE */}

        <Route
          path="attendance"
          element={
            <Navigate to="/employees/attendance" replace />
          }
        />

        <Route
          path="attendance/employees"
          element={
            <Navigate to="/employees/employees" replace />
          }
        />

        <Route
          path="attendance/reports"
          element={
            <Navigate to="/employees/reports" replace />
          }
        />

        <Route
          path="attendance/kiosk"
          element={
            <Navigate to="/employees/attendance" replace />
          }
        />

        <Route
          path="staff/qr-attendance"
          element={
            <Navigate to="/employees/attendance" replace />
          }
        />

        {/* USERS */}

        <Route
          path="users"
          element={
            <ProtectedRoute requiredPermissions={["users.view"]}>
              <Users />
            </ProtectedRoute>
          }
        />

        {/* ROLES */}

        <Route
          path="roles"
          element={
            <ProtectedRoute requiredPermissions={["roles.view"]}>
              <Roles />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/roles"
          element={
            <ProtectedRoute requiredPermissions={["roles.view"]}>
              <Roles />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/permissions"
          element={
            <ProtectedRoute requiredPermissions={["roles.view"]}>
              <Permissions />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/users"
          element={
            <ProtectedRoute requiredPermissions={["users.view"]}>
              <Users />
            </ProtectedRoute>
          }
        />

        {/* 404 */}

        <Route
          path="*"
          element={
            <Navigate
              to="/dashboard"
              replace
            />
          }
        />

      </Route>

    </Routes>
    </Suspense>
    </DebugErrorBoundary>
    </TenantProvider>
  );
}

export default App;
