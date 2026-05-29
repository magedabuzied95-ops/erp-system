import db from "../database/db.js";
import {
  buildEmployeePayrollPortalPayload,
  ensureEmployeePayrollPortalSchema,
  getEmployeeGamificationAdmin,
  loadEmployeePortalByToken,
  regenerateEmployeePortalToken,
} from "../services/employeePayrollPortalService.js";

const checks = [];

const pass = (name, details = {}) => checks.push({ name, ok: true, details });
const fail = (name, error) => checks.push({ name, ok: false, error: error?.message || String(error) });

const requiredTables = [
  "employee_portal_requests",
  "employee_reward_points",
  "employee_badge_awards",
  "employee_admin_rewards",
  "employee_goals",
  "employee_gamification_settings",
];

const tableExists = async (tableName) => {
  const result = await db.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
    ) AS exists
    `,
    [tableName]
  );
  return Boolean(result.rows[0]?.exists);
};

const main = async () => {
  try {
    await ensureEmployeePayrollPortalSchema(db);
    pass("schema bootstrap");
  } catch (error) {
    fail("schema bootstrap", error);
  }

  for (const tableName of requiredTables) {
    try {
      const exists = await tableExists(tableName);
      if (!exists) throw new Error(`${tableName} missing`);
      pass(`table exists: ${tableName}`);
    } catch (error) {
      fail(`table exists: ${tableName}`, error);
    }
  }

  try {
    const result = await db.query(
      `
      SELECT id, tenant_id, employee_portal_token
      FROM employees
      WHERE COALESCE(is_deleted, FALSE) = FALSE
      ORDER BY id ASC
      LIMIT 1
      `
    );
    const employee = result.rows[0];
    if (!employee) throw new Error("No employee rows available for smoke test");
    pass("employee fixture available", { employee_id: employee.id });

    const token = employee.employee_portal_token || await regenerateEmployeePortalToken({ employeeId: employee.id, tenantId: employee.tenant_id });
    const loaded = await loadEmployeePortalByToken(token);
    if (!loaded || String(loaded.id) !== String(employee.id)) throw new Error("Portal token did not resolve to the expected employee");
    pass("portal token resolves only selected employee", { employee_id: loaded.id });

    const payload = await buildEmployeePayrollPortalPayload({ employee: loaded });
    const requiredPayloadKeys = ["employee_profile", "wallet_summary", "attendance", "employee_requests", "performance", "leaderboard"];
    const missingKeys = requiredPayloadKeys.filter((key) => !(key in payload));
    if (missingKeys.length) throw new Error(`Missing payload keys: ${missingKeys.join(", ")}`);
    pass("wallet payload shape", { keys: requiredPayloadKeys });

    if (["1", "true", "yes"].includes(String(process.env.EMPLOYEE_WALLET_SMOKE_MUTATE || "").toLowerCase())) {
      const oldToken = token;
      const newToken = await regenerateEmployeePortalToken({ employeeId: employee.id, tenantId: employee.tenant_id });
      const oldLoaded = await loadEmployeePortalByToken(oldToken);
      const newLoaded = await loadEmployeePortalByToken(newToken);
      if (oldLoaded) throw new Error("Old portal token still resolves after regeneration");
      if (!newLoaded || String(newLoaded.id) !== String(employee.id)) throw new Error("New portal token does not resolve after regeneration");
      pass("token regeneration invalidates old link", { employee_id: employee.id });
    } else {
      pass("token regeneration invalidation check skipped", { reason: "Set EMPLOYEE_WALLET_SMOKE_MUTATE=1 to run the mutating token check." });
    }
  } catch (error) {
    fail("portal flow smoke", error);
  }

  try {
    const admin = await getEmployeeGamificationAdmin({ tenantId: null });
    if (!admin.settings) throw new Error("Gamification settings missing");
    pass("gamification settings available");
  } catch (error) {
    fail("gamification settings available", error);
  }

  const failed = checks.filter((item) => !item.ok);
  console.log(JSON.stringify({ success: failed.length === 0, checks }, null, 2));
  await db.end();
  if (failed.length) process.exit(1);
};

main().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => null);
  process.exit(1);
});
