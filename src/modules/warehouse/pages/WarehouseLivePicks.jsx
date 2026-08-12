import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Clock3, Package2, Speaker, SquareStack, Warehouse } from "lucide-react";

import { subscribeRealtime, useRealtimeConnection } from "../../../shared/realtime/socketStore";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const MAX_ALERTS = 20;
const MERGE_WINDOW_MS = 30 * 1000;
const FLASH_MS = 1000;
const ALERT_SOUND_PATH = "/sounds/warehouse-alert.mp3";
const ALERT_SOUND_DURATION_MS = 7200;

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

const text = (value, fallback = "") => String(value || "").trim() || fallback;

const normalizeAlert = (payload = {}) => {
  const receivedAt = String(payload.timestamp || new Date().toISOString());
  return {
    productId: text(payload.productId ?? payload.product_id ?? ""),
    productName: text(payload.productName || payload.product_name, ""),
    productImage: resolveProductImageUrl(payload.productImage || payload.product_image || ""),
    articleCode: text(payload.article_code || payload.articleCode || ""),
    manufacturerName: text(payload.manufacturer_name || payload.manufacturerName || payload.manufacturer || ""),
    color: text(payload.color, "غير محدد"),
    size: text(payload.size, "One Size"),
    stock: Number(payload.stock || 0),
    sellerName: text(payload.sellerName || payload.seller_name || "POS", "POS"),
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

const clearTimerSet = (timersRef) => {
  const timers = timersRef.current;
  if (!timers) return;
  timers.forEach((timerId) => window.clearTimeout(timerId));
  timers.clear();
};

function WarehouseLivePicks() {
  const realtime = useRealtimeConnection();

  const [alerts, setAlerts] = useState([]);
  const [flash, setFlash] = useState(false);
  const [highlightedAlertId, setHighlightedAlertId] = useState("");
  const [lastReceivedAt, setLastReceivedAt] = useState("");
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const masterGainRef = useRef(null);
  const currentSequenceIdRef = useRef(0);
  const hasActiveSequenceRef = useRef(false);
  const activeTimersRef = useRef(new Set());
  const activeNodesRef = useRef(new Set());
  const flashTimerRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const fallbackStopRef = useRef(null);
  const unlockAttemptedRef = useRef(false);
  const soundBusyRef = useRef(false);

  const setBusy = (value) => {
    soundBusyRef.current = value;
    setSoundBusy(value);
  };

  const cleanupAudioGraph = useCallback(() => {
    clearTimerSet(activeTimersRef);

    const nodes = activeNodesRef.current;
    if (nodes) {
      nodes.forEach((node) => {
        try {
          if (typeof node.stop === "function") node.stop();
        } catch {
          // Ignore nodes that already finished.
        }
        try {
          if (typeof node.disconnect === "function") node.disconnect();
        } catch {
          // Ignore disconnect issues during cleanup.
        }
      });
      nodes.clear();
    }

    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.loop = false;
      } catch {
        // Ignore media element cleanup failures.
      }
    }

    window.clearTimeout(fallbackStopRef.current);
    fallbackStopRef.current = null;
  }, []);

  const ensureAudioContext = useCallback(async () => {
    if (typeof window === "undefined") return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtor();
    }

    const context = audioContextRef.current;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        // Some browsers still require a direct user gesture.
      }
    }

    if (!masterGainRef.current) {
      const masterGain = context.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(context.destination);
      masterGainRef.current = masterGain;
    }

    return context;
  }, []);

  const logSoundEnd = useCallback((details = {}) => {
    console.info("[warehouse-live-picks:alert-sound-end]", details);
  }, []);

  const stopCurrentSound = useCallback(
    (reason = "stopped", sequenceId = currentSequenceIdRef.current) => {
      const shouldLog = hasActiveSequenceRef.current || reason === "failed" || reason === "complete" || reason === "restart";
      cleanupAudioGraph();
      hasActiveSequenceRef.current = false;
      if (soundBusyRef.current) setBusy(false);
      if (shouldLog) {
        logSoundEnd({ sequenceId, reason });
      }
    },
    [cleanupAudioGraph, logSoundEnd]
  );

  const playBeep = useCallback((context, startTime, frequency, durationMs, gainValue = 0.35) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(0.08, durationMs / 1000));
    oscillator.connect(gain);
    gain.connect(masterGainRef.current || context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + Math.max(0.1, durationMs / 1000) + 0.05);
    activeNodesRef.current.add(oscillator);
    activeNodesRef.current.add(gain);
    oscillator.onended = () => {
      try {
        oscillator.disconnect();
      } catch {
        // ignore
      }
      try {
        gain.disconnect();
      } catch {
        // ignore
      }
      activeNodesRef.current.delete(oscillator);
      activeNodesRef.current.delete(gain);
    };
  }, []);

  const runWebAudioPattern = useCallback(
    async (sequenceId, durationMs) => {
      const context = await ensureAudioContext();
      if (!context || currentSequenceIdRef.current !== sequenceId) return false;

      const startAt = context.currentTime + 0.02;
      const groupGap = 0.42;
      const intraGap = 0.14;
      const beepDuration = 0.16;
      const cycleDuration = 3 * (beepDuration + intraGap) + groupGap;
      const cycleCount = Math.ceil(durationMs / (cycleDuration * 1000));

      for (let cycle = 0; cycle < cycleCount; cycle += 1) {
        const cycleStartSeconds = startAt + cycle * cycleDuration;
        for (let index = 0; index < 3; index += 1) {
          const when = cycleStartSeconds + index * (beepDuration + intraGap);
          const tone = index === 1 ? 1040 : 880;
          try {
            playBeep(context, when, tone, beepDuration, 0.38);
          } catch (error) {
            console.warn("[warehouse-live-picks] beep schedule failed", error);
            return false;
          }
        }
      }

      return true;
    },
    [ensureAudioContext, playBeep]
  );

  const runMp3Loop = useCallback(async (sequenceId, durationMs) => {
    const audio = audioRef.current;
    if (!audio || currentSequenceIdRef.current !== sequenceId) return false;

    try {
      audio.loop = true;
      audio.volume = 1;
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback && typeof playback.catch === "function") await playback;
      return true;
    } catch (error) {
      console.warn("[warehouse-live-picks] mp3 playback failed", error);
      return false;
    } finally {
      fallbackStopRef.current = window.setTimeout(() => {
        const currentAudio = audioRef.current;
        if (!currentAudio) return;
        try {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio.loop = false;
        } catch {
          // Ignore media element cleanup failures.
        }
      }, durationMs);
    }
  }, []);

  const startAlertSoundSequence = useCallback(
    async ({ source = "alert" } = {}) => {
      const sequenceId = currentSequenceIdRef.current + 1;
      const previousSequenceId = currentSequenceIdRef.current;
      if (previousSequenceId > 0) {
        stopCurrentSound("restart", previousSequenceId);
      } else {
        cleanupAudioGraph();
      }

      currentSequenceIdRef.current = sequenceId;
      hasActiveSequenceRef.current = true;
      setBusy(true);

      console.info("[warehouse-live-picks:alert-sound-start]", {
        sequenceId,
        source,
        durationMs: ALERT_SOUND_DURATION_MS,
      });

      try {
        const [mp3Started, webAudioStarted] = await Promise.all([
          runMp3Loop(sequenceId, ALERT_SOUND_DURATION_MS),
          runWebAudioPattern(sequenceId, ALERT_SOUND_DURATION_MS),
        ]);

        if (!mp3Started && !webAudioStarted) {
          throw new Error("Unable to start warehouse alert audio");
        }

        const endTimer = window.setTimeout(() => {
          if (currentSequenceIdRef.current !== sequenceId) return;
          currentSequenceIdRef.current = 0;
          stopCurrentSound("complete", sequenceId);
        }, ALERT_SOUND_DURATION_MS);

        activeTimersRef.current.add(endTimer);
        return true;
      } catch (error) {
        console.error("[warehouse-live-picks:alert-sound-failed]", {
          sequenceId,
          source,
          message: error?.message || String(error),
        });
        currentSequenceIdRef.current = 0;
        stopCurrentSound("failed", sequenceId);
        return false;
      }
    },
    [cleanupAudioGraph, runMp3Loop, runWebAudioPattern, stopCurrentSound]
  );

  const unlockSound = useCallback(
    async () => {
      if (unlockAttemptedRef.current) return;
      unlockAttemptedRef.current = true;

      try {
        const context = await ensureAudioContext();
        const audio = audioRef.current;
        if (audio) {
          audio.volume = 1;
          audio.muted = true;
          audio.loop = false;
          try {
            await audio.play();
          } catch {
            // Autoplay still may fail, but the gesture can unlock Web Audio.
          }
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        }
        if (context && context.state === "running") {
          setSoundUnlocked(true);
          console.info("[warehouse-live-picks:sound-unlocked]");
        }
      } catch (error) {
        console.warn("[warehouse-live-picks] sound unlock failed", error);
      }
    },
    [ensureAudioContext]
  );

  useEffect(() => {
    const handleAlert = (payload = {}) => {
      const incoming = normalizeAlert(payload);
      const now = Date.now();
      setLastReceivedAt(incoming.receivedAt);

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
          setHighlightedAlertId(alertKey(merged));
          window.clearTimeout(highlightTimerRef.current);
          highlightTimerRef.current = window.setTimeout(() => setHighlightedAlertId(""), 18000);
          return next.slice(0, MAX_ALERTS);
        }
        setHighlightedAlertId(alertKey(incoming));
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => setHighlightedAlertId(""), 18000);
        return [incoming, ...next].slice(0, MAX_ALERTS);
      });

      startAlertSoundSequence({ source: "alert" });
    };

    return subscribeRealtime("warehouse-pick-alert", handleAlert);
  }, [startAlertSoundSequence]);

  useEffect(() => {
    const unlockOnFirstGesture = () => {
      unlockSound();
    };

    const events = ["pointerdown", "touchstart", "keydown", "click"];
    events.forEach((eventName) => window.addEventListener(eventName, unlockOnFirstGesture, { once: true, passive: true }));
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, unlockOnFirstGesture));
    };
  }, [unlockSound]);

  useEffect(() => {
    return () => {
      window.clearTimeout(flashTimerRef.current);
      window.clearTimeout(highlightTimerRef.current);
      window.clearTimeout(fallbackStopRef.current);
      stopCurrentSound("unmount");
      const context = audioContextRef.current;
      if (context) {
        try {
          context.close();
        } catch {
          // Ignore close failures during teardown.
        }
      }
    };
  }, [stopCurrentSound]);

  const latestAlert = alerts[0];
  const totalAlerts = alerts.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  const handleTestSound = async () => {
    await unlockSound();
    await startAlertSoundSequence({ source: "test" });
  };

  return (
    <div dir="rtl" className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.14),_transparent_30%),linear-gradient(180deg,#070b14_0%,#06070b_100%)] text-white">
      <audio ref={audioRef} src={ALERT_SOUND_PATH} preload="auto" playsInline />

      {flash ? <div className="pointer-events-none fixed inset-0 z-50 bg-amber-300/20 mix-blend-screen animate-pulse" /> : null}

      <div className="absolute inset-0 opacity-25">
        <div className="absolute -left-20 top-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="absolute right-0 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6">
        <section className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.04] shadow-[0_20px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
            <div className="min-w-0">
              <h1 className="m1-page-title truncate text-white">التقاط المخزن المباشر</h1>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleTestSound}
                className="inline-flex min-h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-amber-300/25 bg-amber-400/10 px-3.5 py-2 text-sm font-black text-amber-50 transition hover:bg-amber-400/15"
              >
                <Speaker className="h-4 w-4" />
                اختبار الصوت
              </button>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] font-bold text-zinc-300">
                <span className={`h-2.5 w-2.5 rounded-full ${soundBusy ? "bg-amber-400" : soundUnlocked ? "bg-emerald-400" : "bg-rose-400"}`} />
                <span>{soundBusy ? "الصوت يعمل" : soundUnlocked ? "الصوت مفعّل" : "الصوت مقفل"}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] font-bold text-zinc-300">
                <span>{realtime.connected ? "مباشر" : realtime.connecting ? "جاري الاتصال" : "غير متصل"}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-[11px] font-bold text-zinc-400 sm:px-4">
            <div className="inline-flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-amber-300" />
              <span>آخر استقبال: {lastReceivedAt ? dateTimeFormatter.format(new Date(lastReceivedAt)) : "بانتظار التنبيه الأول"}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <span>{String(totalAlerts).padStart(2, "0")} تنبيه</span>
            </div>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-[0.78fr_1.22fr]">
          <aside className="order-2 space-y-3 lg:order-1">
            <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-3 sm:p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
                <Clock3 className="h-4 w-4 text-primary" />
                آخر 20 تنبيه
              </div>

              <div className="space-y-2.5">
                {alerts.length ? (
                  alerts.map((item, index) => (
                    <AlertRow
                      key={`${alertKey(item)}-${item.timestamp}`}
                      item={item}
                      active={index === 0 && alertKey(item) === highlightedAlertId}
                      faded={index > 0}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-400">
                    لا توجد تنبيهات بعد.
                  </div>
                )}
              </div>
            </div>
          </aside>

          <div className="order-1 space-y-3 lg:order-2">
            {latestAlert ? <LatestPickCard item={latestAlert} active={alertKey(latestAlert) === highlightedAlertId} /> : <EmptyState />}
          </div>
        </section>
      </main>
    </div>
  );
}

function LatestPickCard({ item, active = false }) {
  return (
    <article
      className={`overflow-hidden rounded-[2rem] border p-3 sm:p-4 ${ active ? "border-emerald-300/30 bg-[linear-gradient(135deg,rgba(34,197,94,0.18),rgba(251,191,36,0.12),rgba(255,255,255,0.04))] shadow-[0_0_0_1px_rgba(34,197,94,0.14),0_24px_60px_rgba(16,185,129,0.16)]" : "border-amber-300/20 bg-[linear-gradient(135deg,rgba(251,191,36,0.16),rgba(255,255,255,0.04))] shadow-[0_20px_60px_rgba(0,0,0,0.35)]" }`}
    >
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-amber-100">
        <SquareStack className="h-3.5 w-3.5" />
        التنبيه الحالي
      </div>

      <div className="mt-3 grid gap-4 xl:grid-cols-[1.08fr_0.92fr] xl:items-center">
        <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/30">
          <div className="aspect-[4/3] w-full bg-black/30">
            {item.productImage ? (
              <img src={item.productImage} alt={item.productName || "product"} className="h-full w-full object-contain p-3 sm:p-4" loading="eager" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Package2 className="h-20 w-20 text-zinc-600" />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {item.productName ? <div className="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">{item.productName}</div> : null}

          <div className="flex items-end gap-2 text-white">
            <div className="text-[clamp(2.6rem,7vw,5.6rem)] font-black leading-none tracking-tight">{item.size}</div>
            <div className="pb-1 text-[clamp(1.4rem,3.3vw,2.2rem)] font-black leading-none text-amber-100">× {item.quantity}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <MetaChip label="اللون" value={item.color} />
            {item.articleCode ? <MetaChip label="كود الأرتكل" value={item.articleCode} big /> : null}
            {item.manufacturerName ? <MetaChip label="اسم المصنع" value={item.manufacturerName} big /> : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <InfoCard label="البائع" value={item.sellerName} />
            <InfoCard label="الوقت" value={timeFormatter.format(new Date(item.receivedAt || item.timestamp))} />
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[24rem] items-center justify-center rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
      <div className="max-w-md space-y-3">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-white/10 bg-white/[0.05] text-amber-200">
          <Warehouse className="h-10 w-10" />
        </div>
        <h2 className="m1-section-title text-white">بانتظار أول سحب من الـ POS</h2>
        <p className="text-sm leading-7 text-zinc-400">التنبيه سيظهر مباشرة بعد "إضافة للفاتورة" بدون أي إجراءات يدوية.</p>
      </div>
    </div>
  );
}

function AlertRow({ item, active = false, faded = false }) {
  return (
    <div className={`flex items-center gap-3 rounded-[1.3rem] border p-3 ${active ? "border-emerald-300/30 bg-emerald-400/10 shadow-[0_0_0_1px_rgba(34,197,94,0.1)]" : "border-white/10 bg-black/20"} ${faded ? "opacity-90" : ""}`}>
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:h-18 sm:w-18">
        {item.productImage ? (
          <img src={item.productImage} alt={item.productName || "product"} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package2 className="h-8 w-8 text-zinc-600" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">{item.productName || "منتج"}</div>
            <div className="mt-1 text-[1.15rem] font-black leading-none text-white">
              <span className="text-[1.45rem]">{item.quantity}</span> × {item.size}
            </div>
          </div>
          <div className="shrink-0 text-[11px] font-black text-amber-100">{active ? "جديد" : ""}</div>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-bold text-zinc-400">
          <span>اللون: {item.color}</span>
          {item.articleCode ? <span>كود الأرتكل: {item.articleCode}</span> : null}
          {item.manufacturerName ? <span>اسم المصنع: {item.manufacturerName}</span> : null}
        </div>
        <div className="mt-1 text-[11px] font-bold text-zinc-500">
          {item.sellerName} · {timeFormatter.format(new Date(item.receivedAt || item.timestamp))}
        </div>
      </div>
    </div>
  );
}

function MetaChip({ label, value, big = false }) {
  if (!value) return null;
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 ${big ? "px-3.5 py-2 text-[12px] sm:text-sm" : "px-3 py-1.5 text-[11px]"} font-black text-white`}>
      <span className="text-white/45">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-white">{value || "-"}</div>
    </div>
  );
}

export default WarehouseLivePicks;
