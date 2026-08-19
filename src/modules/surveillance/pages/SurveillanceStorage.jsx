import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardDrive, RefreshCw } from "lucide-react";

import { getStorage, listDevices } from "../services/surveillanceApi";
import { Facts, Failed, Loading, PageHeader, Pill, ReadOnlyNotice, Section, Value } from "../components/SurveillanceUi";
import "../../../theme/ai-surface.css";

/**
 * Recorder storage.
 *
 * THE READING THIS PAGE GETS RIGHT
 * --------------------------------
 * The reference recorder reports ONE disk with FOUR partitions, and two earlier
 * mistakes are permanently designed out here:
 *
 *   1. Reading Detail[0] alone reported a quarter of the real capacity. The
 *      totals shown are the parser's summed figures across every partition.
 *   2. The device reports State "Success", which did not match a naive
 *      /running|ok|normal/ health test, so a perfectly good disk read as
 *      failing. Health comes from the structured IsError flag instead.
 *
 * AND FULL IS NOT BROKEN
 * ----------------------
 * A recorder in overwrite mode sits at 100% for its entire service life: it
 * fills the disk once, then recycles the oldest footage. That is the system
 * working. Showing it in red teaches the operator to ignore this page, so a
 * full-and-healthy disk reads "Recycling" and only IsError reads as a fault.
 *
 * NOTHING HERE WRITES. Formatting or clearing a surveillance disk destroys
 * evidence, and no destructive storage operation is authorised in this build.
 */
export default function SurveillanceStorage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await listDevices();
      const devices = response?.devices || [];
      const collected = [];
      for (const device of devices) {
        // A recorder that is offline cannot answer, and that is a state to
        // show rather than an error to swallow.
        const result = await getStorage(device.id).catch(() => null);
        collected.push({ device, storage: result?.storage || null });
      }
      setEntries(collected);
    } catch {
      setFailed(true);
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={HardDrive}
        title={t("surveillance.storage.title")}
        subtitle={t("surveillance.storage.subtitle")}
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("surveillance.refresh")}
          </button>
        }
      />

      <ReadOnlyNotice messageKey="surveillance.storage.readOnlyNotice" />

      {loading ? (
        <Loading />
      ) : failed ? (
        <Failed messageKey="surveillance.storage.loadError" />
      ) : (
        entries.map(({ device, storage }) => {
          const label =
            storage === null ? "unknown"
              : storage.healthy === false ? "error"
                : storage.full === true ? "recycling"
                  : storage.healthy === true ? "ok" : "unknown";
          const tone = { error: "bad", recycling: "info", ok: "ok", unknown: "neutral" }[label];

          return (
            <Section
              key={device.id}
              title={device.name}
              subtitle={[device.model, device.firmware].filter(Boolean).join(" · ") || undefined}
              right={<Pill tone={tone}>{t(`surveillance.storage.health.${label}`)}</Pill>}
            >
              {storage === null ? (
                <p className="text-[12px] text-slate-500">{t("surveillance.storage.unreadable")}</p>
              ) : (
                <>
                  <Facts
                    rows={[
                      { label: t("surveillance.storage.total"), value: <Value value={storage.totalGb} suffix=" GB" /> },
                      { label: t("surveillance.storage.used"), value: <Value value={storage.usedGb} suffix=" GB" /> },
                      { label: t("surveillance.storage.free"), value: <Value value={storage.totalGb !== null && storage.usedGb !== null ? storage.totalGb - storage.usedGb : null} suffix=" GB" /> },
                      { label: t("surveillance.storage.disks"), value: <Value value={storage.diskCount} /> },
                      { label: t("surveillance.storage.partitions"), value: <Value value={storage.partitionCount} /> },
                      { label: t("surveillance.storage.overwriteState"), value: storage.full === true ? t("surveillance.storage.recycling") : storage.full === false ? t("surveillance.storage.filling") : <Value value={null} /> },
                    ]}
                  />

                  {storage.usedPercent !== null && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                        <span>{t("surveillance.storage.utilisation")}</span>
                        <span className="tabular-nums">{storage.usedPercent}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        {/* Blue at 100% when healthy, not red. The colour has to
                            agree with the label or the page contradicts itself. */}
                        <div
                          className={`h-full rounded-full ${
                            label === "error" ? "bg-rose-400" : label === "recycling" ? "bg-sky-400" : "bg-emerald-400"
                          }`}
                          style={{ width: `${Math.min(100, storage.usedPercent)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {Array.isArray(storage.disks) && storage.disks.length > 0 && (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[34rem] text-[12px]">
                        <thead>
                          <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                            <th className="p-2 text-start">{t("surveillance.storage.col.disk")}</th>
                            <th className="p-2 text-start">{t("surveillance.storage.col.state")}</th>
                            <th className="p-2 text-end">{t("surveillance.storage.col.partitions")}</th>
                            <th className="p-2 text-end">{t("surveillance.storage.col.total")}</th>
                            <th className="p-2 text-end">{t("surveillance.storage.col.used")}</th>
                            <th className="p-2 text-start">{t("surveillance.storage.col.health")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storage.disks.map((disk, index) => (
                            <tr key={disk.name || index} className="border-b border-white/[0.06] last:border-0">
                              <td className="p-2 text-slate-200"><Value value={disk.name} /></td>
                              <td className="p-2 text-slate-400"><Value value={disk.state} /></td>
                              <td className="p-2 text-end tabular-nums text-slate-400"><Value value={disk.partitionCount} /></td>
                              <td className="p-2 text-end tabular-nums text-slate-300"><Value value={disk.totalGb} suffix=" GB" /></td>
                              <td className="p-2 text-end tabular-nums text-slate-300"><Value value={disk.usedGb} suffix=" GB" /></td>
                              <td className="p-2">
                                {disk.isHealthy === null || disk.isHealthy === undefined ? (
                                  <span className="text-slate-600">&mdash;</span>
                                ) : (
                                  <Pill tone={disk.isHealthy ? "ok" : "bad"}>
                                    {disk.isHealthy ? t("surveillance.storage.health.ok") : t("surveillance.storage.health.error")}
                                  </Pill>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </Section>
          );
        })
      )}
    </div>
  );
}
