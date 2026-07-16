import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const stylesheetSource = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const productDetailSource = readFileSync(new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url), "utf8");

test("storefront mobile navigation uses modern commerce icons", () => {
  const navSource = storefrontSource.slice(storefrontSource.indexOf("function MobileBottomNav"), storefrontSource.indexOf("function SummaryRow"));
  assert.match(navSource, /id: "home"[\s\S]*?icon: Home/);
  assert.match(navSource, /id: "categories"[\s\S]*?icon: Grid2x2/);
  assert.match(navSource, /id: "sale"[\s\S]*?icon: Tag/);
  assert.match(navSource, /id: "wishlist"[\s\S]*?icon: Heart/);
  assert.match(navSource, /id: "account"[\s\S]*?icon: UserRound/);
  assert.match(navSource, /sf-mobile-bottom-nav__svg[\s\S]*?strokeWidth=\{2\.45\}/);
});

test("English storefront navigation and product actions do not fall back to Arabic", () => {
  const navSource = storefrontSource.slice(storefrontSource.indexOf("function MobileBottomNav"), storefrontSource.indexOf("function SummaryRow"));
  assert.match(
    navSource,
    /const currentLanguage = normalizeLanguage\([\s\S]*?const isRtl = currentLanguage === "ar";/,
    "MobileBottomNav must define isRtl in its own component scope",
  );
  assert.match(navSource, /isRtl \? "الرئيسية" : "Home"/);
  assert.match(navSource, /isRtl \? "الأقسام" : "Categories"/);
  assert.match(navSource, /isRtl \? "العروض" : "Offers"/);
  assert.match(navSource, /isRtl \? "المفضلة" : "Wishlist"/);
  assert.match(navSource, /isRtl \? "حسابي" : "Account"/);
  assert.match(productDetailSource, /isRtl \? "دليل المقاسات" : "Size guide"/);
  assert.equal((productDetailSource.match(/storefront\.products\.onlyLeft/g) || []).length, 1);
  assert.match(stylesheetSource, /sf-product-cta[\s\S]*?linear-gradient\(135deg, #c99a19, #e5c158\)/);
});

test("mobile navigation isolates its surface and light-dark colors", () => {
  assert.match(storefrontSource, /data-theme=\{isDarkMode \? "dark" : "light"\}/);
  assert.match(storefrontSource, /sf-mobile-bottom-nav__surface/);
  assert.match(storefrontSource, /sf-mobile-bottom-nav__item/);
  assert.match(stylesheetSource, /\.storefront-shell \.sf-mobile-bottom-nav,[\s\S]*?background: transparent !important;/);
  assert.match(stylesheetSource, /sf-mobile-bottom-nav\[data-theme="light"\] \.sf-mobile-bottom-nav__surface/);
  assert.match(stylesheetSource, /sf-mobile-bottom-nav\[data-theme="dark"\] \.sf-mobile-bottom-nav__surface/);
  assert.match(stylesheetSource, /sf-mobile-bottom-nav__item\.is-active[\s\S]*?sf-mobile-bottom-nav__icon/);
  assert.match(stylesheetSource, /sf-mobile-bottom-nav__svg[\s\S]*?stroke: currentColor !important;/);
  assert.match(stylesheetSource, /sf-mobile-bottom-nav__surface \{[\s\S]*?height: 58px;/);
  assert.match(stylesheetSource, /sf-mobile-bottom-nav\[data-theme="light"\][\s\S]*?sf-mobile-bottom-nav__svg[\s\S]*?stroke: #3f3b36 !important;/);
});
