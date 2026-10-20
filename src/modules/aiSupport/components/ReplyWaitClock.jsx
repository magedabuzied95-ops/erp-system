import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock3 } from "lucide-react";

/*
 * The clock in the reply box: how long the customer in the open thread has
 * been waiting for an answer (Genie ERP shows the same one).
 *
 * "Waiting" is the inbox's unread rule — customer messages newer than the
 * last outbound of any kind (staff, AI, product card) — and the wait runs from
 * the FIRST of those, because that is when the customer started waiting. When
 * the newest message is ours nobody is waiting and the clock is not drawn.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const tone = (ms) =>
  ms >= HOUR
    ? "text-rose-500 dark:text-rose-400"
    : ms >= 15 * MINUTE
      ? "text-amber-500 dark:text-amber-300"
      : "text-emerald-600 dark:text-emerald-400";

function relativeWait(ms, language, t) {
  // Latin digits, like the rest of the inbox.
  const locale = `${String(language || "ar").split("-")[0]}-u-nu-latn`;
  let format;
  try {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  } catch {
    format = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  }
  if (ms < MINUTE) return t("aiSupport.inbox.orbit.now");
  if (ms < HOUR) return format.format(-Math.floor(ms / MINUTE), "minute");
  if (ms < DAY) return format.format(-Math.floor(ms / HOUR), "hour");
  return format.format(-Math.floor(ms / DAY), "day");
}

export default function ReplyWaitClock({ since = 0 }) {
  const { t, i18n } = useTranslation();
  // A minute tick keeps the label honest without re-rendering the composer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const waitMs = Math.max(0, now - since);
  const ago = relativeWait(waitMs, i18n.language, t);
  const label = t("aiSupport.inbox.composer.customerWaiting", { time: ago });
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={label}
      data-reply-wait-clock="true"
      className={`group relative mb-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg outline-none transition hover:bg-slate-200/70 focus-visible:bg-slate-200/70 dark:hover:bg-white/10 dark:focus-visible:bg-white/10 ${tone(waitMs)}`}
    >
      <Clock3 className="h-5 w-5" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ background: "#1f2937", color: "#f8fafc" }}
      >
        {ago}
      </span>
    </span>
  );
}
