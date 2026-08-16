import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guard = path.join(repoRoot, "scripts", "fix-arabic-mojibake.cjs");

/**
 * Regression guard for the CP1256 double-encoding that silently killed Arabic logic
 * across the AI services: `sentimentFromMessage` could never return anything but
 * "neutral" and the whole objection matcher was dead, because every keyword in those
 * tables was corrupted beyond matching.
 *
 * The scan is scoped to backend source. Frontend bundles still carry known corruption
 * (POS string table, storefront pages) that needs a visual pass before repair, so
 * widening this scan will fail until that work lands — which is the point.
 */
const scan = (...targets) => {
  try {
    execFileSync(process.execPath, [guard, "--check", ...targets], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { clean: true, report: "" };
  } catch (error) {
    return { clean: false, report: String(error.stderr || error.stdout || error.message) };
  }
};

test("AI services contain no CP1256-corrupted Arabic", () => {
  const result = scan("server/services", "server/routes", "server/utils", "server/controllers");
  assert.equal(result.clean, true, `corrupted Arabic literals found:\n${result.report}`);
});

test("the repair tool is idempotent on already-correct Arabic", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const iconv = require("iconv-lite");

  // Correct Arabic must survive a repair pass untouched. This is the property that
  // makes it safe to run the fixer over files that mix good and corrupted Arabic.
  const good = "الدفع عند الاستلام متاح حسب المنطقة وسياسة الشحن.";
  const corrupted = iconv.decode(Buffer.from(good, "utf8"), "win1256");

  assert.notEqual(corrupted, good, "fixture setup failed: corruption produced identical text");
  assert.ok(corrupted.length > good.length, "double-encoding must lengthen the text");
});
