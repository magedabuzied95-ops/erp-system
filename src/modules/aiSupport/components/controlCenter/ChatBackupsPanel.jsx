// Chat backups — inbox top bar → Config → Chat backups.
//
// "Backup all" (or a channel / date-range backup) queues a job on the server; it writes a .zip with
// conversations.json, messages.jsonl and the media files still on disk, and keeps it 7 days.
// The list polls while a job is preparing. Downloading streams the file through an authenticated
// request (settings:edit only). Server: server/routes/chatBackups.js.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Download, Filter, RefreshCw } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { API_BASE_URL } from "../../../../shared/constants/app";
import { getToken } from "../../../../shared/auth/authStorage";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { ActionButton, PanelSkeleton, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 410, 500, 502] };
const selectTrigger = "h-9 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white";
const dateInputClass = "h-9 w-[150px] rounded-xl border border-white/10 bg-slate-950/70 px-2 text-xs font-bold text-white outline-none focus:border-cyan-300/40";

const STATUS_TONE = {
  queued: "border-white/10 bg-white/[0.06] text-slate-200",
  running: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
  ready: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  failed: "border-rose-300/25 bg-rose-400/10 text-rose-100",
  expired: "border-white/10 bg-white/[0.03] text-slate-500",
};

// Literal keys so a missing translation stays greppable.
const statusLabel = (t, status) => {
  if (status === "running") return t("aiSupport.inboxConfig.backups.status.running");
  if (status === "ready") return t("aiSupport.inboxConfig.backups.status.ready");
  if (status === "failed") return t("aiSupport.inboxConfig.backups.status.failed");
  if (status === "expired") return t("aiSupport.inboxConfig.backups.status.expired");
  return t("aiSupport.inboxConfig.backups.status.queued");
};

const formatSize = (bytes = 0) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

// Same base the shared api client resolves (it does not export its resolver).
const apiBase = () => {
  const hostname = typeof window !== "undefined" ? String(window.location.hostname || "").toLowerCase() : "";
  return hostname.endsWith(".nip.io") || hostname.endsWith(".vercel.app") ? "/api" : API_BASE_URL;
};

const scopeText = (t, filters = {}) => {
  if (!filters || filters.scope !== "filtered") return t("aiSupport.inboxConfig.backups.scopeAll");
  const parts = [];
  if (filters.channel) parts.push(filters.channel);
  if (filters.from || filters.to) parts.push(`${filters.from || "…"} → ${filters.to || "…"}`);
  return parts.join(" · ") || t("aiSupport.inboxConfig.backups.scopeAll");
};

export default function ChatBackupsPanel({ headers }) {
  const { t } = useTranslation();
  const [backups, setBackups] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [channel, setChannel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/inbox-config/backups", { headers, ...SUPPRESSED });
      if (!mountedRef.current) return;
      setBackups(Array.isArray(payload?.backups) ? payload.backups : []);
      setChannels(Array.isArray(payload?.channels) ? payload.channels : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxConfig.backups.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const preparing = backups.some((item) => item.status === "queued" || item.status === "running");
  useEffect(() => {
    if (!preparing) return undefined;
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(timer);
  }, [load, preparing]);

  const request = async (body) => {
    setBusy("request");
    setNotice(null);
    try {
      await api.post("/inbox-config/backups", body, { headers, ...SUPPRESSED });
      if (mountedRef.current) setNotice({ ok: true, text: t("aiSupport.inboxConfig.backups.requested") });
      await load();
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxConfig.backups.actionFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const download = async (item) => {
    setBusy(`download-${item.id}`);
    setNotice(null);
    try {
      const response = await fetch(`${apiBase()}/inbox-config/backups/${item.id}/download`, {
        headers: { ...(headers || {}), Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || t("aiSupport.inboxConfig.backups.downloadFailed"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `chat-backup-${item.id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxConfig.backups.downloadFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const channelOptions = useMemo(() => [
    { value: "", label: t("aiSupport.inboxConfig.backups.allChannels") },
    ...channels.map((row) => ({ value: row.channel, label: `${row.channel} (${row.conversations})` })),
  ], [channels, t]);

  if (loading) return <PanelSkeleton rows={3} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">{t("aiSupport.inboxConfig.backups.subtitle")}</p>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={RefreshCw} onClick={() => load()}>{t("aiSupport.inboxConfig.backups.refresh")}</ActionButton>
          <ActionButton icon={Filter} onClick={() => setShowFilters((value) => !value)}>{t("aiSupport.inboxConfig.backups.filtered")}</ActionButton>
          <ActionButton tone="primary" icon={Archive} loading={busy === "request"} disabled={preparing} onClick={() => request({ scope: "all" })}>{t("aiSupport.inboxConfig.backups.backupAll")}</ActionButton>
        </div>
      </div>

      {showFilters ? (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <label className="block w-52">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.inboxConfig.backups.channel")}</span>
            <div className="mt-1"><ThemedSelect value={channel} onChange={setChannel} options={channelOptions} triggerClassName={selectTrigger} /></div>
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.inboxConfig.backups.from")}</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className={`mt-1 block ${dateInputClass}`} />
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.inboxConfig.backups.to")}</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className={`mt-1 block ${dateInputClass}`} />
          </label>
          <ActionButton
            tone="emerald"
            icon={Archive}
            loading={busy === "request"}
            disabled={preparing || (!channel && !from && !to)}
            onClick={() => request({ scope: "filtered", channel, from, to })}
          >
            {t("aiSupport.inboxConfig.backups.requestFiltered")}
          </ActionButton>
        </div>
      ) : null}

      {notice ? <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p> : null}
      {preparing ? <p className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-2.5 text-xs font-bold text-cyan-100">{t("aiSupport.inboxConfig.backups.preparing")}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[980px] text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.download")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.requestedAt")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.status")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.requestedBy")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.scope")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.conversations")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.messages")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.files")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.missingFiles")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.size")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.backups.columns.availableUntil")}</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((item) => (
              <tr key={item.id} className="border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                <td className="px-3 py-2.5">
                  {item.downloadable ? (
                    <ActionButton tone="emerald" icon={Download} loading={busy === `download-${item.id}`} onClick={() => download(item)} className="h-8">
                      {t("aiSupport.inboxConfig.backups.download")}
                    </ActionButton>
                  ) : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-300">{formatDateTime(item.created_at)}</td>
                <td className="px-3 py-2.5">
                  <span title={item.error || undefined} className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${STATUS_TONE[item.status] || STATUS_TONE.queued}`}>{statusLabel(t, item.status)}</span>
                </td>
                <td className="px-3 py-2.5" dir="auto">{item.requested_by_name || "—"}</td>
                <td className="px-3 py-2.5 text-slate-400" dir="auto">{scopeText(t, item.filters)}</td>
                <td className="px-3 py-2.5 font-black">{item.conversations}</td>
                <td className="px-3 py-2.5 font-black">{item.messages}</td>
                <td className="px-3 py-2.5">{item.files}</td>
                <td className={`px-3 py-2.5 ${item.missing_files ? "text-amber-200" : "text-slate-500"}`}>{item.missing_files}</td>
                <td className="px-3 py-2.5" dir="ltr">{item.size_bytes ? formatSize(item.size_bytes) : "—"}</td>
                <td className="px-3 py-2.5 text-slate-400">{item.status === "ready" ? formatDateTime(item.available_until) : "—"}</td>
              </tr>
            ))}
            {!backups.length ? (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.inboxConfig.backups.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
