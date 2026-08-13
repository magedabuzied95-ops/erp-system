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
  alt = "",
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
      className={`group relative h-24 w-24 overflow-hidden rounded-[var(--radius-control)] border bg-surface-soft shadow-[var(--shadow-card)] ${ isPrimary ? "border-primary" : "border-border" } ${className}`}
    >
      {src ? (
        <img src={src} alt={alt || t("products.images.productImage")} className={`h-full w-full transition duration-200 group-hover:scale-[1.03] ${imageClassName}`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-surface-soft text-xs font-bold text-text-muted">
          {t("products.images.noImage", "No image")}
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/20" />

      {isPrimary ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-black leading-none text-[var(--primary-contrast)] shadow-lg">
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
          className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-red-200/35 bg-red-500/95 text-white shadow-lg shadow-black/35 backdrop-blur-md transition duration-200 hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200/70 disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-text-muted"
          aria-label={deleteDisabled ? deleteDisabledReason || t("products.images.deleteDisabled", "Delete disabled") : t("products.images.deleteImage", "Delete image")}
          title={deleteDisabled ? deleteDisabledReason || t("products.images.deleteDisabled", "Delete disabled") : t("products.actionsMenu.delete", "Delete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={preview}
        className="absolute left-1/2 top-1/2 inline-flex h-[var(--control-height-sm)] w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white opacity-0 shadow-lg backdrop-blur-md transition duration-200 hover:bg-black/80 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        aria-label={t("products.images.previewImage", "Preview image")}
        title={t("products.images.preview", "Preview")}
      >
        <Eye className="h-4 w-4" />
      </button>

      {onPrimary && !isPrimary ? (
        <button
          type="button"
          onClick={() => onPrimary(image)}
          className="absolute bottom-1.5 left-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-200/25 bg-black/65 text-emerald-100 opacity-0 shadow-lg backdrop-blur-md transition duration-200 hover:bg-emerald-500/25 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/60"
          aria-label={t("products.images.setPrimaryImage", "Set as primary image")}
          title={t("products.images.setPrimary", "Set main")}
        >
          <Star className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {actions ? <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">{actions}</div> : null}

      {confirming ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] bg-black/86 p-2 text-center backdrop-blur-sm">
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
            <button type="button" onClick={() => setConfirming(false)} className="rounded-[var(--radius-control)] bg-white/10 px-2 py-1.5 text-[10px] font-bold text-white">
              {t("common.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete?.(image);
              }}
              className="rounded-[var(--radius-control)] bg-red-500 px-2 py-1.5 text-[10px] font-black text-white"
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
