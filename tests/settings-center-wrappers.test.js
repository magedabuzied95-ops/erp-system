import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Phase 2B-1a — SettingsCenter wrapper migration.
//
// These are COMPATIBILITY tests. The four wrappers now render M1UI primitives
// internally, but their external contracts must be byte-for-byte what callers
// already rely on. The highest-value assertion here is the callback ARGUMENT
// SHAPE: M1UI emits DOM events while these wrappers have always emitted a
// boolean (TogglePill) or a string (PremiumInput / TesterInput). Flipping either
// direction would break settings silently — build, lint and the rest of the
// suite would all still pass.

const src = fs.readFileSync(new URL("../src/modules/settings/pages/SettingsCenter.jsx", import.meta.url), "utf8");

const wrapper = (name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `wrapper ${name} not found`);
  const body = src.slice(start, start + 1200);
  const end = body.indexOf("\nfunction ");
  return end > -1 ? body.slice(0, end) : body;
};

// ---- TogglePill: boolean contract ---------------------------------------

test("TogglePill still calls onChange with a BOOLEAN, not a DOM event", () => {
  const s = wrapper("TogglePill");
  assert.match(s, /onChange=\{\(event\) => onChange\(event\.target\.checked\)\}/);
  // the caller must never receive the raw event
  assert.doesNotMatch(s, /onChange=\{onChange\}/, "passing the handler straight through would leak the event");
});

test("TogglePill stays controlled via `checked` and keeps its public props", () => {
  const s = wrapper("TogglePill");
  assert.match(s, /function TogglePill\(\{ label, checked, onChange, compact = false \}\)/);
  assert.match(s, /checked=\{checked\}/);
  assert.doesNotMatch(s, /useState/, "must not gain internal state");
  assert.doesNotMatch(s, /defaultChecked/, "must not become uncontrolled");
});

test("TogglePill renders the canonical Switch", () => {
  assert.match(wrapper("TogglePill"), /<Switch /);
});

// ---- PremiumInput: string contract --------------------------------------

test("PremiumInput still calls onChange with a STRING", () => {
  const s = wrapper("PremiumInput");
  assert.match(s, /onChange=\{\(event\) => onChange\(event\.target\.value\)\}/);
  assert.doesNotMatch(s, /onChange=\{onChange\}/);
});

test("PremiumInput keeps its public props and renders canonical Input", () => {
  const s = wrapper("PremiumInput");
  assert.match(s, /function PremiumInput\(\{ label, value, onChange \}\)/);
  assert.match(s, /<Input /);
  assert.match(s, /value=\{value\}/);
});

test("PremiumInput no longer carries legacy sky/blue focus styling", () => {
  const s = wrapper("PremiumInput");
  assert.doesNotMatch(s, /(?:focus:)?(?:border|ring)-(?:sky|blue)-[0-9]{2,3}/);
});

// ---- TesterInput: string contract + datalist -----------------------------

test("TesterInput still calls onChange with a STRING", () => {
  assert.match(wrapper("TesterInput"), /onChange=\{\(event\) => onChange\(event\.target\.value\)\}/);
});

test("TesterInput keeps its datalist autocomplete — the reason it is not PremiumInput", () => {
  const s = wrapper("TesterInput");
  assert.match(s, /<datalist id=\{listId\}>/);
  assert.match(s, /list=\{listId\}/, "the input must stay wired to the datalist");
  assert.match(s, /options\.map\(\(option\) => <option key=\{option\} value=\{option\} \/>\)/);
});

test("TesterInput and PremiumInput remain separate wrappers", () => {
  assert.ok(src.includes("function TesterInput("), "TesterInput must not be merged away");
  assert.ok(src.includes("function PremiumInput("), "PremiumInput must not be merged away");
});

// ---- SummaryTile ---------------------------------------------------------

test("SummaryTile keeps its public props and renders canonical MetricCard", () => {
  const s = wrapper("SummaryTile");
  assert.match(s, /function SummaryTile\(\{ icon: Icon, label, value \}\)/);
  assert.match(s, /<MetricCard icon=\{Icon\} label=\{label\} value=\{value\} \/>/);
});

// ---- blast radius --------------------------------------------------------

test("the canonical primitives are imported from the shared kit", () => {
  assert.match(src, /import \{ Input, MetricCard, Switch \} from "\.\.\/\.\.\/\.\.\/shared\/ui";/);
});

test("behaviour-coupled settings components were not touched", () => {
  for (const name of [
    "BostaIntegrationPanel", "ShippingZonesEditor", "ShippingLocationsCatalog",
    "ShippingRuleTester", "ZonePolicyList", "ShippingQuickSetup",
    "StorefrontSettings", "SiteSettingsCard", "BrandingUploadField",
  ]) {
    assert.ok(src.includes(`function ${name}(`), `${name} disappeared`);
  }
});

test("the tables stay frozen for Phase 3", () => {
  assert.ok(src.includes("function ZoneRuleTableRow("), "ZoneRuleTableRow must remain");
  assert.equal((src.match(/<table/g) || []).length, 3, "the 3 raw tables must be untouched");
  assert.doesNotMatch(src, /<DataTable/, "no DataTable adoption in this phase");
  assert.doesNotMatch(src, /<Pagination/, "no Pagination adoption in this phase");
});

// ---- Phase 2B-1b: presentational wrappers --------------------------------

test("LogoAvatar's fallback no longer uses legacy blue/violet", () => {
  const s = wrapper("LogoAvatar");
  assert.doesNotMatch(s, /(?:from|to|via)-(?:blue|violet|sky|cyan|indigo)-[0-9]{2,3}/);
  assert.match(s, /dark:from-primary dark:to-primary-hover/, "the fallback now resolves through the brand token");
  assert.match(s, /dark:text-primary-foreground/, "contrast pairs with the token, not a fixed white");
});

test("LogoAvatar keeps its image/fallback contract", () => {
  const s = wrapper("LogoAvatar");
  assert.match(s, /function LogoAvatar\(\{ src, name, size = "h-12 w-12" \}\)/);
  assert.match(s, /onError=\{\(\) => setFailed\(true\)\}/, "broken-image fallback must survive");
  assert.match(s, /alt=""/, "the logo stays decorative — the name is rendered alongside it");
  assert.match(s, /initialsFor\(name\)/);
});

test("carrier brand colours are preserved, not swept into semantic tones", () => {
  // Bosta/Mylerz/ShipBlu are third-party identities. `indigo` and `sky` here are
  // brand, not legacy debt, so a future colour sweep must not "fix" them.
  const meta = src.slice(src.indexOf("const providerMeta ="), src.indexOf("const zoneLabel ="));
  assert.match(meta, /bosta: \["border-rose-200/);
  assert.match(meta, /mylerz: \["border-indigo-200/);
  assert.match(meta, /shipblu: \["border-sky-200/);
});

test("ProviderBadge still maps provider -> presentation locally, and M1UI never learns providers", () => {
  const s = wrapper("ProviderBadge");
  assert.match(s, /function ProviderBadge\(\{ provider, active = false, onClick \}\)/);
  assert.match(s, /const meta = providerMeta\(provider\)/);
  // non-interactive renders a span, interactive renders a real button
  assert.match(s, /if \(!onClick\) return <span/);
  assert.match(s, /<button type="button" onClick=\{onClick\}/);
  const kit = fs.readFileSync(new URL("../src/shared/ui/M1UI.jsx", import.meta.url), "utf8");
  for (const p of ["bosta", "mylerz", "shipblu"]) {
    assert.ok(!kit.includes(p), `M1UI must not know the provider "${p}"`);
  }
});

test("VisualSection and TesterMetric keep their contracts (deliberately not migrated)", () => {
  assert.match(wrapper("VisualSection"), /function VisualSection\(\{ icon: Icon, title, description, children \}\)/);
  assert.match(wrapper("VisualSection"), /\{children\}/);
  assert.match(wrapper("TesterMetric"), /function TesterMetric\(\{ label, value \}\)/);
});
