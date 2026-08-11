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

test("the kit uses no !important at all", () => {
  // Was 3, all inside `.m1-table__empty`, held while tables were frozen. The
  // canonical table system wins on specificity instead, so they are gone and the
  // kit is clean. Table rules now live in m1-table.css — see
  // tests/canonical-table.test.js.
  assert.equal((css.match(/!important/g) || []).length, 0);
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

test("the Phase 3 table freeze is lifted and DataTable kept its old call shape", () => {
  // The freeze marker is gone. DataTable gained density / loading / selection /
  // row-click, but every new prop is optional, so the pre-existing call sites in
  // FinancialReports and AiAgentAnalytics keep working untouched.
  assert.doesNotMatch(jsx, /FROZEN FOR PHASE 3/);
  assert.match(jsx, /export function DataTable\(\{/);
  assert.match(jsx, /\n {2}rowKey = "id",/);
  assert.match(jsx, /emptyLabel = "لا توجد بيانات",/);
});

test("Pagination is the recovered canonical control, not the two-arrow stub", () => {
  // This assertion previously pinned the OLD `({ page, pages, onChange })` stub,
  // which was correct while pagination sat outside the table phase. The
  // recovered canonical Pagination supersedes it; the contract below is strictly
  // larger, so this is a replacement rather than a relaxation.
  assert.match(jsx, /export function Pagination\(\{/);
  for (const prop of ["page = 1", "pages = 1", "total = 0", "pageSize = 10", "pageSizeOptions = DEFAULT_PAGE_SIZES", "onChange", "onPageSizeChange", "disabled = false", "labels = {}"]) {
    assert.ok(jsx.includes(prop), `Pagination lost \`${prop}\``);
  }
  // and it still owns no data fetching — page/pages/total come from the caller
  const body = jsx.slice(jsx.indexOf("export function Pagination({"));
  assert.doesNotMatch(body.slice(0, 3000), /useEffect|fetch\(|api\./, "Pagination must not own a query");
});

// ---- Phase 2A.1: composition capability ----------------------------------

test("StatusBadge and MetricCard accept className like every other primitive", () => {
  // Evidence: Checkbox, Radio, Switch, Card, PageHeader, Tabs, Skeleton (and
  // Button/Input/IconButton via native spread) all compose. These two were the
  // only outliers, which blocked real adoption in Manager Portal.
  assert.match(jsx, /export function StatusBadge\(\{ tone = "neutral", children, className = "" \}\)/);
  assert.ok(jsx.includes(String.raw`export function MetricCard({ label, value, change, icon: Icon, tone = "neutral", density = "comfortable", supporting, className = "" })`), "MetricCard must accept className");
});

test("caller classes APPEND — semantic tone stays owned by the kit", () => {
  // cx() puts the base and tone classes first, so a caller can add but cannot
  // silently replace the semantic colour.
  assert.match(jsx, /cx\("m1-status", `m1-status--\$\{tone\}`, className\)/);
  assert.ok(jsx.includes(String.raw`cx("m1-metric", densityClass, ` + "`m1-metric--${tone}`" + String.raw`, className)`), "metric classes must append");
});

test("className is optional — every existing consumer is unaffected", () => {
  assert.match(jsx, /className = ""/);
  // ComponentsPreview still calls StatusBadge/MetricCard without className
  const preview = fs.readFileSync(new URL("../src/pages/ComponentsPreview.jsx", import.meta.url), "utf8");
  assert.match(preview, /<StatusBadge tone="success">/);
  assert.match(preview, /<MetricCard tone="primary"/);
});

test("no portal- or page-specific concept leaked into the kit", () => {
  for (const term of ["manager", "MiniMetric", "CompactStat", "kpi-card-readable", "sub ="]) {
    assert.ok(!jsx.includes(term), `M1UI must not know about "${term}"`);
  }
});

// ---- Phase 2A.2: MetricCard density + supporting -------------------------

test("MetricCard defaults to comfortable — existing consumers are untouched", () => {
  assert.match(jsx, /density = "comfortable"/);
  assert.match(jsx, /const densityClass = density === "compact" \? "m1-metric--compact" : "m1-metric--comfortable"/);
  // the comfortable baseline must keep its original measurements
  assert.match(css, /\.m1-metric\{min-height:132px;padding:18px/);
});

test("compact is a real density step, not a token change", () => {
  assert.match(css, /\.m1-metric--compact\{min-height:96px;padding:12px\}/);
  for (const rule of ["\.m1-metric--compact \.m1-metric__top", "\.m1-metric--compact strong", "\.m1-metric--compact \.m1-metric__icon"]) {
    assert.match(css, new RegExp(rule), `compact must scale ${rule}`);
  }
  assert.match(jsx, /size=\{density === "compact" \? 16 : 19\}/, "the icon scales with density too");
});

test("density is explicit, not derived from the theme density class", () => {
  // Theme density governs control heights; tile density is a page layout choice.
  // Coupling them would make two systems fight.
  assert.doesNotMatch(css, /theme-density-compact[^}]*m1-metric/);
  assert.match(jsx, /NOT derived from the theme/);
});

test("supporting renders only when provided and stays business-agnostic", () => {
  assert.match(jsx, /\{supporting \? <div className="m1-metric__supporting">\{supporting\}<\/div> : null\}/);
  assert.match(css, /\.m1-metric__supporting\{[^}]*color:var\(--muted\)/);
  // must not colour by meaning
  assert.doesNotMatch(css, /\.m1-metric__supporting[^}]*var\(--success\)|\.m1-metric__supporting[^}]*var\(--danger\)/);
});

test("supporting does not replace `change` — both can coexist", () => {
  const mc = jsx.slice(jsx.indexOf("export function MetricCard"), jsx.indexOf("export function MetricCard") + 1200);
  assert.match(mc, /\{change \? <small>\{change\}<\/small> : null\}/, "change keeps its original treatment");
  assert.match(mc, /supporting \?/);
});

test("compact composes with supporting and className", () => {
  assert.match(css, /\.m1-metric--compact \.m1-metric__supporting/, "supporting scales inside compact");
  assert.match(jsx, /cx\("m1-metric", densityClass, `m1-metric--\$\{tone\}`, className\)/);
});

test("no domain naming or accent-border API leaked into MetricCard", () => {
  const mc = jsx.slice(jsx.indexOf("export function MetricCard"), jsx.indexOf("export function MetricCard") + 1200);
  for (const bad of ["sub =", "subtitle", "trend", "delta", "borderTone", "accent", "topBorder"]) {
    assert.ok(!mc.includes(bad), `MetricCard must not expose "${bad}"`);
  }
});
