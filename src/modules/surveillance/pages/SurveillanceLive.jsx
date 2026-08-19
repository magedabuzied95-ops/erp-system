import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Cpu, Grid2x2, Grid3x3, Loader2, RefreshCw, Square, Video } from "lucide-react";

import CameraTile from "../components/CameraTile";
import { getMediaCapacity, listChannels, listDevices } from "../services/surveillanceApi";
import "../../../theme/ai-surface.css";

/**
 * The layouts an operator can pick.
 *
 * Capped at 16 because that is the reference recorder's channel count, and
 * because the measured hardware ceiling is ~16 simultaneous transcodes. A 25-up
 * option would be a promise the host cannot keep.
 */
const LAYOUTS = [
  { tiles: 1, icon: Square, cols: "grid-cols-1" },
  { tiles: 4, icon: Grid2x2, cols: "grid-cols-1 sm:grid-cols-2" },
  { tiles: 9, icon: Grid3x3, cols: "grid-cols-2 lg:grid-cols-3" },
  { tiles: 16, icon: Grid3x3, cols: "grid-cols-2 lg:grid-cols-4" },
];

export default function SurveillanceLive() {
  const { t } = useTranslation();
  const [channels, setChannels] = useState([]);
  const [capacity, setCapacity] = useState(null);
  const [tiles, setTiles] = useState(4);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [deviceResponse, capacityResponse] = await Promise.all([
        listDevices(),
        getMediaCapacity().catch(() => null),
      ]);
      setCapacity(capacityResponse?.capacity || null);

      const devices = deviceResponse?.devices || [];
      const collected = [];
      for (const device of devices) {
        const response = await listChannels(device.id).catch(() => null);
        for (const channel of response?.channels || []) {
          collected.push({ ...channel, device_name: device.name });
        }
      }
      setChannels(collected);
    } catch {
      setLoadError(true);
      setChannels([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const layout = LAYOUTS.find((item) => item.tiles === tiles) || LAYOUTS[1];

  /**
   * Never offer a layout the host cannot serve.
   *
   * On a software encoder the measured ceiling is ONE camera. Rendering a
   * 16-tile grid there does not degrade gracefully: every tile stutters and the
   * point-of-sale sharing the machine goes with it. Better to show what is
   * possible and say why the rest is not.
   */
  const maxTiles = capacity?.max_concurrent_transcodes ?? 16;
  const effectiveTiles = Math.min(tiles, Math.max(1, maxTiles));
  const capped = effectiveTiles < tiles;

  const pageCount = Math.max(1, Math.ceil(channels.length / effectiveTiles));
  const visible = useMemo(() => {
    const start = Math.min(page, pageCount - 1) * effectiveTiles;
    return channels.slice(start, start + effectiveTiles);
  }, [channels, page, pageCount, effectiveTiles]);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
              <Video className="h-4 w-4" />
              {t("surveillance.eyebrow")}
            </div>
            <h1 className="m1-page-title mt-1">{t("surveillance.live.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("surveillance.live.subtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {LAYOUTS.map(({ tiles: count, icon: Icon }) => (
              <button
                key={count}
                type="button"
                onClick={() => { setTiles(count); setPage(0); }}
                aria-pressed={tiles === count}
                className={`inline-flex h-[var(--control-height-md)] items-center gap-1.5 rounded-full border px-3 text-[11px] font-black ${
                  tiles === count
                    ? "border-primary/60 bg-primary/15 text-white"
                    : "border-white/10 bg-white/[0.055] text-slate-300 hover:border-white/20"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {count}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("surveillance.refresh")}
            </button>
          </div>
        </div>

        {capacity && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5" />
              {capacity.hardware_accelerated
                ? t("surveillance.live.hardwareOn", { encoder: capacity.encoder })
                : t("surveillance.live.hardwareOff")}
            </span>
            <span>{t("surveillance.live.capacity", { count: capacity.max_concurrent_transcodes })}</span>
          </div>
        )}

        {capped && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[12px] text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("surveillance.live.cappedNotice", { requested: tiles, allowed: effectiveTiles })}</span>
          </div>
        )}
      </section>

      {loading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("surveillance.loading")}
        </div>
      ) : loadError ? (
        <div className="rounded-[var(--radius-card)] border border-rose-300/25 bg-rose-300/10 p-6 text-sm text-rose-100">
          {t("surveillance.live.loadError")}
        </div>
      ) : channels.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
          {t("surveillance.live.noChannels")}
        </div>
      ) : (
        <>
          <div className={`grid gap-3 ${layout.cols}`}>
            {visible.map((channel) => (
              // The key includes the tile count: changing layout changes the
              // profile the server picks, so the tile must remount and reopen
              // rather than keep playing a stream chosen for a different grid.
              <CameraTile
                key={`${channel.id}-${effectiveTiles}`}
                channel={channel}
                tileCount={effectiveTiles}
              />
            ))}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-2">
              {Array.from({ length: pageCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setPage(index)}
                  aria-label={t("surveillance.live.page", { number: index + 1 })}
                  className={`h-2.5 w-2.5 rounded-full ${index === page ? "bg-primary" : "bg-white/20 hover:bg-white/40"}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
