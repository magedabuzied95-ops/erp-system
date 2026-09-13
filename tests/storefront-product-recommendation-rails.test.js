import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url), "utf8");
const homeStyles = readFileSync(new URL("../src/storefront/home/home.css", import.meta.url), "utf8");

test("product details render similar, brand and recently viewed recommendation rails", () => {
  assert.match(detailSource, /<RelatedProducts currentProduct=\{product\}/);
  assert.match(detailSource, /<RecentProductsSection currentId=\{product\.id\}/);
  assert.match(storefrontSource, /title=\{sfText\("storefront\.products\.relatedProducts"\)\}/);
  assert.match(storefrontSource, /brand: brand \|\| "__no_brand__", limit: 15/);
  assert.match(storefrontSource, /title=\{brand \? sfText\("storefront\.products\.moreFromBrand", undefined, \{ brand \}\)/);
  assert.match(storefrontSource, /slice\(0, 15\)/);
  assert.match(storefrontSource, /sfText\("storefront\.account\.recentlyViewed"\)/);
});

test("the similar rail matches the product family, never the mirror grade", () => {
  assert.match(storefrontSource, /\.\.\.\(productType \? \{ product_type: productType \} : \{ category: category \|\| "__no_category__" \}\)/);
  assert.match(storefrontSource, /\.\.\.similarFilter, limit: 15, in_stock: 1, grouping: "product"/);
  assert.match(storefrontSource, /products=\{similarResult\.products\} loading=\{similarResult\.loading\}/);
  assert.doesNotMatch(storefrontSource, /grade: grade \|\| "__no_grade__"/);
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

test("a missing photo falls back to the product's own shot before the logo", () => {
  // The walker, mirrored from the component so its cases stay pinned.
  const walk = (node) => {
    if (node.dataset.fallbackApplied === "true") return;
    const originalSrc = String(node.dataset.originalSrc || "").trim();
    if (originalSrc && node.dataset.originalTried !== "true" && node.src !== originalSrc) {
      node.dataset.originalTried = "true";
      node.src = originalSrc;
      return;
    }
    const tried = String(node.dataset.triedSrc || "").split("|").filter(Boolean);
    const next = String(node.dataset.fallbackSrc || "").split("|").map((u) => u.trim())
      .find((url) => url && url !== node.src && !tried.includes(url));
    if (next) {
      node.dataset.triedSrc = [...tried, next].join("|");
      node.src = next;
      return;
    }
    node.dataset.fallbackApplied = "true";
    node.src = "/favicon.svg";
  };
  const settle = (src, dataset, alive) => {
    const node = { src, dataset: { ...dataset } };
    for (let i = 0; i < 12 && !alive.includes(node.src); i += 1) walk(node);
    return node.src;
  };

  // The real case: Adidas Running - Black, whose colour photo 404s while the
  // product's other shot of the same shoe is alive.
  assert.equal(settle("/dead.jpg", { fallbackSrc: "/good.jpg" }, ["/good.jpg"]), "/good.jpg");
  assert.equal(settle("/dead.jpg", { fallbackSrc: "/d2.jpg|/d3.jpg" }, ["/favicon.svg"]), "/favicon.svg");
  assert.equal(settle("/dead.jpg", {}, ["/favicon.svg"]), "/favicon.svg");
  // The responsive url gives way to the original before any alternate.
  assert.equal(settle("/resized.jpg", { originalSrc: "/orig.jpg", fallbackSrc: "/good.jpg" }, ["/orig.jpg"]), "/orig.jpg");
  // A repeated candidate must not loop.
  assert.equal(settle("/dead.jpg", { fallbackSrc: "/a.jpg|/a.jpg" }, ["/favicon.svg"]), "/favicon.svg");

  assert.match(storefrontSource, /const productCardFallbackImages = /);
  // Borrowing another colour's photo would misdescribe the card.
  assert.match(storefrontSource, /const wideCandidates = colorCount > 1\s*\?\s*\[\]/);
  assert.match(storefrontSource, /data-fallback-src=\{cardFallbackImages\.map\(\(url\) => imageFor\(url\)\)\.join\("\|"\)\}/);
});

test("a thin brand rail unfolds colour cards instead of rendering a half-empty row", () => {
  assert.match(storefrontSource, /const RECOMMENDATION_RAIL_MIN_ITEMS = 5;/);
  assert.match(storefrontSource, /const source = onePerModel\.length >= minItems \? onePerModel : cards;/);
  assert.equal((storefrontSource.match(/minItems=\{RECOMMENDATION_RAIL_MIN_ITEMS\}/g) || []).length, 2);
});

test("recommendation rails exclude the open product", () => {
  assert.match(storefrontSource, /parentId === String\(currentId\)/);
});

test("product page rails render the homepage filtered row and its cards", () => {
  const rail = storefrontSource.slice(
    storefrontSource.indexOf("function StorefrontRecommendationRail"),
    storefrontSource.indexOf("function RelatedProductsContent")
  );
  // One card for both pages: the homepage row, its card and its view model.
  assert.match(rail, /<HomeFilteredRail/);
  assert.match(rail, /buildHomeProductCard\(product, cardCtx\)/);
  assert.match(rail, /pricing: featuredSlideProduct/);
  assert.match(rail, /className="sf-related-rail m1h m1h--embedded min-w-0"/);
  // Colour cards of one model share an id, so the rail keeps its own card key.
  assert.match(rail, /key: productCardKey\(product, index\)/);
  assert.doesNotMatch(storefrontSource, /function RecommendationProductTile/);
  // The embedded row takes the storefront theme and stays inside the column.
  // data-theme, not a selector of its own, so Site Studio's dark overrides reach it.
  assert.match(rail, /data-theme=\{dark \? "dark" : "light"\}/);
  assert.doesNotMatch(homeStyles, /storefront-dark \.m1h--embedded/);
  assert.match(homeStyles, /\.m1h--embedded \.m1h-rail \{\s*margin-inline: 0;/);
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

test("recommendation copy never exposes the raw mirror grade", () => {
  assert.doesNotMatch(storefrontSource, /\[brand, category\]\.filter/);
  assert.doesNotMatch(storefrontSource, /`المزيد من فئة \$\{grade\}`/);
  assert.match(storefrontSource, /subtitle=\{sfText\("storefront\.products\.relatedSubtitle"\)\}/);
});

test("the product page reuses the exact home service strip and footer components", () => {
  assert.match(storefrontSource, /<HomeWhySection lang=\{i18n\.language \|\| "ar"\} \/>/);
  assert.match(storefrontSource, /<HomeSimpleFooter lang=\{i18n\.language \|\| "ar"\} \/>/);
  assert.equal((storefrontSource.match(/function HomeSimpleFooter/g) || []).length, 1);
  assert.equal((storefrontSource.match(/function HomeWhySection/g) || []).length, 1);
});
