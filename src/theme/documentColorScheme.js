/* ============================================================================
   ROOT COLOUR-SCHEME SIGNAL — one owner, so no browser repaints the page for us
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

   This module is the only writer for both signals. The storefront takes
   precedence while its shell is mounted; the ERP app supplies the value
   everywhere else. Keep it that way — a direct
   `document.documentElement.style.colorScheme = …` anywhere else re-opens the
   race, and tests/storefront-color-scheme.test.js fails if one appears.
   ========================================================================== */

const ONLY_LIGHT = "only light";
const ONLY_DARK = "only dark";

let appScheme = null;
let storefrontScheme = null;

const normalizeMode = (mode) => (String(mode || "").trim().toLowerCase() === "dark" ? "dark" : "light");

export const rootColorSchemeFor = (mode) => (normalizeMode(mode) === "dark" ? ONLY_DARK : ONLY_LIGHT);

const flush = () => {
  if (typeof document === "undefined") return;

  const active = storefrontScheme || appScheme;
  if (!active) return;

  document.documentElement.style.colorScheme = rootColorSchemeFor(active.mode);

  // The browser toolbar sits against the very top of the page, so it has to
  // track whoever is painting it. The storefront's header is deliberately dark
  // in BOTH of its themes, which is why it does not simply pass its canvas.
  if (!active.themeColor) return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", active.themeColor);
};

export const setAppColorScheme = (mode, themeColor = "") => {
  appScheme = { mode: normalizeMode(mode), themeColor };
  flush();
};

export const setStorefrontColorScheme = (mode, themeColor = "") => {
  storefrontScheme = { mode: normalizeMode(mode), themeColor };
  flush();
};

export const releaseStorefrontColorScheme = () => {
  storefrontScheme = null;
  flush();
};
