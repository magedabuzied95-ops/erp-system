import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");

test("every deployment gives JavaScript chunks a new cache identity", () => {
  assert.match(source, /env\.VERCEL_GIT_COMMIT_SHA/);
  assert.match(source, /entryFileNames: `assets\/\[name\]-\[hash\]-\$\{buildVersion\}\.js`/);
  assert.match(source, /chunkFileNames: `assets\/\[name\]-\[hash\]-\$\{buildVersion\}\.js`/);
});
