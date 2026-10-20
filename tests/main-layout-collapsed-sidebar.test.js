import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync("src/shared/layouts/MainLayout.jsx", "utf8");
const css = readFileSync("src/shared/layouts/MainLayout.m1.css", "utf8");

test("auto-hide is the default and remembered per browser", () => {
  assert.match(layout, /readSidebarJson\(SIDEBAR_AUTO_HIDE_STORAGE_KEY, true\)/);
  assert.match(layout, /writeSidebarJson\(SIDEBAR_AUTO_HIDE_STORAGE_KEY, sidebarAutoHide\)/);
});

test("hovering the edge strip slides the sidebar over the page", () => {
  assert.match(layout, /data-sidebar-edge-strip="true"\s+onMouseEnter=\{\(\) => scheduleSidebarPeek\(true, 120\)\}/);
  assert.match(layout, /onMouseLeave=\{sidebarAutoHide \? closeSidebarPeek : undefined\}/);
  assert.match(layout, /sidebarHidden \? \(isRtl \? "lg:translate-x-full" : "lg:-translate-x-full"\)/);
  assert.match(css, /\.m1-shell-root\.m1-shell-root--sidebar-autohide\{grid-template-columns:12px minmax\(0,1fr\)!important\}/);
});

test("typing in the module search keeps the peeked sidebar open", () => {
  assert.match(layout, /focused === sidebarSearchInputRef\.current\) return;/);
});

test("the header button toggles between pinned and auto-hide", () => {
  assert.match(layout, /onClick=\{toggleSidebarAutoHide\}/);
  assert.match(layout, /sidebarAutoHide \? t\("sidebar\.pin"\) : t\("sidebar\.autoHide"\)/);
});
