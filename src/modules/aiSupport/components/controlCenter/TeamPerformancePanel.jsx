// Who answered, how fast, and how much the agent carried alone.
//
// Every figure here is attributed from message rows, so it survives a conversation going back to the
// AI — see server/services/aiInboxTeamPerformanceService.js. The response time is the wait the
// customer actually experienced before that person's first reply, not the conversation's age.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Clock, MessageSquare, Users } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSection, PanelSkeleton } from "../integrations/integrationsUi.jsx";
import { Field, SelectInput } from "./controlCenterUi.jsx";

const RANGES = [7, 30, 90];

const startOfRange = (days) => {
  const now = new Date();
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
};

// Minutes, not "0.7 hours". A number a person can act on reads in the unit they think in.
const formatDuration = (t, value) => {
  if (value === null || value === undefined) return "—";
  const total = Number(value);
  if (!Number.isFinite(total)) return "—";
  if (total < 60) return t("aiSupport.controlCenter.performance.seconds", { count: Math.round(total) });
  if (total < 3600) return t("aiSupport.controlCenter.performance.minutes", { count: Math.round(total / 60) });
  return t("aiSupport.controlCenter.performance.hours", { count: Math.round((total / 3600) * 10) / 10 });
};

function Kpi({ icon: Icon, label, value, hint = "" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1.5 text-xl font-black text-white">{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-5 text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function TeamPerformancePanel({ headers, tenantId }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get("/ai-agent/analytics/team-performance", {
        params: { tenant_id: tenantId, from: startOfRange(days) },
        headers,
      });
      setReport(payload || null);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, [days, headers, t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const staff = useMemo(() => (Array.isArray(report?.staff) ? report.staff : []), [report]);
  const totals = report?.totals || {};
  const aiShare = useMemo(() => {
    const withStaff = Number(totals.conversations_with_staff_reply) || 0;
    const withAi = Number(totals.conversations_with_ai_reply) || 0;
    if (!withAi && !withStaff) return null;
    // Conversations the agent answered and no person had to touch.
    return Math.round(((withAi - Math.min(withAi, withStaff)) / Math.max(1, withAi)) * 100);
  }, [totals]);

  return (
    <div className="space-y-4">
      <PanelSection
        icon={BarChart3}
        title={t("aiSupport.controlCenter.performance.title")}
        subtitle={t("aiSupport.controlCenter.performance.subtitle")}
        action={<ActionButton tone="ghost" loading={loading} onClick={load}>{t("aiSupport.integrations.common.refresh")}</ActionButton>}
      >
        <div className="grid gap-4">
          <Field label={t("aiSupport.controlCenter.performance.range")}>
            <SelectInput value={String(days)} onChange={(event) => setDays(Number(event.target.value))}>
              {RANGES.map((value) => (
                <option key={value} value={String(value)}>{t("aiSupport.controlCenter.performance.lastDays", { count: value })}</option>
              ))}
            </SelectInput>
          </Field>

          {loading ? (
            <PanelSkeleton rows={3} />
          ) : error ? (
            <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs font-bold text-rose-100">{error}</div>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi icon={Users} label={t("aiSupport.controlCenter.performance.staffCount")} value={totals.staff_count ?? 0} />
                <Kpi icon={MessageSquare} label={t("aiSupport.controlCenter.performance.handled")} value={totals.conversations_handled ?? 0} />
                <Kpi
                  icon={Clock}
                  label={t("aiSupport.controlCenter.performance.avgFirstResponse")}
                  value={formatDuration(t, totals.avg_first_response_seconds)}
                  hint={t("aiSupport.controlCenter.performance.avgFirstResponseHint")}
                />
                <Kpi
                  icon={BarChart3}
                  label={t("aiSupport.controlCenter.performance.aiShare")}
                  value={aiShare === null ? "—" : `${aiShare}%`}
                  hint={t("aiSupport.controlCenter.performance.aiShareHint")}
                />
              </div>

              {staff.length ? (
                <div className="overflow-x-auto rounded-2xl border border-white/10">
                  <table className="w-full min-w-[620px] border-collapse text-start text-xs">
                    <thead>
                      <tr className="bg-white/[0.04] text-[11px] font-black uppercase tracking-[0.1em] text-slate-400">
                        <th className="px-3 py-2.5 text-start">{t("aiSupport.controlCenter.performance.staff")}</th>
                        <th className="px-3 py-2.5 text-start">{t("aiSupport.controlCenter.performance.handled")}</th>
                        <th className="px-3 py-2.5 text-start">{t("aiSupport.controlCenter.performance.replies")}</th>
                        <th className="px-3 py-2.5 text-start">{t("aiSupport.controlCenter.performance.median")}</th>
                        <th className="px-3 py-2.5 text-start">{t("aiSupport.controlCenter.performance.slowest")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staff.map((row) => (
                        <tr key={row.staff_user_id} className="border-t border-white/[0.06]">
                          <td className="px-3 py-2.5 font-black text-white">
                            <span dir="auto">{row.staff_user_name || `#${row.staff_user_id}`}</span>
                            {row.excluded_conversations > 0 ? (
                              <span className="mt-0.5 block text-[10px] font-bold text-amber-200/70">
                                {t("aiSupport.controlCenter.performance.excluded", { count: row.excluded_conversations })}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 font-bold text-slate-200">{row.conversations_handled}</td>
                          <td className="px-3 py-2.5 font-bold text-slate-200">{row.replies_sent}</td>
                          <td className="px-3 py-2.5 font-bold text-slate-200">{formatDuration(t, row.median_first_response_seconds)}</td>
                          <td className="px-3 py-2.5 font-bold text-slate-200">{formatDuration(t, row.slowest_first_response_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">
                  {t("aiSupport.controlCenter.performance.empty")}
                </div>
              )}

              <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-5 text-slate-500">
                {t("aiSupport.controlCenter.performance.note")}
              </p>
            </>
          )}
        </div>
      </PanelSection>
    </div>
  );
}
