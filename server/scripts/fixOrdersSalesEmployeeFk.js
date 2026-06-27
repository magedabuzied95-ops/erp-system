import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

require("dotenv").config({ path: path.join(currentDir, "../.env"), quiet: true });

let db = null;

const run = async () => {
  ({ default: db } = await import("../database/db.js"));
  const {
    logOrdersSalesEmployeeFkTarget,
    repairOrdersSalesEmployeeForeignKey,
  } = await import("../services/salesCommissionService.js");

  console.log("[seller-fk-migration] start");
  await logOrdersSalesEmployeeFkTarget(db, { source: "explicit_migration:before" });
  await repairOrdersSalesEmployeeForeignKey(db, { source: "explicit_migration" });
  await logOrdersSalesEmployeeFkTarget(db, { source: "explicit_migration:after" });
  console.log("[seller-fk-migration] complete");
  await db.end().catch(() => null);
};

run()
  .catch((error) => {
    console.error("[seller-fk-migration] failed", {
      message: error?.message || String(error),
      code: error?.code || null,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db?.end?.().catch(() => null);
  });
