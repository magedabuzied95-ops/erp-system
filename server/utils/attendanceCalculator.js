const toDate = (value) => (value ? new Date(value) : null);
const ATTENDANCE_TIMEZONE = String(process.env.ATTENDANCE_TIMEZONE || process.env.APP_TIMEZONE || process.env.TZ || "Africa/Cairo").trim() || "Africa/Cairo";

const pad = (value) => String(value).padStart(2, "0");

const minutesBetween = (start, end) => {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((toDate(end).getTime() - toDate(start).getTime()) / 60000));
};

const timeZoneOffsetMs = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second)
  );
  return zonedAsUtc - date.getTime();
};

const combineDateAndTime = (dateValue, timeValue) => {
  if (!dateValue || !timeValue) return null;
  if (timeValue instanceof Date) return timeValue;
  const rawTime = String(timeValue);
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(rawTime)) {
    const parsedTime = toDate(timeValue);
    if (parsedTime && !Number.isNaN(parsedTime.getTime())) return parsedTime;
  }
  const dateKey = typeof dateValue === "string"
    ? String(dateValue).slice(0, 10)
    : new Date(dateValue).toISOString().slice(0, 10);
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  const [hours = 0, minutes = 0, seconds = 0] = rawTime
    .split(":")
    .map((part) => Number(part || 0));
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  return new Date(utcGuess.getTime() - timeZoneOffsetMs(utcGuess, ATTENDANCE_TIMEZONE));
};

export const normalizeWorkingDays = (workingDays) => {
  if (!workingDays) return [];
  if (Array.isArray(workingDays)) return workingDays.map(String);
  if (typeof workingDays === "string") {
    try {
      const parsed = JSON.parse(workingDays);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return workingDays
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
};

export const isWorkingDay = (workingDays, dateValue = new Date()) => {
  const days = normalizeWorkingDays(workingDays);
  if (days.length === 0) return true;
  const weekday = dateValue.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const short = dateValue.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  return days.some((day) => String(day).toLowerCase().includes(weekday) || String(day).toLowerCase().includes(short));
};

export const calculateAttendanceMetrics = ({
  attendanceDate,
  checkIn,
  checkOut,
  shift = {},
}) => {
  const safeShift = shift || {};
  const inDate = toDate(checkIn);
  const outDate = toDate(checkOut);
  const dateBase = attendanceDate || inDate || new Date();
  const shiftEndTime = safeShift.end_time || safeShift.endTime || null;
  const shiftStart = combineDateAndTime(dateBase, safeShift.start_time || safeShift.startTime || checkIn);
  let shiftEnd = combineDateAndTime(dateBase, shiftEndTime);
  if (shiftStart && shiftEnd && shiftEnd <= shiftStart) {
    shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60000);
  }

  const allowedLateMinutes = Number(safeShift.allowed_late_minutes || 0);
  const overtimeAfterMinutes = Number(safeShift.overtime_after_minutes || 0);

  const workMinutes = outDate ? minutesBetween(inDate, outDate) : 0;

  let lateMinutes = 0;
  if (shiftStart && inDate) {
    lateMinutes = Math.max(0, minutesBetween(shiftStart, inDate) - allowedLateMinutes);
  }

  let earlyLeaveMinutes = 0;
  if (shiftEnd && outDate) {
    earlyLeaveMinutes = Math.max(0, minutesBetween(outDate, shiftEnd));
  }

  let overtimeMinutes = 0;
  if (outDate) {
    // `overtime_after_minutes` is the worked-duration threshold (for example
    // 600 means overtime starts after 10 worked hours), not a delay added to
    // the scheduled shift end.
    if (overtimeAfterMinutes > 0) {
      overtimeMinutes = Math.max(0, workMinutes - overtimeAfterMinutes);
    } else if (shiftEnd) {
      overtimeMinutes = Math.max(0, minutesBetween(shiftEnd, outDate));
    }
  }

  return {
    work_minutes: workMinutes,
    late_minutes: lateMinutes,
    early_leave_minutes: earlyLeaveMinutes,
    overtime_minutes: overtimeMinutes,
  };
};

export const buildShiftSummaryNotification = ({
  employeeName,
  date,
  workedMinutes,
  lateMinutes,
  overtimeMinutes,
  branchName,
}) => ({
  type: "shift_summary",
  employeeName,
  date,
  workedMinutes,
  lateMinutes,
  overtimeMinutes,
  branchName,
});

export const buildAttendanceAlertNotification = ({
  employeeName,
  attendanceDate,
  alertType,
  branchName,
}) => ({
  type: "attendance_alert",
  employeeName,
  attendanceDate,
  alertType,
  branchName,
});

export const formatMinutes = (minutes = 0) => {
  const total = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${pad(hours)}:${pad(mins)}`;
};

export const getMinutesFromTime = minutesBetween;
