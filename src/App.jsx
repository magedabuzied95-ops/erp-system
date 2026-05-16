import {
  lazy,
  Suspense,
} from "react";

import {
  Routes,
  Route,
  Navigate
} from "react-router-dom";

/* ======================================================
   LAYOUT
====================================================== */

import MainLayout from "./shared/layouts/MainLayout";

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
const ReorderSuggestions = lazy(() => import("./modules/purchases/pages/ReorderSuggestions"));

/* ======================================================
   ACCOUNTING
====================================================== */

const Accounting = lazy(() => import("./modules/accounting/pages/Accounting"));
const CashRegisters = lazy(() => import("./modules/accounting/pages/CashRegisters"));
const Expenses = lazy(() => import("./modules/accounting/pages/Expenses"));
const Revenues = lazy(() => import("./modules/accounting/pages/Revenues"));
const JournalEntries = lazy(() => import("./modules/accounting/pages/JournalEntries"));
const Accounts = lazy(() => import("./modules/accounting/pages/Accounts"));
const FinancialReports = lazy(() => import("./modules/accounting/pages/FinancialReports"));
const ProfitAndLoss = lazy(() => import("./modules/accounting/pages/ProfitAndLoss"));
const Taxes = lazy(() => import("./modules/accounting/pages/Taxes"));

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
const EmployeeSalesPerformance = lazy(() => import("./modules/employees/pages/SalesPerformance"));
const EmployeeCommissions = lazy(() => import("./modules/employees/pages/Commissions"));
const EmployeeTopPerformers = lazy(() => import("./modules/employees/pages/TopPerformers"));
const EmployeeShiftAnalytics = lazy(() => import("./modules/employees/pages/ShiftAnalytics"));
const AttendanceDashboard = lazy(() => import("./modules/attendance/pages/AttendanceDashboard"));
const AttendanceEmployees = lazy(() => import("./modules/attendance/pages/EmployeesAttendance"));
const AttendanceReports = lazy(() => import("./modules/attendance/pages/AttendanceReports"));
const AttendanceKiosk = lazy(() => import("./modules/attendance/pages/AttendanceKiosk"));
const StaffQrAttendance = lazy(() => import("./modules/attendance/pages/StaffQrAttendance"));
const MarketingDashboard = lazy(() => import("./modules/marketing/pages/MarketingDashboard"));
const MarketingAnalytics = lazy(() => import("./modules/marketing/pages/MarketingAnalytics"));
const MarketingAttribution = lazy(() => import("./modules/marketing/pages/MarketingAttribution"));
const MarketingAutomation = lazy(() => import("./modules/marketing/pages/MarketingAutomation"));
const SocialPosts = lazy(() => import("./modules/marketing/pages/SocialPosts"));
const Campaigns = lazy(() => import("./modules/marketing/pages/Campaigns"));
const PostTemplates = lazy(() => import("./modules/marketing/pages/PostTemplates"));
const MarketingSettings = lazy(() => import("./modules/marketing/pages/MarketingSettings"));
const CouponsManager = lazy(() => import("./modules/coupons/pages/CouponsManager"));
const WebsiteSettings = lazy(() => import("./modules/website/pages/WebsiteSettings"));

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

const CompanySettings = lazy(() => import("./modules/saas/pages/CompanySettings"));
const AppearanceSettings = lazy(() => import("./modules/settings/pages/AppearanceSettings"));
const Currencies = lazy(() => import("./modules/settings/pages/Currencies"));
const NotificationsCenter = lazy(() => import("./modules/notifications/pages/NotificationsCenter"));

function App() {

  return (
    <TenantProvider>
    <DebugErrorBoundary title="Application screen crashed">
    <Suspense fallback={<div className="p-6 text-[var(--text)]">Loading...</div>}>
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
        path="/p/:productId"
        element={<PublicProduct />}
      />

      <Route
        path="/shop/*"
        element={
          <Suspense fallback={<div className="p-6 text-stone-700">Loading storefront...</div>}>
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
          path="settings/company"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <CompanySettings />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/appearance"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <AppearanceSettings />
            </ProtectedRoute>
          }
        />

        <Route
          path="settings/currencies"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <Currencies />
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
            <Suspense fallback={<div className="p-6 text-[var(--text)]">Loading smart warehouse...</div>}>
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
            <ProtectedRoute requiredPermissions={["employees.view"]}>
              <SalesEmployees />
            </ProtectedRoute>
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
          path="accounting/cashbox"
          element={<CashRegisters />}
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

        {/* CREATE ORDER */}

        <Route
          path="create-order"
          element={<CreateOrder />}
        />

        {/* POS */}

        <Route
          path="pos"
          element={
            <Suspense fallback={<div className="p-6 text-[var(--text)]">Loading POS...</div>}>
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
            <ProtectedRoute requiredPermissions={["website.settings"]}>
              <WebsiteSettings />
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
              <EmployeeSalesPerformance />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/sales-performance"
          element={
            <ProtectedRoute requiredPermissions={["employees.view"]}>
              <EmployeeSalesPerformance />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/commissions"
          element={
            <ProtectedRoute requiredPermissions={["employees.view"]}>
              <EmployeeCommissions />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/top-performers"
          element={
            <ProtectedRoute requiredPermissions={["employees.view"]}>
              <EmployeeTopPerformers />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/shifts"
          element={
            <ProtectedRoute requiredPermissions={["employees.view"]}>
              <EmployeeShiftAnalytics />
            </ProtectedRoute>
          }
        />

        {/* HR / ATTENDANCE */}

        <Route
          path="attendance"
          element={
            <ProtectedRoute requiredPermissions={["attendance.view"]}>
              <AttendanceDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance/employees"
          element={
            <ProtectedRoute requiredPermissions={["attendance.view"]}>
              <AttendanceEmployees />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance/reports"
          element={
            <ProtectedRoute requiredPermissions={["attendance.view"]}>
              <AttendanceReports />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance/kiosk"
          element={
            <ProtectedRoute requiredPermissions={["attendance.create"]}>
              <AttendanceKiosk />
            </ProtectedRoute>
          }
        />

        <Route
          path="staff/qr-attendance"
          element={
            <ProtectedRoute requiredPermissions={["attendance.create"]}>
              <StaffQrAttendance />
            </ProtectedRoute>
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
          path="settings"
          element={<Navigate to="/settings/roles" replace />}
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
