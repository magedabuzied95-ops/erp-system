import { useEffect, useRef, useState } from "react";

import { api } from "../../shared/api/api";

const statusStyles = {
  success: "bg-emerald-400/10 text-emerald-200 border-emerald-300/20",
  warning: "bg-yellow-400/10 text-yellow-200 border-yellow-300/20",
  error: "bg-red-400/10 text-red-200 border-red-300/20",
};

const formatTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const shortId = (value = "") => {
  const text = String(value || "");
  if (!text) return "";
  return text.length > 26 ? `${text.slice(0, 12)}...${text.slice(-8)}` : text;
};

export default function AILiveLogs({ tenantId, headers, enabled = true }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const panelRef = useRef(null);
  const intervalRef = useRef(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!enabled) return undefined;

    let active = true;
    const loadLogs = async () => {
      const seq = ++requestSeqRef.current;
      try {
        const data = await api.get("/ai-agent/logs", {
          params: tenantId ? { tenant_id: tenantId } : undefined,
          headers,
        });
        if (!active || seq !== requestSeqRef.current) return;
        setLogs(Array.isArray(data?.logs) ? data.logs : []);
        setError("");
      } catch (err) {
        if (!active || seq !== requestSeqRef.current) return;
        setError(err?.responseBody?.message || err?.message || "Live logs unavailable");
      }
    };
    loadLogs();
    intervalRef.current = window.setInterval(loadLogs, 4000);
    return () => {
      active = false;
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [tenantId, headers, enabled]);

  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = 0;
    }
  }, [logs.length]);

  return (
    <section className="rounded-2xl border border-emerald-300/15 bg-slate-950/80 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="m1-section-title uppercase tracking-[0.14em] text-emerald-100">Live AI Logs</h2>
          <p className="text-xs font-bold text-slate-500">Operational event stream, kept in memory only.</p>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${enabled ? "border-emerald-300/15 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-white/[0.055] text-slate-400"}`}>
          <span className={`h-2 w-2 rounded-full ${enabled ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.8)]" : "bg-slate-500"}`} />
          {enabled ? "Polling" : "Paused"}
        </div>
      </div>
      <div ref={panelRef} className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-black/35 font-mono text-xs">
        {error ? <div className="border-b border-red-300/10 px-3 py-2 text-red-200">[{formatTime(Date.now())}] LOG_STREAM_ERROR {error}</div> : null}
        {logs.length ? logs.map((item) => {
          const style = statusStyles[item.status] || "bg-slate-500/10 text-slate-300 border-slate-400/20";
          return (
            <div key={item.id || `${item.createdAt}-${item.type}`} className="border-b border-white/5 px-3 py-2 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">[{formatTime(item.createdAt)}]</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${style}`}>{item.type || "AI_EVENT"}</span>
                {item.intent ? <span className="text-yellow-100">({item.intent})</span> : null}
                {item.reason ? <span className="text-yellow-100">{item.reason}</span> : null}
                {item.productName ? <span className="text-emerald-100">Product: {item.productName}</span> : null}
                {item.platform ? <span className="text-cyan-200">{item.platform}</span> : null}
                {item.conversationId ? <span className="min-w-0 truncate text-slate-400">{shortId(item.conversationId)}</span> : null}
              </div>
              {item.memory ? (
                <div className="mt-1 break-words pl-0 text-slate-400 sm:pl-24">
                  Memory: {[item.memory.lastIntent, item.memory.lastProduct, item.memory.lastSize ? `size ${item.memory.lastSize}` : ""].filter(Boolean).join(" / ")}
                </div>
              ) : null}
              {item.error ? <div className="mt-1 break-words pl-0 text-red-200 sm:pl-24">{item.error}</div> : null}
            </div>
          );
        }) : !error ? <div className="px-3 py-4 text-slate-500">Waiting for AI events...</div> : null}
      </div>
    </section>
  );
}
