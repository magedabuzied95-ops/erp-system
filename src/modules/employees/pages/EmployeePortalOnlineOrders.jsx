import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useEmployeePortalArabic } from "../lib/employeePortalLanguage";
import { Truck } from "lucide-react";
import EmployeePortalNavControls, { buildEmployeePortalHomePath, canNavigateEmployeePortalBack } from "../components/EmployeePortalNavControls";
import PortalOnlineOrdersBoard from "../../../shared/components/portalOnlineOrders/PortalOnlineOrdersBoard";
import { getEmployeePortalOnlineOrder, getEmployeePortalOnlineOrders, printEmployeePortalOnlineOrderLabels, runEmployeePortalOnlineOrderAction } from "../services/employeePortalOnlineOrdersApi";
import usePageTitle from "../../../shared/hooks/usePageTitle";

// أوردرات الشحن in the employee portal. Every employee sees it (owner decision,
// 2026-09-10); the board is shared with the manager portal.
export default function EmployeePortalOnlineOrders() {
  const { t, i18n } = useEmployeePortalArabic();
  usePageTitle("Employee Shipping Orders");
  const { token } = useParams();
  const navigate = useNavigate();
  const dir = String(i18n.resolvedLanguage || i18n.language || "ar").startsWith("ar") ? "rtl" : "ltr";

  const loadList = useCallback((params) => getEmployeePortalOnlineOrders(token, params), [token]);
  // The server decides whether this employee may act (permissions.can_act on the list).
  const runAction = useCallback((orderId, action) => runEmployeePortalOnlineOrderAction(token, orderId, action), [token]);
  const printLabels = useCallback((orderIds) => printEmployeePortalOnlineOrderLabels(token, orderIds), [token]);
  const loadDetail = useCallback(async (orderId) => {
    const response = await getEmployeePortalOnlineOrder(token, orderId);
    return response?.order || null;
  }, [token]);

  const homePath = () => buildEmployeePortalHomePath({ pathname: window.location.pathname, token });

  return (
    <main dir={dir} className="employee-portal-online-orders employee-portal-min-screen employee-portal-safe-top min-h-[100dvh] overflow-x-hidden bg-background px-3 py-3 text-text sm:px-4 sm:py-4">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <EmployeePortalNavControls
          onBack={() => {
            if (canNavigateEmployeePortalBack()) navigate(-1);
            else navigate(homePath(), { replace: true });
          }}
          onHome={() => navigate(homePath())}
          tone="light"
          className="px-0"
        />

        <header className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-sm">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Truck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="m1-page-title text-text">{t("orders.portalBoard.title")}</h1>
            <p className="mt-0.5 text-xs font-bold text-text-muted">{t("orders.portalBoard.subtitle")}</p>
          </div>
        </header>

        <PortalOnlineOrdersBoard loadList={loadList} loadDetail={loadDetail} runAction={runAction} printLabels={printLabels} />
      </div>
    </main>
  );
}
