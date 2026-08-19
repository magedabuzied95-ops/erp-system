import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Network, RefreshCw } from "lucide-react";

import { getNetworkInfo, listDevices } from "../services/surveillanceApi";
import { BoolValue, Facts, Failed, Loading, PageHeader, Pill, ReadOnlyNotice, Section, Value } from "../components/SurveillanceUi";
import "../../../theme/ai-surface.css";

/**
 * Recorder network configuration — read only, and staying that way for now.
 *
 * WHY WRITES ARE PREPARED BUT NOT ARMED
 * -------------------------------------
 * A network write is the one change that can make the recorder unreachable by
 * the very system performing the change. Get the subnet wrong and there is no
 * second attempt from here — recovery means someone standing in the shop with
 * a monitor and a mouse. It is also the change most likely to be requested
 * casually ("just switch it to a static IP").
 *
 * The typed workflow exists server-side behind `surveillance.network:manage`
 * and a dangerous-action confirmation, and it stays disabled pending separate
 * approval. This page shows what the recorder currently reports so an operator
 * can diagnose a connection problem without touching anything.
 *
 * The LAN address IS shown here, unlike elsewhere in the UI: it is not a secret
 * on the customer's own network, and it is the single most useful fact when the
 * ERP cannot reach the recorder. It is still gated behind the network read
 * permission rather than shown to everyone.
 */
export default function SurveillanceNetwork() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await listDevices();
      const collected = [];
      for (const device of response?.devices || []) {
        const result = await getNetworkInfo(device.id).catch(() => null);
        collected.push({ device, network: result?.network || null });
      }
      setEntries(collected);
    } catch { setFailed(true); setEntries([]); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={Network}
        title={t("surveillance.network.title")}
        subtitle={t("surveillance.network.subtitle")}
        actions={
          <button type="button" onClick={() => void load()}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20">
            <RefreshCw className="h-3.5 w-3.5" />{t("surveillance.refresh")}
          </button>
        }
      />

      <ReadOnlyNotice messageKey="surveillance.network.writeGateNotice" />

      {loading ? <Loading /> : failed ? <Failed messageKey="surveillance.network.loadError" /> : (
        entries.map(({ device, network }) => (
          <Section
            key={device.id}
            title={device.name}
            subtitle={[device.model, device.firmware].filter(Boolean).join(" · ") || undefined}
            right={<Pill tone="neutral"><Lock className="h-3 w-3" />{t("surveillance.settings.readOnly")}</Pill>}
          >
            {network === null ? (
              <p className="text-[12px] text-slate-500">{t("surveillance.network.unreadable")}</p>
            ) : (
              <>
                <Facts rows={[
                  { label: t("surveillance.network.ip"), value: <Value value={network.ipAddress} /> },
                  { label: t("surveillance.network.subnet"), value: <Value value={network.subnetMask} /> },
                  { label: t("surveillance.network.gateway"), value: <Value value={network.gateway} /> },
                  { label: t("surveillance.network.dhcp"), value: <BoolValue value={network.dhcpEnabled} /> },
                  { label: t("surveillance.network.hostname"), value: <Value value={network.hostname} /> },
                  { label: t("surveillance.network.mac"), value: <Value value={network.macAddress} /> },
                  { label: t("surveillance.network.mtu"), value: <Value value={network.mtu} /> },
                  { label: t("surveillance.network.dnsAuto"), value: <BoolValue value={network.dnsAutoGet} /> },
                ]} />

                {/* The firmware returns DNS as an ARRAY, not Address0/Address1.
                    Reading the indexed form lost DNS entirely on this device. */}
                <div className="mt-3">
                  <div className="mb-1 text-[11px] text-slate-500">{t("surveillance.network.dns")}</div>
                  {Array.isArray(network.dns) && network.dns.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {network.dns.filter(Boolean).map((server) => (
                        <Pill key={server} tone="neutral">{server}</Pill>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-600">&mdash;</span>
                  )}
                </div>
              </>
            )}
          </Section>
        ))
      )}
    </div>
  );
}
