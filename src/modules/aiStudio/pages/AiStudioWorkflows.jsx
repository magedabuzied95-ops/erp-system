import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Workflow, Play, Loader2, RefreshCw, Plus, CheckCircle2, XCircle, Pencil, LayoutTemplate, Archive, ArchiveRestore, Zap, Power, Clock } from "lucide-react";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import {
  listWorkflows, listWorkflowsWithArchived, runWorkflow, setWorkflowEnabled, seedExampleWorkflow, createWorkflow,
  getAutomationStatus, setTenantAutomation, archiveWorkflow, unarchiveWorkflow, setAutomationTimezone,
} from "../services/aiStudioApi";
import { blankDefinition } from "../lib/workflowGraph";

import i18n from "../../../i18n/i18n";
import "../../../theme/ai-surface.css";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);

/* Keys are the RAW trigger ids / status enums; only the values are display. */
const TRIGGER_KEY = {
  manual: "aiStudio.pages.triggers.manual",
  "followup.due": "aiStudio.pages.triggers.followupDue",
  "inventory.restocked": "aiStudio.pages.triggers.inventoryRestocked",
  "schedule.interval": "aiStudio.pages.triggers.scheduleInterval",
  "channel.message_received": "aiStudio.pages.triggers.channelMessage",
};
const triggerLabel = (t) => (TRIGGER_KEY[t] ? tt(TRIGGER_KEY[t]) : t || tt("aiStudio.pages.triggers.manual"));
/* Literal keys only: a lookup table keeps these verifiable by the
   missing-key guard, unlike a template-literal key built from a value. */
const STATUS_KEY = {
  completed: "aiStudio.pages.status.completed",
  failed: "aiStudio.pages.status.failed",
  running: "aiStudio.pages.status.running",
  awaiting_approval: "aiStudio.pages.status.awaiting_approval",
  rejected: "aiStudio.pages.status.rejected",
  pending: "aiStudio.pages.status.pending",
  approved: "aiStudio.pages.status.approved",
  ok: "aiStudio.pages.status.ok",
  skipped: "aiStudio.pages.status.skipped",
};
/** Display only; an unknown status still falls back to the raw value. */
const statusLabel = (s) => (s ? (STATUS_KEY[s] ? i18n.t(STATUS_KEY[s], { defaultValue: s }) : s) : "—");

const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");
const statusTone = (s) =>
  s === "completed" ? "text-emerald-200" : s === "failed" || s === "rejected" ? "text-rose-200" : s === "awaiting_approval" ? "text-amber-200" : "text-slate-300";


export default function AiStudioWorkflows() {
  const { t } = useTranslation();
  const { headers } = useStudioHeaders();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [automation, setAutomation] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wf, auto] = await Promise.all([
        showArchived ? listWorkflowsWithArchived(headers) : listWorkflows(headers),
        getAutomationStatus(headers).catch(() => null),
      ]);
      setRows(Array.isArray(wf?.workflows) ? wf.workflows : []);
      if (auto?.success !== false && auto) setAutomation(auto);
    } catch { setRows([]); }
    setLoading(false);
  }, [headers, showArchived]);

  useEffect(() => { void load(); }, [load]);

  const doRun = async (id) => {
    setBusy(`run-${id}`); setMsg("");
    try { const res = await runWorkflow(id, {}, headers); setMsg(`Run ${res?.run?.id || ""} → ${res?.result?.status || "started"}`); await load(); }
    catch (e) { setMsg(e?.message || "Run failed"); }
    setBusy("");
  };
  const doToggle = async (id, enabled) => {
    setBusy(`t-${id}`);
    try { await setWorkflowEnabled(id, enabled, headers); await load(); } catch (e) { setMsg(e?.message || t("aiStudio.pages.failed")); }
    setBusy("");
  };
  const doArchive = async (id, archived) => {
    if (!archived && !window.confirm(t("aiStudio.pages.workflows.confirmArchive"))) return;
    setBusy(`a-${id}`); setMsg("");
    try { archived ? await unarchiveWorkflow(id, headers) : await archiveWorkflow(id, headers); await load(); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.pages.failed")); }
    setBusy("");
  };
  const doTenantAutomation = async (enabled) => {
    setBusy("auto"); setMsg("");
    try { await setTenantAutomation(enabled, headers); const a = await getAutomationStatus(headers); setAutomation(a); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.pages.failed")); }
    setBusy("");
  };
  const doSetTimezone = async () => {
    const tz = window.prompt(t("aiStudio.pages.workflows.timezonePrompt"), automation?.timezone || "Africa/Cairo");
    if (!tz) return;
    setBusy("tz"); setMsg("");
    try { const r = await setAutomationTimezone(tz.trim(), headers); if (r?.success === false) setMsg(r?.message || t("aiStudio.pages.workflows.invalidTimezone")); else { const a = await getAutomationStatus(headers); setAutomation(a); } }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.pages.workflows.invalidTimezone")); }
    setBusy("");
  };
  const doNewBlank = async () => {
    setBusy("new"); setMsg("");
    try {
      const res = await createWorkflow({ name: "Untitled workflow", description: "", triggerType: "manual", definition: blankDefinition(), enabled: false }, headers);
      const wid = res?.workflow?.id;
      if (wid) navigate(`/ai-studio/workflows/${wid}/edit`); else await load();
    } catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.pages.failed")); }
    setBusy("");
  };
  const doNewTemplate = async () => {
    setBusy("tpl"); setMsg("");
    try { const res = await seedExampleWorkflow(headers); const wid = res?.workflow?.id; if (wid) navigate(`/ai-studio/workflows/${wid}/edit`); else await load(); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.pages.failed")); }
    setBusy("");
  };

  return (
    <div dir="ltr" className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary"><Workflow className="h-4 w-4" />{t("aiStudio.pages.eyebrow")}</div>
            <h1 className="m1-page-title mt-1">{t("aiStudio.pages.workflows.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("aiStudio.pages.workflows.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={doNewTemplate} disabled={busy === "tpl"} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20 disabled:opacity-50">
              {busy === "tpl" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayoutTemplate className="h-3.5 w-3.5" />}{t("aiStudio.pages.workflows.fromTemplate")}
            </button>
            <button type="button" onClick={doNewBlank} disabled={busy === "new"} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-3 text-[11px] font-black text-primary hover:bg-primary/25 disabled:opacity-50">
              {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{t("aiStudio.pages.workflows.newWorkflow")}
            </button>
            <button type="button" onClick={() => void load()} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20">
              <RefreshCw className="h-3.5 w-3.5" />{t("aiStudio.pages.refresh")}
            </button>
          </div>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {/* Automation status + tenant kill switch */}
      {automation ? (
        <section className={`flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3 ${automation.active ? "border-emerald-300/30 bg-emerald-400/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${automation.active ? "bg-emerald-400/15 text-emerald-100" : "bg-slate-500/15 text-slate-300"}`}>
            <Zap className="h-3.5 w-3.5" /> {t("aiStudio.pages.workflows.automation")} {automation.active ? t("aiStudio.pages.workflows.on") : t("aiStudio.pages.workflows.off")}
          </span>
          <div className="min-w-0 flex-1 text-[11px] text-slate-400">
            {automation.active
              ? <>{t("aiStudio.pages.workflows.automationLive", { count: automation.active_auto_workflows })}</>
              : <>{(automation.reasons || []).join(" ") || t("aiStudio.pages.workflows.automationOff")}</>}
            <span className="ml-1 text-slate-600">{t("aiStudio.pages.workflows.globalTenant", { global: automation.global_enabled ? t("aiStudio.pages.workflows.on_") : t("aiStudio.pages.workflows.off_"), tenant: automation.tenant_enabled ? t("aiStudio.pages.workflows.on_") : t("aiStudio.pages.workflows.off_") })}</span>
            <button type="button" onClick={doSetTimezone} disabled={busy === "tz"} className="ml-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:border-white/20 disabled:opacity-50" title={t("aiStudio.pages.workflows.timezoneTitle")}>
              <Clock className="h-3 w-3" />{automation.timezone || "Africa/Cairo"}
            </button>
          </div>
          <button type="button" onClick={() => doTenantAutomation(!automation.tenant_enabled)} disabled={busy === "auto" || !automation.global_enabled}
            title={!automation.global_enabled ? t("aiStudio.pages.workflows.globalDisabled") : t("aiStudio.pages.workflows.toggleTenant")}
            className={`inline-flex h-[var(--control-height-md)] items-center gap-1.5 rounded-full border px-3 text-[11px] font-black disabled:opacity-40 ${automation.tenant_enabled ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>
            {busy === "auto" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}Tenant automation {automation.tenant_enabled ? "on" : "off"}
          </button>
        </section>
      ) : null}

      {msg ? <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-[12px] font-bold text-primary">{msg}</div> : null}

      <section className="overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11px]">
          <span className="font-black uppercase tracking-wide text-slate-500">{t("aiStudio.pages.workflows.count", { count: rows.length })}</span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-slate-400">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-primary" />{t("aiStudio.pages.workflows.showArchived")}
          </label>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("aiStudio.pages.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">{t("aiStudio.pages.workflows.empty")}</div>
        ) : (
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact w-full text-left text-sm">
              <thead className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3">{t("aiStudio.pages.workflows.columns.name")}</th><th className="px-4 py-3">{t("aiStudio.pages.workflows.columns.trigger")}</th><th className="px-4 py-3">{t("aiStudio.pages.workflows.columns.lastRun")}</th><th className="px-4 py-3">{t("aiStudio.pages.workflows.columns.lastAuto")}</th><th className="px-4 py-3">{t("aiStudio.pages.workflows.columns.enabled")}</th><th className="px-4 py-3 text-right">{t("aiStudio.pages.workflows.columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => {
                  const archived = Boolean(w.archived_at);
                  const auto = w.trigger_type && w.trigger_type !== "manual";
                  return (
                    <tr key={w.id} className={`border-b border-white/5 ${archived ? "opacity-55" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-black text-white">{w.name}{archived ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-400">{t("aiStudio.pages.workflows.archived")}</span> : null}</div>
                        <div className="text-[11px] text-slate-500">v{w.version} · {w.description}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${auto ? "bg-violet-300/15 text-violet-100" : "bg-slate-500/15 text-slate-300"}`}>
                          {auto ? <Zap className="h-3 w-3" /> : null}{triggerLabel(w.trigger_type)}
                        </span>
                        <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">{auto ? t("aiStudio.pages.workflows.automatic") : t("aiStudio.pages.workflows.manual")}</div>
                      </td>
                      <td className="px-4 py-3"><span className={`font-black ${statusTone(w.last_run_status)}`}>{statusLabel(w.last_run_status)}</span><div className="text-[11px] text-slate-500">{fmt(w.last_run_at)}</div></td>
                      <td className="px-4 py-3">{w.last_auto_run_at ? <><span className={`font-black ${statusTone(w.last_auto_run_status)}`}>{statusLabel(w.last_auto_run_status)}</span><div className="text-[11px] text-slate-500">{fmt(w.last_auto_run_at)}</div></> : <span className="text-slate-600">—</span>}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => doToggle(w.id, !w.enabled)} disabled={busy === `t-${w.id}` || archived} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black disabled:opacity-40 ${w.enabled ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>
                          {w.enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{w.enabled ? t("aiStudio.pages.workflows.enabled") : t("aiStudio.pages.workflows.disabled")}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          {!archived ? (
                            <>
                              <button type="button" onClick={() => navigate(`/ai-studio/workflows/${w.id}/edit`)} className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-white hover:border-white/20"><Pencil className="h-3.5 w-3.5" />{t("aiStudio.pages.workflows.edit")}</button>
                              <button type="button" onClick={() => doRun(w.id)} disabled={busy === `run-${w.id}`} className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 px-3 text-[11px] font-black text-primary hover:bg-primary/20 disabled:opacity-50">
                                {busy === `run-${w.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{t("aiStudio.pages.workflows.run")}
                              </button>
                              <button type="button" onClick={() => doArchive(w.id, false)} disabled={busy === `a-${w.id}`} title={t("aiStudio.pages.workflows.archive")} className="inline-flex h-[var(--control-height-sm)] w-8 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-white/[0.05] text-slate-300 hover:text-white disabled:opacity-50"><Archive className="h-3.5 w-3.5" /></button>
                            </>
                          ) : (
                            <button type="button" onClick={() => doArchive(w.id, true)} disabled={busy === `a-${w.id}`} className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-slate-200 hover:border-white/20 disabled:opacity-50"><ArchiveRestore className="h-3.5 w-3.5" />{t("aiStudio.pages.workflows.restore")}</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
