/* ============================================================================
   ROOT THEME SIGNALS — one owner, so no browser repaints the page for us
   ----------------------------------------------------------------------------
   Four signals live on <html>/<body> and every one of them was written by two
   racing effects: the root `color-scheme`, the theme-color meta, the Tailwind
   `dark` class and `data-theme`. This module is the only writer for all four.
   ----------------------------------------------------------------------------
   Chrome on Android ("Settings › Theme › Darken websites"), Samsung Internet's
   dark mode, and the Facebook/Instagram in-app browsers built on them will
   RE-COLOUR any page they judge to have no dark theme of its own. They make
   that judgement from two signals and nothing else: the root `color-scheme`
   and <meta name="color-scheme">.

   Two facts make this a real defect rather than a theoretical one:

   1. A bare `color-scheme: light` is NOT an opt-out. Only the `only` keyword
      is — `color-scheme: only light`. So every visitor sitting in the light
      theme on a phone whose browser has that setting on got an algorithmically
      inverted page: backgrounds flipped, but gradients, images and inline SVG
      left alone, which is what "the light theme is broken on every other
      phone" actually was.

   2. Two writers raced for that one property. ThemeProvider is the OUTERMOST
      provider in main.jsx, so React flushes its effect AFTER the storefront's
      (children first) and overwrote the storefront's value on every run —
      including the extra run when the tenant appearance arrives. Measured live
      on m1store-egy.com: a black storefront reporting `color-scheme: light`
      with `theme-color: #eae7e0`. So even the DARK theme was flagged as a light
      page and darkened a second time, which is why its text washed out too.

   The `dark` class is the same race with a different victim. ThemeProvider
   toggles it from the ERP workspace theme and the storefront toggled it from
   the shop theme, so whoever ran last decided it. On a phone whose ERP theme
   is dark, a LIGHT storefront kept the class: the footer painted its cream
   band (that comes from `.storefront-shell:not(.storefront-dark)`) while every
   `dark:text-white/50` inside it fired — white text on cream, invisible until
   the visitor toggled the theme and the storefront's effect ran last again.

   So the storefront now says what it actually needs: `darkClass: false` in
   BOTH of its themes. Its dark theme is the `.storefront-dark` shell class and
   the hand-written rules in src/index.css, never Tailwind's `dark` variant —
   that is already how a normal visitor's page renders, this only makes it
   deterministic. Do not flip it to `true` as a side effect of another task:
   ~311 `dark:` utilities under src/storefront/ would wake up at once.

   This module is the only writer for all four signals. The storefront takes
   precedence while its shell is mounted; the ERP app supplies the value
   everywhere else. Keep it that way — a direct
   `document.documentElement.style.colorScheme = …`, a `classList.toggle("dark")`
   or a `dataset.theme =` anywhere else re-opens the race, and
   tests/browser-force-dark-optout.test.js fails if one appears.
   ========================================================================== */

const ONLY_LIGHT = "only light";
const ONLY_DARK = "only dark";

let appScheme = null;
let storefrontScheme = null;

const normalizeMode = (mode) => (String(mode || "").trim().toLowerCase() === "dark" ? "dark" : "light");

export const rootColorSchemeFor = (mode) => (normalizeMode(mode) === "dark" ? ONLY_DARK : ONLY_LIGHT);

// The document nodes are written defensively: this module is imported by
// source-level tests that stub `document` with the minimum they need.
const applyThemeClasses = (active) => {
  const root = document.documentElement;
  const body = document.body;
  const dark = active.darkClass && active.mode === "dark";
  const name = active.name || active.mode;

  root?.classList?.toggle?.("dark", dark);
  body?.classList?.toggle?.("dark", dark);
  if (root?.dataset) root.dataset.theme = name;
  if (body?.dataset) body.dataset.theme = name;
};

const flush = () => {
  if (typeof document === "undefined") return;

  const active = storefrontScheme || appScheme;
  if (!active) return;

  document.documentElement.style.colorScheme = rootColorSchemeFor(active.mode);
  applyThemeClasses(active);

  // The browser toolbar sits against the very top of the page, so it has to
  // track whoever is painting it. The storefront's header is deliberately dark
  // in BOTH of its themes, which is why it does not simply pass its canvas.
  if (!active.themeColor) return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", active.themeColor);
};

export const setAppColorScheme = (mode, themeColor = "", name = "") => {
  appScheme = { mode: normalizeMode(mode), themeColor, name, darkClass: true };
  flush();
};

export const setStorefrontColorScheme = (mode, themeColor = "", name = "") => {
  // `darkClass: false` in both themes — see the header. The storefront's dark
  // theme is `.storefront-dark`, not Tailwind's `dark` variant.
  storefrontScheme = { mode: normalizeMode(mode), themeColor, name, darkClass: false };
  flush();
};

export const releaseStorefrontColorScheme = () => {
  storefrontScheme = null;
  flush();
};
