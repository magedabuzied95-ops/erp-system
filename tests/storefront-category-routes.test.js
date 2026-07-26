import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SEO_CATEGORY_PATHS } from "../src/storefront/lib/paths.js";

test("root storefront router mounts every SEO category path from the shared path list", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

  assert.match(source, /import \{ SEO_CATEGORY_PATHS, legacyShopToRootPath \} from "\.\/storefront\/lib\/paths"/);
  assert.match(source, /Array\.from\(SEO_CATEGORY_PATHS\)\.map\(\(path\) => \(/);
  assert.match(source, /<Route key=\{`storefront-category-\$\{path\}`\} path=\{path\}/);

  for (const path of SEO_CATEGORY_PATHS) {
    assert.equal(typeof path, "string");
    assert.ok(path.startsWith("/"));
  }
});
