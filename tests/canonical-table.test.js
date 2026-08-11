import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// M1 canonical table visual system.
//
// The contract this phase commits to is ONE VISUAL SYSTEM, not one rendering
// abstraction: a table is canonical when it wears `m1-table`, whether it is
// rendered by DataTable, by the presentational primitives, or by page JSX that
// was left exactly as it was. These tests protect that contract and the two
// properties that make broad migration safe — specificity instead of
// !important, and tokens instead of literals.

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const stripComments = (s) => s.replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, "$1").replace(/^\s*\/\/.*$/gm, "");

const jsx = read("src/shared/ui/M1UI.jsx");
const cssRaw = read("src/shared/ui/m1-table.css");
const css = stripComments(cssRaw);
const themes = read("src/theme/themes.js");

// ---- tokens ---------------------------------------------------------------

test("the table system hardcodes no colour", () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "raw hex belongs in themes.js");
  assert.doesNotMatch(css, /rgba?\([0-9]/, "raw rgb belongs in themes.js");
  assert.doesNotMatch(css, /\b(?:blue|sky|cyan|indigo|slate|zinc|gray)-[0-9]{2,3}\b/);
});

test("every table colour resolves to a semantic token", () => {
  for (const token of ["--table-head", "--table-hover", "--table-selected", "--border", "--text", "--muted", "--card"]) {
    assert.ok(css.includes(`var(${token})`), `table system does not use ${token}`);
  }
});

test("--table-head and --table-hover ARE defined — the old audit note was stale", () => {
  // Recorded historically as "may be undefined". Both themes define them.
  assert.equal((themes.match(/"table-head":/g) ?? []).length, 2);
  assert.equal((themes.match(/"table-hover":/g) ?? []).length, 2);
});

test("--table-selected is the one genuinely new table token, in both themes", () => {
  assert.equal((themes.match(/"table-selected":/g) ?? []).length, 2, "light and dark both need it");
});

// ---- no !important --------------------------------------------------------

test("the canonical table system introduces zero !important", () => {
  assert.equal((css.match(/!important/g) ?? []).length, 0);
});

test("empty and loading beat the generic cell rule on SPECIFICITY, not !important", () => {
  // `.m1-table > tbody > tr > td` sets the cell padding. The empty/loading cell
  // has to override it; the old code reached for !important three times. The
  // canonical rule qualifies the same selector with the class instead.
  assert.match(css, /\.m1-table > tbody > tr > td\.m1-table__empty/);
  assert.match(css, /\.m1-table > tbody > tr > td\.m1-table__loading/);
});

test("cell padding outranks a Tailwind utility so tables migrate without stripping classes", () => {
  // (0,1,3) vs a utility's (0,1,0). This is what lets an existing table become
  // canonical by gaining one class, with its legacy utilities left in place.
  assert.match(css, /\.m1-table > tbody > tr > td \{[^}]*padding-inline: var\(--m1-table-cell-pi\)/);
  assert.match(css, /\.m1-table > thead > tr > th \{[^}]*padding-inline: var\(--m1-table-cell-pi\)/);
});

test("per-column alignment stays overridable by the call site", () => {
  // text-align is a content decision, so it sits in a :where() layer at (0,0,x)
  // and any utility still wins.
  assert.match(css, /:where\(\.m1-table\)[^{]*\{\s*text-align: start;/s);
});

// ---- density --------------------------------------------------------------

test("density is a two-step contract driven by custom properties", () => {
  assert.match(css, /\.m1-table \{[^}]*--m1-table-font: 13px/s, "comfortable is the base");
  assert.match(css, /\.m1-table--compact \{[^}]*--m1-table-font: 12px/s);
  for (const prop of ["--m1-table-cell-pb", "--m1-table-cell-pi", "--m1-table-head-pb", "--m1-table-row-min"]) {
    assert.ok(css.includes(`${prop}:`), `density variable ${prop} missing`);
  }
});

test("no rule hardcodes a cell padding — pages cannot invent their own row height", () => {
  const cellRules = css.match(/\.m1-table[^{]*\{[^}]*padding-(?:block|inline):[^;]+;/g) ?? [];
  for (const rule of cellRules) {
    const padding = rule.match(/padding-(?:block|inline): ([^;]+);/g) ?? [];
    for (const value of padding) {
      assert.ok(
        /var\(--m1-table-|var\(--space|28px|16px/.test(value),
        `padding should come from the density scale: ${value}`,
      );
    }
  }
});

test("an empty state does not tower over the compact rows it replaces", () => {
  assert.match(css, /\.m1-table--compact > tbody > tr > td\.m1-table__empty[^{]*\{[^}]*padding-block: 16px/s);
});

// ---- RTL ------------------------------------------------------------------

test("the table system is RTL by construction — logical properties only", () => {
  for (const physical of ["padding-left", "padding-right", "margin-left", "margin-right", "border-left:", "border-right:", "text-align: left", "text-align: right"]) {
    assert.ok(!css.includes(physical), `use a logical property instead of ${physical}`);
  }
  assert.ok(css.includes("text-align: start"));
  assert.ok(css.includes("inset-block-start"));
});

test("numeric columns align to the end edge and are NOT mirrored per direction", () => {
  // An Arabic ledger still wants its digit columns lined up with the totals
  // beneath them, so there is exactly one rule and no [dir] variant.
  assert.match(css, /\.m1-table__cell--numeric \{[^}]*text-align: end/s);
  assert.match(css, /\.m1-table__cell--numeric \{[^}]*font-variant-numeric: tabular-nums/s);
  assert.doesNotMatch(css, /\[dir=["']?(?:rtl|ltr)["']?\][^{]*m1-table__cell--numeric/);
});

// ---- primitives -----------------------------------------------------------

test("the presentational primitives exist and are exported", () => {
  for (const name of ["TableContainer", "Table", "TableHead", "TableBody", "TableFoot", "TableRow", "TableHeaderCell", "TableCell", "TableActions", "DataTable"]) {
    assert.match(jsx, new RegExp(`export function ${name}\\b`), `${name} is not exported`);
  }
});

test("the primitives render native table elements — no div-based grid", () => {
  assert.match(jsx, /export function Table\(\{[\s\S]{0,600}?<table className=/);
  assert.match(jsx, /export function TableRow\(\{[\s\S]{0,400}?<tr /);
  assert.match(jsx, /export function TableCell\(\{[\s\S]{0,500}?<td /);
  assert.match(jsx, /export function TableHeaderCell\(\{[\s\S]{0,400}?<th scope="col"/);
});

test("Table exposes the density contract and defaults to comfortable", () => {
  assert.match(jsx, /export function Table\(\{ density = "comfortable"/);
  assert.match(jsx, /density === "compact" \? "m1-table--compact" : null/);
});

test("horizontal overflow is owned by the container, in one place", () => {
  assert.match(css, /\.m1-table-container \{[^}]*overflow-x: auto/s);
  // and the table itself is not forced wide by default
  assert.doesNotMatch(css, /^\.m1-table \{[^}]*min-width/ms);
  assert.match(css, /\.m1-table--wide \{\s*min-width: 720px/);
});

test("selection is driven by data-selected so call sites need no class plumbing", () => {
  assert.match(jsx, /data-selected=\{selected \? "true" : undefined\}/);
  assert.match(css, /\.m1-table > tbody > tr\[data-selected="true"\]/);
});

test("row click makes rows keyboard reachable, not just clickable", () => {
  assert.match(jsx, /tabIndex=\{onRowClick \? 0 : undefined\}/);
  assert.match(jsx, /event\.key === "Enter"/);
  assert.match(css, /\.m1-table--interactive > tbody > tr:focus-visible/);
});

// ---- DataTable backwards compatibility ------------------------------------

test("DataTable's new props are all optional — existing call sites are untouched", () => {
  const start = jsx.indexOf("export function DataTable({");
  const signature = jsx.slice(start, jsx.indexOf("}", jsx.indexOf("loadingLabel")));
  for (const prop of ["density", "loading", "sticky", "wide", "className", "emptyLabel", "loadingLabel"]) {
    assert.match(signature, new RegExp(`${prop} =`), `${prop} must have a default`);
  }
  // selectedKey / isRowSelected / onRowClick are intentionally undefined-by-default
  for (const prop of ["selectedKey", "isRowSelected", "onRowClick"]) {
    assert.ok(signature.includes(prop), `${prop} missing`);
  }
});

test("DataTable renders loading, empty and rows as three distinct states", () => {
  const body = jsx.slice(jsx.indexOf("export function DataTable({"));
  assert.match(body, /loading \? \(/);
  assert.match(body, /className="m1-table__loading"/);
  assert.match(body, /className="m1-table__empty"/);
  assert.match(body, /colSpan=\{columns\.length\}/);
});

test("DataTable tolerates a missing rows array", () => {
  assert.match(jsx, /const list = rows \?\? \[\];/);
});

test("the legacy .m1-table rules were removed from m1-ui.css, not duplicated", () => {
  const uiCss = read("src/shared/ui/m1-ui.css");
  assert.doesNotMatch(uiCss, /\.m1-table\{/, "two competing table stylesheets is the bug this phase removes");
  assert.doesNotMatch(uiCss, /\.m1-table-wrap\{/);
  assert.match(jsx, /import "\.\/m1-table\.css";/);
});
