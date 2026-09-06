import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  applyColorArticleCodesToRows,
  rowInheritsColorArticleCodes,
} from "../shared/articleCode.js";
import { applyBulkSizesToGroups, createVariantRow } from "../src/modules/products/lib/variantBulkSizes.js";

test("a size row with no code of its own follows the colour", () => {
  assert.equal(rowInheritsColorArticleCodes({}), true);
  assert.equal(rowInheritsColorArticleCodes({ article_code: "", article_codes: [] }), true);
  assert.equal(rowInheritsColorArticleCodes({ article_code: "L122-40" }), false);
  assert.equal(rowInheritsColorArticleCodes({ article_codes: ["L122-40"] }), false);
});

test("adding an article code at the colour level fills every empty size row", () => {
  const rows = applyColorArticleCodesToRows(
    [{ id: "a", size: "40" }, { id: "b", size: "41" }],
    ["9060", "327"]
  );
  assert.deepEqual(rows.map((row) => row.article_codes), [["9060", "327"], ["9060", "327"]]);
  assert.deepEqual(rows.map((row) => row.article_code), ["9060", "9060"]);
});

test("a size row that carries its own code is not overwritten by the colour", () => {
  const rows = applyColorArticleCodesToRows(
    [{ id: "a", size: "40", article_codes: ["L122-40"], article_code: "L122-40", article_code_inherited: false }],
    ["9060"]
  );
  assert.deepEqual(rows[0].article_codes, ["L122-40"]);
});

test("a row that followed the colour keeps following it when the colour code changes", () => {
  const first = applyColorArticleCodesToRows([{ id: "a", size: "40" }], ["9060"]);
  const second = applyColorArticleCodesToRows(first, ["8080", "327"]);
  assert.deepEqual(second[0].article_codes, ["8080", "327"]);
  assert.equal(second[0].article_code, "8080");
});

test("clearing the colour code clears the rows that follow it", () => {
  const filled = applyColorArticleCodesToRows([{ id: "a", size: "40" }], ["9060"]);
  const cleared = applyColorArticleCodesToRows(filled, []);
  assert.deepEqual(cleared[0].article_codes, []);
  assert.equal(cleared[0].article_code, "");
});

test("a new row keeps the codes it was created with, and defaults to following the colour", () => {
  const seeded = createVariantRow({ size: "40", article_codes: ["9060", "327"], article_code_inherited: true });
  assert.deepEqual(seeded.article_codes, ["9060", "327"]);
  assert.equal(seeded.article_code, "9060");
  assert.equal(rowInheritsColorArticleCodes(seeded), true);

  const bare = createVariantRow({ size: "41" });
  assert.equal(rowInheritsColorArticleCodes(bare), true);
});

test("sizes added in bulk pick up the colour article codes", () => {
  const { groups } = applyBulkSizesToGroups({
    groups: [{ id: "g1", color: "Black", color_article_codes: ["9060", "327"], sizes: [] }],
    sizes: ["40", "41"],
    targetGroupId: "g1",
  });
  const codes = groups[0].sizes.map((row) => row.article_codes);
  assert.deepEqual(codes, [["9060", "327"], ["9060", "327"]]);
});

for (const page of ["CreateProduct", "ProductEdit"]) {
  test(`${page} pushes the colour article code down to its size rows`, async () => {
    const source = await readFile(
      new URL(`../src/modules/products/pages/${page}.jsx`, import.meta.url),
      "utf8"
    );

    // Without this branch the colour code is typed into a field nobody reads:
    // the rows stay blank and color_article_code is saved empty.
    assert.match(
      source,
      /field === "color_article_codes" \|\| field === "color_article_code"/,
      "the colour article code must be handled in updateColorGroup"
    );
    assert.ok(
      source.includes("sizes: applyColorArticleCodesToRows(group.sizes, codes)"),
      "the colour code must reach the size rows"
    );
    assert.ok(
      source.includes(`color_article_code: codes[0] || ""`),
      "the singular colour code must stay in step with the list that is typed into"
    );
    assert.ok(
      source.includes(`...(field === "article_codes" || field === "article_code"
                          ? { article_code_inherited: false }`),
      "editing a row article code must detach that row from the colour"
    );
  });
}
