import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/shared/layouts/MainLayout.jsx", import.meta.url),
  "utf8"
);

test("sidebar exposes aria-current only for its exact calculated active item", () => {
  const sidebarItem = source.slice(
    source.indexOf("function SidebarNavItem"),
    source.indexOf("function HeaderQuickActionButton")
  );

  assert.match(sidebarItem, /const active = sidebarItemActive\(item, location\)/);
  assert.match(sidebarItem, /aria-current=\{active \? "page" : "false"\}/);
});

test("orders sidebar routes distinguish base, website query, and returns", () => {
  assert.match(source, /if \(search\) return location\.pathname === pathname && location\.search === `\?\$\{search\}`/);
  assert.match(source, /if \(location\.pathname === pathname && !location\.search\) return true/);
  assert.match(source, /CONCRETE_SIDEBAR_PATHS\.has\(location\.pathname\)/);
  assert.match(source, /"\/orders\/returns"/);
});
