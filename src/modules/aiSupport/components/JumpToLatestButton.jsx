import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

/*
 * The way back to the newest message. It only exists while the transcript is
 * scrolled away from its bottom, so it never sits on top of a bubble in the
 * normal, pinned state. Centred horizontally, so it reads the same in Arabic
 * and English — no side to pick, nothing to mirror.
 */
export default function JumpToLatestButton({ visible, onClick, positionClassName = "absolute bottom-3 left-1/2 -translate-x-1/2", style }) {
  const { t } = useTranslation();
  if (!visible) return null;
  const label = t("aiSupport.inbox.ui.jumpToLatest");
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={style}
      className={`${positionClassName} z-30 inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 text-[11px] font-black text-slate-700 shadow-lg shadow-slate-900/15 backdrop-blur transition hover:bg-white dark:border-white/15 dark:bg-slate-900/90 dark:text-slate-100 dark:hover:bg-slate-900`}
    >
      <ChevronDown className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
