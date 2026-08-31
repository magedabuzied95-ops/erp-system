// Guards for the build step that keeps the UI painted on pre-2023 mobile
// engines. Tailwind v4 targets Chrome 111+ / Safari 16.4+ and writes its
// palette in oklch(), its arbitrary-colour opacity modifiers in oklab(), and
// this repo writes its own washes in color-mix(). None of the three degrades on
// its own: the declaration is dropped and the element paints nothing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addLegacyColorFallbacks,
  auditLegacyColorCoverage,
  colorMixFallback,
  oklabToSrgb,
  oklchToSrgb,
  splitTopLevel,
} from "../scripts/legacy-color-fallbacks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

test("oklch converts to the exact sRGB hex Tailwind documents", () => {
  // Straight from Tailwind v4's palette: if these drift, the whole fallback
  // layer is quietly painting the wrong colours.
  assert.equal(oklchToSrgb(0.637, 0.237, 25.331), "#fb2c36", "red-500");
  assert.equal(oklchToSrgb(0.208, 0.042, 265.755), "#0f172b", "slate-900");
  assert.equal(oklchToSrgb(0.696, 0.17, 162.48), "#00bc7d", "emerald-500");
  assert.equal(oklchToSrgb(1, 0, 0), "#ffffff");
  assert.equal(oklchToSrgb(0, 0, 0), "#000000");
});

test("oklab round-trips the arbitrary colours Tailwind encodes", () => {
  // `border-[#7c3aed]/20` ships as oklab(54.1337% .0963843 -.226969 / .2).
  assert.equal(oklabToSrgb(0.541337, 0.0963843, -0.226969, 0.2), "rgba(124, 58, 237, 0.2)");
  assert.equal(oklabToSrgb(0.766528, -0.00256401, 0.138654, 0.18), "rgba(212, 175, 55, 0.18)");
  assert.equal(oklabToSrgb(0.708969, 0.063573, -0.145921), "#a78bfa");
});

test("a mix into transparent falls back to the full-strength colour", () => {
  // Resolving by share would pick `transparent` and paint nothing — which is
  // the exact failure this whole pass exists to prevent.
  assert.equal(colorMixFallback("in srgb, var(--primary) 20%, transparent", "border-color"), "var(--primary)");
  assert.equal(colorMixFallback("in oklab, currentcolor 15%, transparent", "box-shadow"), "currentcolor");
});

test("an accent wash used as a SURFACE degrades to the soft token, not solid accent", () => {
  // Full strength is right for a border or an underline — they must stay
  // visible and never sit behind text. Behind text it is a contrast trap: an
  // 8% primary glow becoming solid gold puts dark text on gold.
  assert.equal(colorMixFallback("in srgb, var(--primary) 8%, transparent", "background"), "var(--primary-soft, transparent)");
  assert.equal(colorMixFallback("in srgb, var(--danger) 10%, transparent", "background-color"), "var(--danger-soft, transparent)");
  assert.equal(colorMixFallback("in srgb, var(--primary) 10%, transparent", "background-image"), "var(--primary-soft, transparent)");
  // A token with no designed soft variant keeps the plain fallback.
  assert.equal(colorMixFallback("in srgb, var(--bg) 84%, transparent", "background-color"), "var(--bg)");
  assert.equal(colorMixFallback("in srgb, var(--muted) 16%, transparent", "background"), "var(--muted)");
});

test("a two-colour mix falls back to whichever colour dominates", () => {
  assert.equal(colorMixFallback("in srgb, var(--primary) 55%, var(--border)"), "var(--primary)");
  assert.equal(colorMixFallback("in srgb, var(--primary) 30%, var(--border)"), "var(--border)");
  assert.equal(colorMixFallback("in srgb, #fff, #000"), "#fff", "no percentage means an even split");
});

test("the tokenizer treats a CSS escape as an escape, not a string", () => {
  // Tailwind writes arbitrary values into the selector, so the stylesheet really
  // contains `.font-\[\'Cairo\'\]`. Reading those `\'` as quotes desynchronised
  // the brace stack for every rule after them — measured, not theoretical.
  const css = String.raw`.font-\[\'Cairo\'\,sans-serif\]{font-family:Cairo}.a{color:oklch(63.7% .237 25.331)}`;
  const out = addLegacyColorFallbacks(css);
  assert.match(out, /\.a\{color:#fb2c36;color:oklch/, "the rule after the escaped selector must still be reached");
  assert.equal(splitTopLevel(String.raw`a\,b, c`).length, 2, "an escaped comma is not a separator");
});

test("a real property gets a plain declaration in front of it, keeping !important", () => {
  const out = addLegacyColorFallbacks(".a{border-color:color-mix(in srgb, var(--primary) 20%, transparent)!important}");
  assert.equal(out, ".a{border-color:var(--primary)!important;border-color:color-mix(in srgb, var(--primary) 20%, transparent)!important}");
});

test("a custom property gets an @supports override, because a preceding one cannot win", () => {
  const out = addLegacyColorFallbacks("@layer base{:root{--chat-bg:color-mix(in srgb, var(--primary) 4%, var(--bg))}}");
  assert.match(out, /^@layer base\{:root\{--chat-bg:color-mix/, "the original stays first");
  assert.match(
    out,
    /@layer base\{@supports not \(color: color-mix\(in srgb, red 50%, blue\)\)\{:root\{--chat-bg:var\(--bg\)\}\}\}$/,
    "the fallback is appended inside the same layer, guarded by the complement"
  );
});

test("Tailwind's already-guarded rules are left alone unless they have no base", () => {
  // Tailwind emits an unguarded base next to its guard for a literal colour —
  // duplicating those would cost payload for nothing.
  const withBase =
    ".b{border-color:#0001}@supports (color:color-mix(in lab, red, red)){.b{border-color:color-mix(in oklab, #000 10%, transparent)}}";
  assert.equal(addLegacyColorFallbacks(withBase), withBase);

  // An opacity modifier on a TOKEN has no static base it could emit, so the
  // guarded declaration is the only one and the utility paints nothing.
  const withoutBase =
    "@layer utilities{@supports (color:color-mix(in lab, red, red)){.c{background-color:color-mix(in oklab, var(--card) 45%, transparent)}}}";
  const out = addLegacyColorFallbacks(withoutBase);
  assert.match(out, /@supports not \(color: color-mix[^{]*\)\{\.c\{background-color:var\(--card\)\}\}/);
  assert.ok(
    out.indexOf("@supports not") > out.indexOf("@supports (color:"),
    "the complement must sit outside Tailwind's positive guard, not inside it"
  );
});

test("var() inside a colour function is left untouched — it cannot be resolved at build time", () => {
  const css = ".a{color:oklch(from var(--x) l c h)}";
  assert.equal(addLegacyColorFallbacks(css), css);
});

test("the audit counts what would actually paint nothing", () => {
  const broken = ".a{color:oklch(63.7% .237 25.331)}";
  assert.equal(auditLegacyColorCoverage(broken).unrescued.length, 1);
  assert.equal(auditLegacyColorCoverage(addLegacyColorFallbacks(broken)).unrescued.length, 0);
});

test("the built stylesheets leave nothing unpainted on a pre-2023 engine", (t) => {
  const assets = path.join(root, "dist", "assets");
  if (!fs.existsSync(assets)) {
    t.skip("no dist/ — run `npm run build` first");
    return;
  }
  const sheets = fs.readdirSync(assets).filter((file) => file.endsWith(".css"));
  assert.ok(sheets.length > 0, "expected built stylesheets");

  const offenders = [];
  let rescued = 0;
  for (const sheet of sheets) {
    const css = fs.readFileSync(path.join(assets, sheet), "utf8");
    const audit = auditLegacyColorCoverage(css);
    rescued += audit.total;
    if (audit.unrescued.length) offenders.push(`${sheet}: ${audit.unrescued.length}`);
  }
  assert.deepEqual(offenders, [], "the build plugin must have rewritten these already");
  assert.ok(rescued > 0, "expected the bundle to actually use modern colour functions");
});
