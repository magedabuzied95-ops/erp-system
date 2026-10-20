// WhatsApp chatbot flows — inbox top bar → WhatsApp → Chatbot Flows.
//
// The list (Build · Name · Status) and the "+ New flow" form live here; "Build" opens the visual
// builder (whatsappFlows/FlowBuilder.jsx) as a full-screen overlay. A flow answers customers on the
// official (Cloud API) numbers once it is published and active; the runtime is
// server/modules/whatsappOfficial/flows/flowInbound.js.
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Search, Trash2, Workflow } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSkeleton, formatDateTime } from "../integrations/integrationsUi.jsx";
import { STATUS_TONE, statusLabel } from "./whatsappFlows/flowLabels.js";

const FlowBuilder = lazy(() => import("./whatsappFlows/FlowBuilder.jsx"));

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 422, 500, 502] };

export default function WhatsAppFlowsPanel({ headers }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [flows, setFlows] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [openId, setOpenId] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/whatsapp-official/flows", { headers, ...SUPPRESSED });
      if (mountedRef.current) setFlows(Array.isArray(payload?.flows) ? payload.flows : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("waOfficialFlows.list.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const create = async (event) => {
    event?.preventDefault();
    setBusy("create");
    setNotice(null);
    try {
      const payload = await api.post("/whatsapp-official/flows", { name: newName.trim() || t("waOfficialFlows.list.defaultName") }, { headers, ...SUPPRESSED });
      if (!mountedRef.current) return;
      setCreating(false);
      setNewName("");
      await load();
      if (payload?.flow?.id) setOpenId(payload.flow.id);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("waOfficialFlows.list.actionFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const remove = async (flow) => {
    if (!window.confirm(t("waOfficialFlows.list.deleteConfirm", { name: flow.name }))) return;
    setBusy(`delete:${flow.id}`);
    setNotice(null);
    try {
      await api.delete(`/whatsapp-official/flows/${flow.id}`, { headers, ...SUPPRESSED });
      if (mountedRef.current) setFlows((current) => current.filter((item) => item.id !== flow.id));
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("waOfficialFlows.list.actionFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  if (loading) return <PanelSkeleton rows={3} />;

  const needle = query.trim().toLowerCase();
  const visible = flows.filter((flow) => (!needle || String(flow.name || "").toLowerCase().includes(needle)) && (!statusFilter || flow.status === statusFilter));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs leading-5 text-slate-400">{t("waOfficialFlows.list.subtitle")}</p>
        <ActionButton tone="primary" icon={Plus} onClick={() => setCreating((value) => !value)}>{t("waOfficialFlows.list.new")}</ActionButton>
      </div>

      {creating ? (
        <form onSubmit={create} className="flex flex-wrap items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.05] p-3">
          <input
            dir="auto"
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t("waOfficialFlows.list.namePlaceholder")}
            maxLength={120}
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
          />
          <ActionButton tone="primary" type="submit" loading={busy === "create"}>{t("waOfficialFlows.list.create")}</ActionButton>
          <ActionButton onClick={() => { setCreating(false); setNewName(""); }}>{t("waOfficialFlows.list.cancel")}</ActionButton>
        </form>
      ) : null}

      {notice ? (
        <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>{notice.text}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("waOfficialFlows.list.search")}
            className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 ps-9 pe-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
          />
        </label>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {["", "draft", "active", "inactive"].map((value) => (
            <button
              key={value || "all"}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`h-8 rounded-lg px-3 text-[11px] font-black transition ${statusFilter === value ? "bg-cyan-400/15 text-cyan-100" : "text-slate-400 hover:text-white"}`}
            >
              {value ? statusLabel(t, value) : t("waOfficialFlows.list.all")}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[620px] text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="w-28 px-3 py-2 text-start">{t("waOfficialFlows.list.columns.build")}</th>
              <th className="px-3 py-2 text-start">{t("waOfficialFlows.list.columns.name")}</th>
              <th className="px-3 py-2 text-start">{t("waOfficialFlows.list.columns.status")}</th>
              <th className="px-3 py-2 text-start">{t("waOfficialFlows.list.columns.updated")}</th>
              <th className="w-12 px-3 py-2" aria-label={t("waOfficialFlows.list.delete")} />
            </tr>
          </thead>
          <tbody>
            {visible.map((flow) => (
              <tr key={flow.id} className="border-t border-white/5 align-middle text-slate-200">
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpenId(flow.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-2.5 text-[11px] font-black text-cyan-100 hover:bg-cyan-400/20"
                  >
                    <Workflow className="h-3.5 w-3.5" aria-hidden="true" />{t("waOfficialFlows.list.build")}
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <div dir="auto" className="font-black">{flow.name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {t("waOfficialFlows.list.nodes", { count: flow.node_count || 0 })}
                    {flow.version ? ` · v${flow.version}` : ""}
                    {flow.has_unpublished && flow.node_count ? ` · ${t("waOfficialFlows.builder.unpublished")}` : ""}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${STATUS_TONE[flow.status] || STATUS_TONE.draft}`}>{statusLabel(t, flow.status)}</span>
                </td>
                <td className="px-3 py-2.5 text-slate-400">{formatDateTime(flow.updated_at)}</td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => remove(flow)}
                    disabled={Boolean(busy)}
                    title={t("waOfficialFlows.list.delete")}
                    aria-label={t("waOfficialFlows.list.delete")}
                    className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                  >
                    {busy === `delete:${flow.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                </td>
              </tr>
            ))}
            {!visible.length ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">{flows.length ? t("waOfficialFlows.list.noMatch") : t("waOfficialFlows.list.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {openId ? (
        <Suspense fallback={<div className="fixed inset-0 z-[320] grid place-items-center bg-[#0b1120]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" /></div>}>
          <FlowBuilder flowId={openId} headers={headers} onClose={() => { setOpenId(null); void load(); }} onChanged={load} />
        </Suspense>
      ) : null}
    </div>
  );
}
