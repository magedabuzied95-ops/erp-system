import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";

const asArray = (value) => (Array.isArray(value) ? value : []);
const firstName = (value = "") => String(value || "").trim().split(/\s+/)[0] || "";

const describe = (t, viewers) => {
  const list = asArray(viewers);
  if (!list.length) return "";
  if (list.length === 1) return t("aiSupport.teamTools.presence.replying", { name: firstName(list[0].name) });
  if (list.length === 2) return t("aiSupport.teamTools.presence.replyingTwo", { first: firstName(list[0].name), second: firstName(list[1].name) });
  return t("aiSupport.teamTools.presence.replyingMany", { name: firstName(list[0].name), count: list.length - 1 });
};

// On a list row: who else has this conversation open. Tiny, so the row keeps its height.
export function StaffViewersChip({ viewers = [], light = false }) {
  const { t } = useTranslation();
  const list = asArray(viewers);
  if (!list.length) return null;
  return (
    <span
      title={describe(t, list)}
      className={`inline-flex max-w-[140px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-black ${light ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200" : "bg-violet-400/15 text-violet-200 ring-1 ring-violet-300/25"}`}
      data-staff-presence="chip"
    >
      <Eye className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{list.map((viewer) => firstName(viewer.name)).join("، ")}</span>
    </span>
  );
}

// Above the thread: a banner the operator cannot miss before they start typing.
export function StaffViewersBanner({ viewers = [], light = false, className = "" }) {
  const { t } = useTranslation();
  const list = asArray(viewers);
  if (!list.length) return null;
  return (
    <div
      role="status"
      data-staff-presence="banner"
      className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] font-black ${light ? "border-violet-200 bg-violet-50 text-violet-800" : "border-violet-300/25 bg-violet-400/10 text-violet-100"} ${className}`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
      </span>
      <span className="min-w-0 truncate">{describe(t, list)}</span>
    </div>
  );
}
