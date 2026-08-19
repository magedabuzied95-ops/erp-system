import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Film, Lock } from "lucide-react";

import { getEncoderConfig } from "../services/surveillanceApi";
import DeviceChannelPicker from "../components/DeviceChannelPicker";
import { Facts, Failed, Loading, PageHeader, Pill, ReadOnlyNotice, Section, Value } from "../components/SurveillanceUi";
import "../../../theme/ai-surface.css";

/**
 * Encoder settings — read now, write prepared and deliberately not armed.
 *
 * WHY THE WRITE PATH IS BUILT BUT DISABLED
 * ----------------------------------------
 * One real encoder write has been performed against this recorder: Channel 1's
 * main-stream bitrate, 512 to 2048 kbps, under an explicit single-purpose
 * authorisation, with a dry run, a three-field diff and a post-write read-back.
 * It worked, and that is the proof that the write machinery is sound.
 *
 * Changing channels 2–16 is a MASS encoder change and a materially different
 * recording configuration — two separate approval gates. So the UI shows the
 * full prepared workflow and refuses to run it. A form that looks live but
 * silently no-ops would be worse than either alternative; this one says why.
 *
 * The safeguards the workflow carries when it is eventually armed, all already
 * implemented server-side: permission check, owner guard, typed allowlisted
 * parameter, strong confirmation token, audit entry, before-snapshot, semantic
 * diff, post-write verification, rollback.
 */

const profileRows = (t, profile) => [
  { label: t("surveillance.video.codec"), value: <Value value={profile?.codec ? String(profile.codec).toUpperCase() : null} /> },
  { label: t("surveillance.video.resolution"), value: profile?.width && profile?.height ? `${profile.width}×${profile.height}` : <Value value={null} /> },
  { label: t("surveillance.video.fps"), value: <Value value={profile?.fps} /> },
  { label: t("surveillance.video.bitrate"), value: <Value value={profile?.bitrateKbps ?? profile?.bitrate_kbps} suffix=" kbps" /> },
  { label: t("surveillance.video.rateControl"), value: <Value value={profile?.bitrateControl ?? profile?.rate_control} /> },
  { label: t("surveillance.video.profile"), value: <Value value={profile?.profile} /> },
];

export default function SurveillanceVideoSettings() {
  const { t } = useTranslation();
  const [selection, setSelection] = useState({ deviceId: null, channelIndex: null });
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!selection.deviceId || selection.channelIndex === null) return;
    setLoading(true);
    setFailed(false);
    try {
      const response = await getEncoderConfig(selection.deviceId, selection.channelIndex);
      setConfig(response?.encoder || null);
    } catch {
      setFailed(true);
      setConfig(null);
    }
    setLoading(false);
  }, [selection.deviceId, selection.channelIndex]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={Film}
        title={t("surveillance.video.title")}
        subtitle={t("surveillance.video.subtitle")}
        actions={<DeviceChannelPicker value={selection} onChange={setSelection} />}
      />

      <ReadOnlyNotice messageKey="surveillance.video.writeGateNotice" />

      {loading ? <Loading /> : failed ? <Failed messageKey="surveillance.video.loadError" /> : !config ? (
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          {t("surveillance.settings.pickChannel")}
        </div>
      ) : (
        <>
          <Section
            title={t("surveillance.video.mainStream")}
            subtitle={t("surveillance.video.mainStreamNote")}
            right={<Pill tone="neutral"><Lock className="h-3 w-3" />{t("surveillance.settings.readOnly")}</Pill>}
          >
            <Facts rows={profileRows(t, config.main)} />
          </Section>

          <Section
            title={t("surveillance.video.subStream")}
            subtitle={t("surveillance.video.subStreamNote")}
            right={<Pill tone="neutral"><Lock className="h-3 w-3" />{t("surveillance.settings.readOnly")}</Pill>}
          >
            <Facts rows={profileRows(t, config.extra)} />
          </Section>

          <Section title={t("surveillance.video.writeWorkflow")} subtitle={t("surveillance.video.writeWorkflowNote")}>
            {/* The steps are listed rather than hidden so the operator can see
                exactly what a future approved change will do to their recorder
                before they approve it. */}
            <ol className="grid grid-cols-1 gap-1.5 text-[12px] text-slate-400 sm:grid-cols-2">
              {[
                "permission", "owner", "confirm", "allowlist", "snapshot",
                "diff", "apply", "verify", "audit", "rollback",
              ].map((step, index) => (
                <li key={step} className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0 text-end font-mono text-[10px] text-slate-600">{index + 1}</span>
                  <span>{t(`surveillance.video.step.${step}`)}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100">
              {t("surveillance.video.channel1Note")}
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
