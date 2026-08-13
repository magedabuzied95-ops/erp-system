import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPageTitle } from "../src/shared/hooks/usePageTitle.js";
import { EXACT_ROUTE_TITLES, resolveErpRoutePageTitle } from "../src/shared/navigation/routePageTitles.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every registered ERP title is page-specific and never falls back to ERP", () => {
  assert.ok(Object.keys(EXACT_ROUTE_TITLES).length >= 100);
  for (const [route, title] of Object.entries(EXACT_ROUTE_TITLES)) {
    assert.ok(title.trim(), route);
    assert.notEqual(title, "ERP", route);
    assert.notEqual(buildPageTitle(title), "M1 - ERP", route);
  }
});

test("detail and dynamic routes receive meaningful browser-tab titles", () => {
  const cases = {
    "/products/726": "Product Details",
    "/products/726/edit": "Edit Product",
    "/orders/INV-366": "Order Details",
    "/purchases/317/edit": "Edit Purchase",
    "/purchases/317": "Purchase Details",
    "/suppliers/42": "Supplier Details",
    "/suppliers/42/statement": "Supplier Statement",
    "/customers/9/statement": "Customer Statement",
    "/inventory/count/6": "Inventory Count Session",
    "/inventory/variant/99/history": "Variant Stock History",
    "/loyalty/customers/14": "Customer Loyalty Profile",
    "/ai-studio/workflows/8/edit": "Edit AI Workflow",
  };

  for (const [route, expected] of Object.entries(cases)) {
    assert.equal(resolveErpRoutePageTitle(route), expected, route);
    assert.equal(buildPageTitle(resolveErpRoutePageTitle(route)), `M1 - ${expected}`, route);
  }
});

test("accounting, settings, marketing and reporting pages no longer share generic titles", () => {
  const routes = [
    "/accounting/treasury",
    "/accounting/payment-method-mappings",
    "/accounting/audit-trail",
    "/settings/company",
    "/settings/shipping",
    "/marketing/social-comments",
    "/marketing/social-media-publisher",
    "/reports/overview",
    "/reports/inventory",
    "/employees/payroll",
  ];
  const titles = routes.map(resolveErpRoutePageTitle);
  assert.equal(new Set(titles).size, routes.length);
  assert.ok(titles.every((title) => title !== "ERP"));
});

test("MainLayout owns route-title resolution through the shared registry", () => {
  const mainLayout = read("src/shared/layouts/MainLayout.jsx");
  assert.match(mainLayout, /resolveErpRoutePageTitle/);
  assert.match(mainLayout, /usePageTitle\(resolveErpRoutePageTitle\(location\.pathname\)\)/);
  assert.doesNotMatch(mainLayout, /return "ERP"/);
});

test("unknown routes still get a readable title instead of M1 - ERP", () => {
  assert.equal(resolveErpRoutePageTitle("/future/new-module"), "New Module");
  assert.equal(buildPageTitle(resolveErpRoutePageTitle("/future/new-module")), "M1 - New Module");
});
