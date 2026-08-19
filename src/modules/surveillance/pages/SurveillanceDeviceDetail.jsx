import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RefreshCw, Server, Search, Wifi } from "lucide-react";

import {
  getDevice, getNetworkInfo, getStorage, getSystemTime,
  listChannels, probeDevice, testConnection,
} from "../services/surveillanceApi";
import { canRead, capabilityState } from "../lib/capability";
import { BoolValue, Facts, Failed, Loading, PageHeader, Pill, Section, Value } from "../components/SurveillanceUi";
import "../../../theme/ai-surface.css";

/**
 * Everything one recorder reports about itself.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * Serial number, P2P UUID and device id are NOT shown. They are redacted server
 * side and this page does not ask for them. The P2P UUID in particular leaked
 * into a terminal during the first probe — a real incident — and the lesson was
 * that identifiers which uniquely name a customer's device on a vendor cloud
 * have no operational use in the ERP and every use to somebody else.
 *
 * The recorder's LAN address is shown on the Network section only, behind the
 * network read permission, because an operator diagnosing a connection problem
 * genuinely needs it and it is not a secret on their own network.
 */

const CAP_TONE = { supported: "ok", "read-only": "info", unsupported: "neutral", unknown: "warn" };

export default function SurveillanceDeviceDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [detail, setDetail] = useState(null);
  const [channels, setChannels] = useState([]);
  const [storage, setStorage] = useState(null);
  const [network, setNetwork] = useState(null);
  const [time, setTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const info = await getDevice(id);
      setDetail(info);
      const caps = info?.capabilities || {};

      // Each section is asked for independently and tolerates its own failure:
      // an unreachable storage controller must not blank the whole page.
      const [ch, st, net, tm] = await Promise.all([
        listChannels(id).catch(() => null),
        canRead(caps, "storageInfo") ? getStorage(id).catch(() => null) : Promise.resolve(null),
        canRead(caps, "networkSettings") ? getNetworkInfo(id).catch(() => null) : Promise.resolve(null),
        getSystemTime(id).catch(() => null),
      ]);
      setChannels(ch?.channels || []);
      setStorage(st?.storage || null);
      setNetwork(net?.network || null);
      setTime(tm?.time || null);
    } catch {
      setFailed(true);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action, okKey, failKey) => {
    setBusy(true);
    setNotice(null);
    try { await action(id); setNotice({ ok: true, key: okKey }); await load(); }
    catch { setNotice({ ok: false, key: failKey }); }
    setBusy(false);
  };

  const device = detail?.device;
  const caps = detail?.capabilities || {};

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={Server}
        title={device?.name || t("surveillance.deviceDetail.title")}
        subtitle={t("surveillance.deviceDetail.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy}
              onClick={() => void run(testConnection, "surveillance.devices.testOk", "surveillance.devices.testFailed")}
              className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20 disabled:opacity-50">
              <Wifi className="h-3.5 w-3.5" />{t("surveillance.devices.test")}
            </button>
            <button type="button" disabled={busy}
              onClick={() => void run(probeDevice, "surveillance.devices.probeOk", "surveillance.devices.probeFailed")}
              className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20 disabled:opacity-50">
              <Search className="h-3.5 w-3.5" />{t("surveillance.devices.probe")}
            </button>
            <button type="button" onClick={() => void load()}
              className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20">
              <RefreshCw className="h-3.5 w-3.5" />{t("surveillance.refresh")}
            </button>
          </div>
        }
      />

      {notice && (
        <div className={`rounded-[var(--radius-card)] border px-4 py-2 text-[12px] ${
          notice.ok ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                    : "border-rose-300/25 bg-rose-300/10 text-rose-100"}`}>
          {t(notice.key)}
        </div>
      )}

      {loading ? <Loading /> : failed || !device ? <Failed messageKey="surveillance.deviceDetail.loadError" /> : (
        <>
          <Section title={t("surveillance.deviceDetail.identity")}
            right={<Pill tone={device.status === "online" ? "ok" : device.status === "offline" ? "bad" : "warn"}>
              {t(`surveillance.devices.status.${device.status}`, { defaultValue: t("surveillance.devices.status.unknown") })}
            </Pill>}>
            <Facts rows={[
              { label: t("surveillance.deviceDetail.vendor"), value: <Value value={device.vendor_key} /> },
              { label: t("surveillance.deviceDetail.model"), value: <Value value={device.model} /> },
              { label: t("surveillance.deviceDetail.firmware"), value: <Value value={device.firmware} /> },
              { label: t("surveillance.deviceDetail.channelsOnDevice"), value: <Value value={device.channel_count} /> },
              { label: t("surveillance.deviceDetail.lastSeen"),
                value: device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : <Value value={null} /> },
              { label: t("surveillance.deviceDetail.lastError"), value: <Value value={device.last_error_code} /> },
            ]} />
          </Section>

          <Section title={t("surveillance.deviceDetail.capabilities")}
            subtitle={t("surveillance.deviceDetail.capabilitiesNote")}
            right={detail.probed_at
              ? <span className="text-[11px] text-slate-500">{t("surveillance.deviceDetail.probedAt", { when: new Date(detail.probed_at).toLocaleString() })}</span>
              : <Pill tone="warn">{t("surveillance.deviceDetail.neverProbed")}</Pill>}>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(caps).sort().map((key) => {
                const state = capabilityState(caps, key);
                return (
                  <span key={key} className="inline-flex items-center gap-1.5">
                    <Pill tone={CAP_TONE[state] || "neutral"}>
                      {key}
                      <span className="opacity-70">· {t(`surveillance.capability.state.${state}`, { defaultValue: state })}</span>
                    </Pill>
                  </span>
                );
              })}
            </div>
            {detail.unknown_count > 0 && (
              <p className="mt-2 text-[11px] text-amber-300/80">
                {t("surveillance.deviceDetail.unknownCount", { count: detail.unknown_count })}
              </p>
            )}
          </Section>

          <Section title={t("surveillance.deviceDetail.channels")}
            right={<Link to="/surveillance/channels" className="text-[11px] text-primary hover:underline">
              {t("surveillance.deviceDetail.allChannels")} &rarr;</Link>}>
            <Facts rows={[
              { label: t("surveillance.deviceDetail.imported"), value: <Value value={channels.length} /> },
              { label: t("surveillance.deviceDetail.enabled"), value: <Value value={channels.filter((c) => c.is_enabled).length} /> },
              { label: t("surveillance.deviceDetail.online"), value: <Value value={channels.filter((c) => c.status === "online").length} /> },
            ]} />
          </Section>

          <Section title={t("surveillance.deviceDetail.streamProfiles")}
            subtitle={t("surveillance.deviceDetail.streamProfilesNote")}>
            {channels.length === 0 ? (
              <p className="text-[12px] text-slate-500">{t("surveillance.channels.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-[12px]">
                  <thead><tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="p-2 text-start">{t("surveillance.channels.col.number")}</th>
                    <th className="p-2 text-start">{t("surveillance.deviceDetail.profile")}</th>
                    <th className="p-2 text-start">{t("surveillance.channels.col.codec")}</th>
                    <th className="p-2 text-start">{t("surveillance.channels.col.resolution")}</th>
                    <th className="p-2 text-end">{t("surveillance.channels.col.fps")}</th>
                  </tr></thead>
                  <tbody>
                    {channels.flatMap((channel) =>
                      (channel.stream_profiles || []).map((p) => (
                        <tr key={`${channel.id}-${p.key}`} className="border-b border-white/[0.06] last:border-0">
                          <td className="p-2 tabular-nums text-slate-400">{channel.channel_index}</td>
                          <td className="p-2 text-slate-300"><Value value={p.label || p.key} /></td>
                          <td className="p-2 text-slate-300"><Value value={p.codec ? String(p.codec).toUpperCase() : null} /></td>
                          <td className="p-2 tabular-nums text-slate-300">{p.width && p.height ? `${p.width}×${p.height}` : <Value value={null} />}</td>
                          <td className="p-2 text-end tabular-nums text-slate-300"><Value value={p.fps} /></td>
                        </tr>
                      )))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={t("surveillance.storage.title")}
            right={<Link to="/surveillance/storage" className="text-[11px] text-primary hover:underline">
              {t("surveillance.deviceDetail.storagePage")} &rarr;</Link>}>
            {storage === null ? <p className="text-[12px] text-slate-500">{t("surveillance.storage.unreadable")}</p> : (
              <Facts rows={[
                { label: t("surveillance.storage.total"), value: <Value value={storage.totalGb} suffix=" GB" /> },
                { label: t("surveillance.storage.used"), value: <Value value={storage.usedGb} suffix=" GB" /> },
                { label: t("surveillance.storage.partitions"), value: <Value value={storage.partitionCount} /> },
                { label: t("surveillance.storage.col.health"),
                  value: storage.healthy === null ? <Value value={null} />
                    : <Pill tone={storage.healthy ? (storage.full ? "info" : "ok") : "bad"}>
                        {t(`surveillance.storage.health.${storage.healthy ? (storage.full ? "recycling" : "ok") : "error"}`)}
                      </Pill> },
              ]} />
            )}
          </Section>

          <Section title={t("surveillance.network.title")}
            right={<Link to="/surveillance/network" className="text-[11px] text-primary hover:underline">
              {t("surveillance.deviceDetail.networkPage")} &rarr;</Link>}>
            {network === null ? <p className="text-[12px] text-slate-500">{t("surveillance.network.unreadable")}</p> : (
              <Facts rows={[
                { label: t("surveillance.network.ip"), value: <Value value={network.ipAddress} /> },
                { label: t("surveillance.network.subnet"), value: <Value value={network.subnetMask} /> },
                { label: t("surveillance.network.gateway"), value: <Value value={network.gateway} /> },
                { label: t("surveillance.network.dhcp"), value: <BoolValue value={network.dhcpEnabled} /> },
                { label: t("surveillance.network.hostname"), value: <Value value={network.hostname} /> },
                { label: t("surveillance.network.mtu"), value: <Value value={network.mtu} /> },
              ]} />
            )}
          </Section>

          <Section title={t("surveillance.deviceDetail.clock")}
            right={time && time.clockTrusted === false ? <Pill tone="warn">{t("surveillance.dashboard.ntpOff")}</Pill> : null}>
            {time === null ? <p className="text-[12px] text-slate-500">{t("surveillance.dashboard.clockUnknown")}</p> : (
              <>
                <Facts rows={[
                  { label: t("surveillance.deviceDetail.deviceTime"), value: <Value value={time.deviceTime} /> },
                  { label: t("surveillance.deviceDetail.timezone"), value: <Value value={time.timeZoneName} /> },
                  { label: t("surveillance.deviceDetail.ntpServer"), value: <Value value={time.ntpServer} /> },
                  { label: t("surveillance.deviceDetail.ntpEnabled"), value: <BoolValue value={time.ntpEnabled} /> },
                ]} />
                {time.clockTrusted === false && (
                  // Stated wherever a timestamp is trusted. NTP is deliberately
                  // NOT enabled by this build — that is an approval gate.
                  <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100">
                    {t("surveillance.deviceDetail.ntpWarning")}
                  </p>
                )}
              </>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
