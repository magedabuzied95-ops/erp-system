import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Lock } from "lucide-react";

import { getRecordingConfig } from "../services/surveillanceApi";
import DeviceChannelPicker from "../components/DeviceChannelPicker";
import { BoolValue, Facts, Failed, Loading, PageHeader, Pill, ReadOnlyNotice, Section, Value } from "../components/SurveillanceUi";
import "../../../theme/ai-surface.css";

/**
 * Recording configuration — read only.
 *
 * THE SCHEDULE SHAPE THIS PAGE GETS RIGHT
 * ---------------------------------------
 * The recorder returns EIGHT schedule rows for a seven-day week. Row 0 is an
 * ALL-DAYS TEMPLATE, not Sunday. An earlier reading reported "scheduleDays: 8",
 * which is not a week — and had the rows been rendered in order, every day
 * would have been labelled one day late.
 *
 * So the template is shown separately, as what it is, and the seven real days
 * are numbered from row 1.
 *
 * NOTHING HERE WRITES. Changing a recording schedule decides what footage
 * exists tomorrow; getting it wrong is not recoverable by editing it back.
 */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export default function SurveillanceRecordingSettings() {
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
      const response = await getRecordingConfig(selection.deviceId, selection.channelIndex);
      setConfig(response?.recording || null);
    } catch { setFailed(true); setConfig(null); }
    setLoading(false);
  }, [selection.deviceId, selection.channelIndex]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={CalendarClock}
        title={t("surveillance.recording.title")}
        subtitle={t("surveillance.recording.subtitle")}
        actions={<DeviceChannelPicker value={selection} onChange={setSelection} />}
      />

      <ReadOnlyNotice messageKey="surveillance.recording.readOnlyNotice" />

      {loading ? <Loading /> : failed ? <Failed messageKey="surveillance.recording.loadError" /> : !config ? (
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          {t("surveillance.settings.pickChannel")}
        </div>
      ) : (
        <>
          <Section
            title={t("surveillance.recording.mode")}
            right={<Pill tone="neutral"><Lock className="h-3 w-3" />{t("surveillance.settings.readOnly")}</Pill>}
          >
            <Facts rows={[
              { label: t("surveillance.recording.modeLabel"), value: <Value value={config.mode ? t(`surveillance.recording.modes.${config.mode}`, { defaultValue: config.mode }) : null} /> },
              { label: t("surveillance.recording.modeRaw"), value: <Value value={config.modeRaw} /> },
              { label: t("surveillance.recording.preRecord"), value: <Value value={config.preRecordSeconds} suffix=" s" /> },
              { label: t("surveillance.recording.redundant"), value: <BoolValue value={config.redundant} /> },
              { label: t("surveillance.recording.hasSchedule"), value: <BoolValue value={config.hasSchedule} /> },
            ]} />
          </Section>

          <Section
            title={t("surveillance.recording.schedule")}
            subtitle={t("surveillance.recording.scheduleNote")}
          >
            <div className="flex flex-wrap items-center gap-2">
              {config.hasAllDaysTemplate && (
                // Named explicitly. Rendering it as "Sunday" would shift every
                // subsequent day by one — the exact off-by-one this avoids.
                <Pill tone="info">{t("surveillance.recording.allDaysTemplate")}</Pill>
              )}
              <span className="text-[12px] text-slate-400">
                {t("surveillance.recording.daysConfigured", {
                  count: Math.min(7, Number(config.scheduleDays) || 0),
                })}
              </span>
              {Number(config.scheduleRowCount) > 0 && (
                <span className="text-[11px] text-slate-600">
                  {t("surveillance.recording.rowCount", { count: config.scheduleRowCount })}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {DAY_KEYS.map((day, index) => (
                <Pill key={day} tone={index < (Number(config.scheduleDays) || 0) ? "ok" : "neutral"}>
                  {t(`surveillance.recording.days.${day}`)}
                </Pill>
              ))}
            </div>
          </Section>

          {Array.isArray(config.trigger) && config.trigger.length > 0 && (
            <Section title={t("surveillance.recording.triggers")} subtitle={t("surveillance.recording.triggersNote")}>
              <div className="flex flex-wrap gap-1.5">
                {config.trigger.map((trigger) => (
                  <Pill key={trigger} tone="neutral">
                    {t(`surveillance.recording.triggerNames.${trigger}`, { defaultValue: trigger })}
                  </Pill>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
