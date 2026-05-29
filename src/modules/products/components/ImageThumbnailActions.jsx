import { useState } from "react";
import { Eye, Star, X } from "lucide-react";
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
    <div className={`group relative overflow-visible rounded-2xl border bg-zinc-950/80 ${isPrimary ? "border-emerald-400/70" : "border-white/10"} ${className}`}>
      <div className="relative h-full w-full overflow-hidden rounded-2xl">
        <div className="pointer-events-none absolute inset-0 z-10 rounded-2xl bg-black/0 transition duration-200 group-hover:bg-black/40" />
        {src ? (
          <img src={src} alt={alt} className={`h-full w-full rounded-2xl transition duration-200 group-hover:scale-[1.04] ${imageClassName}`} />
        ) : (
          <div className="flex h-full min-h-20 w-full items-center justify-center rounded-2xl bg-white/5 text-xs font-bold text-zinc-500">
            {t("products.images.noImage", "No image")}
          </div>
        )}
      </div>

      {isPrimary ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-40 rounded-full bg-emerald-400 px-2 py-0.5 text-[9px] font-black text-black shadow-lg">
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
          className="absolute right-1.5 top-1.5 z-50 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-200/40 bg-red-500/90 text-white opacity-100 shadow-xl shadow-black/40 backdrop-blur-md transition duration-200 hover:scale-110 hover:bg-red-500 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200/70 disabled:cursor-not-allowed disabled:bg-zinc-700/85 disabled:text-zinc-300 disabled:hover:scale-100"
          aria-label={deleteDisabled ? deleteDisabledReason || t("products.images.deleteDisabled", "Delete disabled") : t("products.images.deleteImage", "Delete image")}
          title={deleteDisabled ? deleteDisabledReason || t("products.images.deleteDisabled", "Delete disabled") : t("products.actionsMenu.delete", "Delete")}
        >
          <X className="h-4 w-4 opacity-90 transition duration-200 group-hover:opacity-100" />
        </button>
      ) : null}

      <div className="absolute inset-x-1.5 bottom-1.5 z-40 flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/72 p-1 opacity-100 shadow-xl backdrop-blur-md transition duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <button
          type="button"
          onClick={preview}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20"
          aria-label={t("products.images.previewImage", "Preview image")}
          title={t("products.images.preview", "Preview")}
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        {onPrimary ? (
          <button
            type="button"
            onClick={() => onPrimary(image)}
            disabled={isPrimary}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-100 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t("products.images.setPrimaryImage", "Set as primary image")}
            title={t("products.images.setPrimary", "Set primary")}
          >
            <Star className="h-3.5 w-3.5" />
          </button>
        ) : null}
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
