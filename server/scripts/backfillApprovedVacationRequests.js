// Approved leave requests that never became a vacation row (the parseDateOnly bug fixed in 075a98f)
// are invisible to the paid-leave balance and to payroll. This writes the missing rows.
//
//   node server/scripts/backfillApprovedVacationRequests.js           dry run: lists what is missing
//   node server/scripts/backfillApprovedVacationRequests.js --apply   writes the missing vacations
//
// The dates stay in SQL the whole way, so the JS Date conversion that caused the bug is not involved.
// The forbidden-weekday check is not re-run: a manager already approved these.
import db from "../database/db.js";

const apply = process.argv.includes("--apply");

const MISSING_SQL = `
  SELECT r.id, r.tenant_id, r.employee_id, e.full_name AS employee_name,
         r.request_date::text AS start_date,
         COALESCE(r.end_date, r.request_date)::text AS end_date,
         r.reviewed_at
  FROM employee_portal_requests r
  JOIN employees e ON e.id = r.employee_id
  WHERE LOWER(r.request_type) IN ('vacation', 'leave')
    AND LOWER(r.status) = 'approved'
    AND r.request_date IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM employee_vacations v
      WHERE v.employee_id = r.employee_id
        AND (r.tenant_id IS NULL OR v.tenant_id = r.tenant_id)
        AND COALESCE(v.vacation_date, v.start_date) = r.request_date
        AND COALESCE(v.end_date, v.vacation_date, v.start_date) = COALESCE(r.end_date, r.request_date)
        AND LOWER(COALESCE(v.status, 'pending')) <> 'cancelled'
    )
  ORDER BY r.reviewed_at NULLS LAST, r.id
`;

const main = async () => {
  const { rows } = await db.query(MISSING_SQL);
  console.log(`${rows.length} approved leave request(s) without a vacation row`);
  rows.forEach((row) => console.log(`  #${row.id}  ${row.employee_name}  ${row.start_date} -> ${row.end_date}`));
  if (!apply || !rows.length) {
    if (!apply && rows.length) console.log("dry run - pass --apply to write them");
    return;
  }
  let written = 0;
  for (const row of rows) {
    const result = await db.query(
      `
      INSERT INTO employee_vacations (
        tenant_id, employee_id, vacation_type, vacation_date, start_date, end_date, status, notes, created_at, updated_at
      )
      SELECT r.tenant_id, r.employee_id, 'annual', r.request_date, r.request_date, COALESCE(r.end_date, r.request_date), 'approved',
             CONCAT_WS(E'\\n', NULLIF(r.message, ''), NULLIF(r.admin_note, ''), 'Backfilled from approved portal request #' || r.id),
             NOW(), NOW()
      FROM employee_portal_requests r
      WHERE r.id = $1
      RETURNING id
      `,
      [row.id]
    );
    written += result.rowCount;
  }
  console.log(`wrote ${written} vacation row(s)`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end?.());
