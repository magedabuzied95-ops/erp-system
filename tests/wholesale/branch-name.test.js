import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Retail's single branch is always "فرع البشبيشي". The wholesale copy keeps one branch
// too, but the owner names it -- and a restart must not rename it back (the boot used to
// find the branch by the fixed name, recreate it, and delete every other branch).

const { SINGLE_BRANCH_NAME, WHOLESALE_DEFAULT_BRANCH_NAME, currentSingleBranchName, requestedSingleBranchName } =
  await import("../../server/utils/singleBranchMode.js");

const withMode = async (mode, fn) => {
  const saved = process.env.BUSINESS_MODE;
  if (mode) process.env.BUSINESS_MODE = mode; else delete process.env.BUSINESS_MODE;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.BUSINESS_MODE; else process.env.BUSINESS_MODE = saved; }
};
const pool = (name) => ({ query: async () => ({ rows: name === undefined ? [] : [{ name }] }) });

test("retail: the branch name stays fixed whatever is sent", async () => {
  await withMode(null, async () => {
    assert.equal(requestedSingleBranchName("فرع الجملة"), SINGLE_BRANCH_NAME);
    assert.equal(await currentSingleBranchName(pool("anything")), SINGLE_BRANCH_NAME);
  });
});

test("wholesale: the owner's name is kept; empty falls back", async () => {
  await withMode("wholesale", async () => {
    assert.equal(requestedSingleBranchName("  مخزن العتبة  "), "مخزن العتبة");
    assert.equal(requestedSingleBranchName(""), SINGLE_BRANCH_NAME);
    assert.equal(await currentSingleBranchName(pool("مخزن العتبة")), "مخزن العتبة");
    assert.equal(await currentSingleBranchName(pool()), WHOLESALE_DEFAULT_BRANCH_NAME);
  });
});

test("the boot finds the branch by name on retail only", () => {
  const src = fs.readFileSync(new URL("../../server/utils/singleBranchMode.js", import.meta.url), "utf8");
  assert.match(src, /const keeperByName = !ownerNamesBranch\(\);/);
  assert.match(src, /\$\{keeperByName \? "WHERE name = \$1" : ""\}/);
  assert.match(src, /\$\{keeperByName \? `WHERE name = '\$\{branchNameSql\}'` : ""\}/);
  assert.doesNotMatch(src, /SET branch_name = '\$\{SINGLE_BRANCH_NAME/);
});
