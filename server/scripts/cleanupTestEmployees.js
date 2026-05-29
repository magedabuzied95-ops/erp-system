import db from "../database/db.js";
import { cleanupFakeLegacyEmployees } from "../services/employeeCleanupService.js";

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const argValue = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
};

const main = async () => {
  const confirm = toBool(argValue("confirm") ?? process.env.CONFIRM_CLEANUP_TEST_EMPLOYEES, false);
  const tenantValue = argValue("tenant-id") ?? process.env.CLEANUP_TEST_EMPLOYEES_TENANT_ID;
  const tenantId = tenantValue ? Number(tenantValue) : null;

  if (tenantValue && !Number.isInteger(tenantId)) {
    throw new Error("--tenant-id must be an integer");
  }

  const result = await cleanupFakeLegacyEmployees({
    tenantId,
    confirm,
    actorUserId: null,
  });

  console.log("[cleanup-test-employees] summary", JSON.stringify({
    dry_run: result.dryRun,
    tenant_id: tenantId,
    employees: result.matchedEmployees.length,
    users: result.matchedUsers.length,
    legacy_sales_employees: result.matchedLegacySalesEmployees.length,
    related_records_count: result.relatedRecordsCount,
    counts: result.counts,
  }, null, 2));
};

main()
  .catch((error) => {
    console.error("[cleanup-test-employees] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
