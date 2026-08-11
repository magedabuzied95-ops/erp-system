import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Phase 2A — canonical primitive contracts.
//
// These assert the CONTRACT (native elements, semantics, tokens, RTL), not CSS
// class minutiae, so they stay useful as the styling evolves. There is no DOM
// renderer in this repo's test setup, so behaviour is verified at the source
// contract level rather than by mounting.

const jsx = fs.readFileSync(new URL("../src/shared/ui/M1UI.jsx", import.meta.url), "utf8");
const cssRaw = fs.readFileSync(new URL("../src/shared/ui/m1-ui.css", import.meta.url), "utf8");
// strip comments: they mention !important and colour names by name
const css = cssRaw.replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), "");
const themes = fs.readFileSync(new URL("../src/theme/themes.js", import.meta.url), "utf8");

const section = (name) => {
  const start = jsx.indexOf(`function ${name}(`);
  assert.ok(start > -1, `primitive ${name} not found`);
  return jsx.slice(start, start + 1400);
};

// ---- token purity --------------------------------------------------------

test("no primitive hardcodes a colour — the kit must not know the brand is gold", () => {
  assert.doesNotMatch(css, /\b(?:bg|text|border|ring|from|to|via)-(?:blue|sky|cyan|indigo)-[0-9]{2,3}/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "raw hex belongs in themes.js, not in a primitive");
  assert.doesNotMatch(css, /rgba?\([0-9]/, "raw rgb belongs in themes.js, not in a primitive");
  assert.doesNotMatch(jsx, /\b(?:bg|text|border)-(?:blue|sky|cyan|indigo)-[0-9]{2,3}/);
});

test("the danger foreground is a token, not #fff", () => {
  assert.match(css, /\.m1-button--danger\{[^}]*color:var\(--danger-foreground\)/);
  assert.match(themes, /"danger-foreground": "#ffffff"/, "the literal lives in the token layer");
});

test("primitives add no new !important (the 3 table ones are frozen for Phase 3)", () => {
  assert.equal((css.match(/!important/g) || []).length, 3);
  const frozen = css.slice(css.indexOf(".m1-table__empty"), css.indexOf(".m1-table__empty") + 200);
  assert.equal((frozen.match(/!important/g) || []).length, 3, "all 3 remain inside the frozen table rule");
});

// ---- Button / IconButton -------------------------------------------------

test("Button: native button, forwardRef, type defaults to button", () => {
  const s = section("Button");
  assert.match(jsx, /export const Button = forwardRef\(/);
  assert.match(s, /type = "button"/, "must not default to submit and surprise forms");
  assert.match(s, /<button\s+ref=\{ref\}/);
});

test("Button: loading disables interaction and announces busy", () => {
  const s = section("Button");
  assert.match(s, /disabled=\{disabled \|\| loading\}/);
  assert.match(s, /aria-busy=\{loading \|\| undefined\}/);
});

test("Button: supports leading and trailing icons", () => {
  const s = section("Button");
  assert.match(s, /icon: Icon/);
  assert.match(s, /iconAfter: IconAfter/);
});

test("Button: all five approved variants have styling", () => {
  for (const v of ["primary", "secondary", "outline", "ghost", "danger"]) {
    const styled = css.includes(`.m1-button--${v}`) || v === "secondary"; // secondary is the base style
    assert.ok(styled, `variant ${v} has no styling`);
  }
  for (const s of ["sm", "lg"]) assert.ok(css.includes(`.m1-button--${s}`), `size ${s} missing`);
});

test("IconButton: requires an accessible name and warns in dev when missing", () => {
  const s = section("IconButton");
  assert.match(s, /aria-label=\{label\}/);
  assert.match(s, /console\.warn\("\[M1UI\] IconButton requires a `label`/);
  assert.match(s, /import\.meta\.env\?\.DEV/, "the warning must not ship to production");
});

// ---- form controls -------------------------------------------------------

test("Input: native input, forwardRef, spreads native props", () => {
  const s = section("Input");
  assert.match(jsx, /export const Input = forwardRef\(/);
  assert.match(s, /<input ref=\{ref\}/);
  assert.match(s, /\{\.\.\.props\}/);
});

test("Input: invalid state is exposed to assistive tech and help text is associated", () => {
  assert.match(jsx, /"aria-invalid": invalid \|\| Boolean\(error\) \|\| undefined/);
  assert.match(jsx, /"aria-describedby": helpId/);
  assert.match(jsx, /htmlFor=\{controlId\}/);
});

test("Textarea is a real textarea, not a retagged Input", () => {
  const s = section("Textarea");
  assert.match(s, /<textarea ref=\{ref\}/);
  assert.match(s, /rows = 4/);
  assert.match(css, /\.m1-textarea\{[^}]*resize:vertical/);
});

test("Select uses the native element — no custom dropdown engine", () => {
  const s = section("Select");
  assert.match(s, /<select ref=\{ref\}/);
  assert.doesNotMatch(s, /role="listbox"/);
});

test("Checkbox and Radio are native inputs with associated labels", () => {
  assert.match(section("Checkbox"), /type="checkbox"/);
  assert.match(section("Radio"), /type="radio"/);
  for (const name of ["Checkbox", "Radio"]) {
    assert.match(section(name), /htmlFor=\{controlId\}/, `${name} label is not associated`);
  }
});

test("Switch keeps native form semantics plus role=switch", () => {
  const s = section("Switch");
  assert.match(s, /type="checkbox"/, "must submit with forms");
  assert.match(s, /role="switch"/);
  assert.match(s, /htmlFor=\{controlId\}/);
});

test("SearchInput composes Input rather than restyling a second control", () => {
  const s = section("SearchInput");
  assert.match(s, /<Input/);
  assert.match(s, /type="search"/);
  assert.match(s, /clearLabel = "مسح البحث"/, "the clear action needs an accessible name");
});

// ---- overlays ------------------------------------------------------------

test("Modal: dialog semantics with a unique, associated title", () => {
  const s = section("Modal");
  assert.match(s, /role="dialog"/);
  assert.match(s, /aria-modal="true"/);
  assert.match(s, /aria-labelledby=\{titleId\}/);
  assert.match(jsx, /const titleId = useId\(\);/, "a hardcoded id breaks with two modals open");
});

test("Modal and Drawer close on Escape and on overlay click only", () => {
  assert.match(jsx, /const useEscapeToClose = \(open, onClose\) =>/);
  assert.match(jsx, /event\.key === "Escape"/);
  // clicking inside the panel must not close it
  assert.match(jsx, /event\.target === event\.currentTarget && onClose\?\.\(\)/);
});

test("Drawer uses logical placement so RTL is automatic", () => {
  const s = section("Drawer");
  assert.match(s, /placement = "end"/);
  assert.doesNotMatch(s, /placement = "right"/);
  assert.match(css, /\.m1-drawer--end\{margin-inline-start:auto\}/);
  assert.match(css, /\.m1-drawer--start\{margin-inline-end:auto/);
});

test("focus trapping is documented as deliberately not hand-rolled", () => {
  assert.match(jsx, /Focus trapping is deliberately NOT hand-rolled/);
});

// ---- tabs ----------------------------------------------------------------

test("Tabs: correct roles and selected state, and does not own state", () => {
  const s = section("Tabs");
  assert.match(s, /role="tablist"/);
  assert.match(s, /role="tab"/);
  assert.match(s, /aria-selected=\{selected\}/);
  assert.match(s, /onChange\?\.\(item\.value\)/, "state is the caller's — routed tabs must stay routed");
  assert.doesNotMatch(s, /useState/);
});

test("Tabs: roving tabindex keeps keyboard navigation sane", () => {
  assert.match(section("Tabs"), /tabIndex=\{selected \? 0 : -1\}/);
});

// ---- layout composition --------------------------------------------------

test("PageHeader, Toolbar and FilterBar wrap safely on narrow screens", () => {
  for (const rule of [".m1-page-header__row", ".m1-toolbar", ".m1-filter-bar"]) {
    const at = css.indexOf(rule);
    assert.ok(at > -1, `${rule} missing`);
    assert.match(css.slice(at, at + 200), /flex-wrap:wrap/, `${rule} does not wrap`);
  }
});

test("Badge is semantic only — no business status leaks into the kit", () => {
  for (const bad of ["paid", "cancelled", "pending", "refunded"]) {
    assert.ok(!jsx.includes(`"${bad}"`), `business status "${bad}" must be mapped by the page, not the primitive`);
  }
  assert.match(jsx, /export const Badge = StatusBadge;/);
});

// ---- RTL / backwards compatibility --------------------------------------

test("no physical direction properties in the new primitive CSS", () => {
  const phase2a = css.slice(css.indexOf("Phase 2A canonical primitives"));
  for (const bad of ["padding-left", "padding-right", "margin-left", "margin-right", "border-left:", "border-right:", "left:", "right:"]) {
    assert.ok(!phase2a.includes(bad), `use a logical property instead of ${bad}`);
  }
});

test("existing exports are preserved for backwards compatibility", () => {
  for (const name of ["Button", "Field", "Card", "StatusBadge", "MetricCard", "DataTable", "EmptyState", "Skeleton", "LoadingState", "Modal", "Pagination"]) {
    assert.match(jsx, new RegExp(`export (?:const|function) ${name}\\b`), `export ${name} was dropped`);
  }
});

test("DataTable and Pagination are untouched — frozen for Phase 3", () => {
  assert.match(jsx, /FROZEN FOR PHASE 3/);
  assert.match(jsx, /export function DataTable\(\{ columns, rows, rowKey = "id", emptyLabel = "لا توجد بيانات" \}\)/);
  assert.match(jsx, /export function Pagination\(\{ page = 1, pages = 1, onChange \}\)/);
});
