import test from "node:test";
import assert from "node:assert/strict";

import { classifyPrintProduct, PRINT_PRODUCT_KINDS } from "../shared/productPrintClassifier.js";
import { buildProductLabelPrintPlan, groupProductLabelPdfJobs } from "../shared/productLabelPrintPlan.js";

const variant = (id, size, stock, barcode, color = "Black") => ({ variant_id: id, size, stock, barcode, color, selling_price: 799 });
const product = (product_type, variants, extra = {}) => ({ id: 10, name: "Test Product", product_type, variants, ...extra });

test("classifier uses real product_type classification values", () => {
  assert.equal(classifyPrintProduct(product("sneakers", [])).kind, PRINT_PRODUCT_KINDS.BOXED_SHOES);
  assert.equal(classifyPrintProduct(product("crocs", [])).kind, PRINT_PRODUCT_KINDS.CROCS);
  assert.equal(classifyPrintProduct(product("bags", [])).kind, PRINT_PRODUCT_KINDS.BAGS);
});

test("smallest available shoe size gets one display and stock minus one boxes", () => {
  const plan = buildProductLabelPrintPlan([product("sneakers", [
    variant(1, "42", 2, "V42"),
    variant(2, "40", 3, "V40"),
  ])]);
  assert.equal(plan.counts.display, 1);
  assert.equal(plan.labels.filter((x) => x.variantId === 2 && x.type === "display").length, 1);
  assert.equal(plan.labels.filter((x) => x.variantId === 2 && x.type === "box").length, 2);
  assert.equal(plan.labels.filter((x) => x.variantId === 1 && x.type === "box").length, 2);
});

test("stock one for smallest shoe size produces display only", () => {
  const plan = buildProductLabelPrintPlan([product("shoes", [variant(1, "39", 1, "ONLY")])]);
  assert.equal(plan.counts.display, 1);
  assert.equal(plan.counts.box, 0);
});

test("one display is selected independently for every color", () => {
  const plan = buildProductLabelPrintPlan([product("footwear", [
    variant(1, "40", 2, "A", "Black"),
    variant(2, "41", 2, "B", "Black"),
    variant(3, "38", 2, "C", "White"),
  ])]);
  assert.equal(plan.counts.display, 2);
});

test("crocs create only 25x35 crocs labels", () => {
  const plan = buildProductLabelPrintPlan([product("crocs", [variant(1, "40/41", 2, "CROC")])]);
  assert.deepEqual(new Set(plan.labels.map((x) => `${x.type}:${x.widthMm}x${x.heightMm}`)), new Set(["crocs:25x35"]));
});

test("bags create landscape 55x40 labels with color and article instead of size", () => {
  const bagVariant = { ...variant(1, "ONE", 2, "BAG", "Red"), color_article_code: "RED-ART" };
  const plan = buildProductLabelPrintPlan([product("bags", [bagVariant])]);
  assert.equal(plan.counts.bag, 2);
  assert.ok(plan.labels.every((x) => x.widthMm === 55 && x.heightMm === 40 && x.fieldValue === "Red" && x.size === ""));
  assert.ok(plan.labels.every((x) => x.articleCode === "RED-ART"));
});

test("variant without barcode is excluded with a warning", () => {
  const plan = buildProductLabelPrintPlan([product("crocs", [variant(1, "40", 4, "")])]);
  assert.equal(plan.counts.total, 0);
  assert.match(plan.warnings[0], /barcode/);
});

test("unknown products fall back to 100x50 and do not stop the plan", () => {
  const plan = buildProductLabelPrintPlan([
    product("unknown-type", [variant(1, "M", 2, "OLD")]),
    { ...product("bags", [variant(2, "ONE", 1, "BAG")]), id: 11 },
  ]);
  assert.equal(plan.counts.box, 2);
  assert.equal(plan.counts.bag, 1);
  assert.ok(plan.warnings.some((x) => /100×50/.test(x)));
});

test("PDF jobs contain one physical page size and never mix label sizes", () => {
  const plan = buildProductLabelPrintPlan([
    product("sneakers", [variant(1, "40", 2, "SHOE")]),
    { ...product("crocs", [variant(2, "41", 1, "CROC")]), id: 11 },
    { ...product("bags", [variant(3, "ONE", 1, "BAG")]), id: 12 },
  ]);
  const jobs = groupProductLabelPdfJobs(plan);
  assert.deepEqual(jobs.map((x) => [x.key, x.widthMm, x.heightMm]), [
    ["box", 100, 50],
    ["display", 55, 40],
    ["bag", 55, 40],
    ["crocs", 25, 35],
  ]);
  jobs.forEach((job) => assert.ok(job.labels.every((label) => label.widthMm === job.widthMm && label.heightMm === job.heightMm)));
});

test("shoe box labels carry the color image with product image fallback", () => {
  const colorPlan = buildProductLabelPrintPlan([product(
    "sneakers",
    [{ ...variant(1, "40", 2, "COLOR-IMAGE"), image_url: "color.jpg" }],
    { image_url: "product.jpg" }
  )]);
  const colorBox = colorPlan.labels.find((label) => label.type === "box");
  assert.equal(colorBox.imageUrl, "color.jpg");
  assert.equal(colorBox.color_image_url, "color.jpg");
  assert.equal(colorBox.product_image_url, "product.jpg");

  const fallbackPlan = buildProductLabelPrintPlan([product(
    "sneakers",
    [{ ...variant(1, "40", 2, "PRODUCT-IMAGE"), image_url: "" }],
    { image_url: "product.jpg" }
  )]);
  assert.equal(fallbackPlan.labels.find((label) => label.type === "box").image_url, "product.jpg");
});

test("shoe box labels prioritize thermal image fields before normal images", () => {
  const plan = buildProductLabelPrintPlan([product(
    "sneakers",
    [{
      ...variant(1, "40", 2, "THERMAL"),
      image_url: "normal-color.jpg",
      color_thermal_image_url: "thermal-color.png",
      thermal_image_status: "ready",
    }],
    {
      image_url: "normal-product.jpg",
      product_thermal_image_url: "thermal-product.png",
      product_thermal_image_status: "ready",
    }
  )]);
  const label = plan.labels.find((item) => item.type === "box");
  assert.equal(label.color_thermal_image_url, "thermal-color.png");
  assert.equal(label.product_thermal_image_url, "thermal-product.png");
  assert.equal(label.variant_thermal_image_status, "ready");
  assert.equal(label.product_thermal_image_status, "ready");
});
