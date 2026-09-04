import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Plus, Minus, ChevronRight, ChevronLeft, Trash2, Pencil } from "lucide-react";
import i18n from "../../../i18n/i18n";
import { managerPortalApi } from "../services/managerPortalApi";
import { formatCurrency } from "../../../shared/lib/currency";
import { resolveEmployeeProfileImageUrl } from "../../../shared/lib/imageUrls";
import {
  ATTENDANCE_TZ,
  describeManualShift,
  isOvernightRow,
  toDateKey,
} from "../lib/attendanceShift";

const tt = (key, options) => i18n.t(key, options);
const formatNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));

const formatDay = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("ar-EG", { weekday: "short", day: "numeric", month: "short" }).format(date);
};
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric" }).format(date);
};
// Pinned to the attendance timezone, like the edit form's `toClockInput`: read
// on a phone left on another zone, an unpinned clock disagreed with the value
// the same row put in the editor.
const formatClock = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", { timeZone: ATTENDANCE_TZ, hour: "2-digit", minute: "2-digit" }).format(date);
};
const formatMinutes = (minutes) => {
  const m = Math.max(0, Math.round(Number(minutes || 0)));
  if (!m) return "0 د";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} س ${r ? `${r} د` : ""}`.trim() : `${r} د`;
};
const toClockInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ATTENDANCE_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("hour")}:${get("minute")}`;
};
const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: ATTENDANCE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthLabel = (month) => {
  const [y, m] = String(month || "").split("-").map(Number);
  if (!y || !m) return month || "";
  return new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
};
const shiftMonth = (month, delta) => {
  const [y, m] = String(month || "").split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const TABS = ["overview", "sales", "advances", "attendance", "adjustments"];

const Row = ({ label, value, tone = "" }) => (
  <div className="flex items-center justify-between gap-3 py-2 text-sm">
    <span className="font-bold text-slate-500">{label}</span>
    <span className={`font-black tabular-nums ${tone}`}>{value}</span>
  </div>
);

const Stat = ({ label, value, tone = "text-slate-950" }) => (
  <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-right">
    <div className="text-[10px] font-black text-slate-500">{label}</div>
    <div className={`mt-0.5 truncate text-sm font-black tabular-nums ${tone}`}>{value}</div>
  </div>
);

const statusLabel = (status) => {
  const key = String(status || "").toLowerCase();
  const map = {
    pending: "قيد المراجعة", approved: "معتمد", paid: "مدفوع", settled: "مسدد", deducted: "مخصوم",
    partially_deducted: "مخصوم جزئياً", cancelled: "ملغي", rejected: "مرفوض", active: "نشط", open: "مفتوح",
    checked_in: "حاضر", checked_out: "انصرف", late: "متأخر", absent: "غائب", present: "حاضر",
  };
  return map[key] || status || "—";
};

export default function EmployeeDetailsSheet({ token, employee, initialTab = "overview", onClose, onChanged }) {
  const [tab, setTab] = useState(TABS.includes(initialTab) ? initialTab : "overview");
  const [month, setMonth] = useState(currentMonth());
  const [state, setState] = useState({ loading: true, error: "", details: null });
  const [form, setForm] = useState({ type: "bonus", amount: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [deletingKey, setDeletingKey] = useState("");
  const [attForm, setAttForm] = useState(null);
  const [attSaving, setAttSaving] = useState(false);
  const [attNotice, setAttNotice] = useState("");

  const employeeId = employee?.employee_id || employee?.id;

  const load = async () => {
    if (!token || !employeeId) return;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const res = await managerPortalApi.employeeDetails(token, employeeId, { month });
      setState({ loading: false, error: "", details: res?.details || null });
    } catch (error) {
      setState({ loading: false, error: error?.response?.data?.message || error?.message || tt("managerPortal.employeeDetails.loadError"), details: null });
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token, employeeId, month]);
  useEffect(() => { setTab(TABS.includes(initialTab) ? initialTab : "overview"); }, [initialTab, employeeId]);

  const d = state.details;
  const photo = resolveEmployeeProfileImageUrl(d?.employee?.photo_url || employee?.photo_url || "");
  const name = d?.employee?.name || employee?.employee_name || tt("managerPortal.common.employee");
  const isCurrentMonth = month === currentMonth();

  // اعتماد المرتب — the month's salary is frozen server-side, its advances settled, and any
  // advance taken afterwards is recorded on the next month.
  const [approving, setApproving] = useState(false);
  const [approveNotice, setApproveNotice] = useState({ tone: "", text: "", blockers: [] });
  useEffect(() => { setApproveNotice({ tone: "", text: "", blockers: [] }); }, [month, employeeId]);
  const payrollRun = d?.payroll?.run || null;
  const nextAdvanceMonth = d?.payroll?.next_advance_month || shiftMonth(month, 1);
  const hardBlockers = (d?.payroll?.blockers || [])
    .filter((blocker) => String(blocker?.severity || "").toLowerCase() === "hard")
    .map((blocker) => blocker.message)
    .filter(Boolean);
  const approvePayroll = async () => {
    if (!d || approving || payrollRun) return;
    const net = d.salary.net_pay === null ? "—" : formatCurrency(d.salary.net_pay);
    if (!window.confirm(tt("managerPortal.employeeDetails.payrollApproveConfirm", { month: monthLabel(month), net, next: monthLabel(nextAdvanceMonth) }))) return;
    try {
      setApproving(true);
      setApproveNotice({ tone: "", text: "", blockers: [] });
      await managerPortalApi.approveEmployeePayroll(token, employeeId, { month });
      setApproveNotice({ tone: "ok", text: tt("managerPortal.employeeDetails.payrollApprovedNow", { month: monthLabel(month) }), blockers: [] });
      await load();
      onChanged?.();
    } catch (error) {
      const data = error?.response?.data || {};
      const blockers = (Array.isArray(data.blockers) ? data.blockers : [])
        .filter((blocker) => String(blocker?.severity || "").toLowerCase() === "hard")
        .map((blocker) => blocker.message_ar || blocker.message || "")
        .filter(Boolean);
      setApproveNotice({
        tone: "error",
        text: blockers.length ? tt("managerPortal.employeeDetails.payrollBlocked") : (data.message || error?.message || tt("managerPortal.employeeDetails.payrollApproveError")),
        blockers,
      });
    } finally {
      setApproving(false);
    }
  };

  const submitAdjustment = async (event) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setNotice(tt("managerPortal.employeeDetails.amountRequired")); return; }
    if (!String(form.reason || "").trim()) { setNotice(tt("managerPortal.employeeDetails.reasonRequired")); return; }
    try {
      setSaving(true);
      setNotice("");
      await managerPortalApi.createEmployeeAdjustment(token, employeeId, { type: form.type, amount, reason: form.reason.trim() });
      setForm({ type: form.type, amount: "", reason: "" });
      setNotice(tt("managerPortal.employeeDetails.saved"));
      await load();
      onChanged?.();
    } catch (error) {
      setNotice(error?.response?.data?.message || error?.message || tt("managerPortal.employeeDetails.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const deleteAdjustment = async (row) => {
    if (!window.confirm(tt("managerPortal.employeeDetails.deleteConfirm"))) return;
    const key = `${row._kind}-${row.id}`;
    try {
      setDeletingKey(key);
      setNotice("");
      await managerPortalApi.deleteEmployeeAdjustment(token, employeeId, row._kind, row.id);
      setNotice(tt("managerPortal.employeeDetails.deleted"));
      await load();
      onChanged?.();
    } catch (error) {
      setNotice(error?.response?.data?.message || error?.message || tt("managerPortal.employeeDetails.deleteError"));
    } finally {
      setDeletingKey("");
    }
  };

  const openAttendanceEditor = (row = null) => {
    setAttNotice("");
    setAttForm(row
      ? { date: toDateKey(row.date), check_in: toClockInput(row.check_in), check_out: toClockInput(row.check_out), reason: "", confirm_long: false }
      : { date: isCurrentMonth ? todayKey() : `${month}-01`, check_in: "", check_out: "", reason: "", confirm_long: false });
  };

  // What the correction adds up to, recomputed as the manager types, so the
  // day's length and the check-out's calendar day are on screen before saving.
  const attShift = useMemo(
    () => describeManualShift({ date: attForm?.date, checkIn: attForm?.check_in, checkOut: attForm?.check_out }),
    [attForm?.date, attForm?.check_in, attForm?.check_out]
  );

  const submitAttendance = async (event) => {
    event.preventDefault();
    if (!attForm) return;
    if (!attForm.check_in) { setAttNotice(tt("managerPortal.employeeDetails.checkInRequired")); return; }
    if (!String(attForm.reason || "").trim()) { setAttNotice(tt("managerPortal.employeeDetails.attendanceReasonRequired")); return; }
    // A 12-hour picker turns one mis-tapped ص/م into a day twice its real
    // length, and the derived next-day check-out makes the result look valid.
    if (attShift?.isLong && !attForm.confirm_long) { setAttNotice(tt("managerPortal.employeeDetails.longShiftBlocked")); return; }
    try {
      setAttSaving(true);
      setAttNotice("");
      await managerPortalApi.correctEmployeeAttendance(token, employeeId, {
        attendance_date: attForm.date,
        check_in_time: attForm.check_in,
        check_out_time: attForm.check_out || "",
        // A night shift checks out after midnight: a check-out clock that is not
        // after the check-in clock belongs to the next calendar day. The sheet
        // shows that date, and the length it implies, before this is sent.
        check_out_date: attShift?.checkOutDate || attForm.date,
        correction_scope: attForm.check_out ? "both" : "check_in",
        reason: attForm.reason.trim(),
      });
      setAttForm(null);
      setNotice(tt("managerPortal.employeeDetails.attendanceSaved"));
      await load();
      onChanged?.();
    } catch (error) {
      setAttNotice(error?.response?.data?.message || error?.message || tt("managerPortal.employeeDetails.attendanceSaveError"));
    } finally {
      setAttSaving(false);
    }
  };

  const tabLabels = useMemo(() => ({
    overview: tt("managerPortal.employeeDetails.tabs.overview"),
    sales: tt("managerPortal.employeeDetails.tabs.sales"),
    advances: tt("managerPortal.employeeDetails.tabs.advances"),
    attendance: tt("managerPortal.employeeDetails.tabs.attendance"),
    adjustments: tt("managerPortal.employeeDetails.tabs.adjustments"),
  }), []);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 sm:items-center">
      <button type="button" aria-label={tt("managerPortal.invoice.close")} onClick={onClose} className="absolute inset-0" />
      <section className="manager-employee-sheet relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[2rem] border border-slate-200 bg-white shadow-2xl sm:rounded-[2rem]" dir="rtl">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800 text-lg font-black">
            {photo ? <img src={photo} alt={name} className="h-full w-full object-cover" /> : <span>{String(name).trim().charAt(0)}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m1-section-title truncate text-white">{name}</h2>
            <div className="truncate text-xs font-bold text-slate-300">
              {d?.employee?.job_title || employee?.job_title || employee?.department || ""}
              {d?.employee?.employee_code ? ` · ${d.employee.employee_code}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-primary text-[var(--primary-contrast)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <button type="button" aria-label="prev month" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-700"><ChevronRight className="h-4 w-4" /></button>
          <div className="text-sm font-black text-slate-900">{monthLabel(month)}</div>
          <button type="button" aria-label="next month" disabled={isCurrentMonth} onClick={() => setMonth((m) => shiftMonth(m, 1))} className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-700 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
        </div>

        <div className="manager-employee-sheet-tabs flex gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${tab === key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {tabLabels[key]}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {state.loading ? (
            <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-500" /></div>
          ) : state.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-bold text-rose-700">{state.error}</div>
          ) : !d ? null : (
            <>
              {tab === "overview" ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={tt("managerPortal.employeeDetails.monthSales")} value={formatCurrency(d.sales.total)} />
                    <Stat label={tt("managerPortal.employeeDetails.invoices")} value={formatNumber(d.sales.invoices)} />
                    <Stat label={tt("managerPortal.employeeDetails.baseSalary")} value={formatCurrency(d.salary.base_salary)} />
                    <Stat label={tt("managerPortal.employeeDetails.netPay")} value={d.salary.net_pay === null ? "—" : formatCurrency(d.salary.net_pay)} tone="text-emerald-700" />
                  </div>
                  <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 divide-y divide-slate-100">
                    <Row label={tt("managerPortal.employeeDetails.baseSalary")} value={formatCurrency(d.salary.base_salary)} />
                    <Row label={tt("managerPortal.employeeDetails.commissions")} value={`+ ${formatCurrency(d.salary.commissions)}`} tone="text-emerald-700" />
                    <Row label={tt("managerPortal.employeeDetails.bonuses")} value={`+ ${formatCurrency(d.salary.bonuses)}`} tone="text-emerald-700" />
                    <Row label={tt("managerPortal.employeeDetails.overtimePay")} value={`+ ${formatCurrency(d.salary.approved_overtime_pay)}`} tone="text-emerald-700" />
                    <Row label={tt("managerPortal.employeeDetails.penalties")} value={`- ${formatCurrency(d.salary.penalties_total)}`} tone="text-rose-700" />
                    <Row label={tt("managerPortal.employeeDetails.advanceDeductions")} value={`- ${formatCurrency(d.salary.advance_deductions)}`} tone="text-rose-700" />
                    <Row label={tt("managerPortal.employeeDetails.attendanceDeductions")} value={`- ${formatCurrency(d.salary.attendance_deduction_total)}`} tone="text-rose-700" />
                    <Row label={tt("managerPortal.employeeDetails.totalDeductions")} value={`- ${formatCurrency(d.salary.deductions)}`} tone="text-rose-700" />
                    <Row label={tt("managerPortal.employeeDetails.netPay")} value={d.salary.net_pay === null ? "—" : formatCurrency(d.salary.net_pay)} tone="text-slate-950 text-base" />
                  </div>
                  <div className={`rounded-[var(--radius-card)] border px-3 py-3 ${payrollRun ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-slate-700">{tt("managerPortal.employeeDetails.payrollTitle")}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${payrollRun ? "bg-emerald-600 text-white" : "bg-amber-500/15 text-amber-800"}`}>
                        {payrollRun
                          ? (String(payrollRun.payment_status || "").toLowerCase() === "paid" ? tt("managerPortal.employeeDetails.payrollPaid") : tt("managerPortal.employeeDetails.payrollApproved"))
                          : statusLabel("pending")}
                      </span>
                    </div>
                    {payrollRun ? (
                      <div className="mt-1.5 space-y-0.5 text-[11px] font-bold text-slate-600">
                        <div>{tt("managerPortal.employeeDetails.payrollApprovedOn", { date: formatDate(payrollRun.approved_at) })}</div>
                        <div>{tt("managerPortal.employeeDetails.payrollApprovedHint", { next: monthLabel(nextAdvanceMonth) })}</div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-1.5 text-[11px] font-bold text-slate-600">
                          {tt("managerPortal.employeeDetails.payrollOpenHint", { month: monthLabel(month), next: monthLabel(nextAdvanceMonth) })}
                        </div>
                        {hardBlockers.length ? (
                          <div className="mt-1.5 text-[11px] font-bold text-rose-700">
                            {tt("managerPortal.employeeDetails.payrollBlocked")}
                            <ul className="mt-0.5 list-disc space-y-0.5 pr-4">{hardBlockers.map((text, index) => <li key={index}>{text}</li>)}</ul>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          disabled={approving || hardBlockers.length > 0 || d.salary.net_pay === null}
                          onClick={approvePayroll}
                          className="mt-2 inline-flex h-[var(--control-height-md)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-slate-950 px-3 text-sm font-black text-white disabled:opacity-50"
                        >
                          {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {approving ? tt("managerPortal.employeeDetails.payrollApproving") : tt("managerPortal.employeeDetails.payrollApprove", { month: monthLabel(month) })}
                        </button>
                      </>
                    )}
                    {approveNotice.text ? (
                      <div className={`mt-2 text-xs font-bold ${approveNotice.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>
                        {approveNotice.text}
                        {approveNotice.blockers.length ? (
                          <ul className="mt-0.5 list-disc space-y-0.5 pr-4 text-[11px]">{approveNotice.blockers.map((text, index) => <li key={index}>{text}</li>)}</ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={tt("managerPortal.employeeDetails.advancesOutstanding")} value={formatCurrency(d.advances.total_outstanding)} tone="text-amber-700" />
                    <Stat label={tt("managerPortal.employeeDetails.attendanceDays")} value={formatNumber(d.attendance.totals.days)} />
                    <Stat label={tt("managerPortal.employeeDetails.lateTotal")} value={formatMinutes(d.attendance.totals.late_minutes)} tone="text-rose-700" />
                    <Stat label={tt("managerPortal.employeeDetails.overtimeTotal")} value={formatMinutes(d.attendance.totals.overtime_minutes)} tone="text-emerald-700" />
                  </div>
                  <div className="text-xs font-bold text-slate-500">
                    {tt("managerPortal.employeeDetails.hireDate")}: {formatDate(d.employee.hire_date)}{d.employee.phone ? ` · ${d.employee.phone}` : ""}
                  </div>
                </div>
              ) : null}

              {tab === "sales" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={tt("managerPortal.employeeDetails.monthSales")} value={formatCurrency(d.sales.total)} />
                    <Stat label={tt("managerPortal.employeeDetails.invoices")} value={formatNumber(d.sales.invoices)} />
                  </div>
                  {d.sales.daily.length ? (
                    <div className="divide-y divide-slate-100 rounded-[var(--radius-card)] border border-slate-200 bg-white px-3">
                      {d.sales.daily.map((row) => (
                        <div key={row.day} className="flex items-center justify-between py-2 text-sm">
                          <span className="font-bold text-slate-600">{formatDay(row.day)}</span>
                          <span className="text-xs font-bold text-slate-400">{formatNumber(row.invoices)} {tt("managerPortal.common.invoices")}</span>
                          <span className="font-black tabular-nums text-slate-950">{formatCurrency(row.total)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs font-bold text-slate-500">{tt("managerPortal.employeeDetails.noSales")}</div>}
                </div>
              ) : null}

              {tab === "advances" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={tt("managerPortal.employeeDetails.advancesTaken")} value={formatCurrency(d.advances.total_taken)} />
                    <Stat label={tt("managerPortal.employeeDetails.advancesOutstanding")} value={formatCurrency(d.advances.total_outstanding)} tone="text-amber-700" />
                  </div>
                  {d.advances.rows.length ? d.advances.rows.map((row) => (
                    <div key={row.id} className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black text-slate-950">{formatCurrency(row.amount)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${row.remaining_amount > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{statusLabel(row.deduction_status || row.status)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] font-bold text-slate-500">
                        <span>{tt("managerPortal.employeeDetails.takenOn")}: {formatDate(row.created_at)}</span>
                        <span>{tt("managerPortal.employeeDetails.deductionMonth")}: {monthLabel(row.deduction_month)}</span>
                        <span>{tt("managerPortal.employeeDetails.deducted")}: {formatCurrency(row.deducted_amount)}</span>
                        <span>{tt("managerPortal.employeeDetails.remaining")}: {formatCurrency(row.remaining_amount)}</span>
                      </div>
                      {row.notes ? <div className="mt-1 text-xs text-slate-500">{row.notes}</div> : null}
                    </div>
                  )) : <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs font-bold text-slate-500">{tt("managerPortal.employeeDetails.noAdvances")}</div>}
                </div>
              ) : null}

              {tab === "attendance" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => openAttendanceEditor(null)} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-800">
                      <Plus className="h-3.5 w-3.5" /> {tt("managerPortal.employeeDetails.addAttendance")}
                    </button>
                    {notice ? <span className="text-xs font-bold text-slate-600">{notice}</span> : null}
                  </div>
                  {attForm ? (
                    <form onSubmit={submitAttendance} className="rounded-[var(--radius-card)] border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-[11px] font-black text-slate-500">{tt("managerPortal.employeeDetails.attendanceDate")}</label>
                      <input type="date" value={attForm.date} onChange={(e) => setAttForm((f) => ({ ...f, date: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-950" required />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-black text-slate-500">{tt("managerPortal.employeeDetails.checkInTime")}</label>
                          <input type="time" value={attForm.check_in} onChange={(e) => setAttForm((f) => ({ ...f, check_in: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-950" required />
                        </div>
                        <div>
                          <label className="block text-[11px] font-black text-slate-500">{tt("managerPortal.employeeDetails.checkOutTime")}</label>
                          <input type="time" value={attForm.check_out} onChange={(e) => setAttForm((f) => ({ ...f, check_out: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-950" />
                        </div>
                      </div>
                      <div className="mt-1 text-[10px] font-bold text-slate-400">{tt("managerPortal.employeeDetails.checkOutOptional")}</div>
                      {attShift ? (
                        <div className={`mt-2 rounded-xl border px-3 py-2 text-[11px] font-black ${attShift.isLong ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-600"}`}>
                          <div>
                            {tt("managerPortal.employeeDetails.shiftLength")}: {formatMinutes(attShift.minutes)}
                            {attShift.spansMidnight ? ` · ${tt("managerPortal.employeeDetails.checkOutNextDay")} (${formatDay(attShift.checkOutDate)})` : ""}
                          </div>
                          {attShift.isLong ? <div className="mt-1 font-bold">{tt("managerPortal.employeeDetails.longShiftWarning")}</div> : null}
                          {attShift.isLong ? (
                            <label className="mt-2 flex items-center gap-2 font-bold">
                              <input
                                type="checkbox"
                                checked={Boolean(attForm.confirm_long)}
                                onChange={(e) => setAttForm((f) => ({ ...f, confirm_long: e.target.checked }))}
                                className="h-4 w-4 rounded border-rose-300"
                              />
                              <span>{tt("managerPortal.employeeDetails.longShiftConfirm")}</span>
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                      <input type="text" value={attForm.reason} onChange={(e) => setAttForm((f) => ({ ...f, reason: e.target.value }))} placeholder={tt("managerPortal.employeeDetails.attendanceReason")} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-950" />
                      {attNotice ? <div className="mt-2 text-xs font-bold text-rose-700">{attNotice}</div> : null}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setAttForm(null)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700">{tt("managerPortal.employeeDetails.cancel")}</button>
                        <button type="submit" disabled={attSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white disabled:opacity-60">
                          {attSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {tt("managerPortal.employeeDetails.save")}
                        </button>
                      </div>
                    </form>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={tt("managerPortal.employeeDetails.attendanceDays")} value={formatNumber(d.attendance.totals.days)} />
                    <Stat label={tt("managerPortal.employeeDetails.workHours")} value={`${formatNumber(d.attendance.totals.work_hours)} س`} />
                    <Stat label={tt("managerPortal.employeeDetails.lateTotal")} value={`${formatMinutes(d.attendance.totals.late_minutes)} (${formatNumber(d.attendance.totals.late_days)} ${tt("managerPortal.employeeDetails.days")})`} tone="text-rose-700" />
                    <Stat label={tt("managerPortal.employeeDetails.overtimeTotal")} value={formatMinutes(d.attendance.totals.overtime_minutes)} tone="text-emerald-700" />
                  </div>
                  {d.attendance.rows.length ? (
                    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white">
                      <table className="w-full min-w-[520px] text-xs">
                        <thead className="bg-slate-50 text-[10px] font-black text-slate-500">
                          <tr>
                            <th className="px-2 py-2 text-right">{tt("managerPortal.employeeDetails.day")}</th>
                            <th className="px-2 py-2 text-right">{tt("managerPortal.employeeDetails.checkIn")}</th>
                            <th className="px-2 py-2 text-right">{tt("managerPortal.employeeDetails.checkOut")}</th>
                            <th className="px-2 py-2 text-right">{tt("managerPortal.employeeDetails.hours")}</th>
                            <th className="px-2 py-2 text-right">{tt("managerPortal.employeeDetails.late")}</th>
                            <th className="px-2 py-2 text-right">{tt("managerPortal.employeeDetails.overtime")}</th>
                            <th className="px-2 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-bold text-slate-800">
                          {d.attendance.rows.map((row) => (
                            <tr key={String(row.date)}>
                              <td className="px-2 py-2 whitespace-nowrap">{formatDay(row.date)}</td>
                              <td className="px-2 py-2 tabular-nums">{formatClock(row.check_in)}</td>
                              <td className="px-2 py-2 tabular-nums whitespace-nowrap">
                                {formatClock(row.check_out)}
                                {isOvernightRow(row.check_in, row.check_out) ? (
                                  <sup className="ms-0.5 text-[9px] font-black text-amber-600" title={tt("managerPortal.employeeDetails.checkOutNextDay")}>
                                    {tt("managerPortal.employeeDetails.nextDayShort")}
                                  </sup>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 tabular-nums">{formatNumber(row.work_hours)}</td>
                              <td className={`px-2 py-2 tabular-nums ${row.late_minutes > 0 ? "text-rose-700" : "text-slate-400"}`}>{formatMinutes(row.late_minutes)}</td>
                              <td className={`px-2 py-2 tabular-nums ${row.overtime_minutes > 0 ? "text-emerald-700" : "text-slate-400"}`}>{formatMinutes(row.overtime_minutes)}</td>
                              <td className="px-1 py-1 text-left">
                                <button type="button" aria-label={tt("managerPortal.employeeDetails.editAttendance")} onClick={() => openAttendanceEditor(row)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600">
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-slate-50 text-[11px] font-black text-slate-900">
                          <tr>
                            <td className="px-2 py-2">{tt("managerPortal.employeeDetails.total")}</td>
                            <td className="px-2 py-2" colSpan={2}>{formatNumber(d.attendance.totals.days)} {tt("managerPortal.employeeDetails.days")}</td>
                            <td className="px-2 py-2 tabular-nums">{formatNumber(d.attendance.totals.work_hours)}</td>
                            <td className="px-2 py-2 tabular-nums text-rose-700">{formatMinutes(d.attendance.totals.late_minutes)}</td>
                            <td className="px-2 py-2 tabular-nums text-emerald-700">{formatMinutes(d.attendance.totals.overtime_minutes)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs font-bold text-slate-500">{tt("managerPortal.employeeDetails.noAttendance")}</div>}
                </div>
              ) : null}

              {tab === "adjustments" ? (
                <div className="space-y-4">
                  <form onSubmit={submitAdjustment} className="rounded-[var(--radius-card)] border border-slate-200 bg-slate-50 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setForm((f) => ({ ...f, type: "bonus" }))} className={`inline-flex items-center justify-center gap-1 rounded-xl border px-3 py-2 text-sm font-black ${form.type === "bonus" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                        <Plus className="h-4 w-4" /> {tt("managerPortal.employeeDetails.addBonus")}
                      </button>
                      <button type="button" onClick={() => setForm((f) => ({ ...f, type: "deduction" }))} className={`inline-flex items-center justify-center gap-1 rounded-xl border px-3 py-2 text-sm font-black ${form.type === "deduction" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                        <Minus className="h-4 w-4" /> {tt("managerPortal.employeeDetails.addDeduction")}
                      </button>
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                      placeholder={tt("managerPortal.employeeDetails.amount")}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-950"
                    />
                    <input
                      type="text"
                      value={form.reason}
                      onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                      placeholder={tt("managerPortal.employeeDetails.reason")}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-950"
                    />
                    {notice ? <div className="mt-2 text-xs font-bold text-slate-600">{notice}</div> : null}
                    <button type="submit" disabled={saving} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-sm font-black text-white disabled:opacity-60">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {tt("managerPortal.employeeDetails.save")}
                    </button>
                  </form>

                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={tt("managerPortal.employeeDetails.bonusesMonth")} value={formatCurrency(d.bonuses.total)} tone="text-emerald-700" />
                    <Stat label={tt("managerPortal.employeeDetails.penaltiesMonth")} value={formatCurrency(d.penalties.total)} tone="text-rose-700" />
                  </div>
                  {[...d.bonuses.rows.map((r) => ({ ...r, _kind: "bonus", _date: r.bonus_date })), ...d.penalties.rows.map((r) => ({ ...r, _kind: "deduction", _date: r.penalty_date }))]
                    .sort((a, b) => new Date(b._date || b.created_at) - new Date(a._date || a.created_at))
                    .map((row) => (
                      <div key={`${row._kind}-${row.id}`} className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-black ${row._kind === "bonus" ? "text-emerald-700" : "text-rose-700"}`}>{row._kind === "bonus" ? "+" : "-"} {formatCurrency(row.amount)}</span>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{statusLabel(row.status)}</span>
                            <button type="button" aria-label={tt("managerPortal.employeeDetails.delete")} disabled={deletingKey === `${row._kind}-${row.id}`} onClick={() => deleteAdjustment(row)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 disabled:opacity-50">
                              {deletingKey === `${row._kind}-${row.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                        <div className="mt-1 text-xs font-bold text-slate-700">{row.reason}</div>
                        <div className="mt-0.5 text-[11px] font-bold text-slate-400">{formatDate(row._date || row.created_at)}</div>
                      </div>
                    ))}
                  {!d.bonuses.rows.length && !d.penalties.rows.length ? <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs font-bold text-slate-500">{tt("managerPortal.employeeDetails.noAdjustments")}</div> : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
