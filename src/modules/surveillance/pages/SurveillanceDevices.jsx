import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardDrive, Loader2, RefreshCw, Search, Wifi } from "lucide-react";

import { listDevices, probeDevice, testConnection } from "../services/surveillanceApi";
import "../../../theme/ai-surface.css";
import SurveillanceNav from "../components/SurveillanceNav";

const STATUS_TONE = {
  online: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  offline: "border-slate-300/20 bg-slate-300/10 text-slate-300",
  error: "border-rose-300/25 bg-rose-300/10 text-rose-100",
  unknown: "border-amber-300/25 bg-amber-300/10 text-amber-100",
};

export default function SurveillanceDevices() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await listDevices();
      setDevices(response?.devices || []);
    } catch {
      setLoadError(true);
      setDevices([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (id, action, okKey, failKey) => {
    setBusy((current) => ({ ...current, [id]: true }));
    setNotice(null);
    try {
      await action(id);
      setNotice({ tone: "ok", key: okKey });
      await load();
    } catch {
      // The server deliberately returns a code, not an operator-facing message
      // from the device — so the UI supplies the sentence.
      setNotice({ tone: "fail", key: failKey });
    }
    setBusy((current) => ({ ...current, [id]: false }));
  }, [load]);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
              <HardDrive className="h-4 w-4" />
              {t("surveillance.eyebrow")}
            </div>
            <h1 className="m1-page-title mt-1">{t("surveillance.devices.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("surveillance.devices.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("surveillance.refresh")}
          </button>
        </div>

        {notice && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-[12px] ${
              notice.tone === "ok"
                ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                : "border-rose-300/25 bg-rose-300/10 text-rose-100"
            }`}
          >
            {t(notice.key)}
          </div>
        )}
        <div className="mt-3"><SurveillanceNav /></div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("surveillance.loading")}
        </div>
      ) : loadError ? (
        <div className="rounded-[var(--radius-card)] border border-rose-300/25 bg-rose-300/10 p-6 text-sm text-rose-100">
          {t("surveillance.devices.loadError")}
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          {t("surveillance.devices.empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => {
            const status = device.status || "unknown";
            return (
              <section
                key={device.id}
                className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-[14px] font-black text-white">{device.name}</h2>
                    {/* Vendor and model only. The recorder's address is a
                        server-side fact and is not published to the browser. */}
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {[device.vendor_key, device.model].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                      STATUS_TONE[status] || STATUS_TONE.unknown
                    }`}
                  >
                    {t(`surveillance.devices.status.${status}`, {
                      defaultValue: t("surveillance.devices.status.unknown"),
                    })}
                  </span>
                </div>

                <p className="mt-3 text-[11px] text-slate-500">
                  {t("surveillance.devices.channels", { count: device.channel_count ?? 0 })}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy[device.id]}
                    onClick={() =>
                      void run(device.id, testConnection, "surveillance.devices.testOk", "surveillance.devices.testFailed")
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-[11px] font-black hover:border-white/20 disabled:opacity-50"
                  >
                    {busy[device.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                    {t("surveillance.devices.test")}
                  </button>
                  <button
                    type="button"
                    disabled={busy[device.id]}
                    onClick={() =>
                      void run(device.id, probeDevice, "surveillance.devices.probeOk", "surveillance.devices.probeFailed")
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-[11px] font-black hover:border-white/20 disabled:opacity-50"
                  >
                    <Search className="h-3 w-3" />
                    {t("surveillance.devices.probe")}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
