import { useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Loader2, RotateCcw, UserX } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import StatusBadge from "./StatusBadge";
import { formatDateTime } from "../lib/ordersStore";
import { OrderIdentityLevelsContext } from "../lib/identityAlertLevels.js";

/*
 * "Same address, another name and phone" — the server compares every online order's address
 * with earlier orders (server/modules/orders/addressIdentityAlerts.js). Red: the earlier order
 * was refused or returned. Yellow: it was not (often family or a neighbour).
 */

const LEVEL_STYLE = {
  red: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  yellow: "border-amber-400/30 bg-amber-400/10 text-amber-100",
};

export function IdentityAlertBadge({ order, compact = false }) {
  const { t } = useTranslation();
  const levels = useContext(OrderIdentityLevelsContext);
  const entry = order?.id ? levels?.[order.id] : null;
  if (!entry?.level) return null;
  const label = entry.confirmed ? t("orders.identityAlert.badgeConfirmed") : t("orders.identityAlert.badge");
  return (
    <span
      title={t("orders.identityAlert.badgeHint", { count: entry.count })}
      className={`inline-flex items-center gap-1 rounded-full border font-black ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10px]"} ${LEVEL_STYLE[entry.level]}`}
    >
      <AlertTriangle className="h-3 w-3" />
      {compact ? null : <span className="truncate">{label}</span>}
    </span>
  );
}

function MatchRow({ t, alert }) {
  const other = alert.other_order || {};
  const earlier = alert.direction === "earlier_order";
  return (
    <li className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            to={`/orders/${other.id}`}
            dir="ltr"
            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-black text-zinc-100 hover:bg-white/10"
          >
            {other.invoice_number || `#${other.id}`}
          </Link>
          {alert.severity === "red" ? (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${LEVEL_STYLE.red}`}>
              {t("orders.identityAlert.refused")}
            </span>
          ) : (
            <StatusBadge value={other.status} />
          )}
          <span className="text-[11px] font-semibold text-zinc-500">
            {earlier ? t("orders.identityAlert.earlier") : t("orders.identityAlert.later")}
            {" · "}
            {alert.match_kind === "exact" ? t("orders.identityAlert.exact") : t("orders.identityAlert.similar")}
          </span>
        </div>
        <span className="text-[11px] font-semibold text-zinc-500">{formatDateTime(other.created_at)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-bold text-white">{other.customer_name || t("orders.fallback.customer")}</span>
        <span dir="ltr" className="font-semibold text-zinc-300">{other.customer_phone || "—"}</span>
      </div>
      {other.customer_address ? (
        <div className="mt-1 break-words text-xs font-semibold leading-6 text-zinc-400" dir="auto">
          {[other.governorate, other.city_area, other.customer_address].filter(Boolean).join(" — ")}
        </div>
      ) : null}
    </li>
  );
}

export function IdentityAlertCard({ orderId }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      const result = await api.get(`/orders/${orderId}/identity-alerts`, { suppressErrorStatuses: [403, 404, 500] });
      setData(result || null);
    } catch {
      setData(null);
    }
  }, [orderId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const review = async (decision) => {
    setSaving(decision);
    try {
      const result = await api.post(`/orders/${orderId}/identity-alerts/review`, { decision });
      setData(result);
      toast.success(t("orders.identityAlert.saved"));
    } catch (error) {
      toast.error(error?.message || t("orders.identityAlert.saveFailed"));
    } finally {
      setSaving("");
    }
  };

  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  if (!alerts.length) return null;

  const own = alerts.filter((alert) => alert.direction === "earlier_order");
  const later = alerts.filter((alert) => alert.direction === "later_order");
  const level = data.level;
  const reviewStatus = data.review_status;
  const reviewed = own.find((alert) => alert.status !== "open");
  const tone = level ? LEVEL_STYLE[level] : "border-white/10 bg-white/5 text-zinc-200";

  const title = level === "red"
    ? t("orders.identityAlert.titleRed")
    : level === "yellow"
      ? t("orders.identityAlert.titleYellow")
      : own.length
        ? t("orders.identityAlert.titleDismissed")
        : t("orders.identityAlert.titleLater");

  return (
    <div className={`rounded-2xl border p-5 shadow-xl shadow-black/10 ${tone}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-base font-black">{title}</h3>
            {reviewed ? null : (
              <p className="mt-1 text-xs font-semibold leading-6 opacity-80">
                {own.length ? t("orders.identityAlert.explain") : t("orders.identityAlert.explainLater")}
              </p>
            )}
            {reviewed ? (
              <p className="mt-1 text-xs font-bold">
                {reviewStatus === "same_person" ? t("orders.identityAlert.markedSame") : t("orders.identityAlert.markedDifferent")}
                {reviewed.reviewed_by_name ? ` — ${reviewed.reviewed_by_name}` : ""}
                {reviewed.reviewed_at ? ` · ${formatDateTime(reviewed.reviewed_at)}` : ""}
              </p>
            ) : null}
          </div>
        </div>
        {own.length ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {reviewStatus === "open" ? (
              <>
                <button
                  type="button"
                  disabled={Boolean(saving)}
                  onClick={() => review("same_person")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-rose-500 px-3 text-xs font-black text-white transition hover:bg-rose-600 disabled:opacity-60"
                >
                  {saving === "same_person" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                  {t("orders.identityAlert.samePerson")}
                </button>
                <button
                  type="button"
                  disabled={Boolean(saving)}
                  onClick={() => review("different_person")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/10 px-3 text-xs font-black text-white transition hover:bg-white/15 disabled:opacity-60"
                >
                  {saving === "different_person" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("orders.identityAlert.differentPerson")}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={Boolean(saving)}
                onClick={() => review("open")}
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/10 px-3 text-xs font-black text-white transition hover:bg-white/15 disabled:opacity-60"
              >
                {saving === "open" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {t("orders.identityAlert.reopen")}
              </button>
            )}
          </div>
        ) : null}
      </div>
      <ul className="mt-4 space-y-2">
        {[...own, ...later].map((alert) => <MatchRow key={alert.id} t={t} alert={alert} />)}
      </ul>
    </div>
  );
}
