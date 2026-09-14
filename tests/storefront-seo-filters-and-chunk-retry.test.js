import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seoCategoryByPath, seoPinnedFilterUrl } from "../src/shared/lib/categorySeo.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const section = (path) => seoCategoryByPath(path);

/* ---------------------------------------------------------------------------
   A section page pins gender or type in its path, and the listing reads that pin
   ahead of the query. Writing ?gender=women onto /men lit the Women chip and left
   the grid men. A change to the pinned field has to open another path.
   --------------------------------------------------------------------------- */

test("changing a pinned gender opens that gender's section, keeping the other filters", () => {
  assert.equal(seoPinnedFilterUrl(section("/men"), "gender", "women", "brand=nike&page=3"), "/women?brand=nike");
  assert.equal(seoPinnedFilterUrl(section("/women"), "gender", "kids", ""), "/kids");
  // A stale query copy of the pinned field never survives the move.
  assert.equal(seoPinnedFilterUrl(section("/men"), "gender", "kids", "gender=women&size=40"), "/kids?size=40");
});

test("changing a pinned type opens that type's section and drops every alias of the old one", () => {
  assert.equal(seoPinnedFilterUrl(section("/crocs"), "type", "bags", "color=black"), "/bags?color=black");
  assert.equal(seoPinnedFilterUrl(section("/bags"), "productType", "slippers", "type=bags&product_type=bags&category=x&gender=women"), "/slippers?gender=women");
});

test("a value with no section of its own lands on /products carrying it in the query", () => {
  assert.equal(seoPinnedFilterUrl(section("/crocs"), "type", "sneakers", "size=42"), "/products?size=42&type=sneakers");
  assert.equal(seoPinnedFilterUrl(section("/men"), "gender", "unisex", ""), "/products?gender=unisex");
});

test("removing a pinned field goes to /products with everything else kept", () => {
  assert.equal(seoPinnedFilterUrl(section("/men"), "gender", "", "brand=adidas&sort=price_asc&page=2"), "/products?brand=adidas&sort=price_asc");
  assert.equal(seoPinnedFilterUrl(section("/crocs"), "type", "all", ""), "/products");
  // The large-sizes section pins gender alongside size/stock rules the query cannot carry.
  assert.equal(seoPinnedFilterUrl(section("/men/large-sizes"), "gender", "women", ""), "/women");
});

test("a field the section does not pin, and every non-section page, keep writing the query", () => {
  assert.equal(seoPinnedFilterUrl(section("/men"), "type", "crocs", ""), null);
  assert.equal(seoPinnedFilterUrl(section("/crocs"), "gender", "men", ""), null);
  assert.equal(seoPinnedFilterUrl(section("/offers"), "gender", "women", ""), null);
  assert.equal(seoPinnedFilterUrl(section("/products"), "gender", "women", ""), null);
  assert.equal(seoPinnedFilterUrl(null, "type", "bags", ""), null);
  assert.equal(seoPinnedFilterUrl(section("/men"), "brand", "nike", ""), null);
});

test("a section pinning two URL fields carries the one that did not change", () => {
  const both = { path: "/x", apiFilters: { gender: "men", product_type: "crocs" } };
  assert.equal(seoPinnedFilterUrl(both, "type", "bags", "type=old"), "/bags?gender=men");
  assert.equal(seoPinnedFilterUrl(both, "gender", "", "gender=women"), "/products?type=crocs");
});

test("the listing routes sidebar, quick chips and applied-chip removal through the pinned URL", () => {
  const page = read("src/storefront/pages/StorefrontProductListingPage.jsx");
  assert.match(page, /const pinnedFilterUrl = \(field, value\) => \{[\s\S]{0,400}seoPinnedFilterUrl\(seoCategory, field,/);
  assert.match(page, /const buildFilterUrl = \(field, value\) => \{\s*const pinnedUrl = pinnedFilterUrl\(field, value\);\s*if \(pinnedUrl\) return pinnedUrl;/);
  assert.match(page, /const setSingleFilterValue = \(field, value\) => \{\s*const pinnedUrl = pinnedFilterUrl\(field, value\);\s*if \(pinnedUrl\) \{\s*navigate\(pinnedUrl\);/);
  assert.match(page, /onRemove=\{\(field, value\) => \{\s*const pinnedUrl = field === "gender" \|\| field === "type" \? pinnedFilterUrl\(field, ""\) : null;\s*if \(pinnedUrl\) \{\s*navigate\(pinnedUrl\);/);
  // The chip lights from what the grid is filtered by, the section's pin first.
  assert.match(page, /pinnedFilters=\{seoCategory\?\.apiFilters\}/);
  assert.match(page, /normalizeStorefrontAudienceValue\(pinnedFilters\?\.gender \|\| params\.get\("gender"\)\)/);
  assert.match(page, /normalizeStorefrontProductTypeValue\(pinnedFilters\?\.product_type \|\| params\.get\("type"\)/);
});

/* ---------------------------------------------------------------------------
   vercel.json caches /assets/* as immutable, 404s included. Only a retry with a
   different query string gets past such an entry, so every chunk a customer can
   land on cold goes through importWithChunkRetry.
   --------------------------------------------------------------------------- */

test("the storefront chunk and the customer link pages load through the chunk retry", () => {
  const app = read("src/App.jsx");
  assert.match(app, /import \{ importWithChunkRetry \} from "\.\/shared\/utils\/chunkLoadRecovery";/);
  assert.match(app, /const Storefront = lazy\(\(\) => importWithChunkRetry\(\(\) => import\("\.\/storefront\/Storefront"\)\)\);/);
  for (const name of ["PrivacyPage", "TermsPage", "DataDeletionPage", "OrderConfirmationActionPage", "CustomerAddressPage"]) {
    assert.match(app, new RegExp(`const ${name} = lazy\\(\\(\\) => importWithChunkRetry\\(\\(\\) => import\\(`), name);
  }
  // No storefront page is left on a bare import.
  assert.doesNotMatch(app, /lazy\(\(\) => import\("\.\/storefront\//);
});

test("the App entry retries, and a failed recovery shows the refresh screen instead of a blank page", () => {
  const main = read("src/main.jsx");
  assert.match(main, /importWithChunkRetry\(\(\) => import\("\.\/App\.jsx"\), \{ recover: false \}\)/);
  assert.match(main, /recoverFromChunkLoadError\(error\)\.then\(\(reloading\) => \{\s*if \(!reloading\) showBootFailure\(\);\s*\}, showBootFailure\)/);
  assert.match(main, /window\.__m1ShowBootFailure\(\);/);

  const index = read("index.html");
  assert.match(index, /window\.__m1ShowBootFailure = paintStranded;/);
  assert.match(index, /function paintStranded\(\) \{\s*if \(recovering\) return;/);
});
