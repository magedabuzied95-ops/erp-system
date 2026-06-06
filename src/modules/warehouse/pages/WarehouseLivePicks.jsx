import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Clock3, Package2, SquareStack, Warehouse } from "lucide-react";

import { getCurrentUser } from "../../../shared/auth/authStorage";
import { useRealtimeConnection, subscribeRealtime } from "../../../shared/realtime/socketStore";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const MAX_ALERTS = 20;
const MERGE_WINDOW_MS = 30 * 1000;
const FLASH_MS = 1000;
const ALERT_SOUND_PATH = "/sounds/warehouse-alert.mp3";

const timeFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const safeText = (value, fallback = "") => String(value || "").trim() || fallback;

const normalizeAlert = (payload = {}) => {
  const receivedAt = String(payload.timestamp || new Date().toISOString());
  return {
    productId: String(payload.productId ?? payload.product_id ?? ""),
    productName: safeText(payload.productName || payload.product_name, "منتج"),
    productImage: resolveProductImageUrl(payload.productImage || payload.product_image || ""),
    color: safeText(payload.color, "غير محدد"),
    size: safeText(payload.size, "One Size"),
    stock: Number(payload.stock || 0),
    sellerName: safeText(payload.sellerName || payload.seller_name || "POS", "POS"),
    branchId: safeText(payload.branchId ?? payload.branch_id, ""),
    timestamp: receivedAt,
    receivedAt,
    quantity: Math.max(1, Number(payload.quantity || 1)),
  };
};

const alertKey = (item = {}) => [item.productId, item.color, item.size].map((part) => String(part || "").trim().toLowerCase()).join("|");

const alertAgeMs = (item = {}, now = Date.now()) => {
  const stamp = new Date(item.timestamp || item.receivedAt || 0).getTime();
  if (!Number.isFinite(stamp)) return Number.POSITIVE_INFINITY;
  return now - stamp;
};

function WarehouseLivePicks() {
  const realtime = useRealtimeConnection();
  const user = useMemo(() => getCurrentUser() || {}, []);
  const [alerts, setAlerts] = useState([]);
  const [flash, setFlash] = useState(false);
  const [lastReceivedAt, setLastReceivedAt] = useState("");
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const audioRef = useRef(null);
  const flashTimerRef = useRef(null);
  const stopTimerRef = useRef(null);
  const unlockAttemptedRef = useRef(false);

  const branchLabel = user?.branch_name || user?.branchName || user?.branch_id || "كل الفروع";

  const playAlertSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    window.clearTimeout(stopTimerRef.current);
    try {
      audio.volume = 1;
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback && typeof playback.catch === "function") {
        playback
          .then(() => {
            setSoundUnlocked(true);
          })
          .catch(() => {
            // Keep trying on the next arrival or user gesture.
          });
      } else {
        setSoundUnlocked(true);
      }
      stopTimerRef.current = window.setTimeout(() => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // Ignore audio shutdown failures.
        }
      }, 4200);
    } catch {
      // Audio should never block the alert feed.
    }
  };

  useEffect(() => {
    const unlockAudio = async () => {
      if (unlockAttemptedRef.current) return;
      unlockAttemptedRef.current = true;
      const audio = audioRef.current;
      if (!audio) return;
      try {
        audio.muted = true;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        setSoundUnlocked(true);
      } catch {
        audio.muted = false;
      }
    };

    const events = ["pointerdown", "touchstart", "keydown", "click"];
    events.forEach((eventName) => window.addEventListener(eventName, unlockAudio, { once: true, passive: true }));
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, unlockAudio));
    };
  }, []);

  useEffect(() => {
    const handleAlert = (payload = {}) => {
      const incoming = normalizeAlert(payload);
      const now = Date.now();
      setLastReceivedAt(incoming.receivedAt);
      playAlertSound();

      window.clearTimeout(flashTimerRef.current);
      setFlash(true);
      flashTimerRef.current = window.setTimeout(() => setFlash(false), FLASH_MS);

      setAlerts((current) => {
        const next = [...current];
        const existingIndex = next.findIndex((item) => alertKey(item) === alertKey(incoming) && alertAgeMs(item, now) <= MERGE_WINDOW_MS);
        if (existingIndex >= 0) {
          const merged = {
            ...next[existingIndex],
            ...incoming,
            quantity: Number(next[existingIndex].quantity || 1) + Number(incoming.quantity || 1),
            receivedAt: incoming.receivedAt,
            timestamp: incoming.timestamp,
          };
          next.splice(existingIndex, 1);
          next.unshift(merged);
          return next.slice(0, MAX_ALERTS);
        }
        return [incoming, ...next].slice(0, MAX_ALERTS);
      });
    };

    return subscribeRealtime("warehouse-pick-alert", handleAlert);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(flashTimerRef.current);
    window.clearTimeout(stopTimerRef.current);
  }, []);

  const totalAlerts = alerts.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  const latestAlert = alerts[0];

  return (
    <div dir="rtl" className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_transparent_34%),linear-gradient(180deg,#070b14_0%,#06070b_100%)] text-white">
      <audio ref={audioRef} src={ALERT_SOUND_PATH} preload="auto" playsInline />

      {flash ? <div className="pointer-events-none fixed inset-0 z-50 bg-amber-300/20 mix-blend-screen animate-pulse" /> : null}

      <div className="absolute inset-0 opacity-30">
        <div className="absolute -left-20 top-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="absolute right-0 top-1/4 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <div className="grid gap-4 border-b border-white/10 p-4 sm:p-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-amber-100">
                <BellRing className="h-3.5 w-3.5" />
                Warehouse Live Picks
              </div>
              <h1 className="text-3xl font-black leading-tight text-white sm:text-5xl">لوحة التقاط المخزن المباشرة</h1>
              <p className="max-w-3xl text-sm leading-7 text-zinc-300 sm:text-base">
                كل إضافة ناجحة من الـ POS تظهر هنا فورًا بدون أي إجراءات يدوية. الصوت يعمل تلقائيًا والبطاقات تتحدّث لحظة بلحظة.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <Stat label="حالة الاتصال" value={realtime.connected ? "مباشر" : realtime.connecting ? "جاري الاتصال" : "غير متصل"} tone={realtime.connected ? "emerald" : "amber"} />
              <Stat label="إجمالي التنبيهات" value={String(totalAlerts).padStart(2, "0")} tone="slate" />
              <Stat label="القسم" value={branchLabel} tone="cyan" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs font-bold text-zinc-400 sm:px-6">
            <div className="inline-flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-amber-300" />
              <span>آخر استقبال: {lastReceivedAt ? dateTimeFormatter.format(new Date(lastReceivedAt)) : "بانتظار التنبيه الأول"}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${soundUnlocked ? "bg-emerald-400 shadow-[0_0_0_6px_rgba(74,222,128,0.12)]" : "bg-amber-400 shadow-[0_0_0_6px_rgba(251,191,36,0.12)]"}`} />
              <span>{soundUnlocked ? "الصوت مفعّل" : "الصوت في وضع الانتظار"}</span>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-4">
            {latestAlert ? (
              <article className="overflow-hidden rounded-[2rem] border border-amber-300/20 bg-[linear-gradient(135deg,rgba(251,191,36,0.16),rgba(255,255,255,0.04))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)] sm:p-5">
                <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr] lg:items-center">
                  <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/30">
                    <div className="aspect-[4/3] w-full bg-black/30">
                      {latestAlert.productImage ? (
                        <img
                          src={latestAlert.productImage}
                          alt={latestAlert.productName}
                          className="h-full w-full object-contain p-4"
                          loading="eager"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Package2 className="h-20 w-20 text-zinc-600" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-amber-100">
                      <SquareStack className="h-3.5 w-3.5" />
                      أحدث تنبيه
                    </div>

                    <h2 className="text-2xl font-black leading-tight text-white sm:text-4xl">{latestAlert.productName}</h2>

                    <div className="flex flex-wrap gap-2">
                      <Pill label="القياس" value={`${latestAlert.size} × ${latestAlert.quantity}`} large />
                      <Pill label="اللون" value={latestAlert.color} />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoCard label="البائع" value={latestAlert.sellerName} />
                      <InfoCard label="الوقت المستلم" value={timeFormatter.format(new Date(latestAlert.receivedAt || latestAlert.timestamp))} />
                      <InfoCard label="المخزون" value={String(latestAlert.stock)} />
                      <InfoCard label="الفرع" value={latestAlert.branchId || branchLabel} />
                    </div>
                  </div>
                </div>
              </article>
            ) : (
              <div className="flex min-h-[24rem] items-center justify-center rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                <div className="max-w-md space-y-3">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-white/10 bg-white/[0.05] text-amber-200">
                    <Warehouse className="h-10 w-10" />
                  </div>
                  <h2 className="text-2xl font-black text-white">بانتظار أول سحب من الـ POS</h2>
                  <p className="text-sm leading-7 text-zinc-400">
                    عند الضغط على "إضافة للفاتورة" بعد اختيار اللون والمقاس، سيظهر التنبيه هنا مباشرة.
                  </p>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
                <Clock3 className="h-4 w-4 text-cyan-300" />
                سجل آخر 20 تنبيه
              </div>

              <div className="space-y-3">
                {alerts.length ? alerts.map((item) => (
                  <AlertRow key={`${alertKey(item)}-${item.timestamp}`} item={item} />
                )) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-400">
                    لا توجد تنبيهات بعد.
                  </div>
                )}
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, tone = "slate" }) {
  const toneClasses = {
    emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
    cyan: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
    slate: "border-white/10 bg-black/30 text-white",
  };

  return (
    <div className={`rounded-[1.5rem] border p-4 ${toneClasses[tone] || toneClasses.slate}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="mt-2 text-lg font-black leading-tight">{value}</div>
    </div>
  );
}

function Pill({ label, value, large = false }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 ${large ? "px-4 py-2 text-sm sm:text-base" : "px-3 py-1.5 text-xs"} font-black text-white`}>
      <span className="text-white/55">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-white sm:text-base">{value || "-"}</div>
    </div>
  );
}

function AlertRow({ item }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        {item.productImage ? (
          <img src={item.productImage} alt={item.productName} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package2 className="h-7 w-7 text-zinc-600" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-white">{item.productName}</div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-bold text-zinc-400">
          <span>اللون: {item.color}</span>
          <span>المقاس: {item.size} × {item.quantity}</span>
        </div>
        <div className="mt-1 truncate text-[11px] font-bold text-zinc-500">
          {item.sellerName} · {timeFormatter.format(new Date(item.receivedAt || item.timestamp))}
        </div>
      </div>
    </div>
  );
}

export default WarehouseLivePicks;
