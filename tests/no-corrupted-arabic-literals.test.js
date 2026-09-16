/*
 * Arabic text written through some shell and editor paths arrives as question marks, one per
 * letter: the Settings Center's storefront save button read "??? ??????? ??????" in production
 * for months (it was "حفظ إعدادات المتجر"). A string made only of runs of "?" is never real copy,
 * so none may exist in the app's source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORRUPTED = /(["'`])\?{2,}(?: \?{2,})+\1/;

const walk = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
};

test("no string literal is a row of question marks standing in for Arabic words", async () => {
  const offenders = [];
  for (const dir of ["src", "shared"]) {
    for (const file of await walk(path.join(root, dir))) {
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (CORRUPTED.test(line)) offenders.push(`${path.relative(root, file)}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});
