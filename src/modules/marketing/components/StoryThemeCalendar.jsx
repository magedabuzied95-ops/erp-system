import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Layers, Plus, Sparkles, Trash2 } from "lucide-react";

import { getProductClassifications } from "../../products/services/productClassificationsApi";

/**
 * Weekly theme calendar editor for the AI Marketing Center.
 *
 * The backend picks story products per DAY from whichever blocks list that day,
 * and every block rotates through its own coverage cycle. This component is the
 * control surface for that: which block runs on which day, how deep its pool is,
 * and how far through its lap it currently is.
 *
 * Filter chips store the classification OPTION VALUE, which is exactly what
 * products.product_type / products.grade hold, so a chip and a product row
 * compare like for like.
 */

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/20 backdrop-blur-xl";
const inputClass = "h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm font-black text-white outline-none focus:border-primary/50";
const pillClass = "rounded-lg px-2.5 py-1.5 text-xs font-black transition";

// Date#getDay() indexes, laid out as the Egyptian working week reads.
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
const DAY_LABELS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AUDIENCE_LABELS = { men: "رجالي", women: "حريمي", kids: "أطفال" };

const optionLabel = (option = {}) => option.label_ar || option.name_ar || option.label_en || option.name_en || option.value || "";
const arrayOf = (value) => (Array.isArray(value) ? value : []);

const todayDateKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const formatShortDate = (key = "") => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? `${Number(match[3])}/${Number(match[2])}` : "";
};

const pickOptions = (groups, groupKey) =>
  (groups.find((group) => String(group.key || "").toLowerCase() === groupKey)?.options || []).filter((option) => option.is_active !== false);

const toggleInList = (list, value) =>
  arrayOf(list).includes(value) ? arrayOf(list).filter((entry) => entry !== value) : [...arrayOf(list), value];

function TogglePill({ active, onClick, children, tone = "primary", disabled = false }) {
  const activeTone = tone === "danger" ? "bg-rose-500/80 text-white" : "bg-primary text-slate-950";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`${pillClass} ${active ? activeTone : "border border-white/10 bg-black/25 text-slate-300 hover:bg-white/10"} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

// Free-text brand/name words ("momolly", "skechers"): the block only takes
// products whose name or brand contains one of them. This is how "school bags
// only" works when school and women's bags share the same product type.
function KeywordEditor({ label, hint, values, onChange, disabled = false }) {
  const [draft, setDraft] = useState("");
  const list = arrayOf(values);
  const add = () => {
    const word = draft.trim();
    if (!word) return;
    if (!list.some((entry) => entry.toLowerCase() === word.toLowerCase())) onChange([...list, word]);
    setDraft("");
  };
  return (
    <div>
      <div className="mb-2 text-xs font-black text-slate-400">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((word) => (
          <span key={word} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-2.5 py-1.5 text-xs font-black text-primary">
            {word}
            <button type="button" disabled={disabled} onClick={() => onChange(list.filter((entry) => entry !== word))} className="text-primary/70 hover:text-primary" aria-label={`حذف ${word}`}>
              ×
            </button>
          </span>
        ))}
        <input
          className="h-9 w-36 rounded-lg border border-white/10 bg-black/25 px-2.5 text-xs font-black text-white outline-none focus:border-primary/50"
          placeholder="اكتب ماركة…"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" disabled={disabled || !draft.trim()} onClick={add} className={`${pillClass} border border-white/10 bg-black/25 text-slate-300 hover:bg-white/10 disabled:opacity-50`}>
          إضافة
        </button>
      </div>
      {hint ? <p className="mt-1.5 text-[11px] font-semibold leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function ChipPicker({ label, options, selected, onToggle, emptyHint }) {
  if (!options.length) return <p className="text-xs font-bold text-slate-500">{emptyHint}</p>;
  return (
    <div>
      <div className="mb-2 text-xs font-black text-slate-400">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <TogglePill key={option.value} active={arrayOf(selected).includes(option.value)} onClick={() => onToggle(option.value)}>
            {optionLabel(option)}
          </TogglePill>
        ))}
      </div>
    </div>
  );
}

function BlockStats({ stats }) {
  if (!stats) return null;
  const tiles = [
    { label: "مطابق للفلتر", value: stats.pool_products, tone: stats.pool_products ? "text-white" : "text-rose-300" },
    { label: "اتعمله استوري", value: stats.generated_products, tone: "text-amber-300" },
    { label: "اتنشر", value: stats.published_products, tone: "text-emerald-300" },
    { label: "متبقي في اللفة", value: stats.remaining_products, tone: "text-sky-300" },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
          <div className="text-[11px] font-bold text-slate-400">{tile.label}</div>
          <div className={`text-lg font-black ${tile.tone}`}>{Number(tile.value || 0)}</div>
        </div>
      ))}
    </div>
  );
}

export default function StoryThemeCalendar({ calendar = [], overview = null, onChange, disabled = false }) {
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    let alive = true;
    getProductClassifications()
      .then((rows) => {
        if (alive) setGroups(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        // The editor still works with free-typed filters if classifications fail.
        if (alive) setGroups([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const productTypeOptions = useMemo(() => pickOptions(groups, "product_type"), [groups]);
  const gradeOptions = useMemo(() => pickOptions(groups, "grade"), [groups]);

  const statsByKey = useMemo(() => new Map(arrayOf(overview?.blocks).map((block) => [block.key, block])), [overview]);
  const week = arrayOf(overview?.week);

  const updateBlock = (index, patch) => {
    onChange(calendar.map((block, position) => (position === index ? { ...block, ...patch } : block)));
  };

  const updateFilters = (index, patch) => {
    const current = calendar[index]?.filters || {};
    updateBlock(index, { filters: { ...current, ...patch } });
  };

  const removeBlock = (index) => onChange(calendar.filter((_, position) => position !== index));

  const addBlock = () => {
    const key = `theme-${Date.now().toString(36)}`;
    onChange([
      ...calendar,
      {
        key,
        label_ar: "بلوك جديد",
        days: [],
        stories_per_day: 6,
        audiences: [],
        active: false,
        filters: { product_types: [], grades: [], styles: [], categories: [], offers_only: false, include_offers: false },
      },
    ]);
  };

  return (
    <div className="space-y-4">
      {/* Week strip: what actually goes out on each day, before you touch a block. */}
      <section className={`${cardClass} p-5`}>
        <div className="flex items-center gap-2 text-sm font-black text-white">
          <CalendarDays className="h-4 w-4 text-primary" />
          خريطة الأسبوع
        </div>
        <p className="mt-1 text-xs font-semibold text-slate-400">
          كل يوم بينزل البلوكات المربوطة بيه بس. لو اليوم فاضي مش هينزل فيه استوري.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {/* The server sends the NEXT SEVEN REAL DATES (date-windowed blocks drop
              off the exact day they expire). An older payload without date keys
              still renders as the abstract week. */}
          {(week.length && week[0]?.date_key
            ? week
            : WEEK_ORDER.map((day) => week.find((row) => row.day === day) || { day, blocks: [], total_stories: 0 })
          ).map((entry) => {
            const day = entry.day;
            const blocks = arrayOf(entry?.blocks);
            return (
              <div
                key={`${day}-${entry.date_key || ""}`}
                className={`rounded-xl border p-3 ${blocks.length ? "border-white/10 bg-black/25" : "border-amber-400/30 bg-amber-400/5"}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-black text-white">
                    {DAY_LABELS[day]}
                    {entry.date_label ? <span className="mr-1 text-[10px] font-bold text-slate-400">{entry.is_today ? "النهارده" : entry.date_label}</span> : null}
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">{Number(entry?.total_stories || 0)} استوري</span>
                </div>
                <div className="mt-2 space-y-1">
                  {blocks.length ? (
                    blocks.map((block) => (
                      <div
                        key={block.key}
                        className={`truncate rounded-lg px-2 py-1 text-[11px] font-black ${
                          block.needs_setup ? "bg-rose-500/15 text-rose-200" : "bg-primary/15 text-primary"
                        }`}
                        title={block.needs_setup ? "الفلتر ده مش مطابق أي منتج" : `${block.pool_products} منتج مطابق`}
                      >
                        {block.label_ar}
                      </div>
                    ))
                  ) : (
                    <div className="text-[11px] font-bold text-amber-300">مفيش بلوك</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Block editors */}
      <div className="space-y-3">
        {calendar.map((block, index) => {
          const stats = statsByKey.get(block.key);
          const offersOnly = block.filters?.offers_only === true;
          const expired = Boolean(block.end_date) && block.end_date < todayDateKey();
          const upcoming = Boolean(block.start_date) && block.start_date > todayDateKey();
          return (
            <section key={block.key || index} className={`${cardClass} p-5 ${expired ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Layers className="h-4 w-4 shrink-0 text-primary" />
                <input
                  className={`${inputClass} max-w-xs flex-1`}
                  value={block.label_ar || ""}
                  disabled={disabled}
                  onChange={(event) => updateBlock(index, { label_ar: event.target.value })}
                />
                <TogglePill active={block.active !== false} disabled={disabled} onClick={() => updateBlock(index, { active: block.active === false })}>
                  {block.active !== false ? "شغال" : "متوقف"}
                </TogglePill>
                {expired ? (
                  <span className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-black text-amber-200">
                    خلص موعده {formatShortDate(block.end_date)}
                  </span>
                ) : block.end_date ? (
                  <span className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-black text-emerald-200">
                    لحد {formatShortDate(block.end_date)}
                  </span>
                ) : null}
                {upcoming ? (
                  <span className="rounded-lg border border-sky-400/25 bg-sky-400/10 px-2.5 py-1.5 text-[11px] font-black text-sky-200">
                    يبدأ {formatShortDate(block.start_date)}
                  </span>
                ) : null}
                {stats?.cycle_number ? (
                  <span className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-[11px] font-black text-slate-300">
                    اللفة {stats.cycle_number}
                    {stats.weeks_to_cover ? ` · تخلص في ~${stats.weeks_to_cover} أسبوع` : ""}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeBlock(index)}
                  className="ms-auto rounded-lg border border-rose-400/30 bg-rose-500/10 p-2 text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
                  aria-label="حذف البلوك"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {stats?.needs_setup ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  البلوك شغال لكن الفلتر بتاعه مش مطابق أي منتج — اليوم ده هيعدي فاضي. اختار نوع أو درجة موجودة فعلاً.
                </div>
              ) : null}

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 text-xs font-black text-slate-400">أيام النزول</div>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEK_ORDER.map((day) => (
                        <TogglePill
                          key={day}
                          active={arrayOf(block.days).includes(day)}
                          disabled={disabled}
                          onClick={() => updateBlock(index, { days: toggleInList(block.days, day) })}
                        >
                          {DAY_LABELS[day]}
                        </TogglePill>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-2 block text-xs font-black text-slate-400">من تاريخ (اختياري)</span>
                      <input
                        type="date"
                        className={inputClass}
                        value={block.start_date || ""}
                        disabled={disabled}
                        onChange={(event) => updateBlock(index, { start_date: event.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-black text-slate-400">لحد تاريخ (اختياري)</span>
                      <input
                        type="date"
                        className={inputClass}
                        value={block.end_date || ""}
                        disabled={disabled}
                        onChange={(event) => updateBlock(index, { end_date: event.target.value })}
                      />
                    </label>
                    <p className="col-span-2 -mt-1 text-[11px] font-semibold leading-5 text-slate-500">
                      سيبهم فاضيين = شغال دايمًا. حدد &quot;لحد تاريخ&quot; لموسم بيخلص لوحده — زي شنط المدارس لحد ١٠/٩ — والبلوك بيقف بعده من غير ما تلمس حاجة.
                    </p>
                    <label className="block">
                      <span className="mb-2 block text-xs font-black text-slate-400">استوري في اليوم</span>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        className={inputClass}
                        value={Number(block.stories_per_day ?? 6)}
                        disabled={disabled}
                        onChange={(event) => updateBlock(index, { stories_per_day: Math.max(0, Math.min(60, Number(event.target.value) || 0)) })}
                      />
                    </label>
                    <div>
                      <div className="mb-2 text-xs font-black text-slate-400">الجمهور (فاضي = الكل)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
                          <TogglePill
                            key={value}
                            active={arrayOf(block.audiences).includes(value)}
                            disabled={disabled}
                            onClick={() => updateBlock(index, { audiences: toggleInList(block.audiences, value) })}
                          >
                            {label}
                          </TogglePill>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                    <Sparkles className="h-4 w-4 text-amber-300" />
                    <span className="text-xs font-black text-slate-300">العروض</span>
                    <TogglePill
                      active={offersOnly}
                      disabled={disabled}
                      onClick={() => updateFilters(index, { offers_only: !offersOnly, include_offers: !offersOnly ? true : false })}
                    >
                      عروض فقط
                    </TogglePill>
                    <TogglePill
                      active={block.filters?.include_offers === true}
                      disabled={disabled || offersOnly}
                      onClick={() => updateFilters(index, { include_offers: block.filters?.include_offers !== true })}
                    >
                      اسمح بمنتجات العروض
                    </TogglePill>
                  </div>

                  {offersOnly ? (
                    <p className="text-xs font-bold text-slate-400">
                      البلوك ده بياخد المنتجات المعلّمة كعرض بس، وبيتجاهل باقي الفلاتر. اربطه بأي يوم عشان ترفع العروض فيه.
                    </p>
                  ) : (
                    <>
                      <ChipPicker
                        label="نوع المنتج"
                        options={productTypeOptions}
                        selected={block.filters?.product_types}
                        onToggle={(value) => updateFilters(index, { product_types: toggleInList(block.filters?.product_types, value) })}
                        emptyHint="مفيش أنواع منتجات متسجلة."
                      />
                      <ChipPicker
                        label="الدرجة (ميرور / فيتنامي / محلي …)"
                        options={gradeOptions}
                        selected={block.filters?.grades}
                        onToggle={(value) => updateFilters(index, { grades: toggleInList(block.filters?.grades, value) })}
                        emptyHint="مفيش درجات متسجلة في تصنيفات المنتجات."
                      />
                      <KeywordEditor
                        label="ماركات معينة (اختياري)"
                        hint="فاضي = كل الماركات. لو كتبت momolly مثلًا، البلوك مش هياخد غير المنتجات اللي اسمها أو ماركتها فيها الكلمة دي."
                        values={block.filters?.keywords}
                        disabled={disabled}
                        onChange={(keywords) => updateFilters(index, { keywords })}
                      />
                    </>
                  )}
                </div>
              </div>

              <BlockStats stats={stats} />
            </section>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addBlock}
        disabled={disabled}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        إضافة بلوك
      </button>
    </div>
  );
}
