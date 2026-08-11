import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Canonical Pagination + canonical Table integration.
//
// The Pagination work was recovered from an uncommitted working tree and merged
// on top of the table-unification commits. These tests cover the risks that
// merge specifically creates — they do not re-test either system in isolation
// (tests/canonical-table.test.js and tests/pagination-unification.test.js do).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const jsx = read("src/shared/ui/M1UI.jsx");
const uiCss = read("src/shared/ui/m1-ui.css");
const tableCss = read("src/shared/ui/m1-table.css");
const stripComments = (s) => s.replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, "$1").replace(/^\s*\/\/.*$/gm, "");

const MIGRATED_PAGES = [
  "src/modules/products/pages/ProductsList.jsx",
  "src/modules/products/pages/Units.jsx",
  "src/modules/products/pages/Manufacturers.jsx",
  "src/modules/accounting/pages/JournalEntries.jsx",
  "src/modules/purchases/pages/PurchasesDashboard.jsx",
  "src/modules/purchases/pages/SuppliersDashboard.jsx",
  "src/modules/employees/pages/Branches.jsx",
  "src/modules/inventory/pages/InventoryHistory.jsx",
  "src/modules/managerPortal/pages/InventoryApprovals.jsx",
  "src/modules/reports/pages/Reports.jsx",
  "src/modules/sales/pages/Customers.jsx",
  "src/modules/orders/pages/OrdersDashboard.jsx",
];

// Server-backed lists: these forward the selected size to an API as limit or
// page size, so an invalid value would reach the backend rather than just
// slicing an in-memory array badly.
const SERVER_PAGINATED = [
  "src/modules/accounting/pages/JournalEntries.jsx",
  "src/modules/inventory/pages/InventoryHistory.jsx",
  "src/modules/managerPortal/pages/InventoryApprovals.jsx",
  "src/modules/sales/pages/Customers.jsx",
  "src/modules/products/pages/ProductsList.jsx",
];

// ---- the merge itself -----------------------------------------------------

test("both systems survived the merge — no side was taken wholesale", () => {
  for (const name of ["DataTable", "TableContainer", "Table", "TableHead", "TableBody", "TableFoot", "TableRow", "TableHeaderCell", "TableCell", "TableActions", "Pagination"]) {
    assert.match(jsx, new RegExp(`export function ${name}\\(`), `${name} was lost in the merge`);
  }
  assert.match(jsx, /import "\.\/m1-table\.css";/, "the table stylesheet import was lost");
  assert.match(jsx, /import "\.\/m1-ui\.css";/);
});

test("the merged import line is the union of both sides", () => {
  // Phase 2A needs useEffect/useId/Search; the recovered Pagination needs
  // ChevronRight for the RTL "previous" affordance.
  assert.match(jsx, /import \{ forwardRef, useEffect, useId \} from "react";/);
  assert.match(jsx, /ChevronLeft, ChevronRight, Inbox, LoaderCircle, Search, X/);
});

test("the recovered Pagination kept every feature it shipped with", () => {
  const body = jsx.slice(jsx.indexOf("const DEFAULT_PAGE_SIZES"));
  assert.match(body, /function paginationWindow\(page, pages\)/, "numeric window");
  assert.match(body, /ellipsis-\$\{value\}/, "ellipsis");
  assert.match(body, /m1-pagination__ellipsis/);
  assert.match(body, /aria-current=\{item === safePage \? "page" : undefined\}/);
  assert.match(body, /aria-live="polite"/);
  assert.match(body, /labels = \{\}/, "labels override");
  assert.match(body, /onPageSizeChange/, "page-size selector");
  assert.match(body, /disabled = false/);
  assert.match(body, /<ChevronRight size=\{16\}/, "RTL previous");
  assert.match(body, /<ChevronLeft size=\{16\}/, "RTL next");
});

// ---- the raw colour -------------------------------------------------------

test("the pagination active state uses the existing primary foreground token", () => {
  // It shipped as `color:#fff`. --primary-contrast is already the foreground for
  // a primary-filled surface, so no new token was needed.
  assert.match(uiCss, /\.m1-pagination button\.is-active\{[^}]*background:var\(--accent,var\(--primary\)\)[^}]*color:var\(--primary-contrast\)/);
});

test("the canonical kit still contains no raw colour anywhere", () => {
  for (const [name, css] of [["m1-ui.css", uiCss], ["m1-table.css", tableCss]]) {
    const stripped = stripComments(css);
    assert.doesNotMatch(stripped, /#[0-9a-fA-F]{3,8}\b/, `${name} has raw hex`);
    assert.doesNotMatch(stripped, /rgba?\([0-9]/, `${name} has raw rgb`);
  }
});

test("the merge introduced no !important — including the one theirs carried", () => {
  // Their side of the CSS conflict still had `.m1-metric{…!important}` from
  // before Phase 2A removed it. Taking their hunk wholesale would have walked
  // that back.
  assert.equal((stripComments(uiCss).match(/!important/g) ?? []).length, 0);
  assert.equal((stripComments(tableCss).match(/!important/g) ?? []).length, 0);
  assert.doesNotMatch(uiCss, /\.m1-metric\{border-radius:var\(--radius-card\)!important\}/);
});

// ---- `all` safety ---------------------------------------------------------

test("selecting `all` can never put a non-number on the wire", () => {
  // The ternary intercepts the string BEFORE Number() runs, so neither
  // `limit=all` nor Number("all") -> NaN is reachable.
  assert.match(
    jsx,
    /onPageSizeChange\(event\.target\.value === "all" \? Math\.max\(1, safeTotal\) : Number\(event\.target\.value\)\)/,
    "the `all` guard is the single thing standing between the select and the backend",
  );
});

test("`all` resolves to a positive integer even when total is unknown", () => {
  // Math.max(1, …) floors it at 1, so an early selection before the first
  // response cannot produce 0, NaN or a negative limit.
  assert.match(jsx, /Math\.max\(1, safeTotal\)/);
  assert.match(jsx, /const safeTotal = Math\.max\(0, Number\(total\) \|\| 0\);/);
});

test("the size selector round-trips back to `all` after it resolves to a number", () => {
  // Once pageSize becomes e.g. 4213 the option list no longer contains it, so
  // without this the select would silently fall back to a wrong entry.
  assert.match(jsx, /const numericPageSizes = pageSizeOptions\.filter\(\(option\) => option !== "all"\)/);
  assert.match(jsx, /: hasAllOption \? "all" : safePageSize;/);
});

test("no migrated page forwards a page-size string to its query", () => {
  for (const file of MIGRATED_PAGES) {
    const src = read(file);
    assert.doesNotMatch(src, /limit[=:]\s*["'`]all["'`]/, `${file} would send limit=all`);
    assert.doesNotMatch(src, /pageSize\s*===\s*["']all["']/, `${file} re-implements the all guard locally`);
  }
});

test("every server-paginated page still sends a numeric limit/page", () => {
  for (const file of SERVER_PAGINATED) {
    const src = read(file);
    assert.match(src, /limit|page/, `${file} lost its pagination parameters`);
    // the component owns the conversion; pages must not stringify it back
    assert.doesNotMatch(src, /String\(\s*["']all["']\s*\)/);
  }
});

// ---- call-site integrity --------------------------------------------------

test("each of the 12 pages renders exactly one canonical Pagination", () => {
  for (const file of MIGRATED_PAGES) {
    const src = read(file);
    assert.equal((src.match(/<Pagination[\s/>]/g) ?? []).length, 1, `${file} should render exactly one`);
    assert.match(src, /import \{[^}]*Pagination[^}]*\} from "[^"]*shared\/ui"/, `${file} must import the canonical one`);
  }
});

test("each of the 12 pages wires both callbacks", () => {
  for (const file of MIGRATED_PAGES) {
    const src = read(file);
    const call = src.slice(src.indexOf("<Pagination"), src.indexOf("<Pagination") + 900);
    assert.match(call, /onChange=/, `${file} lost onChange`);
    assert.match(call, /onPageSizeChange=/, `${file} lost onPageSizeChange`);
    assert.match(call, /page=/, `${file} lost page`);
    assert.match(call, /pages=/, `${file} lost pages`);
  }
});

test("no legacy pager survived anywhere", () => {
  for (const file of MIGRATED_PAGES) {
    assert.doesNotMatch(read(file), /PagerButton|function Pager\b/, `${file} still has a legacy pager`);
  }
});

// ---- coexistence ----------------------------------------------------------

test("the table and pagination stylesheets share no selector", () => {
  const selectors = (css) => new Set((css.match(/\.m1-[a-z0-9_-]+/g) ?? []));
  const table = selectors(stripComments(tableCss));
  const ui = selectors(stripComments(uiCss));
  const shared = [...table].filter((s) => ui.has(s));
  assert.deepEqual(shared, [], `the two stylesheets both style: ${shared.join(", ")}`);
});

test("the table density variables are private to the table system", () => {
  assert.doesNotMatch(stripComments(uiCss), /--m1-table-/, "pagination must not read or set table density");
  assert.match(tableCss, /--m1-table-font/);
});

test("empty-state ownership is not duplicated", () => {
  // .m1-empty is the standalone EmptyState; .m1-table__empty is the in-table
  // row. They must stay distinct or a table would get a 210px-tall empty state.
  assert.match(uiCss, /\.m1-empty\{/);
  assert.match(tableCss, /td\.m1-table__empty/);
  assert.doesNotMatch(stripComments(tableCss), /\.m1-empty\{/);
});

test("both systems keep their own responsive block without cross-talk", () => {
  const uiMedia = stripComments(uiCss).match(/@media\(max-width:700px\)\{[^@]*/)?.[0] ?? "";
  const tableMedia = stripComments(tableCss).match(/@media \(max-width: 700px\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(uiMedia, /m1-pagination/, "pagination responsive rules missing");
  assert.doesNotMatch(uiMedia, /m1-table/, "the pagination breakpoint must not restyle tables");
  assert.match(tableMedia, /m1-table/);
  assert.doesNotMatch(tableMedia, /m1-pagination/);
});

test("RTL handling stays consistent across both systems", () => {
  // Pagination sets dir="rtl" on its own nav; the table system relies on logical
  // properties. Neither may hardcode a physical direction.
  assert.match(jsx, /className=\{`m1-pagination \$\{className\}`\.trim\(\)\} aria-label="[^"]*" dir="rtl"/);
  for (const physical of ["padding-left", "padding-right", "text-align: left", "text-align: right"]) {
    assert.ok(!stripComments(tableCss).includes(physical), `table system uses ${physical}`);
  }
});
