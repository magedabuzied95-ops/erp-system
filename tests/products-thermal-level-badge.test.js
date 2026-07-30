import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controllerSource = await readFile(
  new URL("../server/controllers/productsController.js", import.meta.url),
  "utf8"
);
const productsListSource = await readFile(
  new URL("../src/modules/products/pages/ProductsList.jsx", import.meta.url),
  "utf8"
);

test("admin product list returns product and color thermal levels", () => {
  assert.match(controllerSource, /AS product_thermal_image_url/);
  assert.match(controllerSource, /AS thermal_color_count/);
  assert.match(controllerSource, /AS thermal_color_names/);
  assert.match(controllerSource, /FROM barcode_print_queue bpq/);
  assert.match(controllerSource, /bpq\.status IN \('ready', 'printed'\)/);
  assert.match(controllerSource, /productThermalImageUrl:/);
  assert.match(controllerSource, /thermalColorCount:/);
});

test("product rows identify cover-level and color-level thermal artwork", () => {
  assert.match(productsListSource, /Thermal المنتج \+ الألوان/);
  assert.match(productsListSource, /Thermal الألوان/);
  assert.match(productsListSource, /Thermal المنتج/);
  assert.match(productsListSource, /لا توجد Thermal/);
  assert.match(productsListSource, /<ProductThermalLevelBadge row=\{row\}/);
});
