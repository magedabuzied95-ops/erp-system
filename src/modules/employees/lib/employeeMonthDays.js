// The month day by day for the employee portal's أيام الحضور sheet. Attended days come from the
// portal's timeline; absent and leave days from payroll (attendance.month_days), so the sheet shows
// the same absences the salary charges. A leave day is never shown as absent, and nothing after
// today is listed.

export const monthDayKey = (value, timeZone = "Africa/Cairo") => {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

export const buildMonthDays = ({ timeline = [], monthDays = {}, today = monthDayKey(new Date()), timeZone = "Africa/Cairo" } = {}) => {
  const key = (value) => monthDayKey(value, timeZone);
  const month = String(monthDays?.month || today.slice(0, 7));
  const inMonth = (day) => Boolean(day) && day.startsWith(month) && day <= today;
  const present = new Map();
  timeline.forEach((row) => {
    const day = key(row.date || row.attendance_date);
    const status = String(row.status || row.attendance_status || "").toLowerCase();
    if (!inMonth(day) || status === "absent" || !row.check_in) return;
    if (!present.has(day)) present.set(day, row);
  });
  const leave = new Set((monthDays?.leave_dates || []).map(key).filter((day) => inMonth(day) && !present.has(day)));
  const absent = new Set((monthDays?.absent_dates || []).map(key).filter((day) => inMonth(day) && !present.has(day) && !leave.has(day)));
  const rows = [
    ...[...present.entries()].map(([day, row]) => ({ key: day, kind: "present", row })),
    ...[...absent].map((day) => ({ key: day, kind: "absent" })),
    ...[...leave].map((day) => ({ key: day, kind: "leave" })),
  ].sort((a, b) => b.key.localeCompare(a.key));
  return { month, rows, counts: { present: present.size, absent: absent.size, leave: leave.size } };
};
