import db from "../database/db.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { assignNextOpeningEmployee, listEligibleOpeningEmployees } from "./openingShiftService.js";

const cleanDate = (value) => String(value || "").slice(0, 10);

const enumerateDates = (startDate, endDate) => {
  const start = new Date(`${cleanDate(startDate)}T00:00:00Z`);
  const end = new Date(`${cleanDate(endDate)}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  const rows = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    rows.push(cursor.toISOString().slice(0, 10));
  }
  return rows.slice(0, 62);
};

export const generateOpeningShiftSchedule = async ({
  tenantId,
  branchId,
  startDate,
  endDate,
  createdByUserId = null,
  overwrite = false,
} = {}) => {
  await ensureAttendanceSchema();
  if (!branchId) {
    const error = new Error("Branch is required to generate opening schedule");
    error.status = 400;
    throw error;
  }
  const dates = enumerateDates(startDate, endDate);
  if (!dates.length) {
    const error = new Error("Valid schedule date range is required");
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (overwrite) {
      await client.query(
        `
        DELETE FROM employee_shift_schedules
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND branch_id::text = $2::text
          AND shift_type = 'opening'
          AND work_date BETWEEN $3::date AND $4::date
          AND source IN ('schedule_autogen', 'schedule_manual')
        `,
        [tenantId, branchId, dates[0], dates[dates.length - 1]]
      );
      await client.query(
        `
        DELETE FROM shift_opening_assignments
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND branch_id::text = $2::text
          AND work_date BETWEEN $3::date AND $4::date
          AND source IN ('schedule_autogen', 'schedule_manual')
        `,
        [tenantId, branchId, dates[0], dates[dates.length - 1]]
      );
    }

    const historyResult = await client.query(
      `
      SELECT employee_id, COUNT(*)::int AS assigned_count
      FROM employee_shift_schedules
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND branch_id::text = $2::text
        AND shift_type = 'opening'
        AND work_date >= ($3::date - interval '60 days')
        AND work_date < $3::date
      GROUP BY employee_id
      `,
      [tenantId, branchId, dates[0]]
    );
    const loadByEmployee = new Map(historyResult.rows.map((row) => [String(row.employee_id), Number(row.assigned_count || 0)]));
    const generated = [];
    const skipped = [];

    for (const workDate of dates) {
      const existingResult = await client.query(
        `
        SELECT id
        FROM employee_shift_schedules
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND branch_id::text = $2::text
          AND shift_type = 'opening'
          AND work_date = $3::date
        LIMIT 1
        `,
        [tenantId, branchId, workDate]
      );
      if (existingResult.rows[0]) {
        skipped.push({ work_date: workDate, reason: "already_scheduled" });
        continue;
      }

      const candidates = await listEligibleOpeningEmployees(client, { tenantId, branchId, workDate });
      const eligible = candidates
        .filter((candidate) => candidate.eligible !== false && !candidate.has_leave)
        .sort((a, b) => {
          const loadDiff = (loadByEmployee.get(String(a.id)) || 0) - (loadByEmployee.get(String(b.id)) || 0);
          if (loadDiff !== 0) return loadDiff;
          return String(a.full_name || a.name || "").localeCompare(String(b.full_name || b.name || ""));
        });
      if (!eligible.length) {
        skipped.push({ work_date: workDate, reason: "no_eligible_employee" });
        continue;
      }

      let created = null;
      let lastConflict = null;
      for (const selected of eligible) {
        try {
          const result = await assignNextOpeningEmployee(client, {
            tenantId,
            branchId,
            employeeId: selected.id,
            workDate,
            assignedByUserId: createdByUserId,
            source: "schedule_autogen",
            note: "Auto-generated opening shift schedule",
          });
          created = { selected, result };
          break;
        } catch (error) {
          if (error?.code === "OPENING_EMPLOYEE_SHIFT_CONFLICT") {
            lastConflict = error;
            continue;
          }
          throw error;
        }
      }

      if (!created) {
        skipped.push({
          work_date: workDate,
          reason: lastConflict ? "all_eligible_employees_have_shift_conflicts" : "no_eligible_employee",
        });
        continue;
      }

      loadByEmployee.set(String(created.selected.id), (loadByEmployee.get(String(created.selected.id)) || 0) + 1);
      generated.push({
        work_date: workDate,
        employee_id: created.selected.id,
        employee_name: created.selected.full_name || created.selected.name || "",
        assignment_id: created.result.assignment?.id || null,
        schedule_id: created.result.schedule?.id || null,
      });
    }

    await client.query("COMMIT");
    return { generated, skipped, total: dates.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
