import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Clock3, LogOut, MapPinOff, RefreshCcw, UserCheck, UserX } from "lucide-react";

import { getAttendanceToday } from "../attendanceApi";

import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

const safeDate = (value) => {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
};

const formatTime = (value) => {
  const date = safeDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatDate = (value) => {
  const date = safeDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const toneClass = {
  emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
  cyan: "border-primary/20 bg-primary/10 text-primary",
  amber: "border-amber-500/20 bg-amber-500/10 text-amber-200",
  rose: "border-rose-500/20 bg-rose-500/10 text-rose-200",
  slate: "border-white/10 bg-white/5 text-slate-200",
};

function MetricCard({ label, value, hint, tone = "slate", icon }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/10 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-black text-white">{value}</div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${toneClass[tone] || toneClass.slate}`}>
          {icon}
        </div>
      </div>
      {hint ? <div className="mt-3 text-sm text-slate-400">{hint}</div> : null}
    </div>
  );
}

function StatusPill({ status = "" }) {
  const value = String(status || "").toLowerCase();
  const config =
    value === "checked_out"
      ? { label: tt("employeePortal.attendance.checkedOutState"), className: "border-primary/20 bg-primary/10 text-primary" }
      : value === "checked_in"
        ? { label: tt("employeePortal.attendance.checkedIn"), className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" }
        : { label: status || tt("managerPortal.common.unknown"), className: "border-white/10 bg-white/5 text-slate-300" };

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${config.className}`}>{config.label}</span>;
}

export default function AttendanceDashboard() {
  // Subscribes this screen to language changes; strings resolve through tt().
  useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let active = true;

    const loadToday = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getAttendanceToday();
        if (active) setPayload(data || null);
      } catch (err) {
        if (active) {
          setError(err?.message || tt("employeePortal.attendance.errors.loadToday"));
          setPayload(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadToday();
    const interval = window.setInterval(loadToday, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshIndex]);

  const summary = payload?.summary || {};
  const logs = Array.isArray(payload?.logs) ? payload.logs : [];

  const rows = logs.slice(0, 12);

  return (
    <div className="min-h-full bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                <CalendarDays className="h-3.5 w-3.5" />
                {tt("employeePortal.attendance.dashboardTitle")}
              </div>
              <h1 className="m1-display">{tt("employeePortal.attendance.todaySummary")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                {tt("employeePortal.attendance.dashboardSubtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRefreshIndex((value) => value + 1)}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {tt("employeePortal.common.refresh")}
            </button>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label={tt("common.employeeHub.attendance.metrics.presentToday")} value={loading ? "-" : summary.presentNow ?? 0} hint={tt("employeePortal.attendance.presentToday")} tone="emerald" icon={<UserCheck className="h-5 w-5" />} />
          <MetricCard label={tt("employeePortal.attendance.lateToday")} value={loading ? "-" : summary.lateEmployees ?? 0} hint={tt("employeePortal.attendance.arrivedAfterGrace")} tone="rose" icon={<Clock3 className="h-5 w-5" />} />
          <MetricCard label={tt("common.employeeHub.attendance.metrics.absentToday")} value={loading ? "-" : summary.absent ?? 0} hint={`إجمالي الموظفين: ${summary.totalEmployees ?? 0}`} tone="amber" icon={<UserX className="h-5 w-5" />} />
          <MetricCard label={tt("employeePortal.attendance.earlyLeaveToday")} value={loading ? "-" : summary.earlyCheckoutToday ?? 0} hint={tt("employeePortal.attendance.leftBeforeShiftEnd")} tone="cyan" icon={<LogOut className="h-5 w-5" />} />
          <MetricCard label={tt("employeePortal.attendance.outsideGpsToday")} value={loading ? "-" : summary.outsideGpsToday ?? 0} hint={tt("employeePortal.attendance.gpsOutOfRange")} tone="slate" icon={<MapPinOff className="h-5 w-5" />} />
        </section>

        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="m1-section-title text-white">{tt("employeePortal.attendance.liveEmployeeTable")}</h2>
              <p className="text-sm text-slate-400">آخر القراءات ليوم {payload?.date || new Date().toISOString().slice(0, 10)}</p>
            </div>
            <div className="text-sm text-slate-400">{summary.totalWorkedHours ? `ساعات العمل ${summary.totalWorkedHours}` : ""}</div>
          </div>

          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact min-w-full">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{tt("pos.shift.employee")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{tt("employeePortal.common.branch")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{tt("common.employeeHub.attendance.fields.checkIn")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{tt("common.employeeHub.attendance.fields.checkOut")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{tt("employeePortal.common.status")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{tt("employeePortal.attendance.lateMinutes")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{tt("employeePortal.attendance.earlyLeaveMinutes")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">
                      {tt("employeePortal.attendance.loadingToday")}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">
                      {tt("employeePortal.attendance.noRecordsToday")}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={String(row.id)} className="align-top">
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="font-semibold text-white">{row.employee_name || row.full_name || tt("pos.shift.employee")}</div>
                        <div className="text-xs text-slate-400">{row.employee_code || `#${row.employee_id}`}</div>
                      </td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.branch_name || "-"}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatTime(row.check_in_at || row.check_in)}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatTime(row.check_out_at || row.check_out)}</td>
                      <td className="border-b border-white/5 px-3 py-4">
                        <StatusPill status={row.status} />
                        <div className="mt-2 text-xs text-slate-500">{formatDate(row.attendance_date)}</div>
                      </td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.late_minutes ?? 0}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.early_leave_minutes ?? 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
