import { useRef, useState } from "react";
import { sfText } from "../lib/sfText";
import { ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import { getStorefrontResponsiveImageProps } from "../../shared/lib/storefrontImage";
import ProductImageZoom from "./ProductImageZoom";

// The thumbnail's only child is a decorative photo, so the button carries the name
// (ProductImageZoom names its own thumbnails the same way).
const thumbnailLabel = (title, index, total) =>
  [String(title || "").trim(), sfText("storefront.products.thumbnailLabel", "Photo {{current}} of {{total}}", { current: index + 1, total })]
    .filter(Boolean)
    .join(" — ");

export default function StorefrontProductGallery({
  mainImage,
  displayTitle,
  galleryItems = [],
  selectedImage = "",
  activeImageIndex = 0,
  onSelectImage,
  onStepImage,
  imageFor,
  fallbackProductImage,
  mainImageRef = null,
}) {
  const thumbnailsRef = useRef(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  // The photos the viewer pages through; a product with no gallery still has its main photo.
  const zoomItems = galleryItems.length ? galleryItems : mainImage ? [{ image: mainImage }] : [];
  const zoomIndex = galleryItems.length && Number.isInteger(activeImageIndex) ? activeImageIndex : 0;

  // With a mouse, the photo magnifies around the cursor: the transform origin
  // follows the pointer and the :hover rule in productImageZoom.css scales it.
  const followHoverZoom = (event) => {
    if (event.pointerType !== "mouse") return;
    const image = mainImageRef?.current;
    if (!image) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    image.style.transformOrigin = `${x}% ${y}%`;
  };

  const scrollActiveThumbnailIntoView = (index) => {
    const element = thumbnailsRef.current?.querySelector?.(`[data-gallery-index="${index}"]`);
    element?.scrollIntoView?.({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  const stepGallery = (direction) => {
    onStepImage?.(direction);
    const nextIndex = Number.isInteger(activeImageIndex) ? activeImageIndex + direction : 0;
    window.setTimeout(() => scrollActiveThumbnailIntoView(nextIndex), 0);
  };

  return (
    <div className="min-w-0">
      <div
        onPointerMove={followHoverZoom}
        onClick={() => setZoomOpen(true)}
        className="sf-product-gallery-frame sfz-hover-zoom relative mx-auto h-[clamp(250px,42vh,340px)] w-full overflow-hidden p-2 md:h-[clamp(420px,58vh,540px)] md:p-5">
        <img ref={mainImageRef} src={imageFor(mainImage)} {...getStorefrontResponsiveImageProps(imageFor(mainImage), "hero")} onError={fallbackProductImage} alt={displayTitle} className="sf-product-main-image relative z-10 mx-auto h-full w-full object-contain md:max-h-full" loading="eager" decoding="async" fetchPriority="high" width="900" height="675" />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setZoomOpen(true);
          }}
          className="sfz-open"
          aria-label={sfText("storefront.products.zoomImage", "Zoom image")}
        >
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ProductImageZoom
        open={zoomOpen}
        items={zoomItems}
        index={zoomIndex}
        title={displayTitle}
        imageFor={imageFor}
        fallbackProductImage={fallbackProductImage}
        onIndexChange={(item, imageIndex) => {
          if (galleryItems.length) onSelectImage?.(item, imageIndex);
        }}
        onClose={() => setZoomOpen(false)}
      />
      {galleryItems.length > 1 ? (
        <div dir="ltr" className="sf-product-thumbnails mt-1.5 flex items-center gap-1.5 md:mt-3 md:gap-2">
          <button
            type="button"
            onClick={() => stepGallery(-1)}
            className="sf-product-thumb-nav"
            aria-label={sfText("storefront.products.previousImage")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div ref={thumbnailsRef} className="sf-scroll flex min-w-0 flex-1 snap-x snap-mandatory gap-1.5 overflow-x-auto pb-1 md:gap-2">
            {galleryItems.map((item, imageIndex) => {
              const image = item.image;
              const active = Number.isInteger(activeImageIndex) ? imageIndex === activeImageIndex : mainImage === image || selectedImage === image;
              return (
                <button
                  key={`${image}-${imageIndex}`}
                  type="button"
                  data-gallery-index={imageIndex}
                  onClick={() => onSelectImage?.(item, imageIndex)}
                  className={`sf-product-thumb shrink-0 snap-start${active ? " is-active" : ""}`}
                  aria-label={thumbnailLabel(displayTitle, imageIndex, galleryItems.length)}
                  aria-current={active ? "true" : undefined}
                >
                  <img src={imageFor(image)} {...getStorefrontResponsiveImageProps(imageFor(image), "thumbnail")} onError={fallbackProductImage} alt="" className="h-full w-full object-contain" loading="lazy" decoding="async" width="80" height="80" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => stepGallery(1)}
            className="sf-product-thumb-nav"
            aria-label={sfText("storefront.products.nextImage")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
