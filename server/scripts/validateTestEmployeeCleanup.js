import db from "../database/db.js";

const main = async () => {
  const remainingNames = await db.query(`
    SELECT 'employees' AS source, id, full_name AS name
    FROM employees
    WHERE COALESCE(is_deleted, false) = false
      AND COALESCE(full_name, '') ILIKE ANY(ARRAY[
        '%Test%',
        '%Shift Close Test%',
        '%Legacy Test%',
        '%Legacy Close Test%',
        '%Codex%',
        '%Demo%'
      ])
    UNION ALL
    SELECT 'users' AS source, id, name
    FROM users
    WHERE COALESCE(name, '') ILIKE ANY(ARRAY[
      '%Test%',
      '%Shift Close Test%',
      '%Legacy Test%',
      '%Legacy Close Test%',
      '%Codex%',
      '%Demo%'
    ])
    ORDER BY source, id
  `);

  const staleTasks = await db.query(`
    SELECT COUNT(*)::int AS stale_task_assignments
    FROM staff_task_assignments sta
    LEFT JOIN employees assigned_employee ON assigned_employee.id = sta.assigned_employee_id
    LEFT JOIN employees current_employee ON current_employee.id = sta.current_assignee_id
    LEFT JOIN employees completed_employee ON completed_employee.id = sta.completed_by
    WHERE (sta.assigned_employee_id IS NOT NULL AND assigned_employee.id IS NULL)
       OR (sta.current_assignee_id IS NOT NULL AND current_employee.id IS NULL)
       OR (sta.completed_by IS NOT NULL AND completed_employee.id IS NULL)
  `);

  const performanceRows = await db.query(`
    SELECT COUNT(*)::int AS sales_performance_test_rows
    FROM orders o
    LEFT JOIN users u ON u.id = COALESCE(o.sales_employee_id, o.cashier_id, o.created_by)
    WHERE COALESCE(u.name, '') ILIKE ANY(ARRAY[
      '%Test%',
      '%Shift Close Test%',
      '%Legacy Test%',
      '%Legacy Close Test%',
      '%Codex%',
      '%Demo%'
    ])
  `);

  console.log("[cleanup-test-employees] validation", JSON.stringify({
    remaining_names: remainingNames.rows,
    stale_task_assignments: staleTasks.rows[0]?.stale_task_assignments ?? null,
    sales_performance_test_rows: performanceRows.rows[0]?.sales_performance_test_rows ?? null,
  }, null, 2));
};

main()
  .catch((error) => {
    console.error("[cleanup-test-employees] validation failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
