import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Clock, Cpu, HardDrive, Loader2, RefreshCw,
  Radio, Server, Video, VideoOff,
} from "lucide-react";

import { getOverview } from "../services/surveillanceApi";
import "../../../theme/ai-surface.css";

/**
 * A value that may legitimately be unknown.
 *
 * The whole dashboard is built around never inventing a number. A recorder that
 * has just gone offline cannot report its storage, and showing the last known
 * figure — or a zero — is worse than an em dash, because the operator cannot
 * tell the difference between "empty" and "we have no idea".
 */
const Value = ({ value, suffix = "" }) =>
  value === null || value === undefined ? (
    <span className="text-slate-600">&mdash;</span>
  ) : (
    <>
      {value}
      {suffix}
    </>
  );

const Stat = ({ icon: Icon, label, value, suffix, tone = "" }) => (
  <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-4 py-3">
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
    <div className={`text-2xl font-black tabular-nums ${tone || "text-white"}`}>
      <Value value={value} suffix={suffix} />
    </div>
  </div>
);

export default function SurveillanceDashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      // Fast pass first so the page paints without waiting on the recorders,
      // then the full pass fills storage and clock.
      const fast = await getOverview({ fast: true });
      setData(fast);
      setLoading(false);
      const full = await getOverview({ fast: false });
      setData(full);
    } catch {
      setFailed(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totals = data?.totals;
  const media = data?.media;

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
              <Radio className="h-4 w-4" />
              {t("surveillance.eyebrow")}
            </div>
            <h1 className="m1-page-title mt-1">{t("surveillance.dashboard.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("surveillance.dashboard.subtitle")}</p>
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
      </section>

      {/* The clock warning is a banner, not a per-device detail: playback
          timestamps are only as trustworthy as this, and NTP is deliberately
          left disabled, so the operator has to be told rather than have to
          go looking. */}
      {data?.warnings?.length > 0 && (
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-[13px] text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-bold">{t("surveillance.dashboard.clockWarningTitle")}</div>
            <div className="mt-0.5 text-amber-100/80">
              {t("surveillance.dashboard.clockWarningBody", {
                devices: data.warnings.map((w) => w.device_name).join("، "),
              })}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("surveillance.loading")}
        </div>
      ) : failed ? (
        <div className="rounded-[var(--radius-card)] border border-rose-300/25 bg-rose-300/10 p-6 text-sm text-rose-100">
          {t("surveillance.dashboard.loadError")}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              icon={Server}
              label={t("surveillance.dashboard.recorders")}
              value={totals ? `${totals.devices_online}/${totals.devices}` : null}
              tone={totals?.devices_online === totals?.devices ? "text-emerald-400" : "text-amber-300"}
            />
            <Stat
              icon={Video}
              label={t("surveillance.dashboard.camerasOnline")}
              value={totals ? `${totals.channels_online}/${totals.channels_imported}` : null}
              tone={totals?.channels_offline > 0 ? "text-amber-300" : "text-emerald-400"}
            />
            <Stat
              icon={Radio}
              label={t("surveillance.dashboard.activeStreams")}
              value={media?.configured ? `${media.active_streams}/${media.capacity ?? "?"}` : null}
            />
            <Stat
              icon={Cpu}
              label={t("surveillance.dashboard.transcoder")}
              value={media?.encoder || null}
              tone={media?.hardware_accelerated ? "text-emerald-400" : "text-amber-300"}
            />
          </div>

          {/* Media host health gets its own row: when it is down, Live cannot
              work at all, and that is a different failure from a camera being
              offline. */}
          <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px]">
            <span className="inline-flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  !media?.configured ? "bg-slate-500" : media.reachable ? "bg-emerald-400" : "bg-rose-400"
                }`}
              />
              <span className="text-slate-300">
                {!media?.configured
                  ? t("surveillance.dashboard.mediaNotConfigured")
                  : media.reachable
                    ? t("surveillance.dashboard.mediaHealthy")
                    : t("surveillance.dashboard.mediaUnreachable")}
              </span>
            </span>
            {media?.configured && (
              <>
                <span className="text-slate-500">
                  {t("surveillance.dashboard.viewers")}: <Value value={media.viewers} />
                </span>
                <span className="text-slate-500">
                  {t("surveillance.dashboard.capacityLimit")}:{" "}
                  <Value value={media.capacity} />
                  {media.limited_by ? ` (${t(`surveillance.dashboard.limitedBy.${media.limited_by}`)})` : ""}
                </span>
              </>
            )}
            <Link to="/surveillance/live" className="ms-auto text-primary hover:underline">
              {t("surveillance.dashboard.openLive")} &rarr;
            </Link>
          </section>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {(data?.devices || []).map((device) => (
              <section key={device.id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-[14px] font-black">{device.name}</h2>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {[device.vendor_key, device.model, device.firmware].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${
                      device.status === "online"
                        ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                        : device.status === "offline"
                          ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
                          : "border-amber-300/25 bg-amber-300/10 text-amber-100"
                    }`}
                  >
                    {device.status === "online" ? <Video className="h-3 w-3" /> : <VideoOff className="h-3 w-3" />}
                    {t(`surveillance.devices.status.${device.status}`, {
                      defaultValue: t("surveillance.devices.status.unknown"),
                    })}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3">
                  <div>
                    <dt className="text-slate-500">{t("surveillance.dashboard.channels")}</dt>
                    <dd className="font-bold tabular-nums">
                      <Value value={device.channel_count_imported} />
                      {device.channel_count_device !== null &&
                        device.channel_count_device !== device.channel_count_imported && (
                          <span className="ms-1 text-[10px] font-normal text-amber-300">
                            {t("surveillance.dashboard.ofDevice", { count: device.channel_count_device })}
                          </span>
                        )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">{t("surveillance.dashboard.recording")}</dt>
                    <dd className="font-bold tabular-nums"><Value value={device.channels_recording} /></dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">{t("surveillance.dashboard.lastSeen")}</dt>
                    <dd className="font-bold">
                      {device.last_seen_at
                        ? new Date(device.last_seen_at).toLocaleString()
                        : <span className="text-slate-600">&mdash;</span>}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-3 text-[12px]">
                  <span className="inline-flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5 text-slate-500" />
                    {device.storage?.status === "unknown" ? (
                      <span className="text-slate-600">{t("surveillance.dashboard.storageUnknown")}</span>
                    ) : (
                      <>
                        <span className="tabular-nums text-slate-300">
                          <Value value={device.storage.used_gb} suffix=" GB" />
                          {" / "}
                          <Value value={device.storage.total_gb} suffix=" GB" />
                        </span>
                        {/* A full disk that is overwriting is a recorder doing
                            its job. Calling that a failure teaches the operator
                            to ignore this tile. */}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${
                            device.storage.health_label === "error"
                              ? "bg-rose-300/15 text-rose-200"
                              : device.storage.health_label === "recycling"
                                ? "bg-sky-300/15 text-sky-200"
                                : "bg-emerald-300/15 text-emerald-200"
                          }`}
                        >
                          {t(`surveillance.dashboard.storageHealth.${device.storage.health_label}`)}
                        </span>
                      </>
                    )}
                  </span>

                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-slate-500" />
                    {device.clock?.status === "unknown" ? (
                      <span className="text-slate-600">{t("surveillance.dashboard.clockUnknown")}</span>
                    ) : (
                      <span className={device.clock.warn ? "text-amber-300" : "text-slate-300"}>
                        {device.clock.ntp_enabled === false
                          ? t("surveillance.dashboard.ntpOff")
                          : device.clock.ntp_enabled === true
                            ? t("surveillance.dashboard.ntpOn")
                            : t("surveillance.dashboard.clockUnknown")}
                        {device.clock.drift_seconds !== null && (
                          <span className="ms-1 tabular-nums text-slate-500">
                            ({device.clock.drift_seconds > 0 ? "+" : ""}
                            {device.clock.drift_seconds}s)
                          </span>
                        )}
                      </span>
                    )}
                  </span>

                  <Link
                    to={`/surveillance/devices/${device.id}`}
                    className="ms-auto text-primary hover:underline"
                  >
                    {t("surveillance.dashboard.openDevice")} &rarr;
                  </Link>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
