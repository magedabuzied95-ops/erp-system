import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Grid3x3, RefreshCw, Video } from "lucide-react";

import { getDevice, listChannels, listDevices } from "../services/surveillanceApi";
import { Failed, Loading, PageHeader, Pill, Value } from "../components/SurveillanceUi";
import SnapshotButton from "../components/SnapshotButton";
import { capabilityState } from "../lib/capability";
import "../../../theme/ai-surface.css";

/**
 * Every channel on every recorder this tenant can reach.
 *
 * WHY PTZ IS ABSENT RATHER THAN GREYED OUT
 * ----------------------------------------
 * Capability has four states, and `unknown` and `unsupported` both HIDE the
 * control. The reference XVR answers the PTZ status call with an error — it is
 * a fixed-camera recorder — so a disabled PTZ button would be a permanent
 * invitation to press something that cannot work. Only a capability that
 * probed as supported earns a control.
 */

const codecLabel = (codec) => (codec ? String(codec).toUpperCase() : null);

export default function SurveillanceChannels() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [capabilities, setCapabilities] = useState({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [deviceFilter, setDeviceFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const deviceResponse = await listDevices();
      const devices = deviceResponse?.devices || [];
      const collected = [];
      const caps = {};

      for (const device of devices) {
        const [channelResponse, detail] = await Promise.all([
          listChannels(device.id).catch(() => null),
          getDevice(device.id).catch(() => null),
        ]);
        // Capability comes from the PROBE, not from the vendor name. A Dahua
        // NVR supports PTZ; this Dahua XVR does not.
        caps[device.id] = detail?.capabilities || {};
        for (const channel of channelResponse?.channels || []) {
          collected.push({ ...channel, device_id: device.id, device_name: device.name });
        }
      }
      setCapabilities(caps);
      setRows(collected);
    } catch {
      setFailed(true);
      setRows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const devices = useMemo(
    () => [...new Map(rows.map((r) => [r.device_id, r.device_name])).entries()],
    [rows],
  );
  const visible = deviceFilter === "all" ? rows : rows.filter((r) => String(r.device_id) === deviceFilter);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={Grid3x3}
        title={t("surveillance.channels.title")}
        subtitle={t("surveillance.channels.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {devices.length > 1 && (
              <select
                value={deviceFilter}
                onChange={(event) => setDeviceFilter(event.target.value)}
                className="h-[var(--control-height-md)] rounded-full border border-white/10 bg-white/[0.055] px-3 text-[12px] font-bold text-slate-200"
              >
                <option value="all">{t("surveillance.channels.allDevices")}</option>
                {devices.map(([id, name]) => (
                  <option key={id} value={String(id)}>{name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("surveillance.refresh")}
            </button>
          </div>
        }
      />

      {loading ? (
        <Loading />
      ) : failed ? (
        <Failed messageKey="surveillance.channels.loadError" />
      ) : visible.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          {t("surveillance.channels.empty")}
        </div>
      ) : (
        // Wide content scrolls inside its own container so the page body never
        // scrolls sideways — this table has twelve columns on a phone.
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
          <table className="w-full min-w-[68rem] text-[12px]">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="p-2 text-start">{t("surveillance.channels.col.number")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.name")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.status")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.codec")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.resolution")}</th>
                <th className="p-2 text-end">{t("surveillance.channels.col.fps")}</th>
                <th className="p-2 text-end">{t("surveillance.channels.col.bitrate")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.profiles")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.live")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.recording")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.motion")}</th>
                <th className="p-2 text-start">{t("surveillance.channels.col.ptz")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((channel) => {
                const profiles = Array.isArray(channel.stream_profiles) ? channel.stream_profiles : [];
                const main = profiles.find((p) => p.key === "0") || profiles[0] || null;
                const caps = capabilities[channel.device_id] || {};
                const ptzState = caps.ptz?.state ?? caps.ptz ?? "unknown";

                return (
                  <tr key={channel.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                    <td className="p-2 tabular-nums text-slate-400">{channel.channel_index}</td>
                    <td className="p-2">
                      {/* The ERP name is an alias. Renaming here never writes to
                          the recorder — the device keeps its own channel title. */}
                      <span className="font-bold text-slate-100">{channel.name}</span>
                      {channel.vendor_name && channel.vendor_name !== channel.name && (
                        <span className="ms-1 text-[10px] text-slate-600">({channel.vendor_name})</span>
                      )}
                    </td>
                    <td className="p-2">
                      <Pill tone={channel.status === "online" ? "ok" : channel.status === "offline" ? "bad" : "warn"}>
                        {t(`surveillance.devices.status.${channel.status}`, {
                          defaultValue: t("surveillance.devices.status.unknown"),
                        })}
                      </Pill>
                    </td>
                    <td className="p-2 text-slate-300"><Value value={codecLabel(main?.codec)} /></td>
                    <td className="p-2 tabular-nums text-slate-300">
                      {main?.width && main?.height ? `${main.width}×${main.height}` : <Value value={null} />}
                    </td>
                    <td className="p-2 text-end tabular-nums text-slate-300"><Value value={main?.fps ?? null} /></td>
                    <td className="p-2 text-end tabular-nums text-slate-300">
                      <Value value={main?.bitrate_kbps ?? null} suffix=" kbps" />
                    </td>
                    <td className="p-2 tabular-nums text-slate-400">{profiles.length || <Value value={null} />}</td>
                    <td className="p-2">
                      {channel.is_enabled ? (
                        <span className="inline-flex items-center gap-1">
                          <Link to="/surveillance/live" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <Video className="h-3 w-3" />
                            {t("surveillance.channels.watch")}
                          </Link>
                          {capabilityState(caps, "snapshot") === "supported" && (
                            <SnapshotButton
                              deviceId={channel.device_id}
                              channelIndex={channel.channel_index}
                              channelName={channel.name}
                            />
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-600">&mdash;</span>
                      )}
                    </td>
                    <td className="p-2">
                      {channel.is_recording === null || channel.is_recording === undefined ? (
                        <span className="text-slate-600">&mdash;</span>
                      ) : (
                        <Pill tone={channel.is_recording ? "ok" : "neutral"}>
                          {channel.is_recording ? t("surveillance.on") : t("surveillance.off")}
                        </Pill>
                      )}
                    </td>
                    <td className="p-2">
                      {channel.motion_enabled === null || channel.motion_enabled === undefined ? (
                        <span className="text-slate-600">&mdash;</span>
                      ) : (
                        <Pill tone={channel.motion_enabled ? "info" : "neutral"}>
                          {channel.motion_enabled ? t("surveillance.on") : t("surveillance.off")}
                        </Pill>
                      )}
                    </td>
                    <td className="p-2">
                      {/* supported => a control; anything else => a plain label
                          saying so. Never a disabled button. */}
                      {ptzState === "supported" ? (
                        <Pill tone="ok">{t("surveillance.channels.ptzSupported")}</Pill>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider text-slate-600">
                          {t("surveillance.channels.ptzUnsupported")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
