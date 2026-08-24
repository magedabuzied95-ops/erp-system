import { useTranslation } from "react-i18next";

// Whether the customer confirmed is NOT readable from `status`: ORDER_STATUS_ALIASES maps
// `paid` -> `confirmed`, so every paid POS invoice reads as "confirmed" while no customer
// ever confirmed anything. The whatsapp_* timestamps are the only honest source, and
// `pending_confirmation` is the one status that carries confirmation meaning by itself.
export const getConfirmationState = (order = {}) => {
  const status = String(order?.status || "").trim().toLowerCase();
  if (order?.whatsapp_cancelled_at || status === "cancelled_by_customer") {
    return {
      key: "cancelled",
      labelKey: "orders.confirmation.cancelled",
      fallback: "ألغى العميل",
      className: "border-rose-400/25 bg-rose-400/10 text-rose-200",
    };
  }
  if (order?.whatsapp_confirmed_at) {
    return {
      key: "confirmed",
      labelKey: "orders.confirmation.confirmed",
      fallback: "أكّد العميل",
      className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    };
  }
  if (status === "edit_requested") {
    return {
      key: "edit_requested",
      labelKey: "orders.confirmation.editRequested",
      fallback: "طلب تعديل",
      className: "border-orange-400/25 bg-orange-400/10 text-orange-200",
    };
  }
  if (order?.whatsapp_confirmation_sent_at && status === "pending_confirmation") {
    return {
      key: "awaiting",
      labelKey: "orders.confirmation.awaiting",
      fallback: "بانتظار التأكيد",
      className: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    };
  }
  // A COD order sitting in pending_confirmation with no send recorded means the request never
  // left — an operational hole worth seeing in the list, not an absence worth hiding.
  if (status === "pending_confirmation") {
    return {
      key: "not_sent",
      labelKey: "orders.confirmation.notSent",
      fallback: "لم يُرسل طلب التأكيد",
      className: "border-slate-400/25 bg-slate-400/10 text-slate-300",
    };
  }
  return null;
};

function ConfirmationBadge({ order = {}, compact = false }) {
  const { t } = useTranslation();
  const state = getConfirmationState(order);
  if (!state) return null;
  const label = t(state.labelKey, state.fallback);
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 font-bold leading-4 ${compact ? "text-[9px]" : "text-[10px]"} ${state.className}`}
      title={label}
    >
      {label}
    </span>
  );
}

export default ConfirmationBadge;
