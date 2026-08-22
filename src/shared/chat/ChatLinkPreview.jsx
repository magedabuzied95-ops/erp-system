import { memo, useEffect, useState } from "react";

/*
 * OpenGraph card under a message that contains a link (first URL only), the
 * way WhatsApp shows one. Previews are fetched through the caller's adapter
 * (`fetchLinkPreview(url)`) and memoised per URL for the session; a URL with
 * no usable metadata renders nothing.
 */
const previewCache = new Map(); // url -> Promise<preview|null>

const firstUrl = (body = "") => {
  const match = String(body || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return "";
  return match[0].replace(/[.,!?:;)\]}]+$/, "");
};

function ChatLinkPreview({ body, fetchLinkPreview, outgoing }) {
  const url = firstUrl(body);
  const [preview, setPreview] = useState(() => (url && previewCache.has(url) ? undefined : null));

  useEffect(() => {
    if (!url || !fetchLinkPreview) return undefined;
    let cancelled = false;
    if (!previewCache.has(url)) {
      previewCache.set(url, Promise.resolve(fetchLinkPreview(url)).then((response) => response?.preview || null).catch(() => null));
    }
    previewCache.get(url).then((value) => { if (!cancelled) setPreview(value); });
    return () => { cancelled = true; };
  }, [url, fetchLinkPreview]);

  if (!url || !preview) return null;
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={`mb-1.5 block overflow-hidden rounded-[0.7rem] border-s-[4px] border-[var(--chat-quote)] text-inherit no-underline ${outgoing ? "bg-black/10" : "bg-[var(--chat-input)]"}`}
      dir="auto"
    >
      {preview.image ? <img src={preview.image} alt="" className="block max-h-40 w-full object-cover" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
      <span className="block px-3 py-2">
        {preview.title ? <span className="line-clamp-2 text-[13px] font-black leading-5">{preview.title}</span> : null}
        {preview.description ? <span className="line-clamp-2 text-[12px] font-medium leading-4 text-[var(--chat-muted)]">{preview.description}</span> : null}
        <span className="mt-0.5 block truncate text-[11px] font-semibold text-[var(--chat-muted)]" dir="ltr">{preview.site_name || host}</span>
      </span>
    </a>
  );
}

export default memo(ChatLinkPreview);
