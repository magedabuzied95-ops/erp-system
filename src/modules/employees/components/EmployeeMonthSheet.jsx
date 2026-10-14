import { useEffect } from "react";
import { X } from "lucide-react";
import { getAppTimezone } from "../../../shared/lib/appTimezone";
import { buildMonthDays, monthDayKey } from "../lib/employeeMonthDays";

// The sheet behind the home cards: أيام الحضور lists the month day by day (present, absent, leave),
// السلف lists this month's advances and whatever is still owed from earlier months. Absent and
// leave days come from payroll itself, so they match the salary and the manager portal.

const TZ = getAppTimezone();
const arNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));
const dayKey = (value) => monthDayKey(value, TZ);
// A bare YYYY-MM-DD is a calendar day: format it at UTC noon so no timezone can move it.
const formatDay = (key) => {
  if (!key) return "-";
  const date = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat("ar-EG", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(date);
};
const formatClock = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(date);
};
const formatMinutes = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  if (!total) return "";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const hourText = hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : hours ? `${arNumber(hours)} ساعة` : "";
  const minuteText = rest === 1 ? "دقيقة" : rest === 2 ? "دقيقتين" : rest ? `${arNumber(rest)} دقيقة` : "";
  return [hourText, minuteText].filter(Boolean).join(" و");
};
const money = (value) => `${new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(Number(value || 0))} ج.م`;
const monthLabel = (month) => {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return "";
  return new Intl.DateTimeFormat("ar-EG", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-15T12:00:00Z`));
};

// The day had an approved late permission (the server sends the cover; null/absent = none).
const hasPermission = (row) => row?.late_permission_minutes !== null && row?.late_permission_minutes !== undefined;

const Pill = ({ tone, children }) => {
  const tones = {
    present: "bg-success-subtle text-text",
    absent: "bg-danger-subtle text-danger",
    leave: "bg-primary-subtle text-text",
    warning: "bg-warning-subtle text-text",
  };
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${tones[tone] || tones.present}`}>{children}</span>;
};

const Count = ({ label, value, tone }) => (
  <div className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-2 py-2 text-center">
    <div className={`text-base font-black ${tone === "absent" ? "text-danger" : "text-text"}`}>{arNumber(value)}</div>
    <div className="mt-0.5 text-[10px] font-bold text-text-muted">{label}</div>
  </div>
);

function AttendanceBody({ timeline, monthDays }) {
  const { rows, counts } = buildMonthDays({ timeline, monthDays, today: dayKey(new Date()), timeZone: TZ });
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Count label="حضور" value={counts.present} />
        <Count label="غياب" value={counts.absent} tone="absent" />
        <Count label="إجازة" value={counts.leave} />
      </div>
      {rows.length ? (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border">
          {rows.map(({ key, kind, row }) => (
            <li key={`${kind}-${key}`} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${kind === "absent" ? "bg-danger-subtle/40" : "bg-surface"}`}>
              <div className="min-w-0">
                <div className="text-[13px] font-black text-text">{formatDay(key)}</div>
                {kind === "present" ? (
                  <div className="mt-0.5 text-[11px] font-bold text-text-muted">
                    حضور {formatClock(row.check_in)} · انصراف {row.check_out ? formatClock(row.check_out) : "لسه"}
                    {Number(row.late_minutes) > 0 ? <span className="text-danger"> · تأخير {formatMinutes(row.late_minutes)}{hasPermission(row) ? " بعد الإذن" : ""}</span> : null}
                    {hasPermission(row) && !(Number(row.late_minutes) > 0) && Number(row.late_minutes_raw) > 0 ? <span> · الإذن غطّى التأخير</span> : null}
                  </div>
                ) : null}
              </div>
              {kind === "present" && hasPermission(row) ? (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Pill tone="present">حضور</Pill>
                  <Pill tone="leave">إذن تأخير {formatMinutes(row.late_permission_minutes)}</Pill>
                </div>
              ) : kind === "present" ? <Pill tone="present">حضور</Pill> : kind === "absent" ? <Pill tone="absent">غياب</Pill> : <Pill tone="leave">إجازة</Pill>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-[var(--radius-card)] border border-dashed border-border px-3 py-6 text-center text-xs font-bold text-text-muted">مفيش أيام متسجلة الشهر ده لسه</div>
      )}
    </>
  );
}

function AdvancesBody({ advances, total }) {
  const rows = Array.isArray(advances) ? advances : [];
  const thisMonth = rows.filter((row) => row.this_month);
  const earlier = rows.filter((row) => !row.this_month);
  const renderRow = (row) => {
    const settled = row.outstanding_amount <= 0;
    const partly = !settled && row.deducted_amount > 0;
    return (
      <li key={row.id} className="flex items-center justify-between gap-3 bg-surface px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-black text-text">{formatDay(row.taken_on)}</div>
          <div className="mt-0.5 text-[11px] font-bold text-text-muted">
            {settled ? "اتخصمت من المرتب" : partly ? `اتخصم ${money(row.deducted_amount)} · فاضل ${money(row.outstanding_amount)}` : row.deduction_month ? `هتتخصم من مرتب ${monthLabel(String(row.deduction_month).slice(0, 7))}` : "لسه ما اتخصمتش"}
          </div>
        </div>
        <div className="shrink-0 text-end">
          <div className="text-sm font-black text-text">{money(row.amount)}</div>
          {settled ? <Pill tone="present">اتخصمت</Pill> : <Pill tone="warning">عليك</Pill>}
        </div>
      </li>
    );
  };
  return (
    <>
      <div className="rounded-[var(--radius-card)] border border-border bg-warning-subtle px-3 py-3">
        <div className="text-[11px] font-bold text-text-muted">اللي لسه عليك</div>
        <div className="mt-1 text-lg font-black text-text">{money(total)}</div>
      </div>
      <div className="mt-3 text-xs font-black text-text">سلف الشهر ده</div>
      {thisMonth.length ? (
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border">{thisMonth.map(renderRow)}</ul>
      ) : (
        <div className="mt-2 rounded-[var(--radius-card)] border border-dashed border-border px-3 py-4 text-center text-xs font-bold text-text-muted">ما خدتش سلف الشهر ده</div>
      )}
      {earlier.length ? (
        <>
          <div className="mt-4 text-xs font-black text-text">باقي من شهور قبل كده</div>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border">{earlier.map(renderRow)}</ul>
        </>
      ) : null}
    </>
  );
}

// One line of the الخصومات / الإضافات sheets: what it is, its detail, and its amount.
const MoneyLine = ({ title, detail, amount, tone }) => (
  <li className="flex items-start justify-between gap-3 bg-surface px-3 py-2.5">
    <div className="min-w-0">
      <div className="text-[13px] font-black text-text">{title}</div>
      {detail ? <div className="mt-0.5 text-[11px] font-bold leading-5 text-text-muted">{detail}</div> : null}
    </div>
    <div className={`shrink-0 text-sm font-black ${tone === "minus" && amount > 0 ? "text-danger" : "text-text"}`}>
      {tone === "minus" && amount > 0 ? "- " : tone === "plus" && amount > 0 ? "+ " : ""}{money(amount)}
    </div>
  </li>
);

const deductionLine = (item, threshold) => {
  const day = item.date ? formatDay(item.date) : "";
  switch (item.kind) {
    case "late": {
      const left = Math.max(0, item.late_minutes - (item.covered_minutes || 0));
      const parts = [`تأخير ${formatMinutes(item.late_minutes)}`];
      if (item.covered_minutes > 0) parts.push(`الإذن غطّى ${formatMinutes(item.covered_minutes)}`);
      if (!(item.amount > 0)) parts.push(!item.overridden && threshold && left <= threshold ? `مفيش خصم (${arNumber(threshold)} دقيقة مسموح)` : "مفيش خصم");
      else if (item.penalty_days) parts.push(item.penalty_days === 0.5 ? "خصم نص يوم" : `خصم ${arNumber(item.penalty_days)} يوم`);
      if (item.overridden) parts.push("اتعدل من المدير");
      return { title: day, detail: parts.join(" · ") };
    }
    case "absence": {
      const penalty = !(item.penalty_days > 0) ? "مفيش خصم"
        : `خصم ${item.penalty_days === 0.5 ? "نص يوم" : item.penalty_days === 1 ? "يوم" : item.penalty_days === 2 ? "يومين" : `${arNumber(item.penalty_days)} يوم`}`;
      return { title: day, detail: ["غياب", penalty, item.overridden ? "اتعدل من المدير" : ""].filter(Boolean).join(" · ") };
    }
    case "absence_total": return { title: "أيام الغياب", detail: `${arNumber(item.days)} يوم` };
    case "late_total": return { title: "التأخير", detail: "" };
    case "leave": return { title: "إجازات برّه الرصيد", detail: `${arNumber(item.days)} يوم بعد الإجازات المدفوعة` };
    case "missing_hours": return { title: "ساعات ناقصة", detail: `${arNumber(Number(item.hours || 0).toFixed(2))} ساعة أقل من ساعات اليوم` };
    case "early_leave": return { title: "انصراف بدري", detail: `${arNumber(Number(item.hours || 0).toFixed(2))} ساعة` };
    case "penalty": return { title: item.reason || "خصم من المدير", detail: [item.reason ? "خصم من المدير" : "", day].filter(Boolean).join(" · ") };
    case "manual": return { title: "خصومات تانية", detail: "" };
    case "advances": return { title: "سلف هتتخصم الشهر ده", detail: "التفاصيل في كارت السلف" };
    default: return { title: "خصم", detail: "" };
  }
};

const additionLine = (item) => {
  const day = item.date ? formatDay(item.date) : "";
  switch (item.kind) {
    case "commission": return { title: "عمولة المبيعات", detail: "" };
    case "bonus": return { title: item.reason || "مكافأة", detail: [item.reason ? "مكافأة" : "", day].filter(Boolean).join(" · ") };
    case "overtime": return { title: "ساعات إضافية معتمدة", detail: item.hours ? `${arNumber(Number(item.hours).toFixed(2))} ساعة` : "" };
    default: return { title: "إضافة", detail: "" };
  }
};

function MoneyBody({ breakdown, sign }) {
  const items = Array.isArray(breakdown?.items) ? breakdown.items : [];
  const isMinus = sign === "minus";
  const days = isMinus ? items.filter((item) => item.kind === "late" || item.kind === "absence") : [];
  const others = isMinus ? items.filter((item) => item.kind !== "late" && item.kind !== "absence") : items;
  const line = (item, index) => {
    const { title, detail } = isMinus ? deductionLine(item, breakdown?.late_threshold_minutes) : additionLine(item);
    return <MoneyLine key={`${item.kind}-${item.date || ""}-${index}`} title={title} detail={detail} amount={item.amount} tone={sign} />;
  };
  if (!breakdown) {
    return <div className="rounded-[var(--radius-card)] border border-dashed border-border px-3 py-6 text-center text-xs font-bold text-text-muted">المرتب لسه بيتحسب — جرّب تاني بعد شوية</div>;
  }
  return (
    <>
      <div className={`rounded-[var(--radius-card)] border border-border px-3 py-3 ${isMinus ? "bg-danger-subtle" : "bg-success-subtle"}`}>
        <div className="text-[11px] font-bold text-text-muted">{isMinus ? "إجمالي الخصومات لحد النهارده" : "إجمالي الإضافات لحد النهارده"}</div>
        <div className="mt-1 text-lg font-black text-text">{money(breakdown.total)}</div>
      </div>
      {!items.length ? (
        <div className="mt-3 rounded-[var(--radius-card)] border border-dashed border-border px-3 py-6 text-center text-xs font-bold text-text-muted">{isMinus ? "مفيش خصومات الشهر ده" : "مفيش إضافات الشهر ده"}</div>
      ) : null}
      {days.length ? (
        <>
          <div className="mt-3 text-xs font-black text-text">التأخير والغياب يوم بيوم</div>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border">
            {[...days].sort((a, b) => String(b.date).localeCompare(String(a.date))).map(line)}
          </ul>
        </>
      ) : null}
      {others.length ? (
        <>
          {isMinus ? <div className="mt-4 text-xs font-black text-text">خصومات تانية</div> : null}
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border">{others.map(line)}</ul>
        </>
      ) : null}
    </>
  );
}

const SHEET_TITLES = { attendance: "أيام الحضور", advances: "السلف", deductions: "الخصومات", additions: "الإضافات" };

export default function EmployeeMonthSheet({ kind, onClose, timeline, monthDays, advances, advancesTotal, moneyBreakdown }) {
  useEffect(() => {
    if (!kind) return undefined;
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [kind, onClose]);

  if (!kind) return null;
  const title = SHEET_TITLES[kind] || SHEET_TITLES.attendance;
  const month = monthLabel(monthDays?.month);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-[var(--radius-card)] border border-border bg-surface text-text shadow-[var(--shadow-card)] sm:rounded-[var(--radius-card)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-[15px] font-black text-text">{title}</div>
            {month ? <div className="mt-0.5 text-[11px] font-bold text-text-muted">{month}</div> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {kind === "advances" ? <AdvancesBody advances={advances} total={advancesTotal} />
            : kind === "deductions" ? <MoneyBody breakdown={moneyBreakdown?.deductions} sign="minus" />
            : kind === "additions" ? <MoneyBody breakdown={moneyBreakdown?.additions} sign="plus" />
            : <AttendanceBody timeline={timeline} monthDays={monthDays} />}
        </div>
      </div>
    </div>
  );
}
