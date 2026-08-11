import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync("src/shared/layouts/MainLayout.jsx", "utf8");

test("collapsed sidebar separates the brand mark from the toggle", () => {
  assert.match(layout, /sidebarCompact \? "flex-col justify-center"/);
  assert.match(layout, /\{sidebarCompact \? null : <div className="min-w-0">/);
});

test("collapsed sidebar renders a search button instead of squeezing the input", () => {
  assert.match(layout, /onClick=\{openSidebarSearch\}/);
  assert.match(layout, /aria-label=\{t\("sidebar\.searchModules"\)\}/);
  assert.match(layout, /ref=\{sidebarSearchInputRef\}/);
  assert.match(layout, /requestAnimationFrame\(\(\) => sidebarSearchInputRef\.current\?\.focus\(\)\)/);
});
