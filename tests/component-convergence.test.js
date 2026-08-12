import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Final Component Convergence.
//
// The phase converged ~1,500 legacy chrome colours onto the brand accent so the
// ERP, Manager Portal and Employee Portal stop reading as three products. These
// tests protect the two things that make a sweep like that safe: the boundary
// between CHROME and MEANING, and the rule that a paint-over shim may only be
// retired once nothing can still render its legacy hook.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
};

const allFiles = walk("src");
const LEGACY = /\b(?:bg|text|border|ring|from|to|via|shadow|divide|outline|fill|stroke)-(?:blue|cyan|sky|indigo)-\d{2,3}/;

// ---- the chrome / meaning boundary ---------------------------------------

test("chart series colours were never swept — they are data, not chrome", () => {
  // These express series colour as raw hex in props, which a class sweep cannot
  // reach. The test pins that, so a future sweep that DOES reach them fails here
  // rather than silently recolouring the analytics.
  for (const file of [
    "src/modules/analytics/components/AnalyticsCharts.jsx",
    "src/modules/marketing/pages/MarketingAttribution.jsx",
  ]) {
    assert.match(read(file), /(?:stroke|fill)="#[0-9a-fA-F]{3,8}"/, `${file} lost its explicit series colours`);
  }
});

test("the Dashboard KPI palette keeps all seven tones and their paired strokes", () => {
  // Each tone pairs an icon gradient with the sparkline stroke beneath it.
  // Converging sky/cyan/blue would collapse three of seven tile identities AND
  // desync each tile from its own chart line.
  const src = read("src/pages/Dashboard.jsx");
  const palette = src.slice(src.indexOf("const palette = {"), src.indexOf("}[tone]"));
  for (const tone of ["emerald", "sky", "violet", "amber", "rose", "cyan", "blue"]) {
    assert.match(palette, new RegExp(`${tone}: \\{ icon:`), `KPI tone ${tone} was flattened`);
    }
  assert.equal((palette.match(/stroke: "#/g) ?? []).length, 7, "every tone must keep its paired stroke");
});

test("carrier brand identity is still brand, not accent", () => {
  // Bosta / Mylerz / ShipBlu are third-party marks. indigo and sky here are
  // identity, not legacy debt.
  const meta = read("src/modules/settings/pages/SettingsCenter.jsx");
  assert.match(meta, /mylerz: \["border-indigo-200/);
  assert.match(meta, /shipblu: \["border-sky-200/);
});

test("domain palettes still say several things with several hues", () => {
  // A mechanical hue swap is right for chrome and wrong for an encoding. Each of
  // these maps several states onto several hues that an operator reads at a
  // glance; collapsing them onto one accent destroys information.
  const cases = [
    ["src/modules/shipping/pages/ShippingCenter.jsx", ["ready_to_ship", "shipment_created", "picked_up", "in_transit"]],
    ["src/modules/inventory/pages/StockMovements.jsx", ["RETURN_IN", "TRANSFER_IN", "OPENING_BALANCE"]],
    ["src/modules/orders/components/StatusBadge.jsx", ["Created", "Confirmed"]],
    ["src/modules/purchases/components/StatusBadge.jsx", ["Ordered", "Inbound"]],
  ];
  for (const [file, keys] of cases) {
    const src = read(file);
    const hues = new Set();
    for (const key of keys) {
      const line = src.split("\n").find((l) => new RegExp(`\\b${key}\\b\\s*:`).test(l));
      assert.ok(line, `${file} lost the ${key} state`);
      const hue = line.match(/(blue|cyan|sky|indigo|emerald|amber|rose|orange|violet|primary)/)?.[1];
      if (hue) hues.add(hue);
    }
    assert.ok(hues.size > 1, `${file} collapsed ${keys.join("/")} onto a single tone`);
  }
});

test("the attendance status map keeps three distinguishable groups", () => {
  const src = read("src/modules/attendance/components/AttendanceCenter.jsx");
  const map = src.slice(src.indexOf("const statusClass = {"), src.indexOf("};", src.indexOf("const statusClass = {")));
  assert.match(map, /on_leave: "border-primary/, "approved leave");
  assert.match(map, /weekly_off: "border-border/, "scheduled off is neutral");
  assert.match(map, /still_working: "border-info/, "an in-progress shift is info");
});

// ---- contrast -------------------------------------------------------------

test("no element ends up with the brand colour on the brand colour", () => {
  // `bg-sky-50 text-sky-700` was a tint plus dark text; swapping both to one
  // token renders gold on gold. --primary-soft (`primary-subtle`) is the tint.
  const offenders = [];
  for (const file of allFiles) {
    if (!/\.jsx?$/.test(file)) continue;
    const src = read(file);
    for (const match of src.match(/["'`][^"'`]*bg-primary(?![-/\w])[^"'`]*["'`]/g) ?? []) {
      if (/\btext-primary(?![-/\w])/.test(match)) offenders.push(`${file}: ${match.slice(0, 70)}`);
    }
  }
  assert.deepEqual(offenders, [], "brand-on-brand is invisible");
});

test("a solid brand fill uses the brand foreground, not white", () => {
  const offenders = [];
  for (const file of allFiles) {
    if (!/\.jsx?$/.test(file)) continue;
    for (const match of read(file).match(/["'`][^"'`]*\bbg-primary(?![-/\w])[^"'`]*["'`]/g) ?? []) {
      if (/\btext-white\b/.test(match)) offenders.push(`${file}: ${match.slice(0, 70)}`);
    }
  }
  assert.deepEqual(offenders, [], "white on gold is a contrast regression; use --primary-contrast");
});

// ---- shim retirement ------------------------------------------------------

test("paint-over shims may only be retired when NOTHING can render their hook", () => {
  // The scoped audit for this phase reported 56 apparently-dead rules. Every one
  // was a false positive: rules like `.manager-portal-shell [class*="bg-[#005c4b]"]`
  // are hooked to src/shared/chat components that render INSIDE that shell but
  // live outside its module. A per-module check cannot see that.
  //
  // So the retirement criterion is repo-wide absence of the hook, and this test
  // pins the specific trap for whoever tries next.
  const shared = ["src/shared/chat/PortalChatMessageList.jsx", "src/shared/notifications/NotificationBell.jsx"];
  for (const file of shared) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is the reason those rules are alive`);
  }
  assert.match(read("src/shared/chat/PortalChatMessageList.jsx"), /bg-\[#005c4b\]/);
});

test("the shims are still imported by the pages they govern", () => {
  for (const [page, shim] of [
    ["src/modules/managerPortal/pages/ManagerPortal.jsx", "./ManagerPortal.m1.css"],
    ["src/modules/settings/pages/SettingsCenter.jsx", "./SettingsCenter.m1.css"],
    // CreateProduct.m1.css was retired under the criterion above and replaced by
    // product-form.m1.css, which BOTH product-form routes import.
    ["src/modules/products/pages/CreateProduct.jsx", "./product-form.m1.css"],
    ["src/modules/products/pages/ProductEdit.jsx", "./product-form.m1.css"],
  ]) {
    assert.ok(read(page).includes(shim), `${page} stopped importing ${shim}`);
  }
});

test("the retired CreateProduct paint-over left no renderable hook behind", () => {
  // CreateProduct.m1.css was a translation layer keyed on the fixed-dark classes
  // the page was authored with. Both product-form routes now consume the
  // semantic tokens and the frozen radius contract directly, so the hooks are
  // gone rather than merely unstyled. Repo-wide absence is the criterion, per
  // the test above.
  assert.ok(
    !fs.existsSync(path.join(root, "src/modules/products/pages/CreateProduct.m1.css")),
    "the shim is back — re-verify its hooks before reintroducing it",
  );
  const forms = [
    read("src/modules/products/pages/CreateProduct.jsx"),
    read("src/modules/products/pages/ProductEdit.jsx"),
  ].join("\n");
  for (const hook of [
    "bg-white/", "bg-zinc-900", "bg-zinc-950", "text-zinc-", "from-emerald",
    "rounded-2xl", "rounded-[14px]", "rounded-[18px]", "rounded-[28px]",
  ]) {
    assert.ok(!forms.includes(hook), `${hook} came back — the retired shim used to repaint it`);
  }
  // Nothing else in the repo can render the old scoped hooks either.
  assert.deepEqual(allFiles.filter((f) => /\.(jsx?|css)$/.test(f) && read(f).includes("m1-create-")), []);
});

// ---- the ratchet ----------------------------------------------------------

test("the legacy-colour baseline shrank and still matches reality", () => {
  const baseline = read("tests/fixtures/legacy-color-baseline.txt")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  assert.ok(baseline.length <= 60, `baseline should be well under the original 172, got ${baseline.length}`);
  for (const file of baseline) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is listed but no longer exists`);
    assert.match(read(file), LEGACY, `${file} is clean and must leave the baseline`);
  }
});

test("the converged zones are actually clean", () => {
  // Manager and Employee JSX carry no legacy chrome at all now; what remains
  // there lives in the shims, which is a separate problem.
  const dirty = allFiles.filter(
    (f) => /\.jsx?$/.test(f) &&
      /modules\/(managerPortal|employees|attendance)\//.test(f) &&
      LEGACY.test(read(f)),
  );
  assert.deepEqual(dirty, [], "portal JSX should be free of legacy chrome");
});
