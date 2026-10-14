import { useState } from "react";
import { Loader2, Pencil, RotateCcw, Trash2, TreePalm, Undo2 } from "lucide-react";
import i18n from "../../../i18n/i18n";
import { managerPortalApi } from "../services/managerPortalApi";
import { formatCurrency } from "../../../shared/lib/currency";

const tt = (key, options) => i18n.t(key, options);
const formatNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));

// The same words the employee portal's الخصومات sheet uses for a day's penalty.
export const describePenaltyDays = (days) => {
  const value = Number(days || 0);
  if (!value) return tt("managerPortal.employeeDetails.deductions.none");
  if (value === 0.5) return tt("managerPortal.employeeDetails.deductions.halfDay");
  if (value === 1) return tt("managerPortal.employeeDetails.deductions.oneDay");
  if (value === 2) return tt("managerPortal.employeeDetails.deductions.twoDays");
  return tt("managerPortal.employeeDetails.deductions.nDays", { count: formatNumber(value) });
};

const CHOICES = [0, 0.5, 1, 2];
const dateOf = (value) => String(value || "").slice(0, 10);

// الخصومات: every absent or late day exactly as payroll prices it (the preview's day_deductions),
// each one editable while the month is open. A change is stored per day on the server and the
// payroll engine prices that day with it, so the salary card and the employee portal follow.
export function EmployeeDeductionsTab({ token, employeeId, details, formatDay, formatMinutes, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState({ tone: "", text: "" });

  const facts = details?.salary?.attendance_breakdown || {};
  const frozen = Boolean(details?.payroll?.approved);
  // Every leave day in the month sits in the list on its own date, priced the way payroll spends the
  // balance (in date order): from the balance, or a day's pay after it. Leave requests use the balance
  // too, so they are listed; only the days turned from absence here can be undone.
  const convertedDates = new Set((details?.attendance?.converted_leave_dates || []).map(dateOf));
  const pricedLeaves = Array.isArray(details?.attendance?.leave_days_priced) ? details.attendance.leave_days_priced : null;
  const leaveRows = pricedLeaves
    ? pricedLeaves.map((day) => ({ date: dateOf(day.date), type: "leave", paid: day.paid !== false, amount: Number(day.amount || 0), converted: convertedDates.has(dateOf(day.date)) }))
    : [...convertedDates].map((date) => ({ date, type: "leave", paid: null, amount: 0, converted: true }));
  const rows = [...(Array.isArray(facts.day_deductions) ? facts.day_deductions : []), ...leaveRows]
    .sort((a, b) => dateOf(b.date).localeCompare(dateOf(a.date)));
  const leaveBalance = details?.attendance?.leave_balance || null;
  const dayTotal = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const others = [
    // Priced leave days are already in the list above.
    { key: "leave", amount: pricedLeaves ? 0 : Number(facts.leave_deduction || 0), detail: facts.deducted_leave_days ? tt("managerPortal.employeeDetails.deductions.days", { count: formatNumber(facts.deducted_leave_days) }) : "" },
    { key: "missingHours", amount: Number(facts.missing_hours_deduction || 0), detail: facts.missing_hours ? tt("managerPortal.employeeDetails.deductions.hours", { count: formatNumber(facts.missing_hours) }) : "" },
    { key: "earlyLeave", amount: Number(facts.early_leave_deduction || 0), detail: facts.early_leave_hours ? tt("managerPortal.employeeDetails.deductions.hours", { count: formatNumber(facts.early_leave_hours) }) : "" },
    { key: "penalties", amount: Number(details?.salary?.penalties_total || 0), detail: tt("managerPortal.employeeDetails.deductions.penaltiesHint") },
  ].filter((item) => item.amount > 0);

  const rowKey = (row) => `${row.type}-${dateOf(row.date)}`;
  const failure = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

  const save = async (row, penaltyDays, note = "") => {
    const key = rowKey(row);
    try {
      setBusy(key);
      setNotice({ tone: "", text: "" });
      await managerPortalApi.setEmployeeDayDeduction(token, employeeId, {
        date: dateOf(row.date),
        type: row.type,
        penalty_days: penaltyDays,
        rule_penalty_days: row.overridden ? row.rule_penalty_days : row.penalty_days,
        note,
      });
      setEditing(null);
      setNotice({ tone: "ok", text: tt("managerPortal.employeeDetails.deductions.saved") });
      await onChanged?.();
    } catch (error) {
      setNotice({ tone: "error", text: failure(error, tt("managerPortal.employeeDetails.deductions.saveError")) });
    } finally {
      setBusy("");
    }
  };

  const waive = (row) => {
    if (!window.confirm(tt("managerPortal.employeeDetails.deductions.waiveConfirm", { date: formatDay(row.date) }))) return;
    save(row, 0, row.override_note || "");
  };

  const restore = async (row) => {
    const key = rowKey(row);
    try {
      setBusy(key);
      setNotice({ tone: "", text: "" });
      await managerPortalApi.clearEmployeeDayDeduction(token, employeeId, row.type, dateOf(row.date));
      setEditing(null);
      setNotice({ tone: "ok", text: tt("managerPortal.employeeDetails.deductions.restored") });
      await onChanged?.();
    } catch (error) {
      setNotice({ tone: "error", text: failure(error, tt("managerPortal.employeeDetails.deductions.saveError")) });
    } finally {
      setBusy("");
    }
  };

  // غياب → إجازة (owner's rule): the balance's days become leave, any day after it stays an
  // absence. The server checks the balance itself and refuses past it (leave_balance_exhausted).
  const exhaustedMessage = () => tt("managerPortal.employeeDetails.deductions.balanceUsed", {
    used: formatNumber(leaveBalance?.used ?? 0),
    total: formatNumber(leaveBalance?.allowance ?? 0),
  });
  const leaveExhausted = Boolean(leaveBalance) && leaveBalance.left <= 0;
  const toLeave = async (row) => {
    const date = dateOf(row.date);
    if (leaveExhausted) {
      window.alert(tt("managerPortal.employeeDetails.deductions.staysAbsent", { reason: exhaustedMessage(), date: formatDay(date) }));
      return;
    }
    if (!window.confirm(tt("managerPortal.employeeDetails.deductions.toLeaveConfirm", { date: formatDay(date), left: formatNumber(leaveBalance?.left ?? 0), total: formatNumber(leaveBalance?.allowance ?? 0) }))) return;
    const key = rowKey(row);
    try {
      setBusy(key);
      setNotice({ tone: "", text: "" });
      await managerPortalApi.convertAbsenceToLeave(token, employeeId, date);
      setNotice({ tone: "ok", text: tt("managerPortal.employeeDetails.deductions.toLeaveDone") });
      await onChanged?.();
    } catch (error) {
      const data = error?.response?.data || {};
      if (data.code === "leave_balance_exhausted") {
        window.alert(tt("managerPortal.employeeDetails.deductions.staysAbsent", { reason: data.message || exhaustedMessage(), date: formatDay(date) }));
        await onChanged?.();
      } else {
        setNotice({ tone: "error", text: failure(error, tt("managerPortal.employeeDetails.deductions.saveError")) });
      }
    } finally {
      setBusy("");
    }
  };

  const undoLeave = async (row) => {
    if (!window.confirm(tt("managerPortal.employeeDetails.deductions.undoLeaveConfirm", { date: formatDay(row.date) }))) return;
    const key = rowKey(row);
    try {
      setBusy(key);
      setNotice({ tone: "", text: "" });
      await managerPortalApi.undoAbsenceToLeave(token, employeeId, dateOf(row.date));
      setNotice({ tone: "ok", text: tt("managerPortal.employeeDetails.deductions.undoLeaveDone") });
      await onChanged?.();
    } catch (error) {
      setNotice({ tone: "error", text: failure(error, tt("managerPortal.employeeDetails.deductions.saveError")) });
    } finally {
      setBusy("");
    }
  };

  const describeRow = (row) => {
    if (row.type === "leave") {
      const kind = row.paid === false
        ? tt("managerPortal.employeeDetails.deductions.leaveOverBalance")
        : tt("managerPortal.employeeDetails.deductions.leaveFromBalance");
      return row.converted ? `${kind} ${tt("managerPortal.employeeDetails.deductions.wasAbsent")}` : `${tt("managerPortal.employeeDetails.deductions.requestLeave")} · ${kind}`;
    }
    if (row.type === "absence") return tt("managerPortal.employeeDetails.deductions.absence");
    const late = Math.max(0, Number(row.late_minutes || 0) - Number(row.covered_minutes || 0));
    const parts = [tt("managerPortal.employeeDetails.deductions.late", { time: formatMinutes(late) })];
    if (Number(row.covered_minutes) > 0) parts.push(tt("managerPortal.employeeDetails.deductions.permission", { time: formatMinutes(row.covered_minutes) }));
    return parts.join(" · ");
  };

  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-right">
        <div className="text-[10px] font-black text-slate-500">{tt("managerPortal.employeeDetails.deductions.dayTotal")}</div>
        <div className="mt-0.5 text-sm font-black text-rose-700 [font-variant-numeric:tabular-nums]">{formatCurrency(dayTotal)}</div>
        {leaveBalance ? (
          <div className="mt-1 text-[11px] font-bold text-slate-500">
            {tt("managerPortal.employeeDetails.deductions.leaveBalance", { left: formatNumber(leaveBalance.left), total: formatNumber(leaveBalance.allowance) })}
          </div>
        ) : null}
      </div>
      {frozen ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{tt("managerPortal.employeeDetails.deductions.frozen")}</div>
      ) : null}
      {notice.text ? (
        <div className={`text-xs font-bold ${notice.tone === "error" ? "text-rose-700" : "text-emerald-700"}`}>{notice.text}</div>
      ) : null}

      {rows.length ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-slate-200 bg-white">
          {rows.map((row) => {
            const key = rowKey(row);
            const isEditing = editing?.key === key;
            const working = busy === key;
            const amount = Number(row.amount || 0);
            return (
              <div key={key} className="border-b border-slate-200 px-3 py-2.5 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-slate-950">{formatDay(row.date)}</div>
                    <div className="mt-0.5 text-[11px] font-bold text-slate-500">
                      {row.type === "leave" ? describeRow(row) : `${describeRow(row)} · ${describePenaltyDays(row.penalty_days)}`}
                    </div>
                    {row.overridden ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 font-black text-sky-700">{tt("managerPortal.employeeDetails.deductions.edited")}</span>
                        <span className="text-slate-500">{tt("managerPortal.employeeDetails.deductions.ruleWas", { days: describePenaltyDays(row.rule_penalty_days) })}</span>
                        {row.override_by ? <span className="text-slate-500">· {row.override_by}</span> : null}
                      </div>
                    ) : null}
                    {row.override_note ? <div className="mt-0.5 text-[11px] text-slate-500">{row.override_note}</div> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {row.type === "leave" && !(amount > 0) ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">{tt("managerPortal.employeeDetails.deductions.leaveBadge")}</span>
                    ) : (
                      <span className={`text-sm font-black ${amount > 0 ? "text-rose-700" : "text-slate-500"}`}>
                        {amount > 0 ? `- ${formatCurrency(amount)}` : formatCurrency(0)}
                      </span>
                    )}
                    {!frozen && row.type === "leave" && row.converted ? (
                      <button
                        type="button"
                        aria-label={tt("managerPortal.employeeDetails.deductions.undoLeave")}
                        title={tt("managerPortal.employeeDetails.deductions.undoLeave")}
                        disabled={working}
                        onClick={() => undoLeave(row)}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 disabled:opacity-50"
                      >
                        {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                      </button>
                    ) : null}
                    {!frozen && !isEditing && row.type !== "leave" ? (
                      <div className="flex items-center gap-1">
                        {row.type === "absence" ? (
                          <button
                            type="button"
                            aria-label={tt("managerPortal.employeeDetails.deductions.toLeave")}
                            title={tt("managerPortal.employeeDetails.deductions.toLeave")}
                            disabled={working}
                            onClick={() => toLeave(row)}
                            className={`rounded-lg border p-1.5 disabled:opacity-50 ${leaveExhausted ? "border-slate-200 bg-white text-slate-400 opacity-60" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
                          >
                            <TreePalm className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={tt("managerPortal.employeeDetails.deductions.edit")}
                          disabled={working}
                          onClick={() => { setNotice({ tone: "", text: "" }); setEditing({ key, days: Number(row.penalty_days || 0), custom: "", note: row.override_note || "" }); }}
                          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 disabled:opacity-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {row.overridden ? (
                          <button
                            type="button"
                            aria-label={tt("managerPortal.employeeDetails.deductions.restore")}
                            disabled={working}
                            onClick={() => restore(row)}
                            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 disabled:opacity-50"
                          >
                            {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                        {amount > 0 ? (
                          <button
                            type="button"
                            aria-label={tt("managerPortal.employeeDetails.deductions.waive")}
                            disabled={working}
                            onClick={() => waive(row)}
                            className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 disabled:opacity-50"
                          >
                            {working && !row.overridden ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                {isEditing ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const custom = editing.custom.trim();
                      save(row, custom === "" ? editing.days : Number(custom), editing.note.trim());
                    }}
                    className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                  >
                    <div className="text-[11px] font-black text-slate-500">{tt("managerPortal.employeeDetails.deductions.chooseLabel")}</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {CHOICES.map((days) => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setEditing((current) => ({ ...current, days, custom: "" }))}
                          className={`rounded-xl border px-1 py-2 text-[11px] font-black ${editing.custom === "" && editing.days === days ? "border-slate-950 bg-slate-950 text-slate-50" : "border-slate-200 bg-white text-slate-700"}`}
                        >
                          {describePenaltyDays(days)}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="31"
                      step="0.5"
                      value={editing.custom}
                      onChange={(event) => setEditing((current) => ({ ...current, custom: event.target.value }))}
                      placeholder={tt("managerPortal.employeeDetails.deductions.customPlaceholder")}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-950"
                    />
                    <input
                      type="text"
                      value={editing.note}
                      onChange={(event) => setEditing((current) => ({ ...current, note: event.target.value }))}
                      placeholder={tt("managerPortal.employeeDetails.deductions.notePlaceholder")}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-950"
                    />
                    <div className="flex gap-2">
                      <button type="submit" disabled={working} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-slate-50 disabled:opacity-50">
                        {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {tt("managerPortal.employeeDetails.deductions.save")}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">
                        {tt("managerPortal.employeeDetails.deductions.cancel")}
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs font-bold text-slate-500">{tt("managerPortal.employeeDetails.deductions.empty")}</div>
      )}

      {others.length ? (
        <div className="space-y-1.5">
          <div className="text-xs font-black text-slate-700">{tt("managerPortal.employeeDetails.deductions.others")}</div>
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-slate-200 bg-white">
            {others.map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-2 border-b border-slate-200 px-3 py-2.5 last:border-b-0">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-950">{tt(`managerPortal.employeeDetails.deductions.${item.key}`)}</div>
                  {item.detail ? <div className="mt-0.5 text-[11px] font-bold text-slate-500">{item.detail}</div> : null}
                </div>
                <span className="shrink-0 text-sm font-black text-rose-700">- {formatCurrency(item.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default EmployeeDeductionsTab;
