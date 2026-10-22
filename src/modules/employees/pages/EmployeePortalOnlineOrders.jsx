import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useEmployeePortalArabic } from "../lib/employeePortalLanguage";
import EmployeePortalNavControls, { buildEmployeePortalHomePath, canNavigateEmployeePortalBack } from "../components/EmployeePortalNavControls";
import PortalOnlineOrdersBoard from "../../../shared/components/portalOnlineOrders/PortalOnlineOrdersBoard";
import { employeePortalNewOrderApi, employeePortalPickupsApi, getEmployeePortalOnlineOrder, getEmployeePortalOnlineOrders, printEmployeePortalOnlineOrderLabels, runEmployeePortalOnlineOrderAction } from "../services/employeePortalOnlineOrdersApi";
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
  const runAction = useCallback((orderId, action, input) => runEmployeePortalOnlineOrderAction(token, orderId, action, input), [token]);
  const printLabels = useCallback((orderIds) => printEmployeePortalOnlineOrderLabels(token, orderIds), [token]);
  const pickups = useMemo(() => employeePortalPickupsApi(token), [token]);
  const createOrder = useMemo(() => employeePortalNewOrderApi(token), [token]);
  const loadDetail = useCallback(async (orderId) => {
    const response = await getEmployeePortalOnlineOrder(token, orderId);
    return response?.order || null;
  }, [token]);

  const homePath = () => buildEmployeePortalHomePath({ pathname: window.location.pathname, token });

  // واتساب on a card opens the customer's own thread in الرسائل instead of wa.me, so the
  // reply carries the whole history and lands in the shop's inbox (owner, 2026-09-18).
  // The board only calls this for an order the server matched to a real conversation,
  // and only when this employee has messages access.
  // `thread` is the one button pressed (WhatsApp, Messenger, Instagram, TikTok — see ContactButtons).
  const openConversation = useCallback(
    (order, thread = null) => {
      const conversationId = String(thread?.id || order?.conversation?.id || "").trim();
      if (!conversationId) return;
      navigate(`${homePath()}/inbox/${encodeURIComponent(conversationId)}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, token]
  );

  return (
    <main dir={dir} className="employee-portal-online-orders employee-portal-min-screen employee-portal-safe-top min-h-[100dvh] overflow-x-hidden bg-background px-3 py-3 text-text sm:px-4 sm:py-4">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <EmployeePortalNavControls
          onBack={() => {
            if (canNavigateEmployeePortalBack()) navigate(-1);
            else navigate(homePath(), { replace: true });
          }}
          onHome={() => navigate(homePath())}
          className="px-0"
        />

        <PortalOnlineOrdersBoard
          loadList={loadList}
          loadDetail={loadDetail}
          runAction={runAction}
          printLabels={printLabels}
          openConversation={openConversation}
          pickups={pickups}
          createOrder={createOrder}
          title={t("orders.portalBoard.title")}
          headerClassName="rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-sm"
        />
      </div>
    </main>
  );
}
