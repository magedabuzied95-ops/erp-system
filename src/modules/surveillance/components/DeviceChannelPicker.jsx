import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { listChannels, listDevices } from "../services/surveillanceApi";

/**
 * Device + channel selector shared by the per-channel settings pages.
 *
 * Reports the device-local `channel_index`, not the ERP channel id: the
 * encoder, recording and motion endpoints are all addressed by the index the
 * recorder itself uses, and passing the ERP id would silently read a different
 * channel on any device where the two have drifted apart.
 */
export default function DeviceChannelPicker({ value, onChange }) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState([]);
  const [channels, setChannels] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await listDevices().catch(() => null);
      const list = response?.devices || [];
      if (cancelled) return;
      setDevices(list);
      if (!value.deviceId && list[0]) onChange({ deviceId: list[0].id, channelIndex: null });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!value.deviceId) return undefined;
    let cancelled = false;
    (async () => {
      const response = await listChannels(value.deviceId).catch(() => null);
      const list = response?.channels || [];
      if (cancelled) return;
      setChannels(list);
      if (list[0] && value.channelIndex === null) {
        onChange({ deviceId: value.deviceId, channelIndex: list[0].channel_index });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.deviceId]);

  const select = "h-[var(--control-height-md)] rounded-full border border-white/10 bg-white/[0.055] px-3 text-[12px] font-bold text-slate-200";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t("surveillance.settings.selectDevice")}
        className={select}
        value={value.deviceId ?? ""}
        onChange={(event) => onChange({ deviceId: Number(event.target.value), channelIndex: null })}
      >
        {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
      </select>

      <select
        aria-label={t("surveillance.settings.selectChannel")}
        className={select}
        value={value.channelIndex ?? ""}
        onChange={(event) => onChange({ deviceId: value.deviceId, channelIndex: Number(event.target.value) })}
      >
        {channels.map((channel) => (
          <option key={channel.id} value={channel.channel_index}>
            {channel.channel_index} — {channel.name}
          </option>
        ))}
      </select>
    </div>
  );
}
