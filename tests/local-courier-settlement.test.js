import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The hand-in runs against a fake database with mock.module, which needs a runtime flag the
// shared test runner does not pass — so the mocked suite runs in its own process.
test("the courier's hand-in posts cash to the shift, InstaPay and Visa to their accounts", () => {
  const suite = fileURLToPath(new URL("./fixtures/local-courier-settlement.mocked.js", import.meta.url));
  const run = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--test", suite], { encoding: "utf8", timeout: 120000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
