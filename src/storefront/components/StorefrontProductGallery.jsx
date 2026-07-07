import { getStorefrontResponsiveImageProps } from "../../shared/lib/storefrontImage";

export default function StorefrontProductGallery({
  mainImage,
  displayTitle,
  galleryItems = [],
  selectedImage = "",
  activeImageIndex = 0,
  onSelectImage,
  imageFor,
  fallbackProductImage,
  mainImageRef = null,
}) {
  return (
    <div className="min-w-0">
      <div className="sf-product-gallery-frame relative mx-auto h-[clamp(250px,42vh,340px)] w-full max-w-[92vw] overflow-hidden rounded-[24px] border border-stone-200 bg-[linear-gradient(180deg,#fbfaf7_0%,#f1ece4_100%)] p-2 shadow-[0_14px_40px_rgba(39,20,75,0.10)] md:h-[clamp(420px,58vh,540px)] md:max-w-none md:rounded-[1.75rem] md:p-5 md:shadow-[0_20px_55px_rgba(39,20,75,0.10)]">
        <div className="absolute inset-x-10 bottom-5 h-12 rounded-full bg-white/80 blur-2xl md:inset-x-16 md:bottom-8 md:h-16" />
        <img ref={mainImageRef} src={imageFor(mainImage)} {...getStorefrontResponsiveImageProps(imageFor(mainImage), "hero")} onError={fallbackProductImage} alt={displayTitle} className="sf-product-main-image relative z-10 mx-auto h-full w-full object-contain drop-shadow-[0_14px_18px_rgba(39,20,75,0.14)] md:max-h-full md:drop-shadow-[0_22px_26px_rgba(39,20,75,0.18)]" loading="eager" decoding="async" fetchPriority="high" width="900" height="675" />
      </div>
      {galleryItems.length > 1 ? (
        <div className="sf-product-thumbnails sf-scroll mt-1.5 flex snap-x snap-mandatory gap-1.5 overflow-x-auto pb-1 md:mt-3 md:gap-2">
          {galleryItems.map((item, imageIndex) => {
            const image = item.image;
            const active = Number.isInteger(activeImageIndex) ? imageIndex === activeImageIndex : mainImage === image || selectedImage === image;
            return (
              <button
                key={`${image}-${imageIndex}`}
                type="button"
                onClick={() => onSelectImage?.(item, imageIndex)}
                className={`sf-product-thumb h-12 w-12 shrink-0 snap-start overflow-hidden rounded-xl border bg-white p-1 transition-[background-color,border-color,box-shadow,opacity,transform] duration-200 hover:border-stone-900 hover:shadow-[0_10px_24px_rgba(39,20,75,0.10)] md:h-20 md:w-20 md:rounded-2xl md:p-1.5 ${active ? "border-stone-950 shadow-[0_12px_28px_rgba(39,20,75,0.14)]" : "border-stone-200"}`}
              >
                <img src={imageFor(image)} {...getStorefrontResponsiveImageProps(imageFor(image), "thumbnail")} onError={fallbackProductImage} alt="" className="h-full w-full object-contain" loading="lazy" decoding="async" width="80" height="80" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
