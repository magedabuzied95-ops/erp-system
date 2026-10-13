import { useEffect, useState } from "react";
import { Loader2, Package } from "lucide-react";
import { managerPortalApi } from "../services/managerPortalApi";
import { formatCurrency } from "../../../shared/lib/currency";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { ATTENDANCE_TZ } from "../../../shared/lib/attendanceShift";

// الجرد and التقييم, the two tabs after الحضور in the employee sheet. Both read one
// payload (/staff/:id/performance) that is fetched once per employee-month and only
// when one of the two tabs is opened — the sheet's own load stays as heavy as it was.

const formatNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));
const formatDay = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("ar-EG", { timeZone: ATTENDANCE_TZ, weekday: "short", day: "numeric", month: "short" }).format(date);
};
const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: ATTENDANCE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateKey = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: ATTENDANCE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

const COUNT_STATUS = {
  completed: { label: "معتمد", tone: "bg-emerald-50 text-emerald-700" },
  pending_review: { label: "مستني المراجعة", tone: "bg-amber-50 text-amber-700" },
  rejected: { label: "مرفوض", tone: "bg-rose-50 text-rose-700" },
  in_progress: { label: "شغال", tone: "bg-sky-50 text-sky-700" },
};

export function useEmployeePerformance({ token, employeeId, month, enabled }) {
  const [state, setState] = useState({ key: "", loading: false, error: "", data: null });
  const key = `${employeeId}:${month}`;
  useEffect(() => {
    if (!enabled || !token || !employeeId || state.key === key) return undefined;
    let alive = true;
    setState({ key, loading: true, error: "", data: null });
    managerPortalApi.employeePerformance(token, employeeId, { month })
      .then((res) => { if (alive) setState({ key, loading: false, error: "", data: res?.performance || null }); })
      .catch((error) => { if (alive) setState({ key, loading: false, error: error?.response?.data?.message || error?.message || "تعذر التحميل", data: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, employeeId, month, key]);
  const current = state.key === key ? state : { loading: true, error: "", data: null };
  return current;
}

const Stat = ({ label, value, hint = "", tone = "text-slate-950" }) => (
  <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-right">
    <div className="text-[10px] font-black text-slate-500">{label}</div>
    <div className={`mt-0.5 truncate text-sm font-black tabular-nums ${tone}`}>{value}</div>
    {hint ? <div className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{hint}</div> : null}
  </div>
);

const Pending = ({ perf }) => (perf.loading ? (
  <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
) : perf.error ? (
  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-bold text-rose-700">{perf.error}</div>
) : null);

export function EmployeeCountsTab({ perf }) {
  if (perf.loading || perf.error || !perf.data) return <Pending perf={perf} />;
  const { totals, models } = perf.data.counts;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="موديلات اتجردت" value={formatNumber(totals.models)} tone="text-emerald-700" />
        <Stat label="قطع اتعدت" value={formatNumber(totals.pieces)} />
        <Stat label="ألوان / مقاسات" value={`${formatNumber(totals.colors)} / ${formatNumber(totals.size_rows)}`} />
        <Stat
          label="دقة الجرد"
          value={totals.accuracy === null ? "—" : `${formatNumber(totals.accuracy)}%`}
          hint={totals.variance_rows ? `${formatNumber(totals.variance_rows)} مقاس فيه فرق` : ""}
          tone={totals.accuracy !== null && totals.accuracy < 90 ? "text-amber-700" : "text-slate-950"}
        />
      </div>
      {totals.days ? (
        <div className="text-[11px] font-bold text-slate-500">
          {`جرد في ${formatNumber(totals.days)} يوم — ${formatNumber(totals.sessions)} جلسة جرد`}
        </div>
      ) : null}
      {perf.data.counts.error ? <div className="text-[11px] font-bold text-rose-700">تعذر تحميل الجرد</div> : null}
      {models.length ? (
        <div className="divide-y divide-slate-100 rounded-[var(--radius-card)] border border-slate-200 bg-white">
          {models.map((model) => {
            const status = COUNT_STATUS[model.status] || COUNT_STATUS.in_progress;
            const image = model.image_url ? resolveProductImageUrl(model.image_url) : "";
            return (
              <div key={`${model.product_id || model.name}`} className="flex items-center gap-2.5 px-2.5 py-2">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-slate-200 bg-slate-50">
                  {image ? <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-black text-slate-950">{model.name || "—"}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${status.tone}`}>{status.label}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] font-bold text-slate-500">
                    {[model.code, model.colors.join("، ")].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                    <span className="tabular-nums">{`${formatNumber(model.pieces)} قطعة · ${formatNumber(model.size_rows)} مقاس`}</span>
                    <span className="shrink-0">{formatDay(model.last_counted_at)}</span>
                  </div>
                  {model.variance_rows ? (
                    <>
                      <div className="mt-0.5 text-[11px] font-bold text-amber-700">{`فرق في ${formatNumber(model.variance_rows)} مقاس (${formatNumber(model.variance_total)} قطعة)`}</div>
                      {model.over_rows || model.short_rows ? (
                        <div className="mt-0.5 text-[11px] font-bold tabular-nums">
                          {model.over_rows ? <span className="text-emerald-700">{`زيادة ${formatNumber(model.over_total)} قطعة في ${formatNumber(model.over_rows)} مقاس`}</span> : null}
                          {model.over_rows && model.short_rows ? <span className="text-slate-400">{" · "}</span> : null}
                          {model.short_rows ? <span className="text-rose-700">{`نقص ${formatNumber(model.short_total)} قطعة في ${formatNumber(model.short_rows)} مقاس`}</span> : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm font-bold text-slate-500">مفيش جرد الشهر ده</div>
      )}
      {totals.truncated ? <div className="text-[11px] font-bold text-slate-400">ظاهر أول ٥٠٠٠ مقاس بس</div> : null}
    </div>
  );
}

const GRADES = [
  { min: 85, label: "ممتاز", tone: "text-emerald-700", bar: "bg-emerald-500" },
  { min: 70, label: "جيد جداً", tone: "text-emerald-700", bar: "bg-emerald-400" },
  { min: 55, label: "جيد", tone: "text-sky-700", bar: "bg-sky-500" },
  { min: 40, label: "مقبول", tone: "text-amber-700", bar: "bg-amber-500" },
  { min: -1, label: "ضعيف", tone: "text-rose-700", bar: "bg-rose-500" },
];
const gradeOf = (score) => GRADES.find((grade) => score >= grade.min) || GRADES[GRADES.length - 1];
const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

// Each line is scored 0–100 from figures the sheet already shows elsewhere, so the
// manager can always trace a weak line back to the tab that explains it. A line
// with nothing to judge yet (no working day, nobody sold in the branch) is left
// out of the overall score instead of counting as zero.
export const buildEvaluation = (details, performance) => {
  const rows = details?.attendance?.rows || [];
  const totals = details?.attendance?.totals || {};
  const breakdown = details?.salary?.attendance_breakdown || null;
  const today = todayKey();
  const expected = Number(breakdown?.expected_working_days || 0);
  const attended = Number(breakdown?.attended_days ?? totals.days ?? 0);
  const absence = Number(breakdown?.absence_days ?? Math.max(expected - attended, 0));
  const daysWorked = Number(totals.days || 0);
  const lateDays = Number(totals.late_days || 0);
  const missingOut = rows.filter((row) => row.check_in && !row.check_out && dateKey(row.date) < today).length;
  const earlyDays = rows.filter((row) => Number(row.early_leave_minutes || 0) > 0).length;
  const sales = performance?.sales || null;
  const counts = performance?.counts?.totals || null;
  const penalties = details?.penalties?.rows?.length || 0;
  const bonuses = details?.bonuses?.rows?.length || 0;

  const lines = [
    {
      key: "attendance",
      label: "الحضور والغياب",
      score: expected > 0 ? clampScore((Math.min(attended, expected) / expected) * 100) : (daysWorked ? 100 : null),
      detail: expected > 0
        ? `حضر ${formatNumber(attended)} من ${formatNumber(expected)} يوم شغل · غياب ${formatNumber(absence)} يوم`
        : `حضر ${formatNumber(attended)} يوم`,
    },
    {
      key: "punctuality",
      label: "الالتزام بميعاد الحضور",
      score: daysWorked ? clampScore((1 - lateDays / daysWorked) * 100) : null,
      detail: `اتأخر ${formatNumber(lateDays)} يوم · ${formatNumber(totals.late_minutes || 0)} دقيقة تأخير`,
    },
    {
      key: "checkout",
      label: "الانصراف",
      score: daysWorked ? clampScore((1 - Math.min(missingOut + earlyDays, daysWorked) / daysWorked) * 100) : null,
      detail: `${formatNumber(missingOut)} يوم من غير انصراف · ${formatNumber(earlyDays)} يوم مشي بدري`,
    },
    {
      key: "sales",
      label: "المبيعات",
      // At the branch average = 80; 25% above it is full marks.
      score: sales && sales.team_average > 0 ? clampScore((sales.total / sales.team_average) * 80) : null,
      detail: sales
        ? `${formatCurrency(sales.total)} · ${formatNumber(sales.invoices)} فاتورة${sales.rank ? ` · الترتيب ${formatNumber(sales.rank)} من ${formatNumber(sales.team_size)}` : ""}`
        : `${formatCurrency(details?.sales?.total || 0)} · ${formatNumber(details?.sales?.invoices || 0)} فاتورة`,
    },
    {
      key: "counts",
      label: "الجرد",
      score: counts ? (counts.models > 0 ? clampScore(counts.accuracy ?? 100) : 0) : null,
      detail: counts
        ? (counts.models > 0 ? `${formatNumber(counts.models)} موديل · ${formatNumber(counts.pieces)} قطعة · دقة ${formatNumber(counts.accuracy ?? 100)}%` : "مجردش ولا موديل")
        : "—",
    },
    {
      key: "discipline",
      label: "الجزاءات والمكافآت",
      score: clampScore(100 - penalties * 20),
      detail: `${formatNumber(penalties)} جزاء · ${formatNumber(bonuses)} مكافأة`,
    },
  ];
  const scored = lines.filter((line) => line.score !== null);
  const overall = scored.length ? clampScore(scored.reduce((acc, line) => acc + line.score, 0) / scored.length) : null;
  return { lines, overall, sales };
};

export function EmployeePerformanceTab({ details, perf }) {
  if (perf.loading || perf.error || !perf.data) return <Pending perf={perf} />;
  const { lines, overall, sales } = buildEvaluation(details, perf.data);
  const overallGrade = overall === null ? null : gradeOf(overall);
  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-black text-slate-700">التقييم العام للشهر</span>
          {overallGrade ? <span className={`text-sm font-black ${overallGrade.tone}`}>{overallGrade.label}</span> : null}
        </div>
        <div className="mt-1 flex items-end gap-1">
          <span className={`text-3xl font-black tabular-nums ${overallGrade?.tone || "text-slate-400"}`}>{overall === null ? "—" : formatNumber(overall)}</span>
          <span className="pb-1 text-xs font-bold text-slate-400">/ ١٠٠</span>
        </div>
        {overall !== null ? (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${overallGrade.bar}`} style={{ width: `${overall}%` }} />
          </div>
        ) : null}
      </div>

      <div className="divide-y divide-slate-100 rounded-[var(--radius-card)] border border-slate-200 bg-white">
        {lines.map((line) => {
          const grade = line.score === null ? null : gradeOf(line.score);
          return (
            <div key={line.key} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-black text-slate-900">{line.label}</span>
                <span className={`shrink-0 text-xs font-black tabular-nums ${grade?.tone || "text-slate-400"}`}>
                  {grade ? `${formatNumber(line.score)} · ${grade.label}` : "مفيش بيانات"}
                </span>
              </div>
              {grade ? (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${grade.bar}`} style={{ width: `${line.score}%` }} />
                </div>
              ) : null}
              <div className="mt-1 text-[11px] font-bold text-slate-500">{line.detail}</div>
            </div>
          );
        })}
      </div>

      {sales ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="متوسط الفاتورة" value={formatCurrency(sales.average_invoice)} />
          <Stat label="متوسط مبيعات الفرع" value={formatCurrency(sales.team_average)} hint={`أعلى موظف: ${formatCurrency(sales.team_best)}`} />
        </div>
      ) : null}
    </div>
  );
}
