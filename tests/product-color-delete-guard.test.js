import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const editorSource = fs.readFileSync(
  new URL("../src/modules/products/pages/ProductEdit.jsx", import.meta.url),
  "utf8"
);
const productsApiSource = fs.readFileSync(
  new URL("../src/modules/products/services/productsApi.js", import.meta.url),
  "utf8"
);
const controllerSource = fs.readFileSync(
  new URL("../server/controllers/productsController.js", import.meta.url),
  "utf8"
);
const routeSource = fs.readFileSync(
  new URL("../server/routes/products.js", import.meta.url),
  "utf8"
);
const enLocale = JSON.parse(
  fs.readFileSync(new URL("../src/locales/en/products.json", import.meta.url), "utf8")
);
const arLocale = JSON.parse(
  fs.readFileSync(new URL("../src/locales/ar/products.json", import.meta.url), "utf8")
);

test("deleting a saved colour asks first, and a declined confirm changes nothing", () => {
  // The trash button used to drop the whole colour group on one click - while
  // zeroing its stock asked for confirmation.
  assert.match(editorSource, /const removeColorGroup = async \(groupId\) => \{/);
  assert.match(editorSource, /usage = await getProductColorUsage\(id, \{ color: colorName, variantIds \}\)/);
  // The confirm must gate the drop, not merely precede it.
  assert.match(editorSource, /if \(!window\.confirm\(lines\.join\("\\n"\)\)\) return;\s*\r?\n\s*dropColorGroup\(groupId, variantIds\);/);
});

test("a colour that was never saved is dropped without a round trip", () => {
  assert.match(editorSource, /if \(!variantIds\.length \|\| !id\) \{\s*\r?\n\s*dropColorGroup\(groupId, variantIds\);/);
});

test("the confirmation names the stock and the invoices the colour appears on", () => {
  for (const key of [
    "deleteColorSizes",
    "deleteColorStock",
    "deleteColorPurchases",
    "deleteColorOrders",
    "deleteColorImages",
  ]) {
    assert.match(editorSource, new RegExp(`products\\.editor\\.${key}`), `missing line: ${key}`);
    assert.ok(enLocale.editor[key], `missing en copy: ${key}`);
    assert.ok(arLocale.editor[key], `missing ar copy: ${key}`);
  }
  // The invoices survive the delete - saying so is the difference between a
  // warning that informs and one that only frightens.
  assert.match(editorSource, /products\.editor\.deleteColorInvoicesSafe/);
  assert.ok(arLocale.editor.deleteColorInvoicesSafe.includes("الفواتير"));
});

test("a failed usage lookup does not block the delete", () => {
  assert.match(
    editorSource,
    /catch \(error\) \{\s*\r?\n\s*console\.warn\("\[product-edit\] colour usage lookup failed"/
  );
});

test("the colour-usage endpoint is registered and permission gated", () => {
  assert.match(
    routeSource,
    /router\.get\("\/:id\/color-usage", protect, permit\("products", "view"\), getProductColorUsage\);/
  );
  assert.match(productsApiSource, /\/products\/\$\{encodeURIComponent\(productId\)\}\/color-usage\?/);
  assert.match(controllerSource, /export const getProductColorUsage = async \(req, res\) => \{/);
});

test("colour usage counts purchase invoices and sales orders, not just stock", () => {
  assert.match(
    controllerSource,
    /countHistory\(\{ table: "purchase_items", idColumn: "purchase_id", quantityColumn: "quantity" \}\)/
  );
  assert.match(
    controllerSource,
    /countHistory\(\{ table: "order_items", idColumn: "order_id", quantityColumn: "quantity" \}\)/
  );
  // History predating the variant row is matched by product + colour name too.
  assert.match(controllerSource, /pi\.product_id = \$2 AND \$3 <> '' AND LOWER\(BTRIM\(COALESCE\(pi\.color, ''\)\)\)/);
});

test("a colour's images are archived, never dropped, when the colour goes", () => {
  assert.match(controllerSource, /CREATE TABLE IF NOT EXISTS product_variant_images_archive/);
  assert.match(
    controllerSource,
    /const archiveProductVariantImagesForVariants = async \(client, \{ productId, tenantId, variantIds = \[\], colorNames = \[\] \}\)/
  );

  // Both archive helpers must route their image cleanup through the archive. A
  // bare DELETE in either one is the old permanent loss coming back.
  const helperNames = ["archiveMissingProductVariants", "archiveProductVariantsByIds"];
  for (const name of helperNames) {
    const start = controllerSource.indexOf(`const ${name} = async (client,`);
    assert.ok(start > 0, `helper not found: ${name}`);
    const body = controllerSource.slice(start, start + 2400);
    assert.match(body, /await archiveProductVariantImagesForVariants\(client, \{/, `${name} does not archive its images`);
    assert.match(body, /colorNames: result\.rows\.map\(\(row\) => row\.color\)/, `${name} archives no colour-gallery images`);
    assert.doesNotMatch(body, /DELETE FROM product_variant_images\b/, `${name} still hard-deletes images`);
  }
});

test("the colour gallery travels too, and a duplicate colour name cannot drag a live colour's images away", () => {
  // The editor's colour gallery is stored with a colour name and no variant_id,
  // so a variant_id-only sweep would archive the size rows and destroy the
  // images anyone actually looks at.
  assert.match(controllerSource, /LOWER\(BTRIM\(COALESCE\(pvi\.color_name, ''\)\)\) = ANY\(\$3::text\[\]\)/);
  assert.match(
    controllerSource,
    /AND NOT EXISTS \(\s*\r?\n\s*SELECT 1\s*\r?\n\s*FROM product_variants live\s*\r?\n\s*WHERE live\.product_id = pvi\.product_id/
  );
});

test("archived images come back when the colour does, without overwriting fresh ones", () => {
  assert.match(
    controllerSource,
    /const restoreArchivedProductVariantImages = async \(client, \{ productId, tenantId, activeVariantIds = \[\], activeColorNames = \[\] \}\)/
  );
  assert.match(controllerSource, /activeColorNames: activeVariantsAfterSave\.map\(\(variant\) => variant\.color\)/);
  // Only a colour carrying no image today is refilled - by variant id for the
  // size rows, by colour name for the gallery.
  assert.match(
    controllerSource,
    /AND NOT EXISTS \(\s*\r?\n\s*SELECT 1\s*\r?\n\s*FROM product_variant_images live/
  );
  assert.match(controllerSource, /\(a\.variant_id IS NOT NULL AND live\.variant_id = a\.variant_id\)/);
  // The restore runs after the payload rewrite, or the rewrite would wipe it again.
  const rewriteAt = controllerSource.indexOf("await replaceProductVariantImages(client, {", controllerSource.indexOf("export const updateProduct"));
  const restoreAt = controllerSource.indexOf("await restoreArchivedProductVariantImages(client, {");
  assert.ok(rewriteAt > 0 && restoreAt > rewriteAt, "restore must run after replaceProductVariantImages");
});
