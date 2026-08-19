import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Lock } from "lucide-react";

import { getMotionConfig } from "../services/surveillanceApi";
import DeviceChannelPicker from "../components/DeviceChannelPicker";
import { BoolValue, Facts, Failed, Loading, PageHeader, Pill, ReadOnlyNotice, Section, Value } from "../components/SurveillanceUi";
import "../../../theme/ai-surface.css";

/**
 * Motion detection — read only.
 *
 * THE SENSITIVITY SCALE IS READ, NOT ASSUMED
 * ------------------------------------------
 * Most Dahua documentation describes motion sensitivity as 1–6. This recorder
 * reports 0–100. A UI that hardcoded 1–6 would render a device value of 60 as
 * ten times over maximum, and any future slider built on that assumption would
 * write a value the device interprets completely differently.
 *
 * So the scale bounds come from the device's own response
 * (`sensitivityMin`/`sensitivityMax`, detected by `detectSensitivityScale`) and
 * are DISPLAYED, so the operator can see which scale they are looking at.
 *
 * NOTHING HERE WRITES. Motion configuration decides what gets recorded on a
 * motion-triggered channel; changing it silently changes what evidence exists.
 */
export default function SurveillanceMotionSettings() {
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
      const response = await getMotionConfig(selection.deviceId, selection.channelIndex);
      setConfig(response?.motion || null);
    } catch { setFailed(true); setConfig(null); }
    setLoading(false);
  }, [selection.deviceId, selection.channelIndex]);

  useEffect(() => { void load(); }, [load]);

  const min = Number(config?.sensitivityMin);
  const max = Number(config?.sensitivityMax);
  const threshold = Number(config?.threshold);
  const hasScale = Number.isFinite(min) && Number.isFinite(max) && max > min;
  const pct = hasScale && Number.isFinite(threshold)
    ? Math.round(((threshold - min) / (max - min)) * 100)
    : null;

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={Activity}
        title={t("surveillance.motion.title")}
        subtitle={t("surveillance.motion.subtitle")}
        actions={<DeviceChannelPicker value={selection} onChange={setSelection} />}
      />

      <ReadOnlyNotice messageKey="surveillance.motion.readOnlyNotice" />

      {loading ? <Loading /> : failed ? <Failed messageKey="surveillance.motion.loadError" /> : !config ? (
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          {t("surveillance.settings.pickChannel")}
        </div>
      ) : (
        <>
          <Section
            title={t("surveillance.motion.detection")}
            right={<Pill tone="neutral"><Lock className="h-3 w-3" />{t("surveillance.settings.readOnly")}</Pill>}
          >
            <Facts rows={[
              { label: t("surveillance.motion.enabled"), value: <BoolValue value={config.enabled} /> },
              { label: t("surveillance.motion.detectVersion"), value: <Value value={config.detectVersion} /> },
              { label: t("surveillance.motion.regions"), value: <Value value={config.detectRegionCount} /> },
            ]} />
          </Section>

          <Section
            title={t("surveillance.motion.sensitivity")}
            subtitle={t("surveillance.motion.sensitivityNote")}
            right={hasScale
              // The scale itself is the headline, not a footnote: 60 means very
              // different things on 0-100 and on 1-6.
              ? <Pill tone="info">{t("surveillance.motion.scale", { min, max })}</Pill>
              : <Pill tone="warn">{t("surveillance.motion.scaleUnknown")}</Pill>}
          >
            <Facts rows={[
              { label: t("surveillance.motion.threshold"), value: <Value value={config.threshold} /> },
              { label: t("surveillance.motion.scaleMin"), value: <Value value={config.sensitivityMin} /> },
              { label: t("surveillance.motion.scaleMax"), value: <Value value={config.sensitivityMax} /> },
              { label: t("surveillance.motion.scaleSource"), value: <Value value={config.sensitivityScale} /> },
            ]} />

            {pct !== null && (
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                  <span className="tabular-nums">{min}</span>
                  <span className="tabular-nums">{t("surveillance.motion.currentOf", { value: threshold, max })}</span>
                  <span className="tabular-nums">{max}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
              </div>
            )}
          </Section>

          <Section title={t("surveillance.motion.actions")} subtitle={t("surveillance.motion.actionsNote")}>
            <Facts rows={[
              { label: t("surveillance.motion.recordOnMotion"), value: <BoolValue value={config.recordEnabled} /> },
              { label: t("surveillance.motion.recordSeconds"), value: <Value value={config.recordSeconds} suffix=" s" /> },
              { label: t("surveillance.motion.snapshotOnMotion"), value: <BoolValue value={config.snapshotEnabled} /> },
            ]} />
          </Section>
        </>
      )}
    </div>
  );
}
