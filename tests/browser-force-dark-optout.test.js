// Guards for the signals that stop a mobile browser repainting the app itself.
//
// Chrome on Android ("Darken websites"), Samsung Internet's dark mode and the
// in-app browsers built on them re-colour any page they judge to have no dark
// theme of its own. They read exactly two things: <meta name="color-scheme">
// and the root `color-scheme`. A bare `light` is NOT an opt-out — only the
// `only` keyword is — so the light theme was being inverted by the browser on
// every phone with that setting on, and the storefront's dark theme was
// darkened a second time because a race left the root reporting `light` while
// the page painted black.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const OWNER = "src/theme/documentColorScheme.js";

const makeDocument = () => {
  const meta = {
    content: "",
    setAttribute(name, value) {
      if (name === "content") this.content = value;
    },
  };
  // Enough of an element for the owner to write all four signals on.
  const makeElement = () => {
    const classes = new Set();
    return {
      style: { colorScheme: "" },
      dataset: {},
      classList: {
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name),
      },
    };
  };
  return {
    documentElement: makeElement(),
    body: makeElement(),
    querySelector: (selector) => (selector === 'meta[name="theme-color"]' ? meta : null),
    themeColorMeta: meta,
  };
};

// A fresh module instance per test: the owner keeps module-level state on
// purpose, so tests must not inherit each other's.
let instance = 0;
const loadOwner = async () => {
  instance += 1;
  return import(`../src/theme/documentColorScheme.js?case=${instance}`);
};

test("index.html declares dark support before any script runs", () => {
  const html = read("index.html");
  const meta = html.match(/<meta\s+name="color-scheme"\s+content="([^"]+)"\s*\/?>/);
  assert.ok(meta, "index.html must carry <meta name=\"color-scheme\">");
  assert.match(meta[1], /\bdark\b/, "the meta must advertise dark support");

  // It has to be in the document, not injected by the app: the browser decides
  // whether to force-dark the page once, at load.
  const headEnd = html.indexOf("</head>");
  assert.ok(headEnd > 0 && html.indexOf(meta[0]) < headEnd, "the meta must be inside <head>");
});

test("the anti-FOUC seed writes the `only` form, which is the real opt-out", () => {
  const html = read("index.html");
  const assignment = html.match(/root\.style\.colorScheme\s*=\s*([^;]+);/);
  assert.ok(assignment, "the seed script must still set the root colour-scheme");
  assert.match(assignment[1], /only dark/, "dark must be declared as `only dark`");
  assert.match(assignment[1], /only light/, "light must be declared as `only light`");
});

test("index.html keeps a dark canvas fallback for when the seed script cannot run", () => {
  const html = read("index.html");
  assert.match(
    html,
    /@media \(prefers-color-scheme: dark\)/,
    "a phone in dark mode must not get a white flash when the seed script throws"
  );
});

test("rootColorSchemeFor never returns a bare scheme keyword", async () => {
  const { rootColorSchemeFor } = await loadOwner();
  assert.equal(rootColorSchemeFor("dark"), "only dark");
  assert.equal(rootColorSchemeFor("light"), "only light");
  assert.equal(rootColorSchemeFor("system"), "only light", "an unknown mode falls back to light");
  assert.equal(rootColorSchemeFor(undefined), "only light");
});

test("the storefront outranks the ERP theme while its shell is mounted", async () => {
  const doc = makeDocument();
  globalThis.document = doc;
  const { setAppColorScheme, setStorefrontColorScheme, releaseStorefrontColorScheme } = await loadOwner();

  setStorefrontColorScheme("dark", "#050505");
  assert.equal(doc.documentElement.style.colorScheme, "only dark");
  assert.equal(doc.themeColorMeta.content, "#050505");

  // ThemeProvider is the outermost provider, so React flushes this AFTER the
  // storefront's effect — and it used to win. It must not.
  setAppColorScheme("light", "#eae7e0");
  assert.equal(
    doc.documentElement.style.colorScheme,
    "only dark",
    "the ERP theme must not relabel a black storefront as a light page"
  );
  assert.equal(doc.themeColorMeta.content, "#050505");

  // Leaving the storefront hands both signals back.
  releaseStorefrontColorScheme();
  assert.equal(doc.documentElement.style.colorScheme, "only light");
  assert.equal(doc.themeColorMeta.content, "#eae7e0");

  delete globalThis.document;
});

test("a light shop never wears the ERP's dark class", async () => {
  const doc = makeDocument();
  globalThis.document = doc;
  const { setAppColorScheme, setStorefrontColorScheme, releaseStorefrontColorScheme } = await loadOwner();

  // The owner's workspace theme is dark, so the ERP page carries the class.
  setAppColorScheme("dark", "#131211", "dark");
  assert.equal(doc.documentElement.classList.contains("dark"), true);
  assert.equal(doc.body.classList.contains("dark"), true);
  assert.equal(doc.documentElement.dataset.theme, "dark");

  // Then the same phone opens the shop in its LIGHT theme. The footer's cream
  // band comes from `.storefront-shell:not(.storefront-dark)`; if the `dark`
  // class survived here, every `dark:text-white/50` inside it would fire and
  // the text would be white on cream.
  setStorefrontColorScheme("light", "#111111");
  assert.equal(doc.documentElement.classList.contains("dark"), false);
  assert.equal(doc.body.classList.contains("dark"), false);
  assert.equal(doc.documentElement.dataset.theme, "light");
  assert.equal(doc.body.dataset.theme, "light");

  // ThemeProvider re-runs when the tenant appearance profile arrives — after
  // the shop has mounted. That re-run is exactly what used to win.
  setAppColorScheme("dark", "#131211", "dark");
  assert.equal(doc.documentElement.classList.contains("dark"), false, "the ERP theme must not re-dress a light shop page");
  assert.equal(doc.documentElement.dataset.theme, "light");

  // Leaving the shop hands the workspace theme back.
  releaseStorefrontColorScheme();
  assert.equal(doc.documentElement.classList.contains("dark"), true);
  assert.equal(doc.body.classList.contains("dark"), true);
  assert.equal(doc.documentElement.dataset.theme, "dark");

  delete globalThis.document;
});

test("the shop's dark theme rides its own shell class, not the Tailwind variant", async () => {
  const doc = makeDocument();
  globalThis.document = doc;
  const { setStorefrontColorScheme } = await loadOwner();

  setStorefrontColorScheme("dark", "#050505");
  assert.equal(doc.documentElement.style.colorScheme, "only dark");
  assert.equal(doc.documentElement.dataset.theme, "dark");
  // `.storefront-dark` (written by the shop itself) plus the hand-written rules
  // in src/index.css are the shop's dark theme. Turning the class on here would
  // wake ~311 dormant `dark:` utilities across the storefront at once.
  assert.equal(doc.documentElement.classList.contains("dark"), false);
  assert.equal(doc.body.classList.contains("dark"), false);

  delete globalThis.document;
});

test("nothing outside the owner toggles the document `dark` class", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|jsx)$/.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (rel === OWNER) continue;
      const source = fs.readFileSync(full, "utf8");
      if (/(documentElement|document\.body|\broot|\bbody)\.classList\.toggle\(\s*["'`]dark["'`]/.test(source)) {
        offenders.push(rel);
      }
    }
  };
  walk(path.join(root, "src"));
  assert.deepEqual(offenders, [], `these files re-open the dark-class race; route them through ${OWNER}`);
});

test("the storefront light theme still reports a dark toolbar colour", () => {
  const source = read("src/storefront/Storefront.jsx");
  const call = source.match(/setStorefrontColorScheme\(([^)]*)\)/);
  assert.ok(call, "Storefront must publish its theme through the owner module");
  // The storefront header is deliberately dark in both themes, so handing over
  // the cream light canvas would paint the browser toolbar cream over black.
  assert.doesNotMatch(call[1], /#f3f3f1|#eae7e0|#ffffff/i, "light must not hand over its page canvas");
});

test("nothing outside the owner writes the root colour-scheme", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|jsx)$/.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (rel === OWNER) continue;
      if (/(^|\W)(documentElement|root|html)\.style\.colorScheme\s*=/.test(fs.readFileSync(full, "utf8"))) {
        offenders.push(rel);
      }
    }
  };
  walk(path.join(root, "src"));
  assert.deepEqual(offenders, [], `these files re-open the colour-scheme race; route them through ${OWNER}`);
});

test("ThemeProvider and Storefront both go through the owner", () => {
  assert.match(read("src/theme/ThemeProvider.jsx"), /from "\.\/documentColorScheme"/);
  assert.match(read("src/storefront/Storefront.jsx"), /from "\.\.\/theme\/documentColorScheme"/);
});
