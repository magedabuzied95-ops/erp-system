import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync("src/shared/layouts/MainLayout.jsx", "utf8");
const css = readFileSync("src/shared/layouts/MainLayout.m1.css", "utf8");

test("auto-hide is the default and remembered per browser", () => {
  assert.match(layout, /readSidebarJson\(SIDEBAR_AUTO_HIDE_STORAGE_KEY, true\)/);
  assert.match(layout, /writeSidebarJson\(SIDEBAR_AUTO_HIDE_STORAGE_KEY, sidebarAutoHide\)/);
});

test("the sidebar rests as an icon rail and widens over the page on hover", () => {
  assert.match(layout, /onMouseEnter=\{sidebarAutoHide \? \(\) => scheduleSidebarPeek\(true, 120\) : undefined\}/);
  assert.match(layout, /onMouseLeave=\{sidebarAutoHide \? closeSidebarPeek : undefined\}/);
  assert.match(layout, /sidebarHidden \? "m1-shell-sidebar--rail" : "m1-shell-sidebar--peek"/);
  assert.match(css, /\.m1-shell-root\.m1-shell-root--sidebar-autohide\{grid-template-columns:64px minmax\(0,1fr\)!important\}/);
  assert.match(css, /\.m1-shell-sidebar--autohide\.m1-shell-sidebar--peek\{width:260px!important/);
  assert.match(css, /\.m1-shell-sidebar--rail :is\(\.m1-sidebar-fade,nav a>span,nav button>\*\)\{opacity:0/);
});

test("the resting rail lists every module icon and drops the brand card", () => {
  assert.match(layout, /<div className="m1-sidebar-rail-list hidden">/);
  assert.match(layout, /if \(!sidebarHidden\) return \[\];/);
  assert.match(css, /aside\.m1-shell-sidebar--rail nav>:not\(\.m1-sidebar-rail-list\)\{display:none!important\}/);
  assert.match(css, /aside\.m1-shell-sidebar--rail \.m1-sidebar-brand\{display:none\}/);
});

test("typing in the module search keeps the peeked sidebar open", () => {
  assert.match(layout, /focused === sidebarSearchInputRef\.current\) return;/);
});

test("the header button toggles between pinned and auto-hide", () => {
  assert.match(layout, /onClick=\{toggleSidebarAutoHide\}/);
  assert.match(layout, /sidebarAutoHide \? t\("sidebar\.pin"\) : t\("sidebar\.autoHide"\)/);
});
