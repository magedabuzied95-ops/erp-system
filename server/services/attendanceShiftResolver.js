const clean = (value = "") => String(value || "").trim();

const safeTimeZone = (value = "") => {
  const timeZone = clean(value) || "Africa/Cairo";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "Africa/Cairo";
  }
};

const timeToMinutes = (value) => {
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const normalized = ((Math.round(Number(minutes || 0)) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
};

const localMinutes = (date = new Date(), timeZone = "Africa/Cairo") => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
  const hour = part("hour") === 24 ? 0 : part("hour");
  return hour * 60 + part("minute");
};

const localDateParts = (date = new Date(), timeZone = "Africa/Cairo") => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
  return { year: part("year"), month: part("month"), day: part("day") };
};

const addDays = ({ year, month, day }, days = 0) => {
  const value = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
};

const partsToIsoDate = ({ year, month, day }) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const zonedWallTimeToDate = ({ year, month, day }, minutes, timeZone = "Africa/Cairo") => {
  if (minutes === null || minutes === undefined) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcGuess));
  const part = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
  const zonedAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour") === 24 ? 0 : part("hour"),
    part("minute"),
    part("second")
  );
  return new Date(utcGuess - (zonedAsUtc - utcGuess));
};

const inWindow = (minute, start, end) => {
  if (start === null || end === null) return false;
  if (start <= end) return minute >= start && minute <= end;
  return minute >= start || minute <= end;
};

const forwardDistance = (from, to) => ((to - from) + 1440) % 1440;
const closestDistance = (from, to) => Math.min(forwardDistance(from, to), forwardDistance(to, from));

const normalizeShift = (row = {}) => {
  const start = timeToMinutes(row.start_time);
  const end = timeToMinutes(row.end_time);
  const windowStart = timeToMinutes(row.check_in_window_start) ?? start;
  const windowEnd = timeToMinutes(row.check_in_window_end) ?? (start === null ? null : (start + 60) % 1440);
  return {
    ...row,
    startMinutes: start,
    endMinutes: end,
    windowStartMinutes: windowStart,
    windowEndMinutes: windowEnd,
    crossesMidnight: end !== null && start !== null && end <= start,
  };
};

export const ensureShiftResolutionSchema = async (clientOrPool) => {
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_shifts ADD COLUMN IF NOT EXISTS check_in_window_start TIME NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_shifts ADD COLUMN IF NOT EXISTS check_in_window_end TIME NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS attendance_logs ADD COLUMN IF NOT EXISTS selected_shift_id BIGINT NULL REFERENCES employee_shifts(id) ON DELETE SET NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS attendance_logs ADD COLUMN IF NOT EXISTS resolved_shift_start_time TIMESTAMPTZ NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS attendance_logs ADD COLUMN IF NOT EXISTS resolved_shift_end_time TIMESTAMPTZ NULL`);
  await clientOrPool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'attendance_logs'
          AND column_name = 'resolved_shift_start_time'
          AND data_type = 'time without time zone'
      ) THEN
        ALTER TABLE attendance_logs
          ALTER COLUMN resolved_shift_start_time TYPE TIMESTAMPTZ
          USING (CURRENT_DATE + resolved_shift_start_time);
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'attendance_logs'
          AND column_name = 'resolved_shift_end_time'
          AND data_type = 'time without time zone'
      ) THEN
        ALTER TABLE attendance_logs
          ALTER COLUMN resolved_shift_end_time TYPE TIMESTAMPTZ
          USING (CURRENT_DATE + resolved_shift_end_time);
      END IF;
    END $$;
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS attendance_logs ADD COLUMN IF NOT EXISTS shift_resolution_status VARCHAR(40) NOT NULL DEFAULT 'unresolved'`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_shifts_window_lookup ON employee_shifts (tenant_id, employee_id, check_in_window_start, check_in_window_end)`);
};

export const resolveShiftForCheckIn = async ({
  clientOrPool,
  tenantId,
  employeeId,
  checkInAt = new Date(),
  timeZone = "Africa/Cairo",
  requestedShiftId = null,
  fallbackMode = process.env.ATTENDANCE_SHIFT_FALLBACK_MODE || "closest",
} = {}) => {
  await ensureShiftResolutionSchema(clientOrPool);
  const params = [employeeId, tenantId];
  const requestedClause = requestedShiftId ? "AND id = $3" : "";
  if (requestedShiftId) params.push(requestedShiftId);
  const checkInLocalDate = localDateParts(checkInAt, timeZone);
  const scheduleDates = [
    partsToIsoDate(checkInLocalDate),
    partsToIsoDate(addDays(checkInLocalDate, -1)),
    partsToIsoDate(addDays(checkInLocalDate, 1)),
  ];
  const scheduledResult = requestedShiftId
    ? { rows: [] }
    : await clientOrPool.query(
      `
      SELECT
        NULL::bigint AS id,
        id AS schedule_id,
        shift_name,
        shift_type,
        start_time::text AS start_time,
        end_time::text AS end_time,
        expected_hours,
        0::int AS allowed_late_minutes,
        15::int AS overtime_after_minutes,
        '[]'::jsonb AS working_days,
        NULL::time AS check_in_window_start,
        NULL::time AS check_in_window_end,
        work_date,
        'schedule' AS shift_source
      FROM employee_shift_schedules
      WHERE employee_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND work_date = ANY($3::date[])
        AND LOWER(COALESCE(status, 'scheduled')) <> 'cancelled'
      ORDER BY work_date ASC, shift_type = 'opening' DESC, updated_at DESC
      `,
      [employeeId, tenantId, scheduleDates]
    );
  const result = await clientOrPool.query(
    `
    SELECT *
    FROM employee_shifts
    WHERE employee_id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ${requestedClause}
    ORDER BY start_time ASC, created_at DESC
    `,
    params
  );
  const shifts = [...(scheduledResult.rows || []), ...result.rows]
    .map(normalizeShift)
    .filter((shift) => shift.startMinutes !== null);
  if (!shifts.length) {
    return { shift: null, lateMinutes: 0, status: "no_shift", manualReviewRequired: false };
  }

  const checkInMinutes = localMinutes(checkInAt, timeZone);
  const selected =
    shifts.find((shift) => inWindow(checkInMinutes, shift.windowStartMinutes, shift.windowEndMinutes)) ||
    (shifts.length === 1 ? shifts[0] : null);

  let shift = selected;
  let status = selected ? (shifts.length === 1 ? "single_shift" : "matched") : "manual_review_required";
  let manualReviewRequired = false;
  let shiftDateOffset = 0;

  if (!shift) {
    const previousOvernightShift = shifts
      .filter((item) => item.crossesMidnight && checkInMinutes <= item.endMinutes)
      .sort((a, b) => a.endMinutes - b.endMinutes)[0] || null;

    if (previousOvernightShift) {
      shift = previousOvernightShift;
      shiftDateOffset = -1;
      status = String(fallbackMode).toLowerCase() === "manual_review" ? "manual_review_required" : "resolved";
      manualReviewRequired = String(fallbackMode).toLowerCase() === "manual_review";
    } else if (String(fallbackMode).toLowerCase() === "manual_review") {
      shift = shifts.slice().sort((a, b) => closestDistance(checkInMinutes, a.startMinutes) - closestDistance(checkInMinutes, b.startMinutes))[0] || null;
      manualReviewRequired = true;
    } else {
      shift = shifts.slice().sort((a, b) => {
        const aUpcoming = forwardDistance(checkInMinutes, a.windowStartMinutes ?? a.startMinutes);
        const bUpcoming = forwardDistance(checkInMinutes, b.windowStartMinutes ?? b.startMinutes);
        return aUpcoming - bUpcoming || closestDistance(checkInMinutes, a.startMinutes) - closestDistance(checkInMinutes, b.startMinutes);
      })[0] || null;
      status = "resolved";
    }
  }

  if (!selected && !manualReviewRequired && status === "manual_review_required" && shift) {
    status = "resolved";
  }

  const scheduledWorkDateParts = shift?.work_date
    ? (() => {
        const [year, month, day] = String(shift.work_date).slice(0, 10).split("-").map(Number);
        return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? { year, month, day } : null;
      })()
    : null;
  const shiftLocalDate = scheduledWorkDateParts || addDays(checkInLocalDate, shiftDateOffset);
  const resolvedStartTime = shift ? zonedWallTimeToDate(shiftLocalDate, shift.startMinutes, timeZone) : null;
  const resolvedEndTime = shift?.endMinutes === null || shift?.endMinutes === undefined
    ? null
    : zonedWallTimeToDate(addDays(shiftLocalDate, shift.crossesMidnight ? 1 : 0), shift.endMinutes, timeZone);

  if (!shift) {
    return {
      shift: null,
      lateMinutes: 0,
      status: "no_shift",
      manualReviewRequired: false,
      resolvedStartTime: null,
      resolvedEndTime: null,
    };
  }

  if (manualReviewRequired) {
    status = "manual_review_required";
  }

  const rawLate = shift ? forwardDistance(shift.startMinutes, checkInMinutes) : 0;
  const lateMinutes = shift && rawLate < 720 ? Math.max(0, rawLate - Number(shift.allowed_late_minutes || 0)) : 0;
  return {
    shift,
    lateMinutes,
    status,
    manualReviewRequired,
    resolvedStartTime,
    resolvedEndTime,
    resolvedStartClock: shift ? minutesToTime(shift.startMinutes) : null,
    resolvedEndClock: shift?.endMinutes === null || shift?.endMinutes === undefined ? null : minutesToTime(shift.endMinutes),
  };
};
