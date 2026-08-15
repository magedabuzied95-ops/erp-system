import {
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";

import {
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { useTranslation } from "react-i18next";

/* ======================================================
   LAYOUT
====================================================== */

import { api } from "./shared/api/api";
import { setCurrency } from "./shared/lib/currency";
import { FeatureFlagProvider } from "./modules/aiSupport/integration/FeatureFlagProvider";

/* ======================================================
   AUTH
====================================================== */

import Login from "./pages/Login";
import { getToken, isMetaReviewerUser, setAuth } from "./shared/auth/authStorage";

/* ======================================================
   DASHBOARD
====================================================== */

const Dashboard = lazy(() => import("./pages/Dashboard"));
const DashboardPrototype = lazy(() => import("./pages/DashboardPrototype"));
const ThemeFoundation = lazy(() => import("./pages/ThemeFoundation"));
const AppShellPreview = lazy(() => import("./pages/AppShellPreview"));
const ComponentsPreview = lazy(() => import("./pages/ComponentsPreview"));

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
const BarcodePrintQueue = lazy(() => import("./modules/products/pages/BarcodePrintQueue"));
const ProductPrintList = lazy(() => import("./modules/products/pages/ProductPrintList"));

/* ======================================================
   INVENTORY
====================================================== */

const Inventory = lazy(() => import("./modules/inventory/pages/InventoryDashboard"));
const InventoryMovements = lazy(() => import("./modules/inventory/pages/StockMovements"));
const InventoryAdjustments = lazy(() => import("./modules/inventory/pages/StockAdjustments"));
const InventoryHistory = lazy(() => import("./modules/inventory/pages/InventoryHistory"));
const InventoryCount = lazy(() => import("./modules/inventory/pages/InventoryCount"));

const SmartWarehouse = lazy(() => import("./modules/smartWarehouse/pages/SmartWarehouse"));
const WarehouseLivePicks = lazy(() => import("./modules/warehouse/pages/WarehouseLivePicks"));

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
const SupplierStatement = lazy(() => import("./modules/purchases/pages/SupplierStatement"));

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
const GeneralLedger = lazy(() => import("./modules/accounting/pages/GeneralLedger"));
const TrialBalance = lazy(() => import("./modules/accounting/pages/TrialBalance"));
const FinancialReports = lazy(() => import("./modules/accounting/pages/FinancialReports"));
const ProfitAndLoss = lazy(() => import("./modules/accounting/pages/ProfitAndLoss"));
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
const EmployeePortalProducts = lazy(() => import("./modules/employees/pages/EmployeePortalProducts"));
const EmployeePortalInventory = lazy(() => import("./modules/employees/pages/EmployeePortalInventory"));
const EmployeeAppShell = lazy(() => import("./modules/employees/pages/EmployeeAppShell"));
const EmployeePayrollPortal = lazy(() => import("./modules/employees/pages/EmployeePayrollPortal"));
const ManagerPortal = lazy(() => import("./modules/managerPortal/pages/ManagerPortal"));
const ManagerInventoryApprovals = lazy(() => import("./modules/managerPortal/pages/InventoryApprovals"));
const AttendanceDashboard = lazy(() => import("./modules/attendance/pages/AttendanceDashboard"));
const AttendanceEmployees = lazy(() => import("./modules/attendance/pages/EmployeesAttendance"));
const AttendanceReports = lazy(() => import("./modules/attendance/pages/AttendanceReports"));
const AttendanceKiosk = lazy(() => import("./modules/attendance/pages/AttendanceKiosk"));
const StaffQrAttendance = lazy(() => import("./modules/attendance/pages/StaffQrAttendance"));
const PublicBranchAttendance = lazy(() => import("./modules/attendance/pages/PublicBranchAttendance"));
const MarketingDashboard = lazy(() => import("./modules/marketing/pages/MarketingDashboard"));
const AiMarketingCenter = lazy(() => import("./modules/marketing/pages/AiMarketingCenter"));
const AiLeadCenter = lazy(() => import("./modules/marketing/pages/AiLeadCenter"));
const AiMarketingVideos = lazy(() => import("./modules/marketing/pages/AiMarketingVideos"));
const MarketingAnalytics = lazy(() => import("./modules/marketing/pages/MarketingAnalytics"));
const MarketingAttribution = lazy(() => import("./modules/marketing/pages/MarketingAttribution"));
const MarketingAutomation = lazy(() => import("./modules/marketing/pages/MarketingAutomation"));
const SocialPosts = lazy(() => import("./modules/marketing/pages/SocialPosts"));
const SocialMediaPublisher = lazy(() => import("./modules/marketing/pages/SocialMediaPublisher"));
const SocialCalendar = lazy(() => import("./modules/marketing/pages/SocialCalendar"));
const SocialCommentsCenter = lazy(() => import("./modules/marketing/pages/SocialCommentsCenter"));
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
import { SEO_CATEGORY_PATHS, legacyShopToRootPath } from "./storefront/lib/paths";

const RegisterCompany = lazy(() => import("./modules/saas/pages/RegisterCompany"));
const PublicInvoice = lazy(() => import("./pages/PublicInvoice"));
const PublicProduct = lazy(() => import("./pages/PublicProduct"));
const SmartProductQrRedirect = lazy(() => import("./pages/SmartProductQrRedirect"));
const PrivacyPage = lazy(() => import("./storefront/pages/LegalPages").then((module) => ({ default: module.PrivacyPage })));
const TermsPage = lazy(() => import("./storefront/pages/LegalPages").then((module) => ({ default: module.TermsPage })));
const DataDeletionPage = lazy(() => import("./storefront/pages/LegalPages").then((module) => ({ default: module.DataDeletionPage })));
const OrderConfirmationActionPage = lazy(() => import("./storefront/pages/OrderConfirmationActionPage.jsx").then((module) => ({ default: module.OrderConfirmationActionPage })));

const Workspace = lazy(() => import("./modules/saas/pages/Workspace"));

const Billing = lazy(() => import("./modules/saas/pages/Billing"));

const AdminTenants = lazy(() => import("./modules/saas/pages/AdminTenants"));

const SettingsCenter = lazy(() => import("./modules/settings/pages/SettingsCenter"));
const NotificationsCenter = lazy(() => import("./modules/notifications/pages/NotificationsCenter"));
const AiSupportConsole = lazy(() => import("./modules/aiSupport/pages/AiSupportConsole"));
const AiSupportKnowledgeBase = lazy(() => import("./modules/aiSupport/pages/AiSupportKnowledgeBase"));
const AiInbox = lazy(() => import("./modules/aiSupport/pages/AiInbox"));
const AiInboxPwa = lazy(() => import("./modules/aiSupport/pages/AiInboxPwa"));
const AiStudio = lazy(() => import("./modules/aiStudio/pages/AiStudio"));
const AiStudioWorkflows = lazy(() => import("./modules/aiStudio/pages/AiStudioWorkflows"));
const AiStudioExecutions = lazy(() => import("./modules/aiStudio/pages/AiStudioExecutions"));
const AiStudioApprovals = lazy(() => import("./modules/aiStudio/pages/AiStudioApprovals"));
const AiStudioTools = lazy(() => import("./modules/aiStudio/pages/AiStudioTools"));
// Visual workflow builder — lazy so @xyflow/react loads ONLY on the editor route.
const AiStudioWorkflowEditor = lazy(() => import("./modules/aiStudio/pages/AiStudioWorkflowEditor"));
const AiStudioRestockRecovery = lazy(() => import("./modules/aiStudio/pages/AiStudioRestockRecovery"));
const MetaReviewerInbox = lazy(() => import("./modules/aiSupport/pages/MetaReviewerInbox"));
const AiFollowups = lazy(() => import("./modules/aiSupport/pages/AiFollowups"));
const AiChannels = lazy(() => import("./modules/aiSupport/pages/AiChannels"));
const AiAgentSettings = lazy(() => import("./modules/aiSupport/pages/AiAgentSettings"));
const AiSettings = lazy(() => import("./modules/aiSupport/pages/AiSettings"));
const AiAgentAnalytics = lazy(() => import("./modules/aiSupport/pages/AiAgentAnalytics"));
const Storefront = lazy(() => import("./storefront/Storefront"));
// MainLayout is the ERP shell (sidebar, realtime socket, RBAC, notifications).
// It only renders on the ERP host, so load it lazily to keep its heavy graph
// (socket.io-client, rbac store, notifications) out of the customer storefront's
// initial bundle. It renders inside the route-level <Suspense> below.
const MainLayout = lazy(() => import("./shared/layouts/MainLayout"));

function RouteSkeleton() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[var(--bg)] p-4 text-[var(--text)] md:p-6">
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <div className="sf-skeleton-shimmer h-10 w-60 rounded-2xl bg-[var(--surface-soft)]" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="sf-skeleton-shimmer h-24 rounded-2xl bg-[var(--surface-soft)]" />
          ))}
        </div>
        <div className="sf-skeleton-shimmer h-[28rem] rounded-[1.75rem] bg-[var(--surface-soft)]" />
      </div>
    </div>
  );
}

const STOREFRONT_ROOT_HOSTS = new Set([
  "m1store-egy.com",
  "www.m1store-egy.com",
  "localhost",
  "127.0.0.1",
]);

const ERP_HOST = "erp.m1store-egy.com";
const STOREFRONT_CANONICAL_ORIGIN = "https://m1store-egy.com";
const ERP_CANONICAL_ORIGIN = "https://erp.m1store-egy.com";
const M1_FAVICON_URL = "/favicon.svg?v=m1-mark-20260716";

const readHostname = () => {
  if (typeof window === "undefined") return "";
  return String(window.location.hostname || "").trim().toLowerCase();
};

const isStorefrontRootHost = () => {
  const hostname = readHostname();
  if (!hostname) return false;
  if (STOREFRONT_ROOT_HOSTS.has(hostname)) return true;
  return hostname.endsWith(".vercel.app");
};

const isErpHost = () => readHostname() === ERP_HOST;

function PublicHostErpRedirect() {
  const location = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextUrl = `${ERP_CANONICAL_ORIGIN}${location.pathname}${location.search}${location.hash}`;
    window.location.replace(nextUrl);
  }, [location]);

  return null;
}

function StorefrontLegacyRedirect() {
  const location = useLocation();
  if (isErpHost()) {
    if (typeof window !== "undefined") {
      window.location.replace(`${STOREFRONT_CANONICAL_ORIGIN}${legacyShopToRootPath(location.pathname, location.search)}`);
    }
    return null;
  }
  return <Navigate to={legacyShopToRootPath(location.pathname, location.search)} replace />;
}

function ScopedInbox() {
  return isMetaReviewerUser() ? <MetaReviewerInbox /> : <AiInboxPwa />;
}

function ErpMainRoute() {
  return isMetaReviewerUser() ? <Navigate to="/inbox" replace /> : <MainLayout />;
}

function App() {
  useTranslation();
  const location = useLocation();
  const [, setAuthRevision] = useState(0);
  const isEmployeeAppRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/employee-app/");
  const employeeAppToken = isEmployeeAppRoute ? window.location.pathname.split("/")[2] || "" : "";
  const enableStorefrontRootRoutes = isStorefrontRootHost() && !isErpHost();
  const enableErpAppRoutes = !enableStorefrontRootRoutes;

  useEffect(() => {
    const refreshAuthorization = () => setAuthRevision((value) => value + 1);
    window.addEventListener("erp:auth-user-updated", refreshAuthorization);
    return () => window.removeEventListener("erp:auth-user-updated", refreshAuthorization);
  }, []);

  useEffect(() => {
    if (!enableErpAppRoutes || isEmployeeAppRoute || !getToken()) return undefined;
    let cancelled = false;
    api.get("/auth/me", { suppressErrorStatuses: [401, 403] })
      .then((response) => {
        if (cancelled || !response?.user) return;
        setAuth({ token: getToken(), user: response.user });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enableErpAppRoutes, isEmployeeAppRoute]);

  useEffect(() => {
    if (isEmployeeAppRoute) return undefined;
    let cancelled = false;
    api.get("/settings/public", { suppressErrorStatuses: [401, 403, 404, 500] })
      .then((response) => {
        if (cancelled) return;
        const settings = response?.settings || {};
        const code = settings["general.default_currency"];
        const symbol = settings["general.currency_symbol"];
        const faviconUrl = isStorefrontRootHost() || isErpHost()
          ? M1_FAVICON_URL
          : settings["general.favicon_url"] || M1_FAVICON_URL;
        if (code || symbol) setCurrency({ code, symbol });
        if (typeof document !== "undefined") {
          let link = document.querySelector('link[rel="icon"]');
          if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
          }
          link.type = "image/svg+xml";
          link.href = faviconUrl;
        }
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
            <Route path="/employee-app/:token/products" element={<EmployeePortalProducts />} />
            <Route path="/employee-app/:token/inventory" element={<EmployeePortalInventory />} />
            <Route path="/employee-app/:token/inventory/:sessionId" element={<EmployeePortalInventory />} />
            <Route path="/employee-app/:token" element={<EmployeeAppShell />} />
            <Route path="/employee-app/*" element={<EmployeeAppShell />} />
          </Routes>
        </Suspense>
      </DebugErrorBoundary>
    );
  }

  if (enableErpAppRoutes && getToken() && isMetaReviewerUser() && !location.pathname.startsWith("/inbox") && location.pathname !== "/login") {
    return <Navigate to="/inbox" replace />;
  }

  return (
    <FeatureFlagProvider poll={enableErpAppRoutes}>
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

      <Route
        path="/dashboard-prototype"
        element={<DashboardPrototype />}
      />

      <Route
        path="/design-system"
        element={<ThemeFoundation />}
      />

      <Route
        path="/app-shell-preview"
        element={<AppShellPreview />}
      />

      <Route path="/components-preview" element={<ComponentsPreview />} />

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
        path="/qr/product/:productId"
        element={<SmartProductQrRedirect />}
      />

      <Route
        path="/privacy"
        element={<PrivacyPage />}
      />

      <Route
        path="/terms"
        element={<TermsPage />}
      />

      <Route
        path="/data-deletion"
        element={<DataDeletionPage />}
      />

      <Route
        path="/attendance/branch/:token"
        element={<PublicBranchAttendance />}
      />

      <Route
        path="/c/:code"
        element={
          <Suspense fallback={<RouteSkeleton />}>
            <OrderConfirmationActionPage />
          </Suspense>
        }
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
        path="/employee/portal/:token/products"
        element={<EmployeePortalProducts />}
      />

      <Route
        path="/employee/portal/:token/inventory"
        element={<EmployeePortalInventory />}
      />

      <Route
        path="/employee/portal/:token/inventory/:sessionId"
        element={<EmployeePortalInventory />}
      />

      <Route
        path="/employee-portal/:token"
        element={<EmployeePayrollPortal />}
      />

      <Route
        path="/employee-portal/:token/products"
        element={<EmployeePortalProducts />}
      />

      <Route
        path="/employee-portal/:token/inventory"
        element={<EmployeePortalInventory />}
      />

      <Route
        path="/employee-portal/:token/inventory/:sessionId"
        element={<EmployeePortalInventory />}
      />

      <Route
        path="/manager-portal/:token"
        element={<ManagerPortal />}
      />
      <Route
        path="/manager/inventory-approvals"
        element={<ManagerInventoryApprovals />}
      />
      <Route
        path="/manager-portal/:token/inventory-approvals"
        element={<ManagerInventoryApprovals />}
      />

      <Route
        path="/employee-app/:token"
        element={<EmployeeAppShell />}
      />

      <Route
        path="/warehouse/live-picks"
        element={
          <ProtectedRoute>
            <WarehouseLivePicks />
          </ProtectedRoute>
        }
      />

      {enableStorefrontRootRoutes ? (
        <>
          <Route path="/" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/products" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          {Array.from(SEO_CATEGORY_PATHS).map((path) => (
            <Route key={`storefront-category-${path}`} path={path} element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          ))}
          <Route path="/product/:identifier" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/account" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/account/reset-password" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/cart" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/checkout" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/track" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/wishlist" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/recently-viewed" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/sale" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/contact" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/size-guide" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/returns" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/faq" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/success/:orderNumber" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/confirm/:code" element={<Suspense fallback={<RouteSkeleton />}><Storefront /></Suspense>} />
          <Route path="/dashboard" element={<PublicHostErpRedirect />} />
          <Route path="/orders" element={<PublicHostErpRedirect />} />
          <Route path="/orders/*" element={<PublicHostErpRedirect />} />
          <Route path="/settings" element={<PublicHostErpRedirect />} />
          <Route path="/settings/*" element={<PublicHostErpRedirect />} />
          <Route path="/products/*" element={<PublicHostErpRedirect />} />
        </>
      ) : null}

      <Route path="/shop" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/products" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/product/:identifier" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/account" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/account/reset-password" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/cart" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/checkout" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/track" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/wishlist" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/recently-viewed" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/contact" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/size-guide" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/offers" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/sale" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/returns" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/faq" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/success/:orderNumber" element={<StorefrontLegacyRedirect />} />
      <Route path="/shop/confirm/:code" element={<StorefrontLegacyRedirect />} />

      <Route
        path="/shop/*"
        element={
          isErpHost()
            ? <StorefrontLegacyRedirect />
            : (
              <Suspense fallback={<RouteSkeleton />}>
                <Storefront />
              </Suspense>
            )
        }
      />

      <Route
        path="/inbox"
        element={
          <ProtectedRoute requiredPermissions={["ai_inbox_messenger.view"]}>
            <ScopedInbox />
          </ProtectedRoute>
        }
      />

      <Route
        path="/inbox/:conversationId"
        element={
          <ProtectedRoute requiredPermissions={["ai_inbox_messenger.view"]}>
            <ScopedInbox />
          </ProtectedRoute>
        }
      />

      {/* MAIN APP */}

      {enableErpAppRoutes ? (
      <Route
        path="/*"
        element={<ErpMainRoute />}
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

        {/* AI STUDIO — centralized AI control plane (additive; existing AI routes unchanged) */}
        <Route
          path="ai-studio"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <AiStudio />
            </ProtectedRoute>
          }
        />
        <Route
          path="ai-studio/workflows"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <AiStudioWorkflows />
            </ProtectedRoute>
          }
        />
        <Route
          path="ai-studio/executions"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <AiStudioExecutions />
            </ProtectedRoute>
          }
        />
        <Route
          path="ai-studio/approvals"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <AiStudioApprovals />
            </ProtectedRoute>
          }
        />
        <Route
          path="ai-studio/tools"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <AiStudioTools />
            </ProtectedRoute>
          }
        />
        <Route
          path="ai-studio/restock-recovery"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <AiStudioRestockRecovery />
            </ProtectedRoute>
          }
        />
        <Route
          path="ai-studio/workflows/:id/edit"
          element={
            <ProtectedRoute requiredPermissions={["settings.view"]}>
              <AiStudioWorkflowEditor />
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
          path="products/barcode-print-queue"
          element={
            <DebugErrorBoundary>
              <BarcodePrintQueue />
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
            element={
              <ProtectedRoute requiredPermissions={["inventory.edit"]}>
                <InventoryAdjustments />
              </ProtectedRoute>
            }
          />

        <Route
          path="inventory/count"
          element={<InventoryCount />}
        />

        <Route
          path="inventory/count/:id"
          element={<InventoryCount />}
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
          path="customers/:customerId/statement"
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

        <Route
          path="suppliers/:supplierId/statement"
          element={<SupplierStatement />}
        />

        {/* PURCHASES */}

        <Route
          path="purchases"
          element={(
            <ProtectedRoute requiredPermissions={["purchases.view"]}>
              <Purchases />
            </ProtectedRoute>
          )}
        />

        <Route
          path="purchases/create"
          element={(
            <ProtectedRoute requiredPermissions={["purchases.create"]}>
              <CreatePurchase />
            </ProtectedRoute>
          )}
        />

        <Route
          path="purchases/reorder-suggestions"
          element={(
            <ProtectedRoute requiredPermissions={["purchases.view"]}>
              <ReorderSuggestions />
            </ProtectedRoute>
          )}
        />

        <Route
          path="purchases/:id/edit"
          element={(
            <ProtectedRoute requiredPermissions={["purchases.edit"]}>
              <CreatePurchase />
            </ProtectedRoute>
          )}
        />

        <Route
          path="purchases/:id"
          element={(
            <ProtectedRoute requiredPermissions={["purchases.view"]}>
              <PurchaseDetails />
            </ProtectedRoute>
          )}
        />

        {/* ACCOUNTING */}

        <Route
          path="accounting"
          element={<Accounting />}
        />

        <Route
          path="accounting/dashboard"
          element={<Navigate to="/accounting" replace />}
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
          element={<Navigate to="/accounting/cashbox" replace />}
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
          element={<Navigate to="/accounting/accounts" replace />}
        />

        <Route
          path="accounting/accounts"
          element={<Accounts />}
        />

        <Route
          path="accounting/general-ledger"
          element={<GeneralLedger />}
        />

        <Route
          path="accounting/trial-balance"
          element={<TrialBalance />}
        />

        <Route
          path="accounting/reports"
          element={<FinancialReports />}
        />

        <Route
          path="products/print-list"
          element={
            <DebugErrorBoundary>
              <ProductPrintList />
            </DebugErrorBoundary>
          }
        />

        <Route
          path="accounting/analytics"
          element={<Navigate to="/accounting/reports" replace />}
        />

        <Route
          path="accounting/profit-loss"
          element={<ProfitAndLoss />}
        />

        <Route
          path="accounting/taxes"
          element={<Navigate to="/accounting/reports" replace />}
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
          path="marketing/ai-center/leads"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <AiLeadCenter />
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
          path="marketing/social-calendar"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <SocialCalendar />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/social-comments"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <SocialCommentsCenter />
            </ProtectedRoute>
          }
        />

        <Route
          path="marketing/social-media-publisher"
          element={
            <ProtectedRoute requiredPermissions={["marketing.view"]}>
              <SocialMediaPublisher />
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
      ) : null}

    </Routes>
    </Suspense>
    </DebugErrorBoundary>
    </TenantProvider>
    </FeatureFlagProvider>
  );
}

export default App;

