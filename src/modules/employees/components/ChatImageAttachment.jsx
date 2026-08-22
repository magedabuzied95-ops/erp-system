import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

const fetchImageDiagnostics = async (src) => {
  const safeSrc = String(src || "").trim();
  if (!safeSrc || typeof window === "undefined" || typeof fetch !== "function") return;

  const logResult = async (response, method) => {
    const contentType = response.headers.get("content-type") || "";
    console.info("[employee-chat:image-fetch-check]", {
      src: safeSrc,
      method,
      status: response.status,
      contentType,
      redirected: response.redirected,
      finalUrl: response.url || safeSrc,
    });
  };

  try {
    const headResponse = await fetch(safeSrc, { method: "HEAD" });
    await logResult(headResponse, "HEAD");
    return;
  } catch (headError) {
    console.info("[employee-chat:image-fetch-check]", {
      src: safeSrc,
      method: "HEAD",
      status: null,
      contentType: "",
      redirected: false,
      finalUrl: safeSrc,
      error: headError instanceof Error ? headError.message : String(headError || ""),
    });
  }

  try {
    const getResponse = await fetch(safeSrc, { method: "GET" });
    await logResult(getResponse, "GET");
  } catch (getError) {
    console.info("[employee-chat:image-fetch-check]", {
      src: safeSrc,
      method: "GET",
      status: null,
      contentType: "",
      redirected: false,
      finalUrl: safeSrc,
      error: getError instanceof Error ? getError.message : String(getError || ""),
    });
  }
};

export default function ChatImageAttachment({ src, alt = "", compact = false, onClick, originalUrl = "", messageId = null }) {
  const { t } = useTranslation();
  const imageAlt = alt || t("employeePortal.chrome.image");
  const safeSrc = String(src || "").trim();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [safeSrc]);

  if (!safeSrc) {
    return (
      <div className="mb-1 inline-flex min-h-9 max-w-full items-center gap-2 rounded-xl border border-[var(--chat-border)] bg-black/10 px-2 py-1.5 text-[11px] font-bold leading-4 text-[var(--chat-text)]/80">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate" dir="auto">{t("employeePortal.chrome.imageUnavailable")}</span>
      </div>
    );
  }

  if (failed) {
    return (
      <a href={safeSrc} target="_blank" rel="noreferrer" className="mb-1 inline-flex min-h-9 max-w-full items-center gap-2 rounded-xl border border-[var(--chat-border)] bg-black/10 px-2 py-1.5 text-[11px] font-bold leading-4 text-[var(--chat-text)]/80 no-underline">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate" dir="auto">{t("employeePortal.chrome.openImage")}</span>
      </a>
    );
  }

  const handleError = (event) => {
    const image = event.currentTarget;
    console.warn("[employee-chat:image-broken]", {
      src: safeSrc,
      originalUrl: String(originalUrl || "").trim(),
      messageId,
      naturalWidth: image?.naturalWidth || 0,
      naturalHeight: image?.naturalHeight || 0,
    });
    void fetchImageDiagnostics(safeSrc);
    setFailed(true);
  };

  return (
    <button type="button" onClick={() => onClick?.(safeSrc)} className="mb-1 inline-block max-w-full overflow-hidden rounded-[var(--radius-control)] border border-[var(--chat-border)] bg-black/5 text-start align-top">
      <img
        src={safeSrc}
        alt={imageAlt}
        className={`${compact ? "max-h-44 max-w-[16rem]" : "max-h-52 max-w-[20rem]"} h-auto w-auto object-cover`}
        loading="lazy"
        decoding="async"
        onError={handleError}
      />
    </button>
  );
}
