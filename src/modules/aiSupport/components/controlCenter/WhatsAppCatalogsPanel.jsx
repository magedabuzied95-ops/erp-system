// WhatsApp catalogues — inbox top bar → WhatsApp → Catalogs.
//
// The catalogues the shop sells from on WhatsApp: the one in Settings (storefront.facebook_catalog_id)
// plus whatever Meta has linked to the official number. "Sync from Meta" re-reads names, product
// counts and the feed's last upload; the two switches are the number's own commerce settings.
// Products reach the catalogue through the existing feed (/feeds/meta.xml) — its URL is shown so it
// can be pasted into Commerce Manager. Server: server/routes/whatsappCommerce.js.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, RefreshCw, ShoppingCart } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, CopyRow, PanelSkeleton, ToggleRow, clean, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502, 504] };

const STATUS_TONE = {
  active: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  warning: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  error: "border-rose-300/25 bg-rose-400/10 text-rose-100",
  unknown: "border-white/10 bg-white/[0.06] text-slate-300",
};

// Literal keys so a missing translation stays greppable.
const statusLabel = (t, status) => {
  if (status === "active") return t("aiSupport.waCommerce.catalogs.status.active");
  if (status === "warning") return t("aiSupport.waCommerce.catalogs.status.warning");
  if (status === "error") return t("aiSupport.waCommerce.catalogs.status.error");
  return t("aiSupport.waCommerce.catalogs.status.unknown");
};
const sourceLabel = (t, source) =>
  source === "waba" ? t("aiSupport.waCommerce.catalogs.source.waba") : t("aiSupport.waCommerce.catalogs.source.settings");

export default function WhatsAppCatalogsPanel({ headers }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ catalogs: [], numbers: [], feed_url: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const apply = (payload) => setData({
    catalogs: Array.isArray(payload?.catalogs) ? payload.catalogs : [],
    numbers: Array.isArray(payload?.numbers) ? payload.numbers : [],
    feed_url: clean(payload?.feed_url),
  });

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/whatsapp/commerce/catalogs", { headers, ...SUPPRESSED });
      if (mountedRef.current) apply(payload);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waCommerce.catalogs.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setBusy("sync");
    setNotice(null);
    try {
      const payload = await api.post("/whatsapp/commerce/catalogs/sync", {}, { headers, ...SUPPRESSED });
      if (!mountedRef.current) return;
      apply(payload);
      const notes = Array.isArray(payload?.summary?.notes) ? payload.summary.notes : [];
      setNotice({
        ok: !notes.length,
        text: [t("aiSupport.waCommerce.catalogs.synced", { count: payload?.summary?.catalogs || 0 }), ...notes].join("\n"),
      });
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waCommerce.catalogs.actionFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const toggle = async (number, field, value) => {
    setBusy(`${number.phone_number_id}:${field}`);
    setNotice(null);
    try {
      const payload = await api.post(
        "/whatsapp/commerce/catalogs/settings",
        { phone_number_id: number.phone_number_id, [field]: value },
        { headers, ...SUPPRESSED }
      );
      const settings = payload?.settings || {};
      if (!mountedRef.current) return;
      setData((current) => ({
        ...current,
        numbers: current.numbers.map((item) => (item.phone_number_id === number.phone_number_id
          ? { ...item, cart_enabled: settings.cart_enabled, catalog_visible: settings.catalog_visible, error: "" }
          : item)),
      }));
      setNotice({ ok: true, text: t("aiSupport.waCommerce.catalogs.settingsSaved") });
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waCommerce.catalogs.actionFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  if (loading) return <PanelSkeleton rows={3} />;

  const { catalogs, numbers, feed_url: feedUrl } = data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">{t("aiSupport.waCommerce.catalogs.subtitle")}</p>
        <ActionButton icon={RefreshCw} loading={busy === "sync"} onClick={sync}>{t("aiSupport.waCommerce.catalogs.sync")}</ActionButton>
      </div>

      {notice ? (
        <p className={`whitespace-pre-line rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[640px] text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.catalogs.columns.name")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.catalogs.columns.account")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.catalogs.columns.catalogId")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.catalogs.columns.status")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.catalogs.columns.products")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.catalogs.columns.lastSynced")}</th>
            </tr>
          </thead>
          <tbody>
            {catalogs.map((item) => (
              <tr key={item.catalog_id} className="border-t border-white/5 align-top text-slate-200">
                <td className="px-3 py-2.5">
                  <div dir="auto" className="font-black">{item.name || t("aiSupport.waCommerce.catalogs.unnamed")}</div>
                  {item.error ? <div dir="auto" className="mt-1 max-w-[320px] text-[11px] leading-5 text-rose-200/80">{item.error}</div> : null}
                </td>
                <td className="px-3 py-2.5">
                  {item.account_label ? <div dir="auto">{item.account_label}</div> : null}
                  <div className="text-[11px] text-slate-500">{sourceLabel(t, item.source)}</div>
                </td>
                <td className="px-3 py-2.5 text-slate-400" dir="ltr">{item.catalog_id}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${STATUS_TONE[item.status] || STATUS_TONE.unknown}`}>
                    {statusLabel(t, item.status)}
                  </span>
                  {item.last_upload_errors > 0 ? (
                    <div className="mt-1 text-[11px] text-amber-200/80">{t("aiSupport.waCommerce.catalogs.uploadErrors", { count: item.last_upload_errors })}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 font-black">{item.product_count ?? ""}</td>
                <td className="px-3 py-2.5 text-slate-400">{item.last_synced_at ? formatDateTime(item.last_synced_at) : ""}</td>
              </tr>
            ))}
            {!catalogs.length ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.waCommerce.catalogs.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <div className="text-xs font-black text-white">{t("aiSupport.waCommerce.catalogs.commerceTitle")}</div>
          {numbers.length ? numbers.map((number) => (
            <div key={number.phone_number_id} className="space-y-2">
              {numbers.length > 1 ? (
                <div dir="auto" className="text-[11px] font-black text-slate-400">{number.label || number.display_phone_number || number.phone_number_id}</div>
              ) : null}
              <ToggleRow
                icon={Eye}
                title={t("aiSupport.waCommerce.catalogs.showCatalog")}
                description={t("aiSupport.waCommerce.catalogs.showCatalogHint")}
                checked={number.catalog_visible === true}
                busy={busy === `${number.phone_number_id}:is_catalog_visible`}
                disabled={Boolean(busy)}
                onChange={(value) => toggle(number, "is_catalog_visible", value)}
              />
              <ToggleRow
                icon={ShoppingCart}
                title={t("aiSupport.waCommerce.catalogs.enableCart")}
                description={t("aiSupport.waCommerce.catalogs.enableCartHint")}
                checked={number.cart_enabled === true}
                busy={busy === `${number.phone_number_id}:is_cart_enabled`}
                disabled={Boolean(busy)}
                onChange={(value) => toggle(number, "is_cart_enabled", value)}
              />
              {number.error ? <p dir="auto" className="text-[11px] leading-5 text-amber-200/80">{number.error}</p> : null}
            </div>
          )) : (
            <p className="text-[11px] leading-5 text-slate-500">{t("aiSupport.waCommerce.catalogs.noNumber")}</p>
          )}
        </div>
        <div className="space-y-2">
          <CopyRow label={t("aiSupport.waCommerce.catalogs.feedUrl")} value={feedUrl} copyLabel={t("aiSupport.waCommerce.catalogs.copy")} />
          <p className="px-1 text-[11px] leading-5 text-slate-500">{t("aiSupport.waCommerce.catalogs.feedHint")}</p>
        </div>
      </div>
    </div>
  );
}
