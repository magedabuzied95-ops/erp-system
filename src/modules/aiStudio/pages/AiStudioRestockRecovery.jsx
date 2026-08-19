import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { PackageCheck, Loader2, RefreshCw, Plus, ShieldAlert, CheckCircle2, ExternalLink, Users, Tag, Ban, Check, Send, MessageSquare, Pencil, CheckCheck, Eye, AlertTriangle } from "lucide-react";
import AiStudioNav from "../components/AiStudioNav";
import i18n from "../../../i18n/i18n";
import { useStudioHeaders } from "../lib/studioRequest";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);
import {
  getRestockRecovery, seedRestockRecoveryTemplate, getRestockIntents, cancelRestockIntent, fulfilRestockIntent,
  getRestockNotifications, setRestockMessagingMode, editRestockNotification, rejectRestockNotification, approveSendRestockNotification,
} from "../services/aiStudioApi";
import "../../../theme/ai-surface.css";

const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");
const statusTone = (s) =>
  s === "followup_created" ? "text-emerald-200"
  : s === "failed" ? "text-rose-200"
  : s?.startsWith?.("skipped") ? "text-amber-200"
  : "text-slate-300";
const statusLabel = (s) =>
  ({
    followup_created: tt("aiStudio.restock.status.followupCreated"),
    skipped_duplicate: tt("aiStudio.restock.status.skippedDuplicate"),
    skipped_no_stock: tt("aiStudio.restock.status.skippedNoStock"),
    skipped_inactive: tt("aiStudio.restock.status.skippedInactive"),
    failed: tt("aiStudio.restock.status.failed"),
    candidate: tt("aiStudio.restock.status.candidate"),
  })[s] || s;

/** Display only. Keys are the raw notification status enum. */
const notifStatusLabel = (s) =>
  ({
    pending_approval: tt("aiStudio.restock.status.pendingApproval"),
    sent: tt("aiStudio.restock.status.sent"),
    rejected: tt("aiStudio.restock.status.rejected"),
    failed: tt("aiStudio.restock.status.failed"),
  })[s] || String(s || "").replace("_", " ");

export default function AiStudioRestockRecovery() {
  const { t } = useTranslation();
  const { headers } = useStudioHeaders();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [view, setView] = useState("intents"); // intents | notifications | recoveries
  const [intents, setIntents] = useState([]);
  const [intentCounts, setIntentCounts] = useState({});
  const [notifs, setNotifs] = useState([]);
  const [notifCounts, setNotifCounts] = useState({});
  const [deliveryCounts, setDeliveryCounts] = useState({});
  const [messagingMode, setMessagingMode] = useState("off");
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, ri, rn] = await Promise.all([getRestockRecovery(headers), getRestockIntents(headers).catch(() => null), getRestockNotifications(headers).catch(() => null)]);
      setData(r || null);
      if (ri?.intents) setIntents(ri.intents);
      if (ri?.counts) setIntentCounts(ri.counts);
      if (rn?.notifications) setNotifs(rn.notifications);
      if (rn?.counts) setNotifCounts(rn.counts);
      if (rn?.deliveryCounts) setDeliveryCounts(rn.deliveryCounts);
      if (rn?.mode) setMessagingMode(rn.mode);
    } catch { setData(null); }
    setLoading(false);
  }, [headers]);
  useEffect(() => { void load(); }, [load]);

  const doSetMode = async (mode) => {
    if (mode === "approval_send" && !window.confirm(t("aiStudio.restock.confirm.enableApprovalSend"))) return;
    // auto_send is the only mode that messages a customer with nobody reading it
    // first, so it gets its own confirmation rather than reusing the approval one.
    if (mode === "auto_send" && !window.confirm(t("aiStudio.restock.confirm.enableAutoSend"))) return;
    setBusy("mode"); setMsg("");
    try { const r = await setRestockMessagingMode(mode, headers); if (r?.success === false) setMsg(r?.message || t("aiStudio.restock.failed")); else setMessagingMode(r.mode); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.restock.failed")); }
    setBusy("");
  };
  const doNotifAction = async (id, kind) => {
    setBusy(`${kind}-${id}`); setMsg("");
    try {
      if (kind === "reject") { if (!window.confirm(t("aiStudio.restock.confirm.reject"))) { setBusy(""); return; } await rejectRestockNotification(id, "", headers); }
      else if (kind === "edit") { const r = await editRestockNotification(id, editText, headers); if (r?.success !== false) { setEditId(null); setEditText(""); } }
      else if (kind === "send") {
        if (!window.confirm(t("aiStudio.restock.confirm.approveSend"))) { setBusy(""); return; }
        const r = await approveSendRestockNotification(id, headers);
        if (r?.success === false || r?.failed) setMsg(r?.message || r?.reason || t("aiStudio.restock.sendFailed")); else if (r?.sent) setMsg(t("aiStudio.restock.messageSent")); else if (r?.alreadySent) setMsg(t("aiStudio.restock.alreadySent"));
      }
      await load();
    } catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.restock.failed")); }
    setBusy("");
  };

  const doIntentAction = async (id, kind) => {
    setBusy(`${kind}-${id}`); setMsg("");
    try {
      if (kind === "cancel") { if (!window.confirm(t("aiStudio.restock.confirm.cancelIntent"))) { setBusy(""); return; } await cancelRestockIntent(id, headers); }
      else await fulfilRestockIntent(id, headers);
      await load();
    } catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.restock.failed")); }
    setBusy("");
  };

  const doSeed = async () => {
    setBusy("seed"); setMsg("");
    try { const r = await seedRestockRecoveryTemplate(headers); const wid = r?.workflow?.id; if (wid) navigate(`/ai-studio/workflows/${wid}/edit`); else await load(); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || t("aiStudio.restock.failed")); }
    setBusy("");
  };

  const a = data?.automation || {};
  const wf = data?.workflow || null;
  const counts = data?.counts || {};
  const recoveries = data?.recoveries || [];

  // Why automation is (in)active — explicit, never misleading.
  const reasons = [];
  if (!a.global_enabled) reasons.push(t("aiStudio.restock.automation.reasons.globalOff"));
  if (!a.tenant_enabled) reasons.push(t("aiStudio.restock.automation.reasons.tenantOff"));
  if (!wf) reasons.push(t("aiStudio.restock.automation.reasons.noWorkflow"));
  else { if (!wf.enabled) reasons.push(t("aiStudio.restock.automation.reasons.disabled")); if (!wf.granted) reasons.push(t("aiStudio.restock.automation.reasons.notGranted")); }
  const fullyActive = a.global_enabled && a.tenant_enabled && wf?.enabled && wf?.granted;

  return (
    <div dir="ltr" className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary"><PackageCheck className="h-4 w-4" />{t("aiStudio.restock.eyebrow")}</div>
            <h1 className="m1-page-title mt-1">{t("aiStudio.restock.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">{t("aiStudio.restock.introBefore")} <b>{t("aiStudio.restock.introInternal")}</b> {t("aiStudio.restock.introAfter")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!wf ? (
              <button type="button" onClick={doSeed} disabled={busy === "seed"} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-3 text-[11px] font-black text-primary hover:bg-primary/25 disabled:opacity-50">
                {busy === "seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{t("aiStudio.restock.createFromTemplate")}
              </button>
            ) : (
              <button type="button" onClick={() => navigate(`/ai-studio/workflows/${wf.id}/edit`)} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20">{t("aiStudio.restock.openWorkflow")}</button>
            )}
            <button type="button" onClick={() => void load()} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"><RefreshCw className="h-3.5 w-3.5" />{t("aiStudio.restock.refresh")}</button>
          </div>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {msg ? <div className="rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-[12px] font-bold text-rose-100">{msg}</div> : null}

      {/* Automation status — never misleading */}
      <section className={`rounded-2xl border px-4 py-3 ${fullyActive ? "border-emerald-300/30 bg-emerald-400/[0.06]" : "border-amber-300/30 bg-amber-300/[0.06]"}`}>
        <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wide">
          {fullyActive ? <CheckCircle2 className="h-4 w-4 text-emerald-200" /> : <ShieldAlert className="h-4 w-4 text-amber-200" />}
          <span className={fullyActive ? "text-emerald-100" : "text-amber-100"}>{t("aiStudio.restock.automation.label")} {fullyActive ? t("aiStudio.restock.automation.active") : t("aiStudio.restock.automation.inactive")}</span>
        </div>
        {!fullyActive ? <ul className="mt-1.5 list-disc pl-6 text-[12px] text-slate-300">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          : <p className="mt-1 text-[12px] text-slate-300">{t("aiStudio.restock.automation.activeNote")}</p>}
        <p className="mt-1.5 text-[11px] text-slate-500">{t("aiStudio.restock.automation.internalBefore")} <b>{t("aiStudio.restock.automation.not")}</b> {t("aiStudio.restock.automation.internalAfter")}</p>
      </section>

      {/* View toggle + messaging-mode control */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[["intents", t("aiStudio.restock.views.intents")], ["notifications", t("aiStudio.restock.views.notifications")], ["recoveries", t("aiStudio.restock.views.recoveries")]].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border px-3.5 text-[12px] font-black ${view === k ? "border-primary/40 bg-primary text-[var(--primary-contrast)]" : "border-white/10 bg-white/[0.055] text-[var(--text)] hover:border-white/20"}`}>
            {k === "notifications" ? <MessageSquare className="h-3.5 w-3.5" /> : null}{label}{k === "notifications" && Number(notifCounts.pending_approval || 0) > 0 ? <span className="rounded-full bg-amber-400/20 px-1.5 text-[10px] text-amber-100">{notifCounts.pending_approval}</span> : null}
          </button>
        ))}
        <div className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t("aiStudio.restock.messaging.label")}</span>
          {["off", "preview_only", "approval_send", "auto_send"].map((m) => (
            <button key={m} type="button" onClick={() => doSetMode(m)} disabled={busy === "mode"} title={m === "auto_send" ? t("aiStudio.restock.messaging.titleAutoSend") : m === "approval_send" ? t("aiStudio.restock.messaging.titleApprovalSend") : m === "preview_only" ? t("aiStudio.restock.messaging.titlePreviewOnly") : t("aiStudio.restock.messaging.titleOff")}
              className={`rounded-full px-2 py-0.5 text-[10px] font-black ${messagingMode === m ? (m === "auto_send" ? "bg-rose-500 text-white" : m === "approval_send" ? "bg-rose-400 text-slate-950" : m === "preview_only" ? "bg-amber-300 text-slate-950" : "bg-slate-500 text-white") : "text-slate-400 hover:text-white"}`}>
              {m === "off" ? t("aiStudio.restock.messaging.off") : m === "preview_only" ? t("aiStudio.restock.messaging.previewOnly") : m === "approval_send" ? t("aiStudio.restock.messaging.approvalSend") : t("aiStudio.restock.messaging.autoSend")}
            </button>
          ))}
        </div>
      </div>

      {view === "notifications" ? (
        <>
          <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px] text-slate-300">
            {/* In auto_send the "nothing sends without a human" promise is false,
                so the banner states the opposite outright instead of qualifying it. */}
            {messagingMode === "auto_send" ? (
              <span className="text-rose-200"><b className="text-white">{t("aiStudio.restock.banner.autoSendOn")}</b> {t("aiStudio.restock.banner.autoSendDetail")}</span>
            ) : (
              <>
                <b className="text-white">{t("aiStudio.restock.banner.humanApproved")}</b> {t("aiStudio.restock.banner.verifiedFacts")} <b>{t("aiStudio.restock.banner.noSendUntil")}</b>, {t("aiStudio.restock.banner.andOnlyWhen")} <b>{t("aiStudio.restock.messaging.approvalSend")}</b>. {messagingMode !== "approval_send" ? <span className="text-amber-200">{t("aiStudio.restock.banner.sendingDisabled", { mode: messagingMode === "off" ? t("aiStudio.restock.messaging.off") : t("aiStudio.restock.messaging.previewOnly") })}</span> : <span className="text-rose-200">{t("aiStudio.restock.banner.approvalSendOn")}</span>}
              </>
            )}
          </section>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["pendingApproval", notifCounts.pending_approval, "text-amber-200"], ["sent", notifCounts.sent, "text-emerald-200"], ["rejected", notifCounts.rejected, "text-slate-300"], ["failed", notifCounts.failed, "text-rose-200"]].map(([id, val, tone]) => (
              <div key={id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] px-3 py-3"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t(`aiStudio.restock.notifCounts.${id}`)}</div><div className={`mt-1 text-2xl font-black ${tone}`}>{Number(val || 0)}</div></div>
            ))}
          </section>
          <section className="grid grid-cols-3 gap-3">
            {[["delivered", deliveryCounts.delivered, CheckCheck, "text-primary"], ["read", deliveryCounts.read, Eye, "text-emerald-200"], ["deliveryFailed", deliveryCounts.delivery_failed, AlertTriangle, "text-rose-200"]].map(([id, val, Icon, tone]) => (
              <div key={id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] px-3 py-2.5"><div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500"><Icon className="h-3 w-3" />{t(`aiStudio.restock.delivery.${id}`)}</div><div className={`mt-1 text-xl font-black ${tone}`}>{Number(val || 0)}</div></div>
            ))}
          </section>
          <div className="text-[10px] text-slate-500">Delivery lifecycle is reconciled from real provider receipts. WhatsApp reports Sent → Delivered → Read; Messenger/Instagram report Delivered only (read receipts are watermark-only and not shown). Late/out-of-order receipts never move a message backwards.</div>
          <section className="space-y-3">
            {loading ? <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("aiStudio.restock.loading")}</div>
            : notifs.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">No customer-message drafts yet. They appear here when an exact restock intent is recovered while messaging is enabled.</div>
            : notifs.map((n) => {
              const f = n.facts || {};
              const sent = n.status === "sent";
              return (
                <div key={n.id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-black uppercase tracking-[0.14em] text-primary">{t("aiStudio.restock.notif.title")}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${sent ? "bg-emerald-400/20 text-emerald-100" : n.status === "rejected" ? "bg-slate-500/20 text-slate-300" : n.status === "failed" ? "bg-rose-500/20 text-rose-100" : "bg-amber-400/20 text-amber-100"}`}>{notifStatusLabel(n.status)}</span>
                  </div>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.02] p-3 text-[12px]">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t("aiStudio.restock.notif.facts")}</div>
                      <div className="mt-1 space-y-0.5 text-slate-300">
                        <div>{t("aiStudio.restock.notif.customer")} <b className="text-white">{n.customer_name || n.phone || "—"}</b></div>
                        <div>{t("aiStudio.restock.notif.product")} {n.product_name || `#${n.product_id}`}</div>
                        <div>{t("aiStudio.restock.notif.variant")} {[f.color, f.size ? t("aiStudio.restock.notif.size", { value: f.size }) : ""].filter(Boolean).join(" · ") || `#${n.variant_id}`}</div>
                        <div>{t("aiStudio.restock.notif.inStockNow")} <b className="text-emerald-200">{f.available ?? "?"}</b></div>
                        <div>{t("aiStudio.restock.notif.channel")} {n.channel || "—"} · <span className="text-emerald-300">{t("aiStudio.restock.notif.explicitIntent")}</span></div>
                      </div>
                    </div>
                    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.02] p-3 text-[12px]">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{sent ? t("aiStudio.restock.notif.draftSent") : t("aiStudio.restock.notif.draftNotSent")}</div>
                      {editId === n.id ? (
                        <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} dir="rtl" className="mt-1 w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/60 px-2.5 py-2 text-[12px] text-white focus:border-primary/40 focus:outline-none" />
                      ) : (
                        <div dir="rtl" className="mt-1 whitespace-pre-wrap text-slate-200">{n.approved_text || n.draft_text}</div>
                      )}
                    </div>
                  </div>
                  {!sent && n.status !== "rejected" ? (
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {editId === n.id ? (
                        <>
                          <button type="button" onClick={() => { setEditId(null); setEditText(""); }} className="inline-flex h-[var(--control-height-sm)] items-center rounded-[var(--radius-control)] border border-white/10 px-3 text-[11px] font-black text-slate-300">{t("aiStudio.restock.notif.cancel")}</button>
                          <button type="button" onClick={() => doNotifAction(n.id, "edit")} disabled={busy === `edit-${n.id}`} className="inline-flex h-[var(--control-height-sm)] items-center gap-1 rounded-[var(--radius-control)] border border-primary/40 bg-primary/10 px-3 text-[11px] font-black text-primary">{t("aiStudio.restock.notif.saveDraft")}</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => { setEditId(n.id); setEditText(n.approved_text || n.draft_text || ""); }} className="inline-flex h-[var(--control-height-sm)] items-center gap-1 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-white"><Pencil className="h-3.5 w-3.5" />{t("aiStudio.restock.notif.edit")}</button>
                      )}
                      <button type="button" onClick={() => doNotifAction(n.id, "reject")} disabled={busy === `reject-${n.id}`} className="inline-flex h-[var(--control-height-sm)] items-center gap-1 rounded-[var(--radius-control)] border border-rose-400/30 bg-rose-500/10 px-3 text-[11px] font-black text-rose-100"><Ban className="h-3.5 w-3.5" />{t("aiStudio.restock.notif.reject")}</button>
                      <button type="button" onClick={() => doNotifAction(n.id, "send")} disabled={busy === `send-${n.id}` || !["approval_send", "auto_send"].includes(messagingMode)} title={!["approval_send", "auto_send"].includes(messagingMode) ? t("aiStudio.restock.notif.sendDisabledTitle") : t("aiStudio.restock.notif.sendTitle")} className="inline-flex h-[var(--control-height-sm)] items-center gap-1 rounded-[var(--radius-control)] border border-emerald-300/40 bg-emerald-400/15 px-3 text-[11px] font-black text-emerald-50 disabled:opacity-40">{busy === `send-${n.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}{t("aiStudio.restock.notif.approveSend")}</button>
                    </div>
                  ) : sent ? (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        {[
                          { key: "sent", Icon: Check, label: t("aiStudio.restock.delivery.sent"), at: n.sent_at, on: true, tone: "text-slate-200" },
                          { key: "delivered", Icon: CheckCheck, label: t("aiStudio.restock.delivery.delivered"), at: n.delivered_at, on: ["delivered", "read"].includes(n.delivery_status) || Boolean(n.delivered_at), tone: "text-primary" },
                          { key: "read", Icon: Eye, label: t("aiStudio.restock.delivery.read"), at: n.read_at, on: n.delivery_status === "read" || Boolean(n.read_at), tone: "text-emerald-200" },
                        ].map((s) => (
                          <span key={s.key} className={`inline-flex items-center gap-1 ${s.on ? s.tone : "text-slate-600"}`}><s.Icon className="h-3.5 w-3.5" />{s.label}{s.on && s.at ? ` · ${fmt(s.at)}` : ""}</span>
                        ))}
                      </div>
                      {n.delivery_status === "failed" ? (
                        <div className="inline-flex items-center gap-1 text-[11px] text-rose-200"><AlertTriangle className="h-3.5 w-3.5" />{t("aiStudio.restock.delivery.deliveryFailed")}{n.provider_failure_reason ? ` — ${n.provider_failure_reason}` : ""} · {t("aiStudio.restock.delivery.failedSuffix")}</div>
                      ) : null}
                      <details className="text-[10px] text-slate-500"><summary className="cursor-pointer select-none">{t("aiStudio.restock.notif.advanced")}</summary>
                        <div className="mt-1 space-y-0.5">
                          <div>{t("aiStudio.restock.notif.providerMessageId")} {n.provider_message_id || "—"}</div>
                          <div>{t("aiStudio.restock.notif.channel")} {n.channel || "—"}</div>
                          <div>{t("aiStudio.restock.notif.deliveryState")} {n.delivery_status || "sent"}{n.last_provider_event_at ? ` · ${t("aiStudio.restock.notif.lastProviderEvent", { at: fmt(n.last_provider_event_at) })}` : ""}</div>
                          <div>{t("aiStudio.restock.notif.notifiedAccepted")} {fmt(n.sent_at)}</div>
                        </div>
                      </details>
                    </div>
                  ) : <div className="mt-2 text-[11px] text-slate-400">{t("aiStudio.restock.notif.rejectedNote")}</div>}
                </div>
              );
            })}
          </section>
        </>
      ) : null}

      {view === "intents" ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[["waiting", intentCounts.waiting, "text-slate-200"], ["exactVariant", intentCounts.waiting_exact_variant, "text-emerald-200"], ["recoveryCreated", intentCounts.recovery_created, "text-primary"], ["customerNotified", intentCounts.customer_notified, "text-violet-200"], ["cancelled", intentCounts.cancelled, "text-amber-200"]].map(([id, val, tone]) => (
              <div key={id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] px-3 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t(`aiStudio.restock.intentCounts.${id}`)}</div>
                <div className={`mt-1 text-2xl font-black ${tone}`}>{Number(val || 0)}</div>
              </div>
            ))}
          </section>
          <section className="overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("aiStudio.restock.loading")}</div>
            ) : intents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500"><Tag className="h-6 w-6 opacity-60" />{t("aiStudio.restock.intents.empty", { button: t("aiStudio.restock.intents.storefrontButton") })}</div>
            ) : (
              <div className="m1-table-container overflow-x-auto">
                <table className="m1-table m1-table--compact w-full text-left text-sm">
                  <thead className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                    <tr className="border-b border-white/10"><th className="px-4 py-3">{t("aiStudio.restock.intents.columns.customer")}</th><th className="px-4 py-3">{t("aiStudio.restock.intents.columns.product")}</th><th className="px-4 py-3">{t("aiStudio.restock.intents.columns.variant")}</th><th className="px-4 py-3">{t("aiStudio.restock.intents.columns.match")}</th><th className="px-4 py-3">{t("aiStudio.restock.intents.columns.source")}</th><th className="px-4 py-3">{t("aiStudio.restock.intents.columns.requested")}</th><th className="px-4 py-3">{t("aiStudio.restock.intents.columns.status")}</th><th className="px-4 py-3 text-right">{t("aiStudio.restock.intents.columns.actions")}</th></tr>
                  </thead>
                  <tbody>
                    {intents.map((i) => (
                      <tr key={i.id} className="border-b border-white/5">
                        <td className="px-4 py-3"><div className="font-bold text-white">{i.customer_name || i.phone || "—"}</div><div className="text-[11px] text-slate-500">{i.customer_id ? `#${i.customer_id}` : t("aiStudio.restock.intents.guest")}</div></td>
                        <td className="px-4 py-3 text-slate-300">{i.product_name || t("aiStudio.restock.intents.productNumber", { id: i.product_id })}</td>
                        <td className="px-4 py-3 text-slate-300">{i.variant_id ? [i.color, i.size].filter(Boolean).join(" / ") || `#${i.variant_id}` : <span className="text-slate-500">{t("aiStudio.restock.intents.productLevel")}</span>}</td>
                        <td className="px-4 py-3">{i.variant_id ? <span className="inline-flex items-center rounded-full border border-emerald-300/40 bg-emerald-300/10 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-100">{t("aiStudio.restock.intents.exactVariant")}</span> : <span className="inline-flex items-center rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[9px] font-black uppercase text-amber-100">{t("aiStudio.restock.intents.productOnly")}</span>}</td>
                        <td className="px-4 py-3 text-[11px] text-slate-400">{i.source}</td>
                        <td className="px-4 py-3 text-[11px] text-slate-500">{fmt(i.created_at)}</td>
                        <td className="px-4 py-3"><span className="font-black text-slate-300">{statusLabel(i.status)}</span></td>
                        <td className="px-4 py-3 text-right">
                          {["waiting", "recovery_created"].includes(i.status) ? (
                            <div className="inline-flex gap-1.5">
                              <button type="button" onClick={() => doIntentAction(i.id, "fulfil")} disabled={busy === `fulfil-${i.id}`} className="inline-flex h-[var(--control-height-sm)] items-center gap-1 rounded-[var(--radius-control)] border border-emerald-300/30 bg-emerald-400/10 px-2.5 text-[11px] font-black text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"><Check className="h-3.5 w-3.5" />{t("aiStudio.restock.intents.fulfil")}</button>
                              <button type="button" onClick={() => doIntentAction(i.id, "cancel")} disabled={busy === `cancel-${i.id}`} className="inline-flex h-[var(--control-height-sm)] items-center gap-1 rounded-[var(--radius-control)] border border-rose-400/30 bg-rose-500/10 px-2.5 text-[11px] font-black text-rose-100 hover:bg-rose-500/20 disabled:opacity-50"><Ban className="h-3.5 w-3.5" />{t("aiStudio.restock.intents.cancel")}</button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="text-[11px] text-slate-500">{t("aiStudio.restock.intents.consentBefore")} <b>{t("aiStudio.restock.automation.not")}</b> {t("aiStudio.restock.intents.consentAfter")}</p>
        </>
      ) : view === "recoveries" ? (
      <>
      {/* Counts (real data) */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["total", counts.total, "text-slate-200"], ["followupsCreated", counts.followups_created, "text-emerald-200"], ["skippedDuplicate", counts.skipped_duplicate, "text-amber-200"], ["skippedNoStock", counts.skipped_no_stock, "text-amber-200"], ["failed", counts.failed, "text-rose-200"]].map(([id, val, tone]) => (
          <div key={id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] px-3 py-3">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t(`aiStudio.restock.recoveryCounts.${id}`)}</div>
            <div className={`mt-1 text-2xl font-black ${tone}`}>{Number(val || 0)}</div>
          </div>
        ))}
      </section>

      {/* Recovery table */}
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("aiStudio.restock.loading")}</div>
        ) : recoveries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500"><Users className="h-6 w-6 opacity-60" />{t("aiStudio.restock.recoveries.empty")}</div>
        ) : (
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact w-full text-left text-sm">
              <thead className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3">{t("aiStudio.restock.recoveries.columns.customer")}</th><th className="px-4 py-3">{t("aiStudio.restock.recoveries.columns.product")}</th><th className="px-4 py-3">{t("aiStudio.restock.recoveries.columns.priority")}</th><th className="px-4 py-3">{t("aiStudio.restock.recoveries.columns.status")}</th><th className="px-4 py-3">{t("aiStudio.restock.recoveries.columns.followup")}</th><th className="px-4 py-3">{t("aiStudio.restock.recoveries.columns.when")}</th><th className="px-4 py-3">{t("aiStudio.restock.recoveries.columns.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {recoveries.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="px-4 py-3"><div className="font-bold text-white">{r.customer_name || r.phone || "—"}</div><div className="text-[11px] text-slate-500">{r.customer_id ? `#${r.customer_id}` : t("aiStudio.restock.intents.guest")}</div></td>
                    <td className="px-4 py-3 text-slate-300">{r.product_name || t("aiStudio.restock.intents.productNumber", { id: r.product_id })}</td>
                    <td className="px-4 py-3 text-slate-300">{r.priority}</td>
                    <td className="px-4 py-3"><span className={`font-black ${statusTone(r.status)}`}>{statusLabel(r.status)}</span></td>
                    <td className="px-4 py-3 text-slate-400">{r.followup_task_id ? t("aiStudio.restock.recoveries.task", { id: r.followup_task_id }) : "—"}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">{fmt(r.created_at)}</td>
                    <td className="px-4 py-3 max-w-[240px] truncate text-[11px] text-slate-500" title={r.reason || ""}>{r.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>
      ) : null}

      <div className="text-[11px] text-slate-600">
        <button type="button" onClick={() => navigate("/ai-studio/executions")} className="inline-flex items-center gap-1 font-black text-primary hover:text-primary">{t("aiStudio.restock.viewExecutions")} <ExternalLink className="h-3 w-3" /></button>
      </div>
    </div>
  );
}
