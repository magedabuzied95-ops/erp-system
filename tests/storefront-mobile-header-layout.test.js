// The mobile storefront header: five slots on one line, modelled on the
// reference the shop owner picked (levelshoes.com) — menu and search on the
// start edge, wishlist and bag on the end edge, logo dead centre between them.
//
// This file used to assert the opposite arrangement (a cart icon in the row and
// NO search). That was the previous design, replaced deliberately; the
// assertions below are the current intent, not a relaxation of the old one.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storefrontSource = fs.readFileSync("src/storefront/Storefront.jsx", "utf8");
const stylesheet = fs.readFileSync("src/index.css", "utf8");

const start = storefrontSource.indexOf('<div className="sf-mobile-header-shell md:hidden"');
const end = storefrontSource.indexOf('<div className="sf-utility-row', start);
const mobileHeader = storefrontSource.slice(start, end);

test("the mobile header is one line with the logo centred between two clusters", () => {
  assert.ok(start >= 0 && end > start, "the mobile header block must be findable");
  assert.match(mobileHeader, /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(mobileHeader, /sf-header-logo mx-auto/);
  // 52px is the reference's row height, and the logo is sized to sit inside it
  // rather than push it open.
  assert.match(mobileHeader, /h-\[52px\]/);
});

test("menu and search hold the start edge, wishlist and bag the end edge", () => {
  const positions = ["Menu", "Search", "Heart", "ShoppingBag"].map((icon) => ({
    icon,
    at: mobileHeader.indexOf(`<${icon} `),
  }));
  for (const { icon, at } of positions) assert.ok(at > 0, `${icon} must be in the mobile header`);
  const order = positions.map((entry) => entry.at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "start-edge → end-edge order must not drift");
});

test("the icons are bare glyphs — no chip behind them", () => {
  assert.doesNotMatch(mobileHeader, /sf-mobile-header-button/, "the chip class belongs to the old header");
  assert.equal((mobileHeader.match(/sf-topbar-button/g) || []).length, 4, "exactly four actions");
});

test("the count badge sits on the icon's INNER corner, never against the screen edge", () => {
  // `.sf-mobile-cart-badge` is an !important rule inside @layer components that
  // pins the badge to `left`. On the outermost icon of a right-to-left header
  // that IS the edge of the display: the count crowds it and reads as a second,
  // half-cut icon — which is exactly how this was reported. Putting the class
  // back reinstates the bug, and no unlayered rule can override it.
  assert.doesNotMatch(mobileHeader, /sf-mobile-cart-badge/);

  const ruleStart = stylesheet.indexOf(".storefront-shell .sf-topbar-button .sf-action-badge");
  assert.ok(ruleStart > 0, "the topbar badge must own its own placement");
  const rule = stylesheet.slice(ruleStart, stylesheet.indexOf("}", ruleStart));
  assert.match(rule, /inset-inline-start/, "logical placement so it flips with the language");
  assert.doesNotMatch(rule, /left:\s*-/, "a negative left pushes it off the outer edge again");
});

test("the announcement line can set its own colour", () => {
  // `.sf-header-announcement span` is !important inside @layer components, and
  // an unlayered !important cannot outrank a layered one — so this line has to
  // stay something other than a span or it can never be white.
  // Stop at the desktop marquee, which is a separate block and legitimately
  // still made of spans.
  const soloStart = storefrontSource.indexOf("sf-announcement-solo relative");
  const announcement = storefrontSource.slice(
    soloStart,
    storefrontSource.indexOf('className="relative mx-auto hidden h-8', soloStart)
  );
  assert.ok(announcement.length > 0, "the mobile announcement block must be findable");
  assert.match(announcement, /<div\s/, "rendered as a div, not a span");
  assert.doesNotMatch(announcement, /<span[\s>]/);
});

// --- the menu panel -------------------------------------------------------

const menuPanel = (() => {
  const from = storefrontSource.indexOf("sf-mobile-menu-drawer sf-menu-panel");
  const to = storefrontSource.indexOf("mobilePortalTarget\n      ) : null}", from);
  return storefrontSource.slice(from, to > from ? to : from + 6000);
})();

test("the menu panel keeps both classes", () => {
  assert.ok(menuPanel.length > 0, "the panel must be findable");
  // `sf-mobile-menu-drawer` is what the light theme uses to strip the
  // hard-coded dark gradients off everything inside; dropping it turns the
  // lists into black blocks on a white panel. `sf-menu-panel` restyles only the
  // panel's own chrome.
  assert.match(menuPanel, /sf-mobile-menu-drawer sf-menu-panel/);
});

test("the panel is a rectangle — no rounded corner, border or shadow", () => {
  // These lived as utilities on the element, and a utility outranks the panel's
  // own rule, so flattening it from CSS alone silently does nothing.
  const sideClass = storefrontSource.slice(
    storefrontSource.indexOf("const mobileMenuSideClass"),
    storefrontSource.indexOf("const menuOpen")
  );
  assert.doesNotMatch(sideClass, /rounded-/);
  assert.doesNotMatch(sideClass, /shadow-\[/);
  assert.doesNotMatch(sideClass, /border-[lr]\b/);
});

test("language and theme sit above the account row", () => {
  // Matching the full class attribute, not a substring: `sf-menu-toolbar` is a
  // prefix of any renamed variant, so indexOf on the bare name still finds a
  // toolbar that no longer exists.
  const toolbar = menuPanel.indexOf('className="sf-menu-toolbar"');
  const account = menuPanel.indexOf('className="sf-menu-account"');
  const tabs = menuPanel.indexOf('className="sf-menu-tabs"');
  assert.ok(toolbar > 0 && account > toolbar, "the toolbar comes first");
  assert.ok(tabs > account, "the audience tabs come after the account row");
  const toolbarBlock = menuPanel.slice(toolbar, account);
  assert.match(toolbarBlock, /switchLanguage/);
  assert.match(toolbarBlock, /onThemeToggle/);
});

test("search is not inside the menu — it has its own sheet", () => {
  // The search field and its suggestion cards were removed from the drawer on
  // the owner's instruction. The header's search button must therefore open the
  // sheet directly instead of opening the menu to reach a field inside it.
  assert.doesNotMatch(menuPanel, /<PremiumSearch/);
  assert.doesNotMatch(storefrontSource, /drawerMode/, "the drawer search mode is gone for good");
  assert.match(storefrontSource, /sf-mobile-search-sheet/);

  const searchButton = storefrontSource.slice(
    storefrontSource.indexOf('aria-label={t("storefront.header.search")}') - 900,
    storefrontSource.indexOf('aria-label={t("storefront.header.search")}')
  );
  assert.doesNotMatch(searchButton, /setMobileMenuOpen\(true\)/, "the search icon must not open the menu");
});

test("the search sheet is portalled out of the header", () => {
  // The header carries `backdrop-blur`, and a backdrop-filter makes its box the
  // containing block for `position: fixed` descendants — so an inline sheet
  // covered the header strip only and left the page showing through.
  const sheet = storefrontSource.slice(
    storefrontSource.indexOf("Mobile search is its own full-screen sheet"),
    storefrontSource.indexOf("{menuOpen && mobilePortalTarget")
  );
  assert.match(sheet, /createPortal\(/);
  assert.match(sheet, /mobilePortalTarget/);
});

// --- the search empty state ----------------------------------------------

test("the search empty state is trending pills and a grid, not stacked menus", () => {
  const emptyState = storefrontSource.slice(
    storefrontSource.indexOf("The empty state follows the reference"),
    storefrontSource.indexOf("function SearchChips")
  );
  assert.ok(emptyState.length > 0, "the empty state must be findable");
  // Full class attributes, not bare names: each of these is a prefix of any
  // renamed variant, so a substring match still passes on markup that is gone.
  assert.match(emptyState, /className="sf-search-pill-row"/);
  assert.match(emptyState, /className="sf-search-grid"/);
  assert.match(emptyState, /sf-search-tab\$\{/);
  // The three stacked cards asked the shopper to read a menu before typing.
  assert.doesNotMatch(emptyState, /<SearchQuickCard/);
});

test("the inspiration grid is fetched lazily, not on every page", () => {
  const effect = storefrontSource.slice(
    storefrontSource.indexOf("The inspiration grid loads the first time"),
    storefrontSource.indexOf("const menuIsSignedIn")
  );
  assert.ok(effect.length > 0);
  // useProducts fires on mount, which would put a products request on every
  // page of the storefront for a panel most visitors never open.
  assert.doesNotMatch(effect, /useProducts\(/);
  // The guard itself, not just a mention of the ref — the ref is also assigned
  // inside the effect, so naming it proves nothing about the early return.
  assert.match(effect, /\|\| searchInspirationRequestedRef\.current\) return/, "it must bail once it has run");
  assert.match(effect, /mobileSearchOpen|searchOpen/, "and only once search is opened");
});

test("the language control is a glyph that still names its language", () => {
  const toolbarBlock = menuPanel.slice(
    menuPanel.indexOf('className="sf-menu-toolbar"'),
    menuPanel.indexOf('className="sf-menu-account"')
  );
  const languageButton = toolbarBlock.slice(toolbarBlock.indexOf("switchLanguage"));
  // An icon with no accessible name tells a screen reader nothing, and the
  // word it replaced was the only thing saying which language it switches to.
  assert.match(languageButton, /aria-label=\{languageLabel\}/);
  assert.match(languageButton, /<Languages\b/);
  assert.doesNotMatch(languageButton.slice(0, languageButton.indexOf("</button>")), /\{languageLabel\}\s*\n\s*<\/button>/);
});

test("the inspiration grid pages with offset and grows in place", () => {
  const effect = storefrontSource.slice(
    storefrontSource.indexOf("The inspiration grid loads the first time"),
    storefrontSource.indexOf("const menuIsSignedIn")
  );
  // The endpoint ACCEPTS `page` and ignores it — page=2 answers with page 1 and
  // the same first product — so paging by page silently appends duplicates or
  // nothing at all. Only `offset` moves the window; `skip` is ignored too.
  // The params object itself, not the prose around it: the comment above the
  // fetch names `page` and `skip` to explain why neither is used, and matching
  // loose words passes on `{ page: offset }` — which is the exact bug.
  const params = effect.slice(
    effect.indexOf("buildStorefrontProductsRequestUrl({"),
    effect.indexOf("}", effect.indexOf("buildStorefrontProductsRequestUrl({"))
  );
  assert.match(params, /\boffset\b/);
  assert.doesNotMatch(params, /\bpage\b/);
  assert.doesNotMatch(params, /\bskip\b/);

  // And the grid must render everything it has loaded; a slice at the render
  // site made "view all" fetch more and show none of it.
  const emptyState = storefrontSource.slice(
    storefrontSource.indexOf("The empty state follows the reference"),
    storefrontSource.indexOf("function SearchChips")
  );
  assert.doesNotMatch(emptyState, /inspiration\.slice\(/);
  assert.match(emptyState, /onLoadMoreInspiration/, "view all loads more rather than navigating");
  assert.doesNotMatch(emptyState, /<Link to="\/products"/, "it must not leave the sheet");
});

test("the inspiration tile matches OUR photography, not the reference's numbers", () => {
  const rule = stylesheet.slice(stylesheet.indexOf(".storefront-shell .sf-search-tile {"));
  // Our product shots are square (1254x1254). The reference sizes its tiles 5:7
  // because its shots are portrait; copying that number left ~29% of every tile
  // as empty letterbox bands above and below the shoe.
  assert.match(rule.slice(0, 300), /aspect-ratio:\s*1\s*\/\s*1/);
  assert.doesNotMatch(rule.slice(0, 300), /aspect-ratio:\s*5\s*\/\s*7/);
});
