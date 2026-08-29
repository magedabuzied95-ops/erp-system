import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  disableInboxPush,
  enableInboxPush,
  inboxNotificationPermission,
  inboxPushSupported,
  playInboxChime,
  readInboxNotificationPrefs,
  sendInboxPushTest,
  writeInboxNotificationPrefs,
} from "../services/inboxNotifications";

// Shared by both inbox surfaces. The browser only hands out notification
// permission from inside a user gesture, so there has to be something to click —
// re-subscribing on load can keep an existing grant alive but can never create one.

const STATUS_TEXT = {
  granted: "الإشعارات مفعّلة",
  denied: "الإشعارات محظورة من إعدادات المتصفح",
  default: "الإشعارات غير مفعّلة",
  unsupported: "المتصفح ده مش بيدعم الإشعارات",
};

const REASON_TEXT = {
  denied: "المتصفح رافض الإشعارات. فعّلها من إعدادات الموقع وجرّب تاني.",
  dismissed: "لازم توافق على طلب الإشعارات عشان تشتغل.",
  "vapid-missing": "مفاتيح الإشعارات مش مضبوطة على السيرفر.",
  "sw-failed": "مش قادر يسجّل عامل الإشعارات.",
  "subscribe-failed": "فشل الاشتراك في الإشعارات.",
  "save-failed": "الاشتراك اتعمل بس ما اتسجّلش على السيرفر.",
  unsupported: "المتصفح ده مش بيدعم الإشعارات.",
};

const DEFAULT_TRIGGER_CLASS =
  "h-9 w-9 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";

export default function InboxNotificationBell({
  surface = "/inbox",
  className = "",
  // The two surfaces have opposite chrome — a light PWA header and a dark glass
  // desktop bar — so the trigger's skin is the caller's to decide.
  buttonClassName = DEFAULT_TRIGGER_CLASS,
  dotBorderClassName = "border-white dark:border-slate-800",
}) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(() => readInboxNotificationPrefs());
  const [permission, setPermission] = useState(() => inboxNotificationPermission());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [menuStyle, setMenuStyle] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);

  const supported = inboxPushSupported();
  const pushOn = prefs.push && permission === "granted";

  // Both inbox surfaces mount this inside a panel with `overflow-hidden`, which
  // clips an absolutely positioned dropdown mid-word. Portalling to <body> with
  // fixed coordinates is the same escape hatch the PWA header menu uses.
  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }
    const place = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      const margin = 8;
      const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
      setMenuStyle({ position: "fixed", top: Math.round(rect.bottom + 8), left: Math.round(left), width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (containerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggleSound = useCallback(() => {
    setPrefs((current) => {
      const next = writeInboxNotificationPrefs({ sound: !current.sound });
      if (next.sound) playInboxChime();
      return next;
    });
  }, []);

  const togglePush = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      if (pushOn) {
        await disableInboxPush();
        setPrefs(readInboxNotificationPrefs());
        setMessage("تم إيقاف الإشعارات");
      } else {
        const result = await enableInboxPush({ surface });
        setPermission(inboxNotificationPermission());
        setPrefs(readInboxNotificationPrefs());
        setMessage(result.ok ? "تم تفعيل الإشعارات" : REASON_TEXT[result.reason] || "تعذّر تفعيل الإشعارات");
      }
    } finally {
      setBusy(false);
    }
  }, [pushOn, surface]);

  const runTest = useCallback(async () => {
    setBusy(true);
    setMessage("");
    playInboxChime();
    const result = await sendInboxPushTest();
    setBusy(false);
    if (!result?.success) {
      setMessage("تعذّر إرسال إشعار التجربة");
      return;
    }
    setMessage(result.sent > 0 ? "اتبعت إشعار تجربة" : "مفيش اشتراك نشط — فعّل الإشعارات الأول");
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="إعدادات تنبيهات الرسائل"
        title="إعدادات تنبيهات الرسائل"
        className={`relative inline-flex items-center justify-center transition ${buttonClassName}`}
      >
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a2 2 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
          {!pushOn && !prefs.sound ? <path d="M3 3l18 18" strokeLinecap="round" /> : null}
        </svg>
        <span
          className={`absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 ${dotBorderClassName} ${
            pushOn ? "bg-emerald-500" : prefs.sound ? "bg-amber-400" : "bg-slate-300 dark:bg-slate-600"
          }`}
        />
      </button>

      {open && menuStyle ? createPortal(
        <div
          ref={panelRef}
          role="menu"
          dir="rtl"
          style={menuStyle}
          className="z-[9999] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 text-slate-900 shadow-[0_24px_80px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">تنبيهات الرسائل</p>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
            <span className="text-sm">
              صوت عند وصول رسالة
              <span className="block text-[11px] text-slate-400">يرن وانت فاتح الإنبوكس</span>
            </span>
            <input type="checkbox" checked={prefs.sound} onChange={toggleSound} className="h-4 w-4 accent-emerald-500" />
          </label>

          <label
            className={`flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 ${
              supported && !busy ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800" : "cursor-not-allowed opacity-60"
            }`}
          >
            <span className="text-sm">
              إشعار على الجهاز
              <span className="block text-[11px] text-slate-400">يوصلك حتى والتطبيق مقفول</span>
            </span>
            <input
              type="checkbox"
              checked={pushOn}
              disabled={!supported || busy}
              onChange={togglePush}
              className="h-4 w-4 accent-emerald-500"
            />
          </label>

          <div className="mt-1 flex items-center gap-2 border-t border-slate-100 px-2.5 pb-1.5 pt-2 dark:border-slate-800">
            <button
              type="button"
              onClick={runTest}
              disabled={busy}
              /* text-slate-50, not text-white: the M1 token layer remaps `white`
                 to a near-black value (even with `!`), which made this label
                 vanish into its own dark fill. */
              className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-50 transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              جرّب الإشعار
            </button>
            <button
              type="button"
              onClick={() => playInboxChime()}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              جرّب الصوت
            </button>
          </div>

          <p className="px-2.5 pb-2 text-[11px] text-slate-400">{message || STATUS_TEXT[supported ? permission : "unsupported"]}</p>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
