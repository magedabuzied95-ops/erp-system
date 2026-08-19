import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Loader2, X } from "lucide-react";

import { captureSnapshot } from "../services/surveillanceApi";

/**
 * Capture a still from one channel.
 *
 * NOTHING IS KEPT UNLESS ASKED
 * ----------------------------
 * The server returns the bytes and forgets them. In the browser they live as an
 * object URL, and this component revokes it on close and on unmount — an
 * un-revoked blob URL keeps the image in memory for the life of the tab, which
 * is the client-side version of the silent archive the server refuses to build.
 *
 * "Save" does not change what is captured. It marks the audit record, so a
 * kept still is attributable to a person. Every capture is audited either way:
 * auditing only saves would let anyone photograph any camera and leave no trace
 * by simply not clicking save.
 */
export default function SnapshotButton({ deviceId, channelIndex, channelName }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const urlRef = useRef(null);

  const release = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setUrl(null);
  }, []);

  // Unmounting with the viewer open must not leak the blob.
  useEffect(() => release, [release]);

  const capture = useCallback(async ({ save = false } = {}) => {
    setBusy(true);
    setError(null);
    try {
      release();
      const next = await captureSnapshot(deviceId, channelIndex, { save });
      urlRef.current = next;
      setUrl(next);
    } catch (failure) {
      setError(
        failure?.status === 403 ? "surveillance.snapshot.forbidden"
          : failure?.status === 429 ? "surveillance.snapshot.rateLimited"
            : "surveillance.snapshot.failed",
      );
    }
    setBusy(false);
  }, [deviceId, channelIndex, release]);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void capture()}
        aria-label={t("surveillance.snapshot.capture")}
        className="inline-flex items-center gap-1 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
      </button>

      {error && <span className="ms-1 text-[10px] text-rose-300">{t(error)}</span>}

      {url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("surveillance.snapshot.title", { channel: channelName })}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={release}
        >
          <div
            className="flex max-h-full w-full max-w-3xl flex-col gap-3 rounded-[var(--radius-card)] border border-white/15 bg-[#12161c] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-black text-white">
                {t("surveillance.snapshot.title", { channel: channelName })}
              </h2>
              <button
                type="button"
                onClick={release}
                aria-label={t("surveillance.snapshot.close")}
                className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* object-contain, not fill: a still is evidence, and stretching it
                to the frame would misrepresent what the camera saw. The 1080N
                display correction applies to LIVE video, whose pixels are
                non-square; a JPEG from the device is already square-pixel. */}
            <img
              src={url}
              alt={t("surveillance.snapshot.title", { channel: channelName })}
              className="max-h-[70vh] w-full rounded object-contain"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">{t("surveillance.snapshot.notStoredNote")}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void capture({ save: true })}
                className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 text-[11px] font-black hover:border-white/30 disabled:opacity-50"
              >
                <Camera className="h-3.5 w-3.5" />
                {t("surveillance.snapshot.saveToAudit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
