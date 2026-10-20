// The Analytics tab of one WhatsApp template: the same KPI / trend / button clicks / cost blocks as
// the Template Analytics page, narrowed to this template, with "Refresh analytics" pulling from Meta.
// Server: GET/POST /api/whatsapp-official/analytics/templates/:id and /sync.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";

import { api } from "../../../../../shared/api/api";
import { ActionButton, PanelSkeleton, formatDateTime } from "../../integrations/integrationsUi.jsx";
import { SyncErrorBanner, TemplateStatsBlock } from "./AnalyticsBlocks.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502, 504] };

export default function TemplateAnalyticsView({ headers, templateId }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    try {
      const payload = await api.get(`/whatsapp-official/analytics/templates/${encodeURIComponent(templateId)}`, { headers, ...SUPPRESSED });
      if (mountedRef.current) { setData(payload); setFailure(""); }
    } catch (error) {
      if (mountedRef.current) setFailure(error?.message || t("waOfficialAnalytics.loadFailed"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, t, templateId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setBusy("sync");
    try {
      const payload = await api.post("/whatsapp-official/analytics/sync", { template_id: String(templateId) }, { headers, ...SUPPRESSED });
      if (mountedRef.current) { setData(payload); setFailure(""); }
    } catch (error) {
      if (mountedRef.current) setFailure(error?.message || t("waOfficialAnalytics.syncFailed"));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const enable = async () => {
    setBusy("enable");
    try {
      await api.post("/whatsapp-official/analytics/enable", {}, { headers, ...SUPPRESSED });
      await refresh();
    } catch (error) {
      if (mountedRef.current) setFailure(error?.message || t("waOfficialAnalytics.enableFailed"));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  if (loading && !data) return <PanelSkeleton rows={2} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {t("waOfficialAnalytics.tab.range", { from: data?.range?.from || "—", to: data?.range?.to || "—" })}
          {" · "}
          {t("waOfficialAnalytics.lastSynced")}: {formatDateTime(data?.sync?.last_synced_at)}
        </p>
        <ActionButton icon={BarChart3} loading={busy === "sync"} onClick={refresh}>{t("waOfficialAnalytics.tab.refresh")}</ActionButton>
      </div>
      {failure ? <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{failure}</p> : null}
      <SyncErrorBanner error={data?.sync?.error} analyticsDisabled={data?.sync?.analytics_disabled} onEnable={enable} enabling={busy === "enable"} />
      <TemplateStatsBlock data={data} />
    </div>
  );
}
