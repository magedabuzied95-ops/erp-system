import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock,
  Share2,
  Camera,
  Loader2,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  X,
} from "lucide-react";

import {
  applyStoryAutopilotSuggestions,
  getStoryAutopilot,
  runStoryAutopilotNow,
  updateStoryAutopilot,
} from "../services/marketingApi";

const DAY_LABELS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const TIMEZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "UTC"];

const panelClass = "rounded-2xl border border-white/10 bg-white/[0.04] p-4";
const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm font-black text-white outline-none focus:border-cyan-300/50";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
};

// The API returns runtime state alongside the config; the form only edits the config half.
const withoutState = (settings) => {
  const config = { ...(settings || {}) };
  delete config.state;
  return config;
};

const SKIP_REASONS = {
  autopilot_disabled: "النشر التلقائي متوقف",
  inactive_day: "اليوم غير مفعّل في الجدول",
  outside_window: "خارج نافذة النشر المسموحة",
  no_due_slot: "لسه مفيش ميعاد مستحق دلوقتي",
  slot_already_served: "الميعاد ده اتنشر فيه بالفعل",
  min_gap_not_reached: "لسه الفاصل الزمني بين استوريين ما خلصش",
  daily_cap_reached: "وصلنا للحد اليومي المسموح",
  no_eligible_story: "مفيش استوري جاهز في الطابور",
  engine_paused: "محرك التسويق نفسه متوقف — شغّله من زر Resume",
  publish_failed: "آخر محاولة نشر فشلت",
};

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
      className={`mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-1 transition ${
        checked ? "bg-cyan-300" : "bg-white/15"
      }`}
    >
      <span className={`h-4 w-4 rounded-full bg-slate-950 transition ${checked ? "translate-x-5" : ""}`} />
    </span>
  </button>
);

const NumberField = ({ label, hint, value, onChange, min = 0, max = 999 }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-400">{label}</span>
    <input
      type="number"
      min={min}
      max={max}
      value={Number(value ?? 0)}
      onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))}
      className={inputClass}
    />
    {hint ? <span className="mt-1 block text-[11px] font-semibold text-slate-500">{hint}</span> : null}
  </label>
);

const StatTile = ({ label, value, tone = "slate" }) => (
  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
    <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</div>
    <div className={`mt-1 truncate text-lg font-black ${tone === "emerald" ? "text-emerald-200" : tone === "amber" ? "text-amber-200" : "text-white"}`}>
      {value}
    </div>
  </div>
);

const StoryAutopilotSettingsModal = ({ open, onClose, canUpdate = true, canPublish = true }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [running, setRunning] = useState(false);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [log, setLog] = useState([]);
  const [newSlot, setNewSlot] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await getStoryAutopilot();
      const settings = withoutState(payload?.settings);
      setConfig(settings);
      setStatus(payload?.status || null);
      setSuggestion(payload?.suggestion || null);
      setLog(Array.isArray(payload?.log) ? payload.log : []);
    } catch (error) {
      toast.error(error?.message || "تعذر تحميل إعدادات النشر التلقائي");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const patch = (next) => setConfig((current) => ({ ...current, ...next }));

  const slots = useMemo(() => (Array.isArray(config?.slots) ? config.slots : []), [config]);
  const activeDays = useMemo(() => (Array.isArray(config?.active_days) ? config.active_days : []), [config]);
  const platforms = useMemo(() => (Array.isArray(config?.platforms) ? config.platforms : []), [config]);

  const togglePlatform = (platform) => {
    const next = platforms.includes(platform) ? platforms.filter((item) => item !== platform) : [...platforms, platform];
    if (!next.length) {
      toast.error("لازم تختار منصة واحدة على الأقل");
      return;
    }
    patch({ platforms: next });
  };

  const toggleDay = (day) => {
    const next = activeDays.includes(day) ? activeDays.filter((item) => item !== day) : [...activeDays, day].sort((a, b) => a - b);
    if (!next.length) {
      toast.error("لازم تسيب يوم واحد على الأقل مفعّل");
      return;
    }
    patch({ active_days: next });
  };

  const addSlot = (value) => {
    const time = String(value || "").trim();
    if (!TIME_PATTERN.test(time)) {
      toast.error("اكتب الوقت بصيغة HH:MM");
      return;
    }
    if (slots.includes(time)) return;
    patch({ slots: [...slots, time].sort() });
    setNewSlot("");
  };

  const removeSlot = (time) => patch({ slots: slots.filter((item) => item !== time) });

  const save = async () => {
    try {
      setSaving(true);
      const payload = await updateStoryAutopilot(config);
      const settings = withoutState(payload?.settings);
      setConfig(settings);
      toast.success("تم حفظ إعدادات النشر التلقائي");
      await load();
    } catch (error) {
      toast.error(error?.message || "تعذر حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  };

  const applySuggested = async () => {
    try {
      setApplying(true);
      const payload = await applyStoryAutopilotSuggestions();
      const settings = withoutState(payload?.settings);
      setConfig(settings);
      setSuggestion(payload?.suggestion || suggestion);
      toast.success("تم تطبيق الأوقات المقترحة");
    } catch (error) {
      toast.error(error?.message || "تعذر تطبيق الأوقات المقترحة");
    } finally {
      setApplying(false);
    }
  };

  const runNow = async () => {
    try {
      setRunning(true);
      const payload = await runStoryAutopilotNow();
      const summary = payload?.summary || {};
      const published = summary.published?.length || 0;
      const failed = summary.failed?.length || 0;
      if (published) toast.success(`تم نشر ${published} استوري الآن`);
      else if (failed) toast.error(`فشل نشر ${failed} استوري`);
      else toast(SKIP_REASONS[summary.skipped?.[0]?.reason] || "مفيش استوري اتنشر في التشغيل ده");
      await load();
    } catch (error) {
      toast.error(error?.message || "تعذر تشغيل النشر التلقائي");
    } finally {
      setRunning(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm md:p-6" dir="rtl">
      <div className="my-4 w-full max-w-4xl rounded-3xl border border-white/10 bg-[#0a0e18] text-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10">
              <Settings className="h-5 w-5 text-cyan-200" />
            </span>
            <div>
              <h2 className="text-lg font-black">إعدادات النشر التلقائي للاستوري</h2>
              <p className="text-xs font-semibold text-slate-400">
                ينشر الاستوريهات المولّدة بتصميماتك المعتمدة في أفضل أوقات التفاعل على فيسبوك.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </header>

        {loading || !config ? (
          <div className="flex items-center justify-center gap-3 p-16 text-sm font-black text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            جارٍ التحميل...
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <section className={panelClass}>
              <Toggle
                label={config.enabled ? "النشر التلقائي مُفعّل" : "النشر التلقائي متوقف"}
                hint="لما يكون مفعّل، النظام بينشر الاستوريهات الجاهزة لوحده في المواعيد المحددة تحت — من غير أي تدخل منك."
                checked={config.enabled === true}
                onChange={(value) => patch({ enabled: value })}
              />
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="الوقت المحلي" value={`${status?.local_day || ""} ${status?.local_time || "—"}`} />
                <StatTile label="اتنشر النهاردة" value={`${status?.published_today ?? 0} / ${config.max_per_day}`} tone="emerald" />
                <StatTile label="الميعاد الجاي" value={formatDateTime(status?.next_slot_at)} />
                <StatTile label="استوري جاهز في الطابور" value={status?.ready_stories ?? 0} tone={status?.ready_stories ? "emerald" : "amber"} />
              </div>
              {status?.last_skip_reason ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs font-bold text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  آخر تشغيل ({formatDateTime(status?.last_run_at)}): {SKIP_REASONS[status.last_skip_reason] || status.last_skip_reason}
                </div>
              ) : null}
            </section>

            <section className={panelClass}>
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-cyan-100">
                <Sparkles className="h-4 w-4" />
                الأوقات المقترحة
                <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-black text-slate-300">
                  {suggestion?.source === "page_insights" ? "من تفاعل صفحتك الفعلي" : "معايير فيسبوك للاستوري"}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(suggestion?.slots || []).map((slot) => {
                  const selected = slots.includes(slot.time);
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => (selected ? removeSlot(slot.time) : addSlot(slot.time))}
                      className={`rounded-xl border p-3 text-right transition ${
                        selected ? "border-cyan-300/40 bg-cyan-400/10" : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-base font-black text-white">{slot.time}</span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black text-slate-200">{slot.score}%</span>
                      </div>
                      <div className="mt-1 text-xs font-black text-cyan-100">{slot.label}</div>
                      <div className="mt-1 text-[11px] font-semibold leading-5 text-slate-400">{slot.reason}</div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${slot.score}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={applySuggested}
                  disabled={applying || !canUpdate}
                  className={`${buttonClass} border border-cyan-300/30 bg-cyan-300 text-slate-950 hover:bg-cyan-200`}
                >
                  {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  طبّق الأوقات المقترحة
                </button>
                <span className="text-[11px] font-semibold text-slate-500">
                  التوقيت حسب {config.timezone} — الأوقات بتتحدث تلقائيًا كل ما بيانات صفحتك تكبر.
                </span>
              </div>
            </section>

            <section className={panelClass}>
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
                <CalendarClock className="h-4 w-4" />
                جدول النشر
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                <button
                  type="button"
                  onClick={() => patch({ schedule_mode: "suggested_slots" })}
                  className={`${buttonClass} ${config.schedule_mode === "suggested_slots" ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
                >
                  مواعيد ثابتة مقترحة
                </button>
                <button
                  type="button"
                  onClick={() => patch({ schedule_mode: "queue_schedule" })}
                  className={`${buttonClass} ${config.schedule_mode === "queue_schedule" ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
                >
                  مواعيد الطابور نفسه
                </button>
              </div>
              <p className="mt-2 text-[11px] font-semibold leading-5 text-slate-400">
                {config.schedule_mode === "suggested_slots"
                  ? "النظام بينشر استوري واحد عند كل ميعاد من المواعيد اللي تحت، ويسحب أقدم استوري جاهز من الطابور."
                  : "النظام بيحترم ميعاد كل عنصر في الطابور زي ما اتجدول وقت التوليد، جوّه نافذة النشر بس."}
              </p>

              {config.schedule_mode === "suggested_slots" ? (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {slots.map((time) => (
                      <span key={time} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-sm font-black text-cyan-50">
                        <Clock className="h-3.5 w-3.5" />
                        {time}
                        <button type="button" onClick={() => removeSlot(time)} className="text-cyan-200/70 hover:text-white">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                    {!slots.length ? <span className="text-xs font-bold text-amber-200">مفيش مواعيد محددة — النشر مش هيشتغل.</span> : null}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="time"
                      value={newSlot}
                      onChange={(event) => setNewSlot(event.target.value)}
                      className={`${inputClass} max-w-[160px]`}
                    />
                    <button type="button" onClick={() => addSlot(newSlot)} className={`${buttonClass} border border-white/10 bg-white/10 text-white hover:bg-white/15`}>
                      إضافة ميعاد
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-4">
                <span className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">أيام النشر</span>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, day) => {
                    const dayScore = suggestion?.days?.find((entry) => entry.day === day)?.score ?? 0;
                    const active = activeDays.includes(day);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                          active ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-black/20 text-slate-400"
                        }`}
                      >
                        {label}
                        <span className="mr-1 text-[10px] font-black text-slate-400">{dayScore}%</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-400">بداية النافذة</span>
                  <input type="time" value={config.window_start} onChange={(event) => patch({ window_start: event.target.value })} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-400">نهاية النافذة</span>
                  <input type="time" value={config.window_end} onChange={(event) => patch({ window_end: event.target.value })} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-400">المنطقة الزمنية</span>
                  <select value={config.timezone} onChange={(event) => patch({ timezone: event.target.value })} className={inputClass}>
                    {TIMEZONES.map((zone) => (
                      <option key={zone} value={zone} className="bg-slate-900">
                        {zone}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className={panelClass}>
              <div className="mb-3 text-sm font-black text-white">المنصات</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => togglePlatform("facebook")}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-right transition ${
                    platforms.includes("facebook") ? "border-sky-300/30 bg-sky-400/10 text-sky-50" : "border-white/10 bg-black/20 text-slate-400"
                  }`}
                >
                  <Share2 className="h-5 w-5" />
                  <span className="text-sm font-black">Facebook Stories</span>
                  {platforms.includes("facebook") ? <Check className="mr-auto h-4 w-4" /> : null}
                </button>
                <button
                  type="button"
                  onClick={() => togglePlatform("instagram")}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-right transition ${
                    platforms.includes("instagram") ? "border-fuchsia-300/30 bg-fuchsia-400/10 text-fuchsia-50" : "border-white/10 bg-black/20 text-slate-400"
                  }`}
                >
                  <Camera className="h-5 w-5" />
                  <span className="text-sm font-black">Instagram Stories</span>
                  {platforms.includes("instagram") ? <Check className="mr-auto h-4 w-4" /> : null}
                </button>
              </div>
            </section>

            <section className={panelClass}>
              <div className="mb-3 text-sm font-black text-white">حدود الأمان</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumberField label="أقصى عدد يوميًا" value={config.max_per_day} onChange={(value) => patch({ max_per_day: value })} min={1} max={500} />
                <NumberField label="أقصى عدد في التشغيل" value={config.max_per_run} onChange={(value) => patch({ max_per_run: value })} min={1} max={100} />
                <NumberField label="أقل فاصل (دقيقة)" value={config.min_gap_minutes} onChange={(value) => patch({ min_gap_minutes: value })} max={1440} />
                <NumberField label="مهلة الميعاد (دقيقة)" hint="لو السيرفر اتأخر عن الميعاد" value={config.slot_grace_minutes} onChange={(value) => patch({ slot_grace_minutes: value })} min={1} max={1440} />
                <NumberField label="تعويض التأخير (دقيقة)" hint="لوضع مواعيد الطابور" value={config.catchup_grace_minutes} onChange={(value) => patch({ catchup_grace_minutes: value })} max={10080} />
                <NumberField label="عدد المحاولات" value={config.max_retries} onChange={(value) => patch({ max_retries: value })} max={50} />
                <NumberField label="فاصل إعادة المحاولة (دقيقة)" value={config.retry_backoff_minutes} onChange={(value) => patch({ retry_backoff_minutes: value })} min={1} max={1440} />
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-3">
                <Toggle
                  label="ينشر الموافَق عليه بس"
                  hint="لو مفعّل، الاستوري لازم يتوافق عليه يدويًا قبل ما الأوتوبايلوت ينشره."
                  checked={config.require_approval === true}
                  onChange={(value) => patch({ require_approval: value })}
                />
                <Toggle
                  label="تصميم مولّد إجباري"
                  hint="ميعديش أي استوري من غير التصميم النهائي المعتمد."
                  checked={config.skip_without_generated_asset === true}
                  onChange={(value) => patch({ skip_without_generated_asset: value })}
                />
                <Toggle
                  label="يتابع تحليلات الصفحة"
                  hint="يعدّل ترتيب الأوقات المقترحة حسب تفاعل صفحتك الفعلي."
                  checked={config.follow_insights === true}
                  onChange={(value) => patch({ follow_insights: value })}
                />
              </div>
            </section>

            {log.length ? (
              <section className={panelClass}>
                <div className="mb-3 text-sm font-black text-white">آخر الأحداث</div>
                <div className="space-y-1.5">
                  {log.map((entry, index) => (
                    <div key={`${entry.created_at}-${index}`} className="flex items-start gap-2 rounded-lg bg-black/25 px-3 py-2 text-[11px] font-semibold text-slate-300">
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          entry.status === "success" ? "bg-emerald-400" : entry.status === "failed" ? "bg-rose-400" : "bg-slate-500"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">{entry.message || entry.event_type}</span>
                      <span className="shrink-0 text-slate-500">{formatDateTime(entry.created_at)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}

        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-b-3xl border-t border-white/10 bg-[#0a0e18]/95 p-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={load} disabled={loading} className={`${buttonClass} border border-white/10 bg-white/10 text-white hover:bg-white/15`}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              تحديث
            </button>
            <button
              type="button"
              onClick={runNow}
              disabled={running || !canPublish}
              className={`${buttonClass} border border-emerald-300/25 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20`}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              شغّل دلوقتي
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className={`${buttonClass} border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10`}>
              إغلاق
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || loading || !canUpdate}
              className={`${buttonClass} border border-cyan-300/30 bg-cyan-300 text-slate-950 hover:bg-cyan-200`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              حفظ الإعدادات
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default StoryAutopilotSettingsModal;
