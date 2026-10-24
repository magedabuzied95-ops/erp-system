import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, PackageCheck, RefreshCw, Undo2 } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { formatDateTime } from "../lib/ordersStore";

/*
 * Bosta's cross-merchant consignee record (delivered vs returned across all
 * merchants, success rate). Bosta only serves it to a logged-in dashboard
 * session, not to the business API key, so it is fetched by the companion
 * "Bosta <-> ERP" Chrome extension (tools/bosta-erp-extension) and stored by the
 * server. This card reads the stored snapshot and asks the extension to refresh
 * it. When the extension is not installed, the card still shows what was synced
 * before; only the refresh button is inert.
 */

const ERROR_KEY = {
  NO_BOSTA_LOGIN: "errNoLogin",
  BOSTA_UNAUTHORIZED: "errUnauthorized",
};

function errorKeyFor(code) {
  if (ERROR_KEY[code]) return ERROR_KEY[code];
  if (typeof code === "string" && code.startsWith("SAVE_FAILED")) return "errSaveFailed";
  if (code === "EXTENSION_UNAVAILABLE" || code === "NO_BOSTA_TAB" || code === "BOSTA_TAB_NOT_READY") return "noExtension";
  return "errGeneric";
}

function Stat({ value, label, tone = "" }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-center">
      <div className={`text-xl font-black ${tone}`}>{value == null ? "—" : value}</div>
      <div className="mt-0.5 text-[10px] font-bold text-zinc-400">{label}</div>
    </div>
  );
}

/*
 * Props:
 *  - phone: the customer's phone.
 *  - fetchRecord: optional async (phone) => record|null. When given (the portals
 *    pass a token-scoped fetcher), it replaces the admin `api.get` call.
 *  - readOnly: hide the refresh button and all extension wiring. The portals use
 *    this — their users have no Chrome extension and no Bosta login; they just
 *    see whatever the admin synced from the main ERP.
 */
export function BostaConsigneeHistoryCard({ phone, fetchRecord = null, readOnly = false }) {
  const { t } = useTranslation();
  const normalizedPhone = String(phone || "").trim();

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [extReady, setExtReady] = useState(false);
  const [extChecked, setExtChecked] = useState(false);
  const pendingRef = useRef(false);
  const timeoutRef = useRef(null);

  const load = useCallback(async () => {
    if (!normalizedPhone) return;
    try {
      if (fetchRecord) {
        const rec = await fetchRecord(normalizedPhone);
        setRecord(rec && rec.data !== undefined ? rec.data : rec || null);
      } else {
        const res = await api.get(`/shipping/bosta/consignee-history?phone=${encodeURIComponent(normalizedPhone)}`);
        setRecord(res?.data || null);
      }
    } catch {
      /* keep whatever we already showed */
    }
  }, [normalizedPhone, fetchRecord]);

  useEffect(() => {
    setRecord(null);
    load();
  }, [load]);

  // Detect the extension: ping, wait for its "ready" reply. (admin card only)
  useEffect(() => {
    if (readOnly) return undefined;
    const onReady = () => {
      setExtReady(true);
      setExtChecked(true);
    };
    window.addEventListener("erp:bosta-extension-ready", onReady);
    window.dispatchEvent(new CustomEvent("erp:bosta-extension-ping"));
    const grace = setTimeout(() => setExtChecked(true), 2000);
    return () => {
      window.removeEventListener("erp:bosta-extension-ready", onReady);
      clearTimeout(grace);
    };
  }, [readOnly]);

  // Results from the extension (via content-erp.js). (admin card only)
  useEffect(() => {
    if (readOnly) return undefined;
    const onResult = (ev) => {
      if (!pendingRef.current) return;
      pendingRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setLoading(false);
      const d = ev?.detail || {};
      if (d.ok) {
        if (d.record) setRecord(d.record);
        else load();
      } else {
        if (d.record) setRecord(d.record); // data arrived; only the save failed
        toast.error(t(`orders.bostaConsignee.${errorKeyFor(d.error)}`));
      }
    };
    window.addEventListener("erp:bosta-consignee-result", onResult);
    return () => window.removeEventListener("erp:bosta-consignee-result", onResult);
  }, [t, load, readOnly]);

  const refresh = useCallback(() => {
    if (!normalizedPhone || loading) return;
    pendingRef.current = true;
    setLoading(true);
    window.dispatchEvent(new CustomEvent("erp:bosta-consignee-fetch", { detail: { phone: normalizedPhone } }));
    timeoutRef.current = setTimeout(() => {
      if (!pendingRef.current) return;
      pendingRef.current = false;
      setLoading(false);
      toast.error(t("orders.bostaConsignee.noExtension"));
    }, 9000);
  }, [normalizedPhone, loading, t]);

  useEffect(() => () => timeoutRef.current && clearTimeout(timeoutRef.current), []);

  if (!normalizedPhone) return null;

  const successRate = record?.success_rate;
  const lowSuccess = successRate != null && Number(successRate) < 70;
  const highReturns = Boolean(record?.high_unpaid_returns);
  const rateTone = successRate == null ? "" : lowSuccess ? "text-rose-300" : "text-emerald-300";

  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-black text-zinc-100">{t("orders.bostaConsignee.title")}</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">{t("orders.bostaConsignee.hint")}</div>
        </div>
        {readOnly ? null : (
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black text-zinc-100 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {loading ? t("orders.bostaConsignee.refreshing") : t("orders.bostaConsignee.refresh")}
          </button>
        )}
      </div>

      {record ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={record.delivered} label={t("orders.bostaConsignee.delivered")} tone="text-emerald-300" />
            <Stat value={record.returned} label={t("orders.bostaConsignee.returned")} tone="text-rose-300" />
            <Stat value={successRate == null ? null : `${successRate}%`} label={t("orders.bostaConsignee.successRate")} tone={rateTone} />
            <Stat value={record.consecutive_returned} label={t("orders.bostaConsignee.consecutive")} />
          </div>

          {highReturns || lowSuccess ? (
            <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] font-bold text-amber-100">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{t(highReturns ? "orders.bostaConsignee.highReturns" : "orders.bostaConsignee.lowSuccess")}</span>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
            {record.synced_at ? <span>{t("orders.bostaConsignee.syncedAt", { when: formatDateTime(record.synced_at) })}</span> : null}
            {record.synced_by ? <span>{t("orders.bostaConsignee.syncedBy", { name: record.synced_by })}</span> : null}
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
          <PackageCheck className="h-4 w-4 opacity-60" />
          <span>{t(readOnly ? "orders.bostaConsignee.neverReadonly" : "orders.bostaConsignee.never")}</span>
        </div>
      )}

      {!readOnly && extChecked && !extReady ? (
        <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-[10px] text-zinc-400">
          <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
          <span>{t("orders.bostaConsignee.noExtension")}</span>
        </div>
      ) : null}
    </div>
  );
}

export default BostaConsigneeHistoryCard;
