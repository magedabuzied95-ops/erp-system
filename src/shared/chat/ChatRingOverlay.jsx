import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MessageSquareReply, PhoneCall, PhoneOff } from "lucide-react";

/*
 * Full-screen incoming-ring sheet. Portaled to <body> so it sits above POS
 * modals and portal tabs alike; the pulsing icon is the only animation.
 */
export default function ChatRingOverlay({ ring, onAnswer, onReply, onDismiss }) {
  const { t } = useTranslation();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!ring) return undefined;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [ring]);

  if (!ring || typeof document === "undefined") return null;

  const remaining = Math.max(0, Math.round((ring.expires_at - Date.now()) / 1000));
  const name = ring.sender_name || (ring.sender_type === "admin" ? t("common.chatRing.management") : t("common.chatRing.someone"));

  return createPortal(
    <div role="alertdialog" aria-live="assertive" aria-label={t("common.chatRing.incoming")} className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="chat-ring-card w-full max-w-sm rounded-[28px] border border-amber-300/30 bg-[linear-gradient(180deg,#1c1917,#0c0a09)] p-6 text-center text-white shadow-[0_40px_120px_rgba(0,0,0,0.7)]">
        <div className="chat-ring-pulse mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-amber-400 text-zinc-950 shadow-[0_0_0_0_rgba(245,158,11,0.6)]">
          <PhoneCall className="h-11 w-11" />
        </div>
        <div className="mt-5 text-[11px] font-black uppercase tracking-[0.22em] text-amber-300/80">{t("common.chatRing.incoming")}</div>
        <div className="mt-1 text-2xl font-black leading-tight" dir="auto">{name}</div>
        <div className="mt-2 text-sm font-semibold text-zinc-400">{t("common.chatRing.incomingHint")}</div>
        <div className="mt-1 text-[11px] font-bold tabular-nums text-zinc-500">{t("common.chatRing.expiresIn", { seconds: remaining })}</div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onAnswer}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-base font-black text-white shadow-[0_12px_30px_rgba(16,185,129,0.35)] active:scale-95"
          >
            <PhoneCall className="h-5 w-5" />
            {t("common.chatRing.answer")}
          </button>
          <button
            type="button"
            onClick={onReply || onAnswer}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 text-base font-black text-white active:scale-95"
          >
            <MessageSquareReply className="h-5 w-5" />
            {t("common.chatRing.reply")}
          </button>
        </div>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-300">
            <PhoneOff className="h-3.5 w-3.5" />
            {t("common.chatRing.silence")}
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export function ChatRingStatus({ outgoing, onClear }) {
  const { t } = useTranslation();
  if (!outgoing) return null;
  const tone =
    outgoing.status === "answered"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      : outgoing.status === "missed"
        ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
        : "border-amber-300/30 bg-amber-400/10 text-amber-100";
  const label =
    outgoing.status === "answered"
      ? t("common.chatRing.answeredBy", { name: outgoing.answered_by || t("common.chatRing.someone"), seconds: outgoing.seconds || 0 })
      : outgoing.status === "missed"
        ? t("common.chatRing.missed")
        : t("common.chatRing.ringing");
  return (
    <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold ${tone}`} role="status">
      <PhoneCall className={`h-4 w-4 shrink-0 ${outgoing.status === "ringing" ? "animate-pulse" : ""}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {outgoing.status !== "ringing" && onClear ? (
        <button type="button" onClick={onClear} className="shrink-0 text-[11px] font-black underline-offset-2 hover:underline">
          {t("common.chatRing.dismiss")}
        </button>
      ) : null}
    </div>
  );
}
