import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url), "utf8");
const lightStyles = readFileSync(new URL("../src/storefront/storefront-light.css", import.meta.url), "utf8");

test("product details render similar, brand and recently viewed recommendation rails", () => {
  assert.match(detailSource, /<RelatedProducts currentProduct=\{product\}/);
  assert.match(detailSource, /<RecentProductsSection currentId=\{product\.id\}/);
  assert.match(storefrontSource, /title="منتجات ذات صلة"/);
  assert.match(storefrontSource, /brand: brand \|\| "__no_brand__", limit: 15/);
  assert.match(storefrontSource, /title=\{brand \? `المزيد من منتجات \$\{brand\}`/);
  assert.match(storefrontSource, /slice\(0, 15\)/);
  assert.match(storefrontSource, /sfText\("storefront\.account\.recentlyViewed"\)/);
});

test("the similar rail matches the product family, never the mirror grade", () => {
  assert.match(storefrontSource, /\.\.\.\(productType \? \{ product_type: productType \} : \{ category: category \|\| "__no_category__" \}\)/);
  assert.match(storefrontSource, /\.\.\.similarFilter, limit: 15, in_stock: 1, grouping: "product"/);
  assert.match(storefrontSource, /products=\{similarResult\.products\} loading=\{similarResult\.loading\}/);
  assert.doesNotMatch(storefrontSource, /grade: grade \|\| "__no_grade__"/);
});

test("rails glide one card at a time on the sibling site's swiper timings", () => {
  assert.match(storefrontSource, /const RAIL_GAP_PX = 10;/);
  assert.match(storefrontSource, /const RAIL_AUTOPLAY_MS = 2500;/);
  assert.match(storefrontSource, /const RAIL_SLIDE_MS = 1500;/);
  // The delay is the REST between glides, exactly as Swiper counts it: a step lands
  // once per rest + glide. Timing the interval at RAIL_AUTOPLAY_MS alone left the row
  // in motion 60% of the time, and a moving row shows a sliced card at each edge.
  assert.match(storefrontSource, /setSlide\(\(current\) => current \+ 1\), RAIL_AUTOPLAY_MS \+ RAIL_SLIDE_MS\)/);
  assert.match(storefrontSource, /transition: animating \? `transform \$\{RAIL_SLIDE_MS\}ms ease` : "none"/);
  // Card width must survive a missed measurement, so it is pure CSS.
  assert.match(storefrontSource, /const slideBasis = `calc\(\(100% - \$\{\(perView - 1\) \* RAIL_GAP_PX\}px\) \/ \$\{perView\}\)`;/);
  assert.match(storefrontSource, /const slideOffset = `calc\(\(100% \+ \$\{RAIL_GAP_PX\}px\) \* \$\{slide\} \/ \$\{perView\}\)`;/);
  assert.doesNotMatch(storefrontSource, /new ResizeObserver\(\(\[entry\]\) => setViewportWidth/);
  // A page-at-a-time slice is what made a rotated row collapse to its remainder.
  assert.doesNotMatch(storefrontSource, /items\.slice\(page \* pageSize/);
});

test("rail breakpoints and looping match the reference carousel", () => {
  assert.match(storefrontSource, /\{ minWidth: 1024, perView: 5 \}/);
  assert.match(storefrontSource, /\{ minWidth: 768, perView: 3 \}/);
  assert.match(storefrontSource, /\{ minWidth: 640, perView: 2 \}/);
  assert.match(storefrontSource, /\{ minWidth: 0, perView: 1 \}/);
  // Mirrors railPerViewForWidth: first breakpoint at or below the viewport wins.
  const breakpoints = [...storefrontSource.matchAll(/\{ minWidth: (\d+), perView: (\d+) \}/g)].map(([, minWidth, perView]) => ({
    minWidth: Number(minWidth),
    perView: Number(perView),
  }));
  const perViewFor = (width) => breakpoints.find((breakpoint) => width >= breakpoint.minWidth).perView;
  assert.equal(perViewFor(1440), 5);
  assert.equal(perViewFor(800), 3);
  assert.equal(perViewFor(700), 2);
  assert.equal(perViewFor(380), 1);
  // Cloning the head is what lets the track run past the end and snap back unseen.
  assert.match(storefrontSource, /const trackItems = canSlide \? \[\.\.\.items, \.\.\.items\.slice\(0, perView\)\] : items;/);
  assert.match(storefrontSource, /jumpLap\(slide - items\.length\), RAIL_SLIDE_MS/);
});

test("the similar rail narrows by family, audience and grade together", () => {
  assert.match(storefrontSource, /\.\.\.\(audience \? \{ gender: audience \} : \{\}\)/);
  assert.match(storefrontSource, /\.\.\.\(grade \? \{ grade \} : \{\}\)/);
  assert.match(storefrontSource, /currentProduct\?\.gender \|\|/);
  assert.match(storefrontSource, /Array\.isArray\(currentProduct\?\.audiences\) \? currentProduct\.audiences\[0\] : ""/);
  assert.match(storefrontSource, /currentProduct\?\.grade \|\| currentProduct\?\.quality/);

  // The filter the component builds, mirrored here so the cases stay pinned.
  const build = (productType, category, audience, grade) => {
    const filter = {
      ...(productType ? { product_type: productType } : { category: category || "__no_category__" }),
      ...(audience ? { gender: audience } : {}),
      ...(grade ? { grade } : {}),
    };
    const query = new URLSearchParams(
      Object.entries(filter).filter(([, value]) => value && !String(value).startsWith("__"))
    ).toString();
    return { filter, href: query ? `/products?${query}` : "/products" };
  };

  // Grade values as production actually stores them.
  assert.deepEqual(build("sneakers", "", "men", "imported_from_vietnam").filter, {
    product_type: "sneakers",
    gender: "men",
    grade: "imported_from_vietnam",
  });
  assert.equal(
    build("sneakers", "", "men", "mirror_original").href,
    "/products?product_type=sneakers&gender=men&grade=mirror_original"
  );
  // Each axis is optional and must widen the match, never empty it.
  assert.deepEqual(build("sneakers", "", "men", "").filter, { product_type: "sneakers", gender: "men" });
  assert.deepEqual(build("sneakers", "", "", "local").filter, { product_type: "sneakers", grade: "local" });
  assert.deepEqual(build("", "Bags", "kids", "").filter, { category: "Bags", gender: "kids" });
  // A product with none of the three still yields a usable link.
  assert.equal(build("", "", "", "").href, "/products");
});

test("rail tile photos sit on the sibling site's grey plate, not white", () => {
  const tile = storefrontSource.slice(
    storefrontSource.indexOf("function RecommendationProductTile"),
    storefrontSource.indexOf("const RECOMMENDATION_RAIL_MIN_ITEMS")
  );
  assert.match(tile, /sf-product-card-media group\/card-image relative aspect-square overflow-hidden bg-\[#e5e5e5\]/);
  assert.doesNotMatch(tile, /aspect-square overflow-hidden bg-white/);
});

test("rail tiles carry the same slide-up quick add as the grid card", () => {
  const tile = storefrontSource.slice(
    storefrontSource.indexOf("function RecommendationProductTile"),
    storefrontSource.indexOf("const RECOMMENDATION_RAIL_MIN_ITEMS")
  );
  // The tile is its own hover group, so a rail neighbour cannot slide it.
  assert.match(tile, /sf-product-recommendation-tile group group\/tile/);
  assert.match(tile, /md:group-hover\/tile:-translate-y-\[35px\] md:focus-within:-translate-y-\[35px\]/);
  assert.match(tile, /sf-card-action-wrap min-w-0 overflow-clip md:h-\[35px\]/);
  assert.match(tile, /sf-card-slide-cta hidden h-\[35px\][\s\S]{0,400}md:inline-flex/);
  // Touch has no hover, so the price stays put next to a round quick add.
  assert.match(tile, /sf-quick-add-button[\s\S]{0,900}md:hidden/);
  // Colour and size resolve through the very helpers the grid card uses.
  assert.match(tile, /getProductColorGroups\(\{ \.\.\.product, variants: sellableTileVariants\.length \? sellableTileVariants : tileVariants \}\)/);
  assert.match(tile, /getSizeOptionsForColorGroup\(nextGroup, product\)\.filter\(\(item\) => variantHasStock\(item\.variant\)\)/);
  assert.match(tile, /<ProductCardVariantSheet/);
  assert.match(tile, /onAddToCart\?\.\(product, chosenVariant, quantity\)/);
  // A tile with nothing sellable, or no cart handler, must not offer the button.
  assert.match(tile, /const canQuickAdd = sellableTileVariants\.length > 0 && typeof onAddToCart === "function"/);
  assert.match(tile, /disabled=\{!canQuickAdd\}/);
});

test("the product page hands its rails a cart handler to make quick add reachable", () => {
  assert.match(detailSource, /<RelatedProducts currentProduct=\{product\}[^>]*onAddToCart=\{onAddToCart\}/);
  assert.match(storefrontSource, /function RecommendationProductTile\(\{ product, wishlist = \[\], toggleWishlist, saleModeEnabled, onAddToCart \}\)/);
});

test("a thin brand rail unfolds colour cards instead of rendering a half-empty row", () => {
  assert.match(storefrontSource, /const RECOMMENDATION_RAIL_MIN_ITEMS = 5;/);
  assert.match(storefrontSource, /const source = onePerModel\.length >= minItems \? onePerModel : cards;/);
  assert.equal((storefrontSource.match(/minItems=\{RECOMMENDATION_RAIL_MIN_ITEMS\}/g) || []).length, 2);
});

test("recommendation rails provide slide controls and exclude the open product", () => {
  assert.match(storefrontSource, /parentId === String\(currentId\)/);
  assert.match(storefrontSource, /onClick=\{\(\) => moveBy\(-1\)\}/);
  assert.match(storefrontSource, /onClick=\{\(\) => moveBy\(1\)\}/);
  assert.match(storefrontSource, /window\.setInterval/);
  assert.match(storefrontSource, /sf-product-recommendation-page/);
  assert.match(storefrontSource, /aria-label=\{`شريحة \$\{index \+ 1\}`\}/);
  // A swipe has to follow the reading direction, which flips under RTL.
  assert.match(storefrontSource, /moveBy\(distance \* direction > 0 \? 1 : -1\)/);
});

test("customer recent products include brand and crossed-price fields", () => {
  const controller = readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  assert.match(controller, /b\.name AS brand_name/);
  assert.match(controller, /AS compare_at_price/);
  assert.match(controller, /LEFT JOIN brands b ON b\.id = p\.brand_id/);
  assert.match(controller, /LEFT JOIN LATERAL \([\s\S]*?FROM product_variants pv/);
  assert.match(controller, /display_variant\.selling_price/);
  assert.match(controller, /display_variant\.compare_price/);
  assert.match(controller, /ORDER BY \(COALESCE\(pv\.stock, 0\) > 0\) DESC/);
});

test("product page prioritizes cached or direct product data and defers recommendation requests", () => {
  assert.match(detailSource, /const prefetched = storefrontApi\.peekProductDetails\(routeValue\)/);
  assert.match(detailSource, /label: "prefetched"/);
  assert.match(detailSource, /label: "direct", loader: loadDirect/);
  assert.match(storefrontSource, /function RelatedProductsContent/);
  assert.match(storefrontSource, /rootMargin: "600px 0px"/);
  assert.match(storefrontSource, /ready \? <RelatedProductsContent/);
});

test("recommendations use a compact five-across storefront strip instead of product cards", () => {
  assert.match(storefrontSource, /function RecommendationProductTile/);
  // Five across is now the widest breakpoint of the sliding track, not a static grid.
  assert.match(storefrontSource, /sf-product-recommendation-viewport/);
  assert.match(storefrontSource, /flex: `0 0 \$\{slideBasis\}`/);
  assert.match(storefrontSource, /aspect-square overflow-hidden bg-\[#e5e5e5\]/);
  assert.doesNotMatch(storefrontSource, /<ProductCard product=\{product\} railType="similar" rank=\{index \+ 1\}/);
});

test("product recommendation strips have explicit light-mode colors", () => {
  assert.match(storefrontSource, /sf-product-recommendation-name/);
  assert.match(lightStyles, /not\(\.storefront-dark\) \.sf-product-recommendation-name/);
  assert.match(lightStyles, /not\(\.storefront-dark\) \.sf-product-recommendation-meta/);
  assert.match(storefrontSource, /sf-product-recommendation-current-price/);
  assert.match(storefrontSource, /sf-product-recommendation-compare-price/);
  assert.match(lightStyles, /not\(\.storefront-dark\) \.sf-product-recommendation-current-price/);
  assert.match(lightStyles, /not\(\.storefront-dark\) \.sf-product-recommendation-compare-price/);
});

test("recommendation copy never exposes the raw mirror grade", () => {
  assert.doesNotMatch(storefrontSource, /\[brand, category\]\.filter/);
  assert.doesNotMatch(storefrontSource, /`المزيد من فئة \$\{grade\}`/);
  assert.match(storefrontSource, /subtitle="منتجات مشابهة مختارة لك"/);
});

test("the product page reuses the exact home service strip and footer components", () => {
  assert.match(storefrontSource, /<HomeWhySection lang=\{i18n\.language \|\| "ar"\} \/>/);
  assert.match(storefrontSource, /<HomeSimpleFooter lang=\{i18n\.language \|\| "ar"\} \/>/);
  assert.equal((storefrontSource.match(/function HomeSimpleFooter/g) || []).length, 1);
  assert.equal((storefrontSource.match(/function HomeWhySection/g) || []).length, 1);
});
