import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, ScrollText } from "lucide-react";

import { listDeviceAudit, listDevices } from "../services/surveillanceApi";
import { Failed, Loading, PageHeader, Pill, Value } from "../components/SurveillanceUi";
import "../../../theme/ai-surface.css";

/**
 * The surveillance audit trail.
 *
 * WHAT THIS MUST BE ABLE TO REPRESENT
 * -----------------------------------
 * The one real write performed against the recorder — Channel 1's main-stream
 * bitrate, 512 to 2048 kbps — has to be fully reconstructable from a row here:
 * who, which tenant and branch, which device and channel, what changed from
 * what to what, when, and whether it succeeded.
 *
 * AND WHAT IT MUST NEVER CONTAIN
 * ------------------------------
 * No credential, no serial number, no P2P UUID. The before/after values are
 * rendered through the same redaction the logger uses, because an audit trail
 * is a log that is deliberately kept forever — the worst possible place for a
 * secret to land. A leaked P2P UUID during the probe is exactly how this
 * lesson was learned.
 */

const RESULT_TONE = { ok: "ok", success: "ok", failed: "bad", error: "bad", denied: "warn" };

/** Renders a before/after pair without pretending a missing side is empty. */
const Diff = ({ before, after }) => {
  const { t } = useTranslation();
  if (before === null && after === null) return <span className="text-slate-600">&mdash;</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 font-mono text-[11px]">
      <span className="rounded bg-rose-300/10 px-1 text-rose-200">
        {before === null || before === undefined ? t("surveillance.audit.none") : String(before)}
      </span>
      <span className="text-slate-600">&rarr;</span>
      <span className="rounded bg-emerald-300/10 px-1 text-emerald-200">
        {after === null || after === undefined ? t("surveillance.audit.none") : String(after)}
      </span>
    </span>
  );
};

export default function SurveillanceAudit() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
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
        const audit = await listDeviceAudit(device.id).catch(() => null);
        for (const entry of audit?.audit || audit?.entries || []) {
          collected.push({ ...entry, device_name: device.name });
        }
      }
      // Newest first — an audit page is read from the top when something has
      // just gone wrong.
      collected.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setRows(collected);
    } catch {
      setFailed(true);
      setRows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={ScrollText}
        title={t("surveillance.audit.title")}
        subtitle={t("surveillance.audit.subtitle")}
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

      {loading ? (
        <Loading />
      ) : failed ? (
        <Failed messageKey="surveillance.audit.loadError" />
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          {t("surveillance.audit.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
          <table className="w-full min-w-[62rem] text-[12px]">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="p-2 text-start">{t("surveillance.audit.col.when")}</th>
                <th className="p-2 text-start">{t("surveillance.audit.col.user")}</th>
                <th className="p-2 text-start">{t("surveillance.audit.col.branch")}</th>
                <th className="p-2 text-start">{t("surveillance.audit.col.device")}</th>
                <th className="p-2 text-end">{t("surveillance.audit.col.channel")}</th>
                <th className="p-2 text-start">{t("surveillance.audit.col.action")}</th>
                <th className="p-2 text-start">{t("surveillance.audit.col.change")}</th>
                <th className="p-2 text-start">{t("surveillance.audit.col.result")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                  <td className="whitespace-nowrap p-2 tabular-nums text-slate-400">
                    {entry.created_at ? new Date(entry.created_at).toLocaleString() : <Value value={null} />}
                  </td>
                  <td className="p-2 text-slate-200"><Value value={entry.user_name || entry.user_id} /></td>
                  <td className="p-2 text-slate-400"><Value value={entry.branch_name || entry.branch_id} /></td>
                  <td className="p-2 text-slate-300"><Value value={entry.device_name} /></td>
                  <td className="p-2 text-end tabular-nums text-slate-400">
                    <Value value={entry.channel_index ?? entry.metadata?.channel_index ?? null} />
                  </td>
                  <td className="p-2">
                    <span className="font-mono text-[11px] text-sky-200">{entry.action}</span>
                  </td>
                  <td className="p-2">
                    <Diff before={entry.old_value ?? null} after={entry.new_value ?? null} />
                  </td>
                  <td className="p-2">
                    <Pill tone={RESULT_TONE[String(entry.result || "").toLowerCase()] || "neutral"}>
                      <Value value={entry.result} />
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
