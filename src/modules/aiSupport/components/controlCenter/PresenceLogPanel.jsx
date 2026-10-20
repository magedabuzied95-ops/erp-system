// Presence log — inbox top bar → Config → Presence log.
//
// When each operator had the inbox open: one row per online session (online from, offline at,
// duration, online now, busy) and a per-person total for the chosen range. Rows are written by the
// inbox heartbeat (server/services/staffPresenceLogService.js); this page only reads them.
// Days are Cairo calendar days — the server does the range maths.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";

import { api } from "../../../../shared/api/api";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { ActionButton, PanelSkeleton, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 500, 502] };
const selectTrigger = "h-9 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white";
const dateInputClass = "h-9 w-[150px] rounded-xl border border-white/10 bg-slate-950/70 px-2 text-xs font-bold text-white outline-none focus:border-cyan-300/40";

const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const formatDuration = (t, seconds = 0) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return t("aiSupport.inboxConfig.presence.hoursMinutes", { hours, minutes });
  if (minutes) return t("aiSupport.inboxConfig.presence.minutes", { minutes });
  return t("aiSupport.inboxConfig.presence.lessThanMinute");
};

function YesNo({ on, tone = "emerald", yes, no }) {
  const tones = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  };
  return on
    ? <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-black ${tones[tone]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{yes}</span>
    : <span className="text-slate-500">{no}</span>;
}

export default function PresenceLogPanel({ headers }) {
  const { t } = useTranslation();
  const [preset, setPreset] = useState("today");
  const [from, setFrom] = useState(cairoToday);
  const [to, setTo] = useState(cairoToday);
  const [userId, setUserId] = useState("");
  const [data, setData] = useState({ sessions: [], users: [] });
  const [knownUsers, setKnownUsers] = useState([]); // the picker keeps everyone while one person is filtered
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = { preset, user_id: userId || undefined, ...(preset === "custom" ? { from, to } : {}) };
      const payload = await api.get("/inbox-config/presence", { headers, params, ...SUPPRESSED });
      if (!mountedRef.current) return;
      const users = Array.isArray(payload?.users) ? payload.users : [];
      setData({ sessions: Array.isArray(payload?.sessions) ? payload.sessions : [], users });
      if (!userId) setKnownUsers(users);
      setError("");
    } catch (loadError) {
      if (mountedRef.current) setError(loadError?.message || t("aiSupport.inboxConfig.presence.loadFailed"));
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [from, headers, preset, t, to, userId]);

  useEffect(() => { void load(); }, [load]);

  // Who is online changes by the minute; keep the page honest while it is open.
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  const userOptions = useMemo(() => {
    const seen = new Map();
    for (const row of knownUsers) seen.set(String(row.user_id), row.user_name);
    if (userId && !seen.has(userId)) seen.set(userId, `#${userId}`);
    return [{ value: "", label: t("aiSupport.inboxConfig.presence.allUsers") }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [knownUsers, t, userId]);

  const onlineNow = data.users.filter((row) => row.online).length;

  if (loading) return <PanelSkeleton rows={3} />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">{t("aiSupport.inboxConfig.presence.subtitle")}</p>

      <div className="flex flex-wrap items-center gap-2">
        {[
          ["today", t("aiSupport.inboxConfig.presence.today")],
          ["7d", t("aiSupport.inboxConfig.presence.last7")],
          ["custom", t("aiSupport.inboxConfig.presence.custom")],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPreset(key)}
            className={`h-8 rounded-full border px-3 text-[11px] font-black transition ${preset === key ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`}
          >
            {label}
          </button>
        ))}
        {preset === "custom" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="date" aria-label={t("aiSupport.inboxConfig.presence.from")} value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className={dateInputClass} />
            <span className="text-slate-600">→</span>
            <input type="date" aria-label={t("aiSupport.inboxConfig.presence.to")} value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className={dateInputClass} />
          </div>
        ) : null}
        <div className="w-48">
          <ThemedSelect value={userId} onChange={setUserId} options={userOptions} ariaLabel={t("aiSupport.inboxConfig.presence.user")} triggerClassName={selectTrigger} />
        </div>
        <ActionButton icon={RefreshCw} loading={refreshing} onClick={() => load()} className="ms-auto">{t("aiSupport.inboxConfig.presence.refresh")}</ActionButton>
      </div>

      {error ? <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{error}</p> : null}

      {/* Per-person totals for the range (clipped to it: a session from yesterday counts only today's part). */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.inboxConfig.presence.onlineNow")}</div>
          <div className="mt-1 text-xl font-black text-emerald-200">{onlineNow}</div>
        </div>
        {data.users.map((row) => (
          <div key={row.user_id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-black text-white" dir="auto">{row.user_name}</span>
              {row.online ? <span className={`h-2 w-2 shrink-0 rounded-full ${row.busy ? "bg-amber-300" : "bg-emerald-300"}`} /> : null}
            </div>
            <div className="mt-1 text-lg font-black text-cyan-100">{formatDuration(t, row.online_seconds)}</div>
            <div className="text-[11px] text-slate-500">{t("aiSupport.inboxConfig.presence.sessionsCount", { count: row.sessions })}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[720px] text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.presence.columns.user")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.presence.columns.onlineFrom")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.presence.columns.offlineAt")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.presence.columns.duration")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.presence.columns.online")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.presence.columns.busy")}</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((row) => (
              <tr key={row.id} className="border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                <td className="px-3 py-2.5 font-black" dir="auto">{row.user_name}</td>
                <td className="px-3 py-2.5 text-slate-300">{formatDateTime(row.online_from)}</td>
                <td className="px-3 py-2.5 text-slate-300">{row.online ? "—" : formatDateTime(row.offline_at)}</td>
                <td className="px-3 py-2.5 font-black">{formatDuration(t, row.duration_seconds)}</td>
                <td className="px-3 py-2.5"><YesNo on={row.online} yes={t("aiSupport.inboxConfig.presence.yes")} no={t("aiSupport.inboxConfig.presence.no")} /></td>
                <td className="px-3 py-2.5"><YesNo on={row.busy} tone="amber" yes={t("aiSupport.inboxConfig.presence.yes")} no={t("aiSupport.inboxConfig.presence.no")} /></td>
              </tr>
            ))}
            {!data.sessions.length ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.inboxConfig.presence.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
