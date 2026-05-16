import { useEffect, useState } from "react";
import { Download, Filter, RefreshCcw, Table2 } from "lucide-react";

import { getAttendanceReports } from "../attendanceApi";

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date();
monthStart.setDate(1);

const defaultFrom = monthStart.toISOString().slice(0, 10);

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const statusLabel = (status, checkout) => {
  const value = String(status || "").toLowerCase();
  if (value === "checked_out" || checkout) return "Checked out";
  if (value === "checked_in") return "Checked in";
  return status || "Open";
};

const exportCsv = (rows = [], fileName = "attendance-reports.csv") => {
  const headers = ["Employee", "Branch", "Date", "Check In", "Check Out", "Worked Minutes", "Status"];
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      [
    row.employee_name || "",
    row.branch_name || "",
    row.attendance_date || "",
    row.check_in_at || row.check_in || "",
    row.check_out_at || row.check_out || "",
    row.work_minutes ?? "",
        statusLabel(row.status, row.check_out_at || row.check_out),
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
      {hint ? <div className="mt-2 text-sm text-slate-400">{hint}</div> : null}
    </div>
  );
}

export default function AttendanceReports() {
  const [filters, setFilters] = useState({
    from: defaultFrom,
    to: today,
    employeeId: "",
    branchId: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getAttendanceReports(filters);
        if (active) setPayload(data || null);
      } catch (err) {
        if (active) {
          setError(err?.message || "Failed to load attendance reports");
          setPayload(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [filters, refreshIndex]);

  const summary = payload?.summary || {};
  const logs = Array.isArray(payload?.logs) ? payload.logs : [];
  const monthlyTotals = Array.isArray(payload?.monthlyTotals) ? payload.monthlyTotals : [];

  const rows = logs;

  return (
    <div className="min-h-full bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <Table2 className="h-3.5 w-3.5" />
                Attendance reports
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">Export-ready attendance reports</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                Filter by date and employee, then export a clean operational table with monthly totals.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => exportCsv(rows, `attendance-${filters.from}-to-${filters.to}.csv`)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => setRefreshIndex((value) => value + 1)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Filter className="h-4 w-4" />
            Filters
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">From</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">To</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Employee ID</span>
              <input
                type="text"
                value={filters.employeeId}
                onChange={(event) => setFilters((prev) => ({ ...prev, employeeId: event.target.value }))}
                placeholder="All employees"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
              />
            </label>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Present" value={loading ? "-" : summary.present ?? 0} hint="All logs in the filtered range" />
          <StatCard label="Checked out" value={loading ? "-" : summary.checkedOut ?? 0} hint="Completed attendance rows" />
          <StatCard label="Missing checkout" value={loading ? "-" : summary.missingCheckout ?? 0} hint="Open rows without a checkout" />
          <StatCard label="Late" value={loading ? "-" : summary.late ?? 0} hint="Rows with late minutes" />
          <StatCard label="Worked hours" value={loading ? "-" : summary.totalWorkedHours || "00:00"} hint={`Range ${payload?.from || filters.from} to ${payload?.to || filters.to}`} />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">Monthly totals</h2>
              <p className="text-sm text-slate-400">Grouped by month for the active filter range.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">Loading monthly totals...</div>
            ) : monthlyTotals.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">No totals available for this range.</div>
            ) : (
              monthlyTotals.map((item) => (
                <StatCard
                  key={item.month}
                  label={item.month}
                  value={item.totalWorkedHours || "00:00"}
                  hint={`Present ${item.present} · Checked out ${item.checkedOut} · Missing checkout ${item.missingCheckout}`}
                />
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">Attendance table</h2>
              <p className="text-sm text-slate-400">Employee, branch, worked hours, and checkout status.</p>
            </div>
            <div className="text-sm text-slate-400">{rows.length} rows</div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Employee</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Branch</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Date</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Check in</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Check out</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Worked</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">
                      Loading report rows...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">
                      No attendance records found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={String(row.id)} className="align-top">
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="font-semibold text-white">{row.employee_name || row.full_name || "Employee"}</div>
                        <div className="text-xs text-slate-400">{row.employee_code || `#${row.employee_id}`}</div>
                      </td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.branch_name || "-"}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.attendance_date || "-"}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatDateTime(row.check_in_at || row.check_in)}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatDateTime(row.check_out_at || row.check_out)}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">
                        {row.work_minutes ? `${Math.floor(row.work_minutes / 60)}h ${row.work_minutes % 60}m` : "-"}
                      </td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">
                        {statusLabel(row.status, row.check_out_at || row.check_out)}
                      </td>
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
