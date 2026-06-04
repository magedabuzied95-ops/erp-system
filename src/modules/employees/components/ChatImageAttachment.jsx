import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

export default function ChatImageAttachment({ src, alt = "Image", compact = false, onClick }) {
  const safeSrc = String(src || "").trim();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [safeSrc]);

  if (!safeSrc || failed) {
    return (
      <div className="mb-1 inline-flex min-h-9 max-w-full items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-2 py-1.5 text-[11px] font-bold leading-4 text-slate-200/80">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate" dir="auto">Image unavailable</span>
      </div>
    );
  }

  const handleError = (event) => {
    console.warn("[employee-chat:image-broken]", {
      src: safeSrc,
      currentSrc: event.currentTarget?.currentSrc || "",
      alt,
    });
    setFailed(true);
  };

  return (
    <button type="button" onClick={() => onClick?.(safeSrc)} className="mb-1 inline-block max-w-full overflow-hidden rounded-xl border border-black/5 bg-black/5 text-start align-top">
      <img
        src={safeSrc}
        alt={alt}
        className={`${compact ? "max-h-44 max-w-[16rem]" : "max-h-52 max-w-[20rem]"} h-auto w-auto object-cover`}
        loading="lazy"
        decoding="async"
        onError={handleError}
      />
    </button>
  );
}
