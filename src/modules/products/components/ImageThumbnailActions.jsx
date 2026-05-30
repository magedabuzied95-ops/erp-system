import { useState } from "react";
import { Eye, Star, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const imageSource = (image = {}) =>
  String(
    image.preview ||
      image.image_url ||
      image.url ||
      image.product_image_url ||
      image.variant_image_url ||
      image.color_image_url ||
      image.image ||
      ""
  ).trim();

function ImageThumbnailActions({
  image,
  alt = "Product image",
  isPrimary = false,
  onDelete,
  onPrimary,
  onPreview,
  deleteDisabled = false,
  deleteDisabledReason = "",
  className = "",
  imageClassName = "object-cover",
  actions,
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const src = imageSource(image);

  const preview = () => {
    if (onPreview) {
      onPreview(image);
      return;
    }
    if (src && typeof window !== "undefined") {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      className={`group relative flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-zinc-950/80 p-2 shadow-lg shadow-black/10 ${
        isPrimary ? "border-emerald-400/70" : "border-white/10"
      } ${className}`}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/8 bg-black/30">
        {src ? (
          <img src={src} alt={alt} className={`h-full w-full transition duration-200 group-hover:scale-[1.03] ${imageClassName}`} />
        ) : (
          <div className="flex h-full min-h-20 w-full items-center justify-center bg-white/5 text-xs font-bold text-zinc-500">
            {t("products.images.noImage", "No image")}
          </div>
        )}

        {isPrimary ? (
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-emerald-400 px-2 py-0.5 text-[9px] font-black text-black shadow-lg">
            {t("products.images.main", "Main")}
          </span>
        ) : null}

        {onDelete ? (
          <button
            type="button"
            onClick={() => {
              if (!deleteDisabled) setConfirming(true);
            }}
            disabled={deleteDisabled}
            className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200/40 bg-red-500/95 text-white shadow-xl shadow-black/40 backdrop-blur-md transition duration-200 hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200/70 disabled:cursor-not-allowed disabled:bg-zinc-700/85 disabled:text-zinc-300"
            aria-label={deleteDisabled ? deleteDisabledReason || t("products.images.deleteDisabled", "Delete disabled") : t("products.images.deleteImage", "Delete image")}
            title={deleteDisabled ? deleteDisabledReason || t("products.images.deleteDisabled", "Delete disabled") : t("products.actionsMenu.delete", "Delete")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="mt-2 flex min-h-8 items-center gap-1.5">
        <button
          type="button"
          onClick={preview}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/8 text-white transition hover:bg-white/15"
          aria-label={t("products.images.previewImage", "Preview image")}
          title={t("products.images.preview", "Preview")}
        >
          <Eye className="h-4 w-4" />
        </button>
        {onPrimary ? (
          <button
            type="button"
            onClick={() => onPrimary(image)}
            disabled={isPrimary}
            className={`inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border border-emerald-300/15 bg-emerald-400/12 px-2 text-[10px] font-black text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-55 ${
              actions ? "w-8 flex-none" : "flex-1"
            }`}
            aria-label={t("products.images.setPrimaryImage", "Set as primary image")}
            title={t("products.images.setPrimary", "Set primary")}
          >
            <Star className="h-3.5 w-3.5 shrink-0" />
            {actions ? null : (
              <span className="truncate">{isPrimary ? t("products.images.main", "Main") : t("products.images.setPrimary", "Set main")}</span>
            )}
          </button>
        ) : null}
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>

      {confirming ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/86 p-2 text-center backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="absolute right-1.5 top-1.5 rounded-full bg-white/10 p-1 text-white hover:bg-white/20"
            aria-label={t("products.images.cancelDelete", "Cancel delete")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="text-[11px] font-black text-white">{t("products.images.confirmDelete", "Delete image?")}</div>
          <div className="grid w-full grid-cols-2 gap-1">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg bg-white/10 px-2 py-1.5 text-[10px] font-bold text-white">
              {t("common.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete?.(image);
              }}
              className="rounded-lg bg-red-500 px-2 py-1.5 text-[10px] font-black text-white"
            >
              {t("products.actionsMenu.delete", "Delete")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ImageThumbnailActions;
