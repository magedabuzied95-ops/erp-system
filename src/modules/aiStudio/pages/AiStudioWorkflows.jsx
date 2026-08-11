import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Workflow, Play, Loader2, RefreshCw, Plus, CheckCircle2, XCircle, Pencil, LayoutTemplate, Archive, ArchiveRestore, Zap, Power, Clock } from "lucide-react";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import {
  listWorkflows, listWorkflowsWithArchived, runWorkflow, setWorkflowEnabled, seedExampleWorkflow, createWorkflow,
  getAutomationStatus, setTenantAutomation, archiveWorkflow, unarchiveWorkflow, setAutomationTimezone,
} from "../services/aiStudioApi";
import { blankDefinition } from "../lib/workflowGraph";

const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");
const statusTone = (s) =>
  s === "completed" ? "text-emerald-200" : s === "failed" || s === "rejected" ? "text-rose-200" : s === "awaiting_approval" ? "text-amber-200" : "text-slate-300";

const TRIGGER_LABEL = {
  manual: "Manual", "followup.due": "Follow-up Due", "inventory.restocked": "Inventory Restocked",
  "schedule.interval": "Scheduled", "channel.message_received": "Channel",
};
const triggerLabel = (t) => TRIGGER_LABEL[t] || t || "Manual";

export default function AiStudioWorkflows() {
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
    try { await setWorkflowEnabled(id, enabled, headers); await load(); } catch (e) { setMsg(e?.message || "Failed"); }
    setBusy("");
  };
  const doArchive = async (id, archived) => {
    if (!archived && !window.confirm("Archive this workflow? It will stop running and be hidden from the default list (history is kept).")) return;
    setBusy(`a-${id}`); setMsg("");
    try { archived ? await unarchiveWorkflow(id, headers) : await archiveWorkflow(id, headers); await load(); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || "Failed"); }
    setBusy("");
  };
  const doTenantAutomation = async (enabled) => {
    setBusy("auto"); setMsg("");
    try { await setTenantAutomation(enabled, headers); const a = await getAutomationStatus(headers); setAutomation(a); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || "Failed"); }
    setBusy("");
  };
  const doSetTimezone = async () => {
    const tz = window.prompt("Automation timezone — enter an IANA name (e.g. Africa/Cairo, America/New_York). Scheduled workflows run at this local time.", automation?.timezone || "Africa/Cairo");
    if (!tz) return;
    setBusy("tz"); setMsg("");
    try { const r = await setAutomationTimezone(tz.trim(), headers); if (r?.success === false) setMsg(r?.message || "Invalid timezone"); else { const a = await getAutomationStatus(headers); setAutomation(a); } }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || "Invalid timezone"); }
    setBusy("");
  };
  const doNewBlank = async () => {
    setBusy("new"); setMsg("");
    try {
      const res = await createWorkflow({ name: "Untitled workflow", description: "", triggerType: "manual", definition: blankDefinition(), enabled: false }, headers);
      const wid = res?.workflow?.id;
      if (wid) navigate(`/ai-studio/workflows/${wid}/edit`); else await load();
    } catch (e) { setMsg(e?.responseBody?.message || e?.message || "Failed"); }
    setBusy("");
  };
  const doNewTemplate = async () => {
    setBusy("tpl"); setMsg("");
    try { const res = await seedExampleWorkflow(headers); const wid = res?.workflow?.id; if (wid) navigate(`/ai-studio/workflows/${wid}/edit`); else await load(); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || "Failed"); }
    setBusy("");
  };

  return (
    <div dir="ltr" className="space-y-4 p-4 text-white md:p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100"><Workflow className="h-4 w-4" />AI Studio</div>
            <h1 className="mt-1 text-xl font-black">Workflows</h1>
            <p className="mt-1 text-sm text-slate-400">Design workflows in the visual builder, run them manually, or let ERP events trigger them automatically.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={doNewTemplate} disabled={busy === "tpl"} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20 disabled:opacity-50">
              {busy === "tpl" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayoutTemplate className="h-3.5 w-3.5" />}From template
            </button>
            <button type="button" onClick={doNewBlank} disabled={busy === "new"} className="inline-flex h-9 items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-300/15 px-3 text-[11px] font-black text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-50">
              {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}New workflow
            </button>
            <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20">
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </button>
          </div>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {/* Automation status + tenant kill switch */}
      {automation ? (
        <section className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${automation.active ? "border-emerald-300/30 bg-emerald-400/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${automation.active ? "bg-emerald-400/15 text-emerald-100" : "bg-slate-500/15 text-slate-300"}`}>
            <Zap className="h-3.5 w-3.5" /> Automation {automation.active ? "ON" : "OFF"}
          </span>
          <div className="min-w-0 flex-1 text-[11px] text-slate-400">
            {automation.active
              ? <>Automatic triggers are live for this store. {automation.active_auto_workflows} automatic workflow(s) active.</>
              : <>{(automation.reasons || []).join(" ") || "Automatic triggers are off."}</>}
            <span className="ml-1 text-slate-600">Global: {automation.global_enabled ? "on" : "off"} · Tenant: {automation.tenant_enabled ? "on" : "off"}</span>
            <button type="button" onClick={doSetTimezone} disabled={busy === "tz"} className="ml-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:border-white/20 disabled:opacity-50" title="Change automation timezone (scheduled workflows run at this local time)">
              <Clock className="h-3 w-3" />{automation.timezone || "Africa/Cairo"}
            </button>
          </div>
          <button type="button" onClick={() => doTenantAutomation(!automation.tenant_enabled)} disabled={busy === "auto" || !automation.global_enabled}
            title={!automation.global_enabled ? "Global automation is disabled on the server" : "Toggle automation for this store"}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black disabled:opacity-40 ${automation.tenant_enabled ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>
            {busy === "auto" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}Tenant automation {automation.tenant_enabled ? "on" : "off"}
          </button>
        </section>
      ) : null}

      {msg ? <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[12px] font-bold text-cyan-100">{msg}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11px]">
          <span className="font-black uppercase tracking-wide text-slate-500">{rows.length} workflow{rows.length === 1 ? "" : "s"}</span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-slate-400">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-cyan-400" />Show archived
          </label>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No workflows yet. Use “New workflow” for a blank canvas, or “From template” for a safe read-only example.</div>
        ) : (
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact w-full text-left text-sm">
              <thead className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3">Name</th><th className="px-4 py-3">Trigger</th><th className="px-4 py-3">Last run</th><th className="px-4 py-3">Last auto</th><th className="px-4 py-3">Enabled</th><th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => {
                  const archived = Boolean(w.archived_at);
                  const auto = w.trigger_type && w.trigger_type !== "manual";
                  return (
                    <tr key={w.id} className={`border-b border-white/5 ${archived ? "opacity-55" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-black text-white">{w.name}{archived ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-400">Archived</span> : null}</div>
                        <div className="text-[11px] text-slate-500">v{w.version} · {w.description}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${auto ? "bg-violet-300/15 text-violet-100" : "bg-slate-500/15 text-slate-300"}`}>
                          {auto ? <Zap className="h-3 w-3" /> : null}{triggerLabel(w.trigger_type)}
                        </span>
                        <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">{auto ? "Automatic" : "Manual"}</div>
                      </td>
                      <td className="px-4 py-3"><span className={`font-black ${statusTone(w.last_run_status)}`}>{w.last_run_status || "—"}</span><div className="text-[11px] text-slate-500">{fmt(w.last_run_at)}</div></td>
                      <td className="px-4 py-3">{w.last_auto_run_at ? <><span className={`font-black ${statusTone(w.last_auto_run_status)}`}>{w.last_auto_run_status}</span><div className="text-[11px] text-slate-500">{fmt(w.last_auto_run_at)}</div></> : <span className="text-slate-600">—</span>}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => doToggle(w.id, !w.enabled)} disabled={busy === `t-${w.id}` || archived} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black disabled:opacity-40 ${w.enabled ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>
                          {w.enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{w.enabled ? "Enabled" : "Disabled"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          {!archived ? (
                            <>
                              <button type="button" onClick={() => navigate(`/ai-studio/workflows/${w.id}/edit`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-white hover:border-white/20"><Pencil className="h-3.5 w-3.5" />Edit</button>
                              <button type="button" onClick={() => doRun(w.id)} disabled={busy === `run-${w.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-50">
                                {busy === `run-${w.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Run
                              </button>
                              <button type="button" onClick={() => doArchive(w.id, false)} disabled={busy === `a-${w.id}`} title="Archive" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300 hover:text-white disabled:opacity-50"><Archive className="h-3.5 w-3.5" /></button>
                            </>
                          ) : (
                            <button type="button" onClick={() => doArchive(w.id, true)} disabled={busy === `a-${w.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-slate-200 hover:border-white/20 disabled:opacity-50"><ArchiveRestore className="h-3.5 w-3.5" />Restore</button>
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
