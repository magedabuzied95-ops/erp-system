import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CalendarRange, Loader2, Wand2, X } from "lucide-react";

import { generateAutonomousAiMarketingPlan, getStoryAutopilot } from "../services/marketingApi";

// Mirrors GENERATION_PLAN_LIMITS on the backend; the server clamps anyway, the
// client only keeps the preview honest about what will actually be generated.
const LIMITS = { max_days: 31, max_stories_per_day: 40, max_posts_per_day: 10, max_total_stories: 500, max_total_posts: 120 };

const PRESETS = [
  { key: "day", label: "اليوم", days: 1 },
  { key: "week", label: "أسبوع", days: 7 },
  { key: "two_weeks", label: "أسبوعين", days: 14 },
  { key: "month", label: "شهر", days: 30 },
];

const panelClass = "rounded-2xl border border-white/10 bg-white/[0.04] p-4";
const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm font-black text-white outline-none focus:border-cyan-300/50";

const clampInt = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
};

const NumberField = ({ label, hint, value, onChange, min = 0, max = 999 }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-400">{label}</span>
    <input
      type="number"
      min={min}
      max={max}
      value={Number(value ?? 0)}
      onChange={(event) => onChange(clampInt(event.target.value, min, max, min))}
      className={inputClass}
    />
    {hint ? <span className="mt-1 block text-[11px] font-semibold text-slate-500">{hint}</span> : null}
  </label>
);

const Toggle = ({ label, hint, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-right transition ${
      checked ? "border-cyan-300/30 bg-cyan-400/10" : "border-white/10 bg-black/20"
    }`}
  >
    <span className="min-w-0">
      <span className="block text-sm font-black text-white">{label}</span>
      {hint ? <span className="mt-1 block text-xs font-semibold leading-5 text-slate-400">{hint}</span> : null}
    </span>
    <span
      className="mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-1 transition"
      style={{ background: checked ? "var(--primary)" : "rgba(255,255,255,0.15)" }}
    >
      <span
        className={`h-4 w-4 rounded-full transition ${checked ? "translate-x-5" : ""}`}
        style={{ background: checked ? "var(--primary-contrast)" : "var(--card)" }}
      />
    </span>
  </button>
);

const Stat = ({ label, value, tone = "white" }) => (
  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
    <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</div>
    <div className={`mt-1 text-lg font-black ${tone === "amber" ? "text-amber-200" : tone === "emerald" ? "text-emerald-200" : "text-white"}`}>{value}</div>
  </div>
);

const dayLabel = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString("ar-EG", { weekday: "short", day: "numeric", month: "short" });
};

export default function GenerationPlanModal({ open, onClose, onQueued, defaults = {}, canCreate = true, selectionMode = "catalog_coverage" }) {
  const [days, setDays] = useState(30);
  const [storiesPerDay, setStoriesPerDay] = useState(12);
  const [postsPerDay, setPostsPerDay] = useState(0);
  const [startTomorrow, setStartTomorrow] = useState(new Date().getHours() >= 17);
  const [alignAutopilot, setAlignAutopilot] = useState(true);
  const [autopilot, setAutopilot] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStoriesPerDay(clampInt(defaults.stories_per_day, 0, LIMITS.max_stories_per_day, 12));
    setPostsPerDay(clampInt(defaults.posts_per_day, 0, LIMITS.max_posts_per_day, 0));
    let cancelled = false;
    getStoryAutopilot()
      .then((payload) => {
        if (cancelled) return;
        setAutopilot(payload?.settings || null);
      })
      .catch(() => {
        if (!cancelled) setAutopilot(null);
      });
    return () => {
      cancelled = true;
    };
    // Only re-seed when the modal opens; edits inside it must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totals = useMemo(() => {
    const stories = Math.min(LIMITS.max_total_stories, storiesPerDay * days);
    const posts = Math.min(LIMITS.max_total_posts, postsPerDay * days);
    return {
      stories,
      posts,
      storiesCapped: storiesPerDay * days > LIMITS.max_total_stories,
      postsCapped: postsPerDay * days > LIMITS.max_total_posts,
    };
  }, [days, storiesPerDay, postsPerDay]);

  const firstDay = startTomorrow ? 1 : 0;
  const lastDay = firstDay + days - 1;
  const themeMode = selectionMode === "theme_calendar";
  const autopilotEnabled = autopilot?.enabled === true;
  const autopilotQueueMode = autopilot?.schedule_mode === "queue_schedule";
  const autopilotCap = Number(autopilot?.max_per_day) || 0;
  const autopilotNeedsWork = !autopilotEnabled || !autopilotQueueMode || autopilotCap < storiesPerDay;

  const submit = async () => {
    if (!canCreate || submitting) return;
    if (totals.stories === 0 && totals.posts === 0) {
      toast.error("حدد عدد القصص أو المنشورات أولًا.");
      return;
    }
    try {
      setSubmitting(true);
      const result = await generateAutonomousAiMarketingPlan({
        days,
        stories_per_day: storiesPerDay,
        posts_per_day: postsPerDay,
        start_tomorrow: startTomorrow,
        align_autopilot: alignAutopilot,
      });
      toast.success(
        `اتحطت خطة ${days} يوم في الطابور: ${result?.requested_stories ?? totals.stories} قصة و ${result?.requested_posts ?? totals.posts} منشور.`
      );
      onQueued?.(result);
      onClose?.();
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || "تعذر إنشاء الخطة";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm md:p-6" dir="rtl">
      <div className="my-4 w-full max-w-3xl rounded-3xl border border-white/10 bg-[#0a0e18] text-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10">
              <CalendarRange className="h-5 w-5 text-cyan-200" />
            </span>
            <div>
              <h2 className="text-lg font-black">خطة إنشاء القصص</h2>
              <p className="text-xs font-semibold text-slate-400">
                أنشئ كمية كبيرة مرة واحدة، وكل يوم ياخد حصته بالضبط موزعة على أوقات التفاعل.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <section className={panelClass}>
            <div className="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">المدة</div>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setDays(preset.days)}
                  className={`${buttonClass} border ${
                    days === preset.days ? "border-cyan-300/40 bg-cyan-400/15 text-white" : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <NumberField label="عدد الأيام" value={days} onChange={setDays} min={1} max={LIMITS.max_days} />
              <NumberField label="قصص لكل يوم" value={storiesPerDay} onChange={setStoriesPerDay} min={0} max={LIMITS.max_stories_per_day} hint={themeMode ? "في وضع التقويم الأسبوعي كل بلوك بيحدد حصته بنفسه" : ""} />
              <NumberField label="منشورات لكل يوم" value={postsPerDay} onChange={setPostsPerDay} min={0} max={LIMITS.max_posts_per_day} />
            </div>
            <div className="mt-3">
              <Toggle
                label="ابدأ من بكرة"
                hint={`لو اتقفلت دلوقتي، أول يوم في الخطة هيبقى ${dayLabel(startTomorrow ? 1 : 0)} وآخر يوم ${dayLabel(lastDay)}.`}
                checked={startTomorrow}
                onChange={setStartTomorrow}
              />
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <Stat label="إجمالي القصص" value={totals.stories} tone={totals.storiesCapped ? "amber" : "white"} />
            <Stat label="إجمالي المنشورات" value={totals.posts} tone={totals.postsCapped ? "amber" : "white"} />
            <Stat label="آخر يوم" value={dayLabel(lastDay)} />
          </section>
          {totals.storiesCapped || totals.postsCapped ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs font-bold text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              الحد الأقصى للخطة الواحدة {LIMITS.max_total_stories} قصة و {LIMITS.max_total_posts} منشور؛ الباقي اعمله خطة تانية بعدين.
            </div>
          ) : null}

          <section className={panelClass}>
            <Toggle
              label="اضبط النشر التلقائي على مواعيد الخطة"
              hint="يشغّل النشر التلقائي على وضع «مواعيد الطابور» ويرفع الحد اليومي لعدد القصص عشان كل قصة تطلع في وقتها."
              checked={alignAutopilot}
              onChange={setAlignAutopilot}
            />
            <div className="mt-3 text-xs font-semibold leading-5 text-slate-400">
              {autopilot ? (
                <>
                  النشر التلقائي حاليًا: {autopilotEnabled ? "شغّال" : "متوقف"} · الوضع: {autopilotQueueMode ? "مواعيد الطابور" : "مواعيد ثابتة"} · الحد اليومي: {autopilotCap || "—"}
                  {!alignAutopilot && autopilotNeedsWork ? (
                    <span className="mt-1 block text-amber-200">من غير الضبط، القصص هتتولد بمواعيدها لكن النشر التلقائي مش هيلتزم بيها.</span>
                  ) : null}
                </>
              ) : (
                "تعذر قراءة إعدادات النشر التلقائي."
              )}
            </div>
          </section>

          <div className="text-xs font-semibold leading-5 text-slate-500">
            الصور بتتجهز في الخلفية واحدة ورا التانية؛ الخطة الكبيرة بتاخد وقت لحد ما كل القصص تظهر بتصميمها. القصص بتدخل الطابور بحالة «جاهز» وتتبع إعداد الموافقة الحالي.
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <button type="button" onClick={onClose} className={`${buttonClass} border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10`}>
              إلغاء
            </button>
            <button type="button" onClick={submit} disabled={!canCreate || submitting} className={`${buttonClass} bg-white text-slate-950 hover:bg-primary`}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {submitting ? "جارٍ الإرسال..." : `إنشاء ${totals.stories} قصة`}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
