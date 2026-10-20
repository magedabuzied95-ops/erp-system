import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, RefreshCw, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { metaErrorMessage } from "../../../shared/metaAdsApi";
import { uploadMedia } from "../wizardApi";
import { localPreviewKind, previewUrlFor, rememberPreview } from "./mediaPreviews";

const MAX_BYTES = 30 * 1024 * 1024;

// One dashed upload tile. kind = "image" | "video" | "any".
export default function MediaTile({ media, onChange, kind = "any", accountId, label, compact = false }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  const accept = kind === "image" ? "image/jpeg,image/png" : kind === "video" ? "video/mp4,video/quicktime" : "image/jpeg,image/png,video/mp4,video/quicktime";

  const onFile = async (file) => {
    if (!file) return;
    setError("");
    if (file.size > MAX_BYTES) {
      setError(t("metaAdsWizard.ad.fileTooBig"));
      return;
    }
    setProgress(0);
    try {
      const res = await uploadMedia({ file, accountId, onProgress: setProgress });
      const next =
        res.type === "video"
          ? { type: "video", video_id: res.video_id, thumbnail_url: res.thumbnail_url || "", url: res.thumbnail_url || "", name: file.name }
          : { type: "image", image_hash: res.image_hash, url: res.url || "", name: file.name };
      rememberPreview(next, file);
      onChange(next);
    } catch (err) {
      setError(metaErrorMessage(err) || t("metaAdsWizard.ad.uploadFailed"));
    } finally {
      setProgress(null);
    }
  };

  const preview = previewUrlFor(media);
  const previewKind = localPreviewKind(media);
  const Icon = kind === "video" ? Video : ImagePlus;

  return (
    <div className={`wz-media ${compact ? "wz-media--compact" : ""}`.trim()}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {media ? (
        <div className="wz-media__filled">
          {preview && !(media.type === "video" && previewKind === "video") ? (
            <img src={preview} alt="" className="wz-media__img" />
          ) : preview ? (
            <video src={preview} className="wz-media__img" muted playsInline />
          ) : (
            <span className="wz-media__placeholder"><Video size={22} /></span>
          )}
          <div className="wz-media__bar">
            <button type="button" className="wz-icon-btn" onClick={() => inputRef.current?.click()} aria-label={t("metaAdsWizard.ad.replaceMedia")} title={t("metaAdsWizard.ad.replaceMedia")}>
              <RefreshCw size={14} />
            </button>
            <button type="button" className="wz-icon-btn" onClick={() => onChange(null)} aria-label={t("metaAdsWizard.common.remove")} title={t("metaAdsWizard.common.remove")}>
              <X size={14} />
            </button>
          </div>
          {media.type === "video" ? <span className="wz-media__badge"><Video size={12} /></span> : null}
        </div>
      ) : (
        <button type="button" className="wz-media__empty" onClick={() => inputRef.current?.click()} disabled={progress !== null}>
          {progress !== null ? <LoaderCircle size={22} className="m1-spin" /> : <Icon size={22} />}
          {label && !compact ? <span>{label}</span> : null}
        </button>
      )}
      {progress !== null ? (
        <div className="wz-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {error ? <div className="wz-error">{error}</div> : null}
    </div>
  );
}
